/**
 * 声明式流水线执行引擎。
 *
 * 解析 pipeline.yaml → 按 step 顺序执行 Agent → 通过 context 字典在步骤间传递产物。
 * step 产物的键即 step.output。
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Pipeline, PipelineStep, RunContext } from "../types.js";
import { createRunContext } from "./run-context.js";
import { getDomainDir } from "./paths.js";
import { invokeSession } from "./sdk-client.js";
import { validate } from "./schema-resolver.js";
import { log, logWarn } from "./log.js";

export interface ExecutePipelineOptions {
  /** 注入自定义会话执行器（测试用） */
  invoke?: typeof invokeSession;
}

/** 加载并解析流水线定义 */
export function loadPipeline(pipelinePath: string): Pipeline {
  const raw = readFileSync(pipelinePath, "utf-8");
  const parsed = parseYaml(raw) as Partial<Pipeline>;
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error(`流水线定义无效（缺少 steps）: ${pipelinePath}`);
  }
  return {
    name: parsed.name ?? "unnamed",
    ...(parsed.description ? { description: parsed.description } : {}),
    steps: parsed.steps,
  };
}

/**
 * 执行一条流水线。
 *
 * @param userPrompt 原始用户输入
 * @param domainName 域名
 * @param runDir 运行目录
 */
export async function executePipeline(
  userPrompt: string,
  domainName: string,
  runDir: string,
  options: ExecutePipelineOptions = {},
): Promise<unknown> {
  const invoke = options.invoke ?? invokeSession;
  const domainDir = getDomainDir(domainName);
  const pipelinePath = join(domainDir, "pipelines", "deployment.pipeline.yaml");
  const pipeline = loadPipeline(pipelinePath);

  log(`[pipeline] 载入流水线 ${pipeline.name}（${pipeline.steps.length} 步）`);

  const context: Record<string, unknown> = { user_prompt: userPrompt };

  let last: unknown = context.user_prompt;
  for (const step of pipeline.steps) {
    if (step.foreach) {
      last = await executeForEach(step, context, domainDir, runDir, domainName, invoke);
      continue;
    }
    const result = await executeAgent(step, context, domainDir, runDir, domainName, invoke);
    context[step.output] = result;
    last = result;
  }

  log(`[pipeline] 流水线 ${pipeline.name} 执行完成`);
  return last;
}

/** 普通 step：执行单个 Agent，产物写入 context[step.output] */
async function executeAgent(
  step: PipelineStep,
  context: Record<string, unknown>,
  domainDir: string,
  runDir: string,
  domainName: string,
  invoke: typeof invokeSession,
): Promise<unknown> {
  const agentPath = resolveInDomain(domainDir, step.agent);
  const systemPrompt = readFileSync(agentPath, "utf-8");
  const input = step.input ? context[step.input] : context.user_prompt;

  const ctx = createRunContext(domainName, runDir);
  ctx.trace.event("pipeline.step", { step: step.name, agent: step.agent });

  const result = await invoke(
    {
      systemPrompt,
      userMessage: renderInput(input),
      mcpConfigPath: ctx.mcpConfigPath,
      label: step.name,
    },
    ctx,
    step.name,
  );

  const parsed = extractJson(result.output);
  if (step.schema) {
    const schemaPath = resolveInDomain(domainDir, step.schema);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    const check = validate(parsed, schema);
    if (!check.valid) {
      throw new Error(
        `流水线步骤 ${step.name} 产物不符合 schema ${step.schema}:\n${check.errors.join("\n")}`,
      );
    }
  }
  return parsed;
}

/** foreach step：对上一步产物做数组展开，逐项执行 Agent */
async function executeForEach(
  step: PipelineStep,
  context: Record<string, unknown>,
  domainDir: string,
  runDir: string,
  domainName: string,
  invoke: typeof invokeSession,
): Promise<unknown[]> {
  const sourceKey = step.foreach;
  if (!sourceKey) {
    logWarn(`[pipeline] 步骤 ${step.name} 声明了 foreach 但缺少来源键，跳过`);
    return [];
  }
  const source = context[sourceKey];
  const items = Array.isArray(source) ? source : source ? [source] : [];
  const results: unknown[] = [];
  for (const [index, item] of items.entries()) {
    const scoped: PipelineStep = {
      ...step,
      name: `${step.name}[${index}]`,
      input: sourceKey,
    };
    const subContext: Record<string, unknown> = { ...context, [sourceKey]: item };
    results.push(await executeAgent(scoped, subContext, domainDir, runDir, domainName, invoke));
  }
  context[step.output] = results;
  return results;
}

/** 在域目录内解析相对路径 */
function resolveInDomain(domainDir: string, relative: string): string {
  return isAbsolute(relative) ? relative : join(domainDir, relative);
}

/** 把上一步产物渲染成给 Agent 的输入文本 */
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
