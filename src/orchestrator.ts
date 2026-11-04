/**
 * 编排器 —— 多域 Agent Harness 的中枢。
 *
 * Phase 0  Catalog Route：读 src/prompts/catalog.md，用一次轻量 LLM 调用判定域。
 * Phase 1  引擎分派：session 引擎走域内 skill 路由；pipeline 引擎走声明式流水线。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "./types.js";
import { createRunContext, makeRunId } from "./runtime/run-context.js";
import { createTrace } from "./runtime/trace.js";
import { getDomainDir, PROMPTS_DIR, RUNS_ROOT } from "./runtime/paths.js";
import { invokeSession } from "./runtime/sdk-client.js";
import type { LlmClient } from "./runtime/llm.js";
import { executePipeline, extractJson } from "./runtime/pipeline-engine.js";
import { loadPromptFile } from "./runtime/prompt-file.js";
import { log, logError } from "./runtime/log.js";

/** 编排器可选参数（测试时可注入 mock LLM） */
export interface OrchestrateOptions {
  llm?: LlmClient;
}

/** 合法域名 */
export const VALID_DOMAINS = ["build", "qa", "gop"] as const;
export type DomainName = (typeof VALID_DOMAINS)[number];

/** 执行引擎类型 */
export type EngineType = "session" | "pipeline";

/** 域元信息：决定该域走哪条执行引擎 */
export interface DomainMeta {
  engine: EngineType;
  /** 单 skill 域：路由后直接进入该 skill，跳过域内 brain routing */
  singleSkill?: string;
}

/** 域配置：skill 白名单 + 工具白名单 */
export interface DomainConfig {
  validSkills: string[];
  singleSkill?: string;
  queryAllowedTools: string[];
}

/**
 * 只读工具白名单。
 *
 * 平台接入方应按自己的 MCP 服务替换这份清单：
 * 工具名统一采用 `mcp__<server>__<tool>` 三段式，代码侧与 System Prompt 双重约束。
 */
export const QUERY_ALLOWED_TOOLS: string[] = [
  // —— 活动搭建平台（只读）——
  "mcp__platform__scene_getList",
  "mcp__platform__scene_getById",
  "mcp__platform__childScene_getList",
  "mcp__platform__childScene_getById",
  "mcp__platform__childScene_getCountryTimeList",
  "mcp__platform__category_getList",
  "mcp__platform__category_getById",
  "mcp__platform__page_getBasic",
  "mcp__platform__page_listModules",
  "mcp__platform__module_listResourcesAndSchedules",
  "mcp__platform__schedule_getContent",
  "mcp__platform__schedule_getPoolInfo",
  "mcp__platform__schedule_createOrGetList",
  "mcp__platform__modulePool_getModulesWithTemplate",
  "mcp__platform__modulePool_searchModuleVersions",
  "mcp__platform__freeze_getByChildSceneId",
  "mcp__platform__user_getCurrentUser",
  // —— 多语言素材平台（只读）——
  "mcp__locale__locale_getLanguageList",
  "mcp__locale__locale_getTextInfo",
  "mcp__locale__locale_getCategoryTree",
  "mcp__locale__locale_getTagList",
  "mcp__locale__locale_getSceneList",
  "mcp__locale__locale_getSceneInfo",
  "mcp__locale__locale_getSceneTexts",
  "mcp__locale__locale_queryTextsByLocaleKeys",
  "mcp__locale__locale_getImageScenes",
  "mcp__locale__locale_getImageStatus",
];

/** 域元信息表 */
export const DOMAIN_META: Record<string, DomainMeta> = {
  build: { engine: "session" },
  qa: { engine: "session", singleSkill: "query" },
  gop: { engine: "pipeline" },
};

/** 域配置表 */
export const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  build: {
    validSkills: ["init", "query", "fix"],
    queryAllowedTools: QUERY_ALLOWED_TOOLS,
  },
  qa: {
    validSkills: ["query"],
    singleSkill: "query",
    queryAllowedTools: QUERY_ALLOWED_TOOLS,
  },
  gop: {
    validSkills: [],
    queryAllowedTools: QUERY_ALLOWED_TOOLS,
  },
};


/**
 * Catalog 路由：用一次轻量 LLM 调用判定用户请求应落到哪个域。
 *
 * 使用临时 RunContext（域名为占位符 `_catalog`），不依赖目标域的任何配置。
 * 路由失败时兜底到 qa —— 查询比创建安全。
 */
