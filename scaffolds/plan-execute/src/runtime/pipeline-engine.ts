/**
 * 声明式流水线执行引擎。
 *
 * 读 pipeline.yaml → 按步骤执行 Agent 或子流水线 → 产物写进作用域供下游用表达式取值。
 *
 * 步骤能力：
 *   - input   表达式 / 带表达式的对象（`${plan.pages}`、`{ page: "${item}" }`）
 *   - when    条件为假则跳过（skipped）
 *   - retries 模型调用失败、输出不是 JSON、schema 不通过时重试；配置和表达式错误不重试
 *   - foreach 对数组逐项执行，parallel 控制并发（默认 1），任一项失败则整步失败（不再派发新项）
 *   - pipeline 嵌套子流水线，子作用域 = 父作用域 + 本步 input
 *
 * 运行目录里会写：
 *   state.json               每步 status / attempts / 起止时间 / error
 *   artifacts/<stepId>.json  每个成功步骤的产物
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Pipeline, PipelineStep, RunContext, SessionRequest } from "../types.js";
import { createRunContext } from "./run-context.js";
import { getDomainDir } from "./paths.js";
import { invokeSession } from "./sdk-client.js";
import { validate } from "./schema-resolver.js";
import { log } from "./log.js";
import { loadPromptFile } from "./prompt-file.js";
import { ExpressionError, hasExpression, isTruthy, resolveValue } from "./expr.js";
import { createStateStore, type StateStore } from "./pipeline-state.js";

/** 主流水线文件名 */
export const MAIN_PIPELINE = "deployment.pipeline.yaml";

/** 嵌套深度上限，防止子流水线互相引用 */
const MAX_DEPTH = 8;

export interface ExecutePipelineOptions {
  /** 注入自定义会话执行器（测试用） */
  invoke?: typeof invokeSession;
  /** 主流水线文件（相对域目录或绝对路径），默认 pipelines/deployment.pipeline.yaml */
  pipelineFile?: string;
}

/** 配置层面的错误（文件缺失、字段非法、foreach 不是数组），重试也没用 */
export class PipelineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineConfigError";
  }
}

/** 步骤 ID：优先 id，其次 name */
export function stepId(step: PipelineStep): string {
  return step.id ?? step.name ?? "";
}

/** 加载并校验流水线定义 */
export function loadPipeline(pipelinePath: string): Pipeline {
  if (!existsSync(pipelinePath)) throw new PipelineConfigError(`流水线文件不存在: ${pipelinePath}`);
  const parsed = parseYaml(readFileSync(pipelinePath, "utf-8")) as Partial<Pipeline> | null;
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new PipelineConfigError(`流水线定义无效（缺少 steps）: ${pipelinePath}`);
  }

  const seen = new Set<string>();
  for (const [i, step] of parsed.steps.entries()) {
    const where = `${pipelinePath} 第 ${i + 1} 步`;
    const id = stepId(step);
    if (!id) throw new PipelineConfigError(`${where} 缺少 id`);
    if (seen.has(id)) throw new PipelineConfigError(`${where} 的 id 重复: ${id}`);
    seen.add(id);
    if (!step.agent === !step.pipeline) {
      throw new PipelineConfigError(`${where}（${id}）必须且只能声明 agent 或 pipeline 之一`);
    }
    for (const key of ["parallel", "retries"] as const) {
      const v = step[key];
      const min = key === "parallel" ? 1 : 0;
      if (v !== undefined && (!Number.isInteger(v) || v < min)) {
        throw new PipelineConfigError(`${where}（${id}）的 ${key} 必须是 ≥${min} 的整数`);
      }
    }
    if (step.parallel !== undefined && !step.foreach) {
      throw new PipelineConfigError(`${where}（${id}）声明了 parallel 但没有 foreach`);
    }
  }

  return {
    name: parsed.name ?? "unnamed",
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.output !== undefined ? { output: parsed.output } : {}),
    steps: parsed.steps,
  };
}

/** 一次流水线运行共享的环境 */
interface Env {
  domainDir: string;
  ctx: RunContext;
  state: StateStore;
  invoke: typeof invokeSession;
}

/**
 * 执行一条流水线。
 *
 * @param userPrompt 原始用户输入
 * @param domainName 域名
 * @param runDir 运行目录
 * @returns 流水线产物（pipeline.output 表达式，缺省为最后一个执行的步骤的产物）
 */
