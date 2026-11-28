/**
 * 域内 skill 执行入口 —— 把 init / fix 这类「模型出计划、代码执行」的 skill 串起来。
 *
 * init：模型产出 plan.json → schema 校验 → Executor 分层执行
 * fix ：模型产出修复动作列表 → 逐条执行
 */
import { join } from "node:path";
import type { ExecutionResult, RunContext } from "../types.js";
import { getDomainDir } from "./paths.js";
import { invokeSession } from "./sdk-client.js";
import { extractJson } from "./pipeline-engine.js";
import { validate } from "./schema-resolver.js";
import { log, logError, logWarn } from "./log.js";
import { loadPromptFile } from "./prompt-file.js";

export interface RunDomainSkillOptions {
  /** 注入自定义会话执行器（测试用） */
  invoke?: typeof invokeSession;
}

/**
 * 执行域内 skill。
 *
 * @param skill skill 名（init / fix / ...）
 * @param userPrompt 用户输入
 * @param domainName 域名
 * @param ctx 运行上下文
 */
export async function runDomainSkill(
  skill: string,
  userPrompt: string,
  domainName: string,
  ctx: RunContext,
  options: RunDomainSkillOptions = {},
): Promise<DomainSkillOutcome> {
  const invoke = options.invoke ?? invokeSession;
  const domainDir = getDomainDir(domainName);
  const specPath = join(domainDir, "skills", skill, "spec.md");

  const spec = loadPromptFile(specPath);

  const result = await invoke(
    {
      systemPrompt: spec.body,
      userMessage: userPrompt,
      mcpConfigPath: ctx.mcpConfigPath,
      ...(spec.allowedTools ? { allowedTools: spec.allowedTools } : {}),
      ...(spec.maxTurns ? { maxTurns: spec.maxTurns } : {}),
    },
    ctx,
    skill,
  );

  const parsed = extractJson(result.output);

  if (skill === "init") {
    return await runInit(skill, parsed, domainName, ctx);
  }
  if (skill === "fix") {
    return await runFix(skill, parsed, ctx);
  }

  log(`[domain:${domainName}] skill ${skill} 已完成（未定义代码执行阶段）`);
  return { summary: result.output, execution: parsed };
}

/** 域内 skill 的产出 */
export interface DomainSkillOutcome {
  /** 人类可读摘要 */
  summary: string;
  /** 结构化执行结果，交给 Review 阶段 */
  execution: unknown;
  /** 模型产出的计划（init 才有），验收用它确定建了哪些页、每页对应哪篇页面知识 */
  plan?: unknown;
}

/** init：校验 plan.json 并交给域 executor 执行 */
async function runInit(
  skill: string,
  plan: unknown,
  domainName: string,
  ctx: RunContext,
): Promise<DomainSkillOutcome> {
  const domainDir = getDomainDir(domainName);
  const schemaPath = join(domainDir, "schemas", "plan.schema.json");

  try {
    const { readFileSync } = await import("node:fs");
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    const check = validate(plan, schema);
    if (!check.valid) {
      throw new Error(`plan.json 不符合 schema:\n${check.errors.join("\n")}`);
    }
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
    const e = err as Error;
    if (!e.message.includes("不符合 schema")) throw e;
    logWarn(`[domain:${domainName}] ${e.message}`);
  }

  const { executor } = await import("../domains/build/executor.js");
  const execution = (await executor.execute(plan as never, ctx)) as ExecutionResult;
  log(`[domain:${domainName}] skill ${skill} 执行完成`);
  const failed = execution.items.filter((item) => !item.ok);
  const lines = [
    `执行结果：${execution.success ? "成功" : "部分失败"}`,
    `摘要：${execution.summary}`,
  ];
  for (const item of failed) {
    lines.push(`- [${item.step}] ${item.target}: ${item.error ?? "失败"}`);
  }
  const todos = manualTodosOf(plan);
  if (todos.length) {
    lines.push(`人工待办：${todos.length} 项`);
    for (const t of todos) lines.push(`- ${t.pageName} / ${t.floorName}${t.reason ? `：${t.reason}` : ""}`);
  }
  return { summary: lines.join("\n"), execution, plan };
}

/** 计划里知识库标记为人工配置、不自动排期的楼层 */
interface ManualTodo {
  pageName: string;
  floorName: string;
  reason?: string;
}

export function manualTodosOf(plan: unknown): ManualTodo[] {
  const list = (plan as { manualTodos?: unknown } | null)?.manualTodos;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (t): t is ManualTodo =>
      !!t && typeof (t as ManualTodo).pageName === "string" && typeof (t as ManualTodo).floorName === "string",
  );
}

/** fix：模型给出动作列表，逐条调用 */
async function runFix(
  skill: string,
  payload: unknown,
  ctx: RunContext,
): Promise<DomainSkillOutcome> {
  const { ToolRunner } = await import("./tool-runner.js");
  const actions = extractActions(payload);
  const runner = await ToolRunner.open(ctx);
  try {
    for (const action of actions) {
      log(`[fix] 执行 ${action.tool}`);
      try {
        await runner.call(action.tool, action.args);
      } catch (err) {
        logError(`[fix] ${action.tool} 失败: ${(err as Error).message}`);
      }
    }
  } finally {
    await runner.close();
  }
  log(`[domain:fix] skill ${skill} 执行完成（${actions.length} 个动作）`);
  const summary = `修复动作 ${actions.length} 个已执行`;
  return { summary, execution: { success: true, items: actions, summary } };
}

interface FixAction {
  tool: string;
  args: Record<string, unknown>;
}

function extractActions(payload: unknown): FixAction[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is FixAction =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FixAction).tool === "string",
    );
  }
  if (payload && typeof payload === "object") {
    const actions = (payload as { actions?: unknown }).actions;
    if (Array.isArray(actions)) return extractActions(actions);
  }
  return [];
}