export async function catalogRoute(
  userPrompt: string,
  runDir: string,
  options: OrchestrateOptions = {},
): Promise<string> {
  log("▶ Phase 0: Catalog Route (域识别)");
  const catalogPath = join(PROMPTS_DIR, "catalog.md");
  const catalog = readFileSync(catalogPath, "utf-8");

  // catalog 阶段使用临时空 MCP 配置，不需要外部工具
  const emptyMcpPath = join(runDir, "mcp-catalog.json");
  writeFileSync(emptyMcpPath, JSON.stringify({ mcpServers: {} }));

  // 复用现有 trace 结构，但不依赖 domain 信息
  const tempTrace = createTrace(runDir);
  const tempCtx: RunContext = {
    runId: runDir.split(/[\\/]/).pop() ?? makeRunId(),
    runDir,
    domain: "_catalog",
    trace: tempTrace,
    mcpConfigPath: emptyMcpPath,
  };

  try {
    const result = await invokeSession(
      {
        systemPrompt: catalog,
        userMessage: userPrompt,
        mcpConfigPath: emptyMcpPath,
      },
      tempCtx,
      "catalog",
      options.llm ? { llm: options.llm } : {},
    );
    const parsed = extractJson(result.output) as { domain?: string } | null;
    const domain = parsed?.domain;
    if (domain && (VALID_DOMAINS as readonly string[]).includes(domain)) {
      return domain;
    }
    logError("[catalog] 路由结果非法:", JSON.stringify(parsed));
  } catch (e) {
    logError("[catalog] 路由失败，兜底 qa:", (e as Error).message);
  }
  return "qa"; // 兜底: 查询比创建安全
}

/**
 * 编排入口。
 *
 * @param userPrompt 用户输入
 * @param domainName 可选域名；不传则自动路由
 */
