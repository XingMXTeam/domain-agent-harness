/**
 * MCP 客户端池 —— 管理一个域下的多个 MCP 服务，支持并发调用、失败重试与会话重建。
 *
 * 工具名统一采用 `mcp__<server>__<tool>` 三段式。
 */
import { readFileSync } from "node:fs";
import { log, logDebug, logError } from "./log.js";

/** MCP 调用结果 */
export interface McpCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** 单个 MCP 服务配置 */
export interface McpServerConfig {
  type?: "http" | "stdio" | "sse";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** MCP 配置（与 `.mcp.json` 结构兼容） */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** MCP 协议版本 */
const PROTOCOL_VERSION = "2025-03-26";

/** 单个服务的 HTTP 客户端 */
class McpHttpClient {
  private sessionId?: string;
  private idCounter = 0;
  private initialized = false;

  constructor(
    readonly serverName: string,
    private readonly url: string,
    private readonly baseHeaders: Record<string, string>,
    private readonly timeoutMs = 60_000,
  ) {}

  /** 建立会话。初始化前会清掉旧 sessionId，避免失效会话头导致 404。 */
  async initialize(): Promise<void> {
    this.sessionId = undefined;
    this.initialized = false;
    log(`[mcp:${this.serverName}] initializing → ${this.url}`);

    const res = await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "domain-agent-harness", version: "0.1.0" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `[mcp:${this.serverName}] initialize failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }

    this.sessionId = res.headers.get("mcp-session-id") ?? undefined;
    await this.notify("notifications/initialized");
    this.initialized = true;
    log(`[mcp:${this.serverName}] initialized, session=${this.sessionId ?? "(none)"}`);
  }

  /** 列出服务端提供的工具 */
  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) await this.initialize();
    const res = await this.rpc("tools/list");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `[mcp:${this.serverName}] tools/list failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const message = await this.parseResponse(res);
    const result = message.result as { tools?: McpTool[] } | undefined;
    return result?.tools ?? [];
  }

  /** 调用工具，失败时重试并重建会话 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    for (let attempt = 0; attempt <= CALL_MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await this.rpc("tools/call", { name, arguments: args });
      } catch (fetchErr) {
        // 网络级错误（DNS / TCP 连接失败等）
        if (attempt < CALL_MAX_RETRIES) {
          logError(
            `[mcp:${this.serverName}] ${name} fetch error (attempt ${attempt + 1}/${CALL_MAX_RETRIES + 1})`,
          );
          await this.retryWithReInit(attempt);
          continue;
        }
        return {
          success: false,
          error: `fetch error: ${(fetchErr as Error).message}`,
        };
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (attempt < CALL_MAX_RETRIES && res.status >= 500) {
          logError(
            `[mcp:${this.serverName}] ${name} HTTP ${res.status} (attempt ${attempt + 1}/${CALL_MAX_RETRIES + 1})`,
          );
          await this.retryWithReInit(attempt);
          continue;
        }
        return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
      }

      const message = await this.parseResponse(res);
      if (message.error) {
        return {
          success: false,
          error: message.error.message ?? JSON.stringify(message.error),
        };
      }
      const result = message.result as
        | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
        | undefined;
      const text = (result?.content ?? [])
        .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
        .join("\n");
      if (result?.isError) {
        return { success: false, error: text };
      }
      return { success: true, data: parseMaybeJson(text) };
    }
    return { success: false, error: "超过最大重试次数" };
  }

  /** 退避后重建会话 */
  private async retryWithReInit(attempt: number): Promise<void> {
    await sleep(CALL_BASE_DELAY_MS * 2 ** attempt);
    try {
      await this.initialize();
    } catch (err) {
      logError(`[mcp:${this.serverName}] 重建会话失败: ${(err as Error).message}`);
    }
  }

  private async rpc(method: string, params?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.baseHeaders,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: ++this.idCounter,
      method,
    };
    if (params !== undefined) body.params = params;

    return fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async notify(method: string): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.baseHeaders,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    try {
      await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // 通知失败不影响主流程
    }
  }

  /** 解析响应体（兼容纯 JSON 与 SSE 帧） */
  private async parseResponse(res: Response): Promise<RpcMessage> {
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed) as RpcMessage;
      } catch {
        /* 落到 SSE 解析 */
      }
    }
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload) as RpcMessage;
      } catch {
        /* 继续找下一帧 */
      }
    }
    throw new Error(`无法解析 MCP 响应: ${trimmed.slice(0, 200)}`);
  }
}

interface RpcMessage {
  result?: unknown;
  error?: { message?: string };
}

/** MCP 工具声明 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const CALL_MAX_RETRIES = 3;
const CALL_BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MCP 客户端池 —— 一个域对应一个池，池内含多个服务。
 */
export class McpClientPool {
  private readonly clients = new Map<string, McpHttpClient>();

  constructor(
    readonly servers: Record<string, McpServerConfig>,
    private readonly timeoutMs = 60_000,
  ) {}

  /** 连接池内全部服务 */
  static async create(
    config: McpConfig,
    timeoutMs = 60_000,
  ): Promise<McpClientPool> {
    const pool = new McpClientPool(config.mcpServers, timeoutMs);
    await pool.connectAll();
    return pool;
  }

  private async connectAll(): Promise<void> {
    for (const [name, server] of Object.entries(this.servers)) {
      if (!server.url) {
        logError(`[mcp:${name}] 缺少 url，跳过`);
        continue;
      }
      const client = new McpHttpClient(
        name,
        server.url,
        server.headers ?? {},
        this.timeoutMs,
      );
      try {
        await client.initialize();
        this.clients.set(name, client);
      } catch (err) {
        logError(`[mcp:${name}] 初始化失败: ${(err as Error).message}`);
      }
    }
  }

  /**
   * 调用工具。
   *
   * @param serverName 服务名
   * @param toolName 工具名
   * @param args 参数
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      return { success: false, error: `MCP 服务不可用: ${serverName}` };
    }
    return client.callTool(toolName, args);
  }

  /** 已连接的服务名 */
  get connectedServers(): string[] {
    return [...this.clients.keys()];
  }

  /** 列出全部服务的工具，统一命名为 `mcp__<server>__<tool>` */
  async listTools(): Promise<Array<{ server: string; tool: McpTool }>> {
    const out: Array<{ server: string; tool: McpTool }> = [];
    for (const [serverName, client] of this.clients) {
      try {
        for (const tool of await client.listTools()) {
          out.push({ server: serverName, tool });
        }
      } catch (err) {
        logError(`[mcp:${serverName}] tools/list 失败: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** 关闭全部会话 */
  async close(): Promise<void> {
    this.clients.clear();
  }
}

/** 从配置文件创建客户端池 */
export async function createMcpClientPool(
  configPath: string,
  timeoutMs = 60_000,
): Promise<McpClientPool> {
  let config: McpConfig = { mcpServers: {} };
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as McpConfig;
  } catch (err) {
    logError(`[mcp] 读取配置失败 ${configPath}: ${(err as Error).message}`);
  }
  logDebug(`[mcp] 配置加载自 ${configPath}`);
  return McpClientPool.create(config, timeoutMs);
}

/** MCP 返回的 content 往往是 JSON 文本，尝试解析 */
export function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}
