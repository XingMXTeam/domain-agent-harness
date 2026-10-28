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
): Promise<string> {
  const invoke = options.invoke ?? invokeSession;
  const domainDir = getDomainDir(domainName);
  const specPath = join(domainDir, "skills", skill, "spec.md");

  const spec = await import("node:fs").then((fs) =>
    fs.readFileSync(specPath, "utf-8"),
  );

  const result = await invoke(
    {
      systemPrompt: spec,
      userMessage: userPrompt,
      mcpConfigPath: ctx.mcpConfigPath,
    },
    ctx,
    skill,
  );

  const parsed = extractJson(result.output);

  if (skill === "init") {
    const summary = await runInit(skill, parsed, domainName, ctx);
    return summary;
  }
  if (skill === "fix") {
    return await runFix(skill, parsed, ctx);
  }

  log(`[domain:${domainName}] skill ${skill} 已完成（未定义代码执行阶段）`);
  return result.output;
}

/** init：校验 plan.json 并交给域 executor 执行 */
async function runInit(
  skill: string,
  plan: unknown,
  domainName: string,
  ctx: RunContext,
): Promise<string> {
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
  return lines.join("\n");
}

/** fix：模型给出动作列表，逐条调用 */
async function runFix(
  skill: string,
  payload: unknown,
  ctx: RunContext,
): Promise<string> {
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
  return `修复动作 ${actions.length} 个已执行`;
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
