/**
 * 运行上下文 —— 承载一次运行的生命周期信息，并负责生成 MCP 配置文件。
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpConfig, RunContext, Trace } from "../types.js";
import { DOMAINS_DIR, RUNS_ROOT } from "./paths.js";
import { createTrace } from "./trace.js";
import { log, logWarn } from "./log.js";

/** 生成一次运行的 ID */
export function makeRunId(): string {
  const now = new Date();
  const stamp =
    now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const rand = randomBytes(3).toString("hex");
  return `${stamp}-${rand}`;
}

/**
 * 创建运行上下文。
 *
 * @param domain 域名
 * @param existingRunDir 复用已有运行目录（Catalog 阶段复用正式运行的目录，避免生命周期割裂）
 */
export function createRunContext(domain: string, existingRunDir?: string): RunContext {
  const runId = existingRunDir
    ? existingRunDir.split(/[\\/]/).pop() ?? makeRunId()
    : makeRunId();
  const runDir = existingRunDir ?? join(RUNS_ROOT, runId);
  if (!existingRunDir) mkdirSync(runDir, { recursive: true });

  const trace = createTrace(runDir);
  const mcpConfigPath = buildMcpConfig(domain, runDir);

  return { runId, runDir, domain, trace, mcpConfigPath };
}

/**
 * 读取域的 mcp.json，替换 Token 占位符，写入运行目录。
 * 返回生成后的配置文件路径。
 */
export function buildMcpConfig(domain: string, runDir: string): string {
  const domainMcpPath = join(DOMAINS_DIR, domain, "mcp.json");
  let mcpConfig: McpConfig;
  try {
    mcpConfig = JSON.parse(readFileSync(domainMcpPath, "utf-8")) as McpConfig;
  } catch (err) {
    logWarn(`[mcp] 域 ${domain} 未提供 mcp.json（${(err as Error).message}），使用空配置`);
    mcpConfig = { mcpServers: {} };
  }
  const resolved = resolveTokenPlaceholders(mcpConfig) as McpConfig;
  const outPath = join(runDir, "mcp-config.json");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  return outPath;
}

/**
 * 递归替换配置中的 `{{ENV_VAR}}` 占位符。
 *
 * 支持带默认值的写法 `{{ENV_VAR:默认值}}`：环境变量未设置时用默认值，
 * 这样配置文件里可以直接写 `{{PLATFORM_MCP_URL:https://mcp.example.com/...}}`，
 * 用户只需用环境变量覆盖，不用改文件。
 *
 * 未设置且没有默认值的变量替换为空串，并在日志里提示，避免把字面量写进磁盘。
 */
export function resolveTokenPlaceholders<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(
      /\{\{([A-Z0-9_]+)(?::([^}]*))?\}\}/g,
      (_m, name: string, fallback?: string) => {
        const replacement = process.env[name];
        if (replacement) return replacement;
        if (fallback !== undefined) return fallback;
        logWarn(`[mcp] 环境变量 ${name} 未设置，替换为空串`);
        return "";
      },
    ) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTokenPlaceholders(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTokenPlaceholders(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** 供外部复用的 trace 类型别名 */
export type { Trace };