export async function orchestrate(
  userPrompt: string,
  domainName?: string,
  options: OrchestrateOptions = {},
): Promise<void> {
  const runId = makeRunId();
  const runDir = join(RUNS_ROOT, runId);
  mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const domainAtStart = domainName ?? "_pending";
  writeMeta(runDir, {
    runId,
    domain: domainAtStart,
    status: "running",
    startedAt,
  });

  // Step 1: 确定域
  if (!domainName) {
    domainName = await catalogRoute(userPrompt, runDir, options);
    log(`[catalog] 自动路由到域: ${domainName}`);
  }
  writeMeta(runDir, { runId, domain: domainName, status: "running", startedAt });

  try {
    await runDomain(domainName, userPrompt, runId, runDir, options);
  } catch (err) {
    writeMeta(runDir, {
      runId,
      domain: domainName,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  writeMeta(runDir, {
    runId,
    domain: domainName,
    status: "done",
    startedAt,
    endedAt: new Date().toISOString(),
  });
}

/** 域内执行主体 */
async function runDomain(
  domainName: string,
  userPrompt: string,
  runId: string,
  runDir: string,
  options: OrchestrateOptions,
): Promise<void> {
  const meta = DOMAIN_META[domainName];
  if (!meta) throw new Error(`Unknown domain: ${domainName}`);
  const config = DOMAIN_CONFIGS[domainName];
  if (!config) throw new Error(`Unknown domain config: ${domainName}`);
  const domainConfig: DomainConfig = config;

  // Step 2: 根据引擎类型分派
  if (meta.engine === "pipeline") {
    // gop 域: 声明式流水线执行
    const report = await executePipeline(userPrompt, domainName, runDir);
    printAnswer(report);
    return;
  }

  // session 引擎: build / qa
  const ctx = createRunContext(domainName, runDir);

  // 单 skill 域优化 —— 跳过 brain routing
  if (domainConfig.singleSkill) {
    const answer = await executeQuerySkill(
      userPrompt,
      getDomainDir(domainName),
      ctx,
      domainConfig.queryAllowedTools,
      options,
    );
    printAnswer(answer);
    return;
  }

  // 多 skill 域: 走域内 brain routing
  const skill = await routeSkill(userPrompt, domainName, ctx, options);
  if (skill === "query") {
    const answer = await executeQuerySkill(
      userPrompt,
      getDomainDir(domainName),
      ctx,
      domainConfig.queryAllowedTools,
      options,
    );
    printAnswer(answer);
    return;
  }

  // init / fix 走域内 executor
  const { runDomainSkill } = await import("./runtime/domain-skill.js");
  const outcome = await runDomainSkill(skill, userPrompt, domainName, ctx);

  // Phase 3a: 验收 —— 代码按 review-rules 只读核对平台状态，pass / fail 由代码判定
  const acceptance = skill === "init" ? await runBuildAcceptance(outcome, ctx) : undefined;

  // Phase 3b: Review —— 模型只读审查，解释原因、给建议；不能推翻验收结论
  const { runReview, formatReview } = await import("./runtime/review.js");
  const review = await runReview(
    skill,
    acceptance ? { ...(outcome.execution as object), acceptance } : outcome.execution,
    domainName,
    ctx,
    { llm: options.llm },
  );
  const sections: string[] = [];
  if (acceptance) {
    const { formatAcceptance } = await import("./domains/build/acceptance.js");
    sections.push(formatAcceptance(acceptance));
  }
  if (review) {
    const blocked = acceptance?.ran === true && !acceptance.ok;
    sections.push(formatReview(blocked ? { ...review, ok: false } : review));
  } else {
    sections.push(outcome.summary);
  }
  printAnswer(sections.join("\n\n"));
}

/** build 域 init 之后的验收；平台读不到时记成未通过而不是抛错 */
async function runBuildAcceptance(
  outcome: { execution: unknown; plan?: unknown },
  ctx: RunContext,
) {
  const { runAcceptance, mcpAcceptanceSource } = await import("./domains/build/acceptance.js");
  const { createMcpClientPool } = await import("./runtime/mcp-client.js");
  const pool = await createMcpClientPool(ctx.mcpConfigPath);
  try {
    return await runAcceptance(outcome.plan, outcome.execution as never, mcpAcceptanceSource(pool));
  } finally {
    await pool.close();
  }
}

/**
 * 域内 brain routing：读域的 brain.md，用一次 LLM 调用在域内 skill 之间选择。
 */
export async function routeSkill(
  userPrompt: string,
  domainName: string,
  ctx: RunContext,
  options: OrchestrateOptions = {},
): Promise<string> {
  const domainDir = getDomainDir(domainName);
  const brainPath = join(domainDir, "brain.md");
  const brain = readFileSync(brainPath, "utf-8");
  const config = DOMAIN_CONFIGS[domainName];

  const result = await invokeSession(
    {
      systemPrompt: brain,
      userMessage: userPrompt,
      mcpConfigPath: ctx.mcpConfigPath,
    },
    ctx,
    "brain",
    options.llm ? { llm: options.llm } : {},
  );

  const parsed = extractJson(result.output) as { skill?: string } | null;
  const skill = parsed?.skill ?? "";
  const validSkills = DOMAIN_CONFIGS[domainName]?.validSkills ?? [];
  if (!validSkills.includes(skill)) {
    logError(`[brain] 非法 skill "${skill}"，可用: ${validSkills.join(", ")}`);
    return validSkills[0] ?? "query";
  }
  return skill;
}

/**
 * 执行 query skill：读 spec.md 作为 System Prompt，按白名单限制工具。
 */
export async function executeQuerySkill(
  userPrompt: string,
  domainDir: string,
  ctx: RunContext,
  allowedTools: string[],
  options: OrchestrateOptions = {},
): Promise<string> {
  const specPath = join(domainDir, "skills", "query", "spec.md");
  const spec = loadPromptFile(specPath);

  const result = await invokeSession(
    {
      systemPrompt: spec.body,
      userMessage: userPrompt,
      mcpConfigPath: ctx.mcpConfigPath,
      allowedTools: spec.allowedTools ?? allowedTools,
      ...(spec.maxTurns ? { maxTurns: spec.maxTurns } : {}),
    },
    ctx,
    "query",
    options.llm ? { llm: options.llm } : {},
  );
  return result.output;
}

/** 运行元信息 */
export interface RunMeta {
  runId: string;
  domain: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  error?: string;
}

/** 写运行元信息到 `<runDir>/meta.json` */
export function writeMeta(runDir: string, meta: RunMeta): void {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  } catch (err) {
    logError("[meta] 写入失败:", (err as Error).message);
  }
}

/**
 * 打印最终答案。
 *
 * stdout 留给用户看的结果；日志与结构化进度都在 stderr。
 */
export function printAnswer(answer: unknown): void {
  if (answer === undefined || answer === null) return;
  if (typeof answer === "string") {
    process.stdout.write(`${answer}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
}
