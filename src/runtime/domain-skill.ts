/**
 * 域内 skill 执行入口 —— 把 init / fix 这类「模型出计划、代码执行」的 skill 串起来。
 *
 * init：模型产出 plan.json → schema 校验 → Executor 分层执行
 * fix ：模型产出修复动作列表 → 逐条执行
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionItem, ExecutionResult, RunContext } from "../types.js";
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

  // init 的 JSON 解析失败不抛错，交给 schema 闸处理（回给模型修一次）
  let parsed = skill === "init" ? tryExtractJson(result.output) : extractJson(result.output);

  if (skill === "init") {
    // 计划必须过 schema：不合格就把错误回给模型修一次，仍不合格则不执行
    let errors = checkPlan(parsed, domainName);
    if (errors.length) {
      logWarn(`[domain:${domainName}] plan.json 不符合 schema，回给模型修正一次:\n${errors.join("\n")}`);
      const retry = await invoke(
        {
          systemPrompt: spec.body,
          userMessage:
            `${userPrompt}\n\n你上一次输出的 plan.json 不符合 schema：\n${errors.map((e) => `- ${e}`).join("\n")}\n` +
            `请修正后只输出完整的 JSON。上一次的输出：\n${JSON.stringify(parsed ?? null)}`,
          mcpConfigPath: ctx.mcpConfigPath,
          ...(spec.allowedTools ? { allowedTools: spec.allowedTools } : {}),
          ...(spec.maxTurns ? { maxTurns: spec.maxTurns } : {}),
        },
        ctx,
        `${skill}-repair`,
      );
      parsed = tryExtractJson(retry.output);
      errors = checkPlan(parsed, domainName);
    }
    if (errors.length) {
      writePlan(ctx, parsed);
      const summary = `计划不符合 schema，已拦截，未执行任何写操作：\n${errors.map((e) => `- ${e}`).join("\n")}`;
      logError(`[domain:${domainName}] ${summary}`);
      return { summary, execution: { success: false, items: [], summary }, plan: parsed, blocked: true };
    }
    return await runInit(skill, parsed, domainName, ctx);
  }
  if (skill === "fix") {
    return await runFix(skill, parsed, ctx, spec.allowedActions ?? []);
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
  /** DAH_PLAN_ONLY=1 时为 true：只产出了计划，未执行 */
  planOnly?: boolean;
  /** 计划被代码拦截（schema 不合格），未执行 */
  blocked?: boolean;
}

/** init：校验 plan.json 并交给域 executor 执行 */
async function runInit(
  skill: string,
  plan: unknown,
  domainName: string,
  ctx: RunContext,
): Promise<DomainSkillOutcome> {
  // 计划始终落盘，便于复盘与评测
  writePlan(ctx, plan);

  // 只规划不执行（评测 / 人工预览用）：不连平台写接口，不验收
  if (process.env.DAH_PLAN_ONLY === "1") {
    log(`[domain:${domainName}] DAH_PLAN_ONLY=1，只产出计划，不执行`);
    return { summary: JSON.stringify(plan ?? null, null, 2), execution: { planOnly: true }, plan, planOnly: true };
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

/** 按域的 plan.schema.json 校验计划，返回错误列表（空 = 合格） */
export function checkPlan(plan: unknown, domainName: string): string[] {
  if (plan === null || plan === undefined) return ["模型没有输出可解析的 JSON"];
  const schemaPath = join(getDomainDir(domainName), "schemas", "plan.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
  const check = validate(plan, schema);
  return check.valid ? [] : check.errors;
}

function tryExtractJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

function writePlan(ctx: RunContext, plan: unknown): void {
  writeFileSync(join(ctx.runDir, "plan.json"), JSON.stringify(plan ?? null, null, 2));
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

/**
 * fix：模型给出动作列表，代码逐条执行。
 * 只执行 spec.md frontmatter `allowedActions` 里列出的工具；没列 = 一个都不执行（默认拒绝）。
 */
export async function runFix(
  skill: string,
  payload: unknown,
  ctx: RunContext,
  allowedActions: string[],
  runner?: Pick<import("./tool-runner.js").ToolRunner, "call" | "close">,
): Promise<DomainSkillOutcome> {
  const actions = extractActions(payload);
  const allowed = new Set(allowedActions);
  const items: ExecutionItem[] = [];
  const toRun = actions.filter((a) => {
    if (allowed.has(a.tool)) return true;
    logError(`[fix] 动作 ${a.tool} 不在 allowedActions 内，拒绝执行`);
    items.push({ step: "fix", target: a.tool, ok: false, error: "不在 allowedActions 内，已拒绝" });
    return false;
  });
  if (toRun.length) {
    const { ToolRunner } = await import("./tool-runner.js");
    const r = runner ?? (await ToolRunner.open(ctx));
    try {
      for (const action of toRun) {
        log(`[fix] 执行 ${action.tool}`);
        try {
          await r.call(action.tool, action.args);
          items.push({ step: "fix", target: action.tool, ok: true });
        } catch (err) {
          logError(`[fix] ${action.tool} 失败: ${(err as Error).message}`);
          items.push({ step: "fix", target: action.tool, ok: false, error: (err as Error).message });
        }
      }
    } finally {
      await r.close();
    }
  }
  const okCount = items.filter((i) => i.ok).length;
  const summary = `修复动作 ${actions.length} 个：成功 ${okCount}，失败或拒绝 ${actions.length - okCount}`;
  log(`[domain:fix] skill ${skill} ${summary}`);
  return { summary, execution: { success: okCount === actions.length, items, summary } };
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
