/**
 * SDK 客户端 —— 一次「模型 + 工具」的完整会话。
 *
 * 流程：加载域的 MCP 配置 → 建立客户端池并拉取工具清单 → 构造带工具的 LLM 请求
 *      → 若模型请求工具则执行并回灌结果 → 直到模型不再请求工具。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext, SessionRequest, SessionResult } from "../types.js";
import { createMcpClientPool, type McpClientPool } from "./mcp-client.js";
import {
  createLlmClient,
  type ChatMessage,
  type ContentPart,
  type LlmClient,
  type ToolSpec,
} from "./llm.js";
import { loadLlmConfig } from "./config.js";
import { log, logDebug, logError } from "./log.js";

/** 单次会话允许的最大工具轮数，防止死循环 */
const MAX_TOOL_ROUNDS = 30;

export interface InvokeSessionOptions {
  /** 注入自定义 LLM 客户端（测试用） */
  llm?: LlmClient;
  /** 注入自定义 MCP 客户端池（测试用） */
  pool?: McpClientPool;
}

/**
 * 执行一次会话。
 *
 * @param req 会话请求
 * @param ctx 运行上下文
 * @param label 会话标签，用于日志与产物文件名
 */
export async function invokeSession(
  req: SessionRequest,
  ctx: RunContext,
  label: string,
  options: InvokeSessionOptions = {},
): Promise<SessionResult> {
  const llm = options.llm ?? createLlmClient(loadLlmConfig());
  const ownsPool = !options.pool;
  const pool = options.pool ?? (await createMcpClientPool(ctx.mcpConfigPath));

  try {
    const tools = await collectTools(pool);
    logDebug(`[session:${label}] 可用工具 ${tools.length} 个`);

    // 传了数组（含空数组）就是白名单；空数组 = 不给任何工具。只有不传才不限制。
    const allowed = req.allowedTools ? new Set(req.allowedTools) : undefined;
    const usableTools = allowed
      ? tools.filter((t) => allowed.has(t.name))
      : tools;

    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: req.userMessage }] },
    ];

    let lastText = "";
    let usage: SessionResult["usage"];
    let rounds = 0;
    const maxRounds = req.maxTurns && req.maxTurns > 0 ? req.maxTurns : MAX_TOOL_ROUNDS;

    for (;;) {
      rounds += 1;
      if (rounds > maxRounds) {
        log(`[session:${label}] 工具轮数超过上限 ${maxRounds}，强制结束`);
        break;
      }

      const resp = await llm.chat({
        system: req.systemPrompt,
        messages,
        tools: usableTools,
      });

      lastText = resp.text;
      usage = resp.usage;

      const toolUses = resp.content.filter(
        (p): p is Extract<ContentPart, { type: "tool_use" }> => p.type === "tool_use",
      );
      if (toolUses.length === 0) break;

      messages.push({ role: "assistant", content: resp.content });

      const results: ContentPart[] = [];
      for (const call of toolUses) {
        const result = await executeToolCall(pool, call, label, allowed);
        results.push({
          type: "tool_result",
          toolUseId: call.id,
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
    }

    const finalText =
      lastText ||
      messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) => m.content)
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");

    const result: SessionResult = {
      output: finalText,
      ...(usage ? { usage } : {}),
    };

    writeTranscript(ctx, label, { request: req, messages, result });
    return result;
  } finally {
    if (ownsPool) await pool.close();
  }
}

/** 汇总池内所有服务的工具 */
async function collectTools(pool: McpClientPool): Promise<ToolSpec[]> {
  const listed = await pool.listTools();
  return listed.map(({ server, tool }) => ({
    name: `mcp__${server}__${tool.name}`,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
  }));
}

/** 执行单个工具调用 */
async function executeToolCall(
  pool: McpClientPool,
  call: Extract<ContentPart, { type: "tool_use" }>,
  label: string,
  allowed?: Set<string>,
): Promise<{ content: string; isError?: boolean }> {
  const parts = call.name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") {
    return { content: `未知工具: ${call.name}`, isError: true };
  }
  // 白名单是硬约束：即使模型硬编码了一个未提供的工具，也不得执行
  if (allowed && !allowed.has(call.name)) {
    logError(`[session:${label}] 工具 ${call.name} 不在白名单内，拒绝执行`);
    return { content: `工具 ${call.name} 不在允许列表内，拒绝执行`, isError: true };
  }
  const serverName = parts[1] ?? "";
  const toolName = parts.slice(2).join("__");
  try {
    logDebug(`[session:${label}] 调用工具 ${call.name}`);
    const result = await pool.callTool(serverName, toolName, call.input);
    if (!result.success) {
      return { content: `工具调用失败: ${result.error ?? "未知错误"}`, isError: true };
    }
    const data = result.data;
    const content =
      typeof data === "string" ? data : JSON.stringify(data ?? null, null, 2);
    return { content };
  } catch (err) {
    return { content: `工具调用失败: ${(err as Error).message}`, isError: true };
  }
}

/** 落盘会话记录，便于复盘 */
function writeTranscript(ctx: RunContext, label: string, payload: unknown): void {
  try {
    const dir = join(ctx.runDir, "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.json`), JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    log(`[session:${label}] 会话记录写入失败: ${(err as Error).message}`);
  }
}