export async function executePipeline(
  userPrompt: string,
  domainName: string,
  runDir: string,
  options: ExecutePipelineOptions = {},
): Promise<unknown> {
  const domainDir = getDomainDir(domainName);
  const pipelinePath = resolveInDomain(domainDir, options.pipelineFile ?? join("pipelines", MAIN_PIPELINE));
  const pipeline = loadPipeline(pipelinePath);
  const ctx = createRunContext(domainName, runDir);
  const state = createStateStore(runDir, pipeline.name);
  const env: Env = { domainDir, ctx, state, invoke: options.invoke ?? invokeSession };

  log(`[pipeline] 载入流水线 ${pipeline.name}（${pipeline.steps.length} 步）`);
  try {
    const result = await runPipeline(pipeline, { user_prompt: userPrompt }, env, "", 0);
    state.finish("done");
    log(`[pipeline] 流水线 ${pipeline.name} 执行完成`);
    return result;
  } catch (err) {
    state.finish("failed");
    throw err;
  }
}

/** 顺序执行一条流水线的步骤，返回它的产物 */
async function runPipeline(
  pipeline: Pipeline,
  scope: Record<string, unknown>,
  env: Env,
  prefix: string,
  depth: number,
): Promise<unknown> {
  if (depth > MAX_DEPTH) throw new PipelineConfigError(`子流水线嵌套超过 ${MAX_DEPTH} 层，检查是否循环引用`);
  let last: unknown;
  for (const step of pipeline.steps) {
    const id = prefix + stepId(step);
    const key = step.output ?? stepId(step);

    if (step.when !== undefined && !isTruthy(resolveValue(step.when, scope))) {
      env.state.skip(id);
      env.ctx.trace.event("pipeline.skip", { step: id, when: step.when });
      log(`[pipeline] 跳过 ${id}（when 为假）`);
      continue;
    }

    const value = step.foreach
      ? await runForeach(step, id, scope, env, depth)
      : await runWithRetries(step, id, scope, env, depth);
    scope[key] = value;
    last = value;
  }
  return pipeline.output !== undefined ? resolveValue(pipeline.output, scope) : last;
}

/** foreach：逐项执行，parallel 个 worker 抢任务，输出按输入顺序 */
async function runForeach(
  step: PipelineStep,
  id: string,
  scope: Record<string, unknown>,
  env: Env,
  depth: number,
): Promise<unknown[]> {
  env.state.start(id);
  const expr = hasExpression(step.foreach) ? step.foreach! : `\${${step.foreach}}`;
  const source = resolveValue(expr, scope);
  if (!Array.isArray(source)) {
    const msg = `步骤 ${id} 的 foreach 没有解析成数组: ${step.foreach}`;
    env.state.fail(id, msg);
    throw new PipelineConfigError(msg);
  }

  const concurrency = Math.min(step.parallel ?? 1, Math.max(source.length, 1));
  const results: unknown[] = new Array(source.length);
  const errors: string[] = [];
  let cursor = 0;

  // 旧写法 `foreach: key` 里，单项在作用域里也以原键名可见
  const legacyKey = hasExpression(step.foreach) ? undefined : step.foreach;

  const worker = async () => {
    for (;;) {
      if (errors.length) return; // fail-fast：已有失败就不再派发新项
      const index = cursor++;
      if (index >= source.length) return;
      const item = source[index];
      const itemScope = { ...scope, item, index, ...(legacyKey ? { [legacyKey]: item } : {}) };
      try {
        results[index] = await runWithRetries(
          { ...step, foreach: undefined, parallel: undefined },
          `${id}[${index}]`,
          itemScope,
          env,
          depth,
          legacyKey ? `\${${legacyKey}}` : undefined,
        );
      } catch (err) {
        errors.push(`[${index}] ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (errors.length) {
    const msg = `步骤 ${id} 有 ${errors.length} 项失败:\n${errors.join("\n")}`;
    env.state.fail(id, msg);
    throw new Error(msg);
  }
  env.state.done(id, results);
  return results;
}

/** 执行单个步骤（agent 或子流水线），按 retries 重试 */
async function runWithRetries(
  step: PipelineStep,
  id: string,
  scope: Record<string, unknown>,
  env: Env,
  depth: number,
  defaultInput?: string,
): Promise<unknown> {
  const maxAttempts = 1 + (step.retries ?? 0);
  env.state.start(id);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    env.state.attempt(id);
    try {
      const value = step.pipeline
        ? await runSubPipeline(step, id, scope, env, depth)
        : await runAgent(step, id, scope, env, defaultInput);
      env.state.done(id, value);
      return value;
    } catch (err) {
      lastError = err as Error;
      const fatal = err instanceof PipelineConfigError || err instanceof ExpressionError;
      env.ctx.trace.event("pipeline.attempt_failed", { step: id, attempt, error: lastError.message, fatal });
      if (fatal || attempt === maxAttempts) break;
      log(`[pipeline] ${id} 第 ${attempt}/${maxAttempts} 次失败，重试: ${lastError.message}`);
    }
  }
  env.state.fail(id, lastError?.message ?? "未知错误");
  throw lastError ?? new Error(`步骤 ${id} 失败`);
}

/** 子流水线：子作用域 = 父作用域 + 本步 input（对象时展开，其他值放在 input 键下） */
async function runSubPipeline(
  step: PipelineStep,
  id: string,
  scope: Record<string, unknown>,
  env: Env,
  depth: number,
): Promise<unknown> {
  const child = loadPipeline(resolveInDomain(env.domainDir, step.pipeline!));
  const input = step.input === undefined ? undefined : resolveInput(step.input, scope);
  const childScope: Record<string, unknown> = {
    ...scope,
    ...(isPlainObject(input) ? input : input === undefined ? {} : { input }),
  };
  env.ctx.trace.event("pipeline.subpipeline", { step: id, pipeline: child.name });
  return runPipeline(child, childScope, env, `${id}/`, depth + 1);
}

/** Agent 步骤：读提示词（含 frontmatter）→ 调模型 → 抽 JSON → schema 校验 */
async function runAgent(
  step: PipelineStep,
  id: string,
  scope: Record<string, unknown>,
  env: Env,
  defaultInput?: string,
): Promise<unknown> {
  const agentPath = resolveInDomain(env.domainDir, step.agent!);
  if (!existsSync(agentPath)) throw new PipelineConfigError(`步骤 ${id} 的 Agent 文件不存在: ${step.agent}`);
  const prompt = loadPromptFile(agentPath);
  const rawInput = step.input ?? defaultInput ?? "${user_prompt}";
  const input = resolveInput(rawInput, scope);

  env.ctx.trace.event("pipeline.step", { step: id, agent: step.agent });
  const req: SessionRequest = {
    systemPrompt: prompt.body,
    userMessage: renderInput(input),
    mcpConfigPath: env.ctx.mcpConfigPath,
    label: id,
    ...(prompt.allowedTools ? { allowedTools: prompt.allowedTools } : {}),
    ...(prompt.maxTurns ? { maxTurns: prompt.maxTurns } : {}),
  };
  const result = await env.invoke(req, env.ctx, id);
  const parsed = extractJson(result.output);

  const schemaRef = step.schema ?? (prompt.outputSchema ? schemaPathOf(prompt.outputSchema) : undefined);
  if (schemaRef) {
    const schemaPath = resolveInDomain(env.domainDir, schemaRef);
    if (!existsSync(schemaPath)) throw new PipelineConfigError(`步骤 ${id} 的 schema 不存在: ${schemaRef}`);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    const check = validate(parsed, schema);
    if (!check.valid) {
      throw new Error(`流水线步骤 ${id} 产物不符合 schema ${schemaRef}:\n${check.errors.join("\n")}`);
    }
  }
  return parsed;
}

/** 旧写法：不带 `${}` 的字符串视为上下文键名 */
function resolveInput(raw: unknown, scope: Record<string, unknown>): unknown {
  if (typeof raw === "string" && !hasExpression(raw)) return scope[raw];
  return resolveValue(raw, scope);
}

/** frontmatter 的 outputSchema 只写文件名时，到域的 schemas/ 下找 */
function schemaPathOf(name: string): string {
  return name.includes("/") ? name : join("schemas", name);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 在域目录内解析相对路径 */
function resolveInDomain(domainDir: string, relative: string): string {
  return isAbsolute(relative) ? relative : join(domainDir, relative);
}

/** 把输入渲染成给 Agent 的文本 */
function renderInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === undefined || input === null) return "";
  return JSON.stringify(input, null, 2);
}

/**
 * 从模型输出里抽取 JSON。
 * 兼容裸 JSON、```json 代码块、以及前后带说明文字的情况。
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("模型输出为空，无法解析 JSON");

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试其它形态 */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续 */
    }
  }

  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(trimmed.slice(firstObj, lastObj + 1));
    } catch {
      /* 继续 */
    }
  }

  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    try {
      return JSON.parse(trimmed.slice(firstArr, lastArr + 1));
    } catch {
      /* 继续 */
    }
  }

  throw new Error(`模型输出无法解析为 JSON: ${trimmed.slice(0, 200)}`);
}
