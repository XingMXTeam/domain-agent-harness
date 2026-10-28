/**
 * 端到端测试：起一个真实的本地 MCP HTTP 服务，跑通
 * 「模型决策 → 工具调用 → 结果回灌 → 最终输出」全链路。
 *
 * 不依赖任何外部服务与 API Key。
 */
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { invokeSession } from "../src/runtime/sdk-client.js";
import { createRunContext } from "../src/runtime/run-context.js";
import type { ChatRequest, ChatResponse, LlmClient } from "../src/runtime/llm.js";
import type { RunContext } from "../src/types.js";

const tempDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ── 本地 MCP 服务 ───────────────────────────────────────────

interface McpServerHandle {
  server: Server;
  url: string;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
}

async function startMcpServer(): Promise<McpServerHandle> {
  const calls: McpServerHandle["calls"] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body || "{}") as {
        id?: number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };

      const send = (payload: unknown) => {
        const text = JSON.stringify(payload);
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "test-session-1",
        });
        res.end(text);
      };

      switch (message.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              serverInfo: { name: "test-mcp", version: "0.0.1" },
            },
          });
          return;
        case "notifications/initialized":
          res.writeHead(202).end();
          return;
        case "tools/list":
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "scene_getList",
                  description: "查场景列表",
                  inputSchema: { type: "object", properties: { keyword: { type: "string" } } },
                },
              ],
            },
          });
          return;
        case "tools/call": {
          const tool = message.params?.name ?? "";
          const args = message.params?.arguments ?? {};
          calls.push({ tool, args });
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ scenes: [{ id: "scene-1", name: "618 大促" }] }),
                },
              ],
            },
          });
          return;
        }
        default:
          send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/mcp`, calls };
}

// ── mock LLM ───────────────────────────────────────────────

/** 第一轮请求工具，第二轮给出最终答案 */
function mockLlm(toolArgs: Record<string, unknown>): {
  client: LlmClient;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let turn = 0;
  return {
    requests,
    client: {
      provider: "anthropic",
      model: "mock",
      async chat(req: ChatRequest): Promise<ChatResponse> {
        requests.push(req);
        turn += 1;
        if (turn === 1) {
          return {
            content: [
              {
                type: "tool_use",
                id: "call-1",
                name: "mcp__platform__scene_getList",
                input: toolArgs,
              },
            ],
            text: "",
          };
        }
        return {
          content: [{ type: "text", text: "查到活动：618 大促" }],
          text: "查到活动：618 大促",
        };
      },
    },
  };
}

// ── 测试 ────────────────────────────────────────────────────

describe("端到端：模型 → MCP 工具 → 回灌 → 输出", () => {
  let mcp: McpServerHandle;
  let runDir: string;
  let ctx: RunContext;

  before(async () => {
    mcp = await startMcpServer();
    runDir = makeTmp("dah-e2e-");
    const mcpConfigPath = join(runDir, "mcp-config.json");
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          platform: { type: "http", url: mcp.url, headers: {} },
        },
      }),
    );
    ctx = {
      runId: "e2e",
      runDir,
      domain: "qa",
      trace: { event: () => {}, events: () => [], flush: () => {} },
      mcpConfigPath,
    };
  });

  after(() => {
    mcp?.server.close();
  });

  it("模型请求的工具被真实执行，参数原样送达", async () => {
    const { client, requests } = mockLlm({ keyword: "618" });
    const result = await invokeSession(
      {
        systemPrompt: "你是查询助手",
        userMessage: "查一下 618 活动",
        mcpConfigPath: ctx.mcpConfigPath,
      },
      ctx,
      "e2e",
      { llm: client },
    );

    assert.equal(mcp.calls.length, 1, "MCP 工具应被调用一次");
    assert.equal(mcp.calls[0]?.tool, "scene_getList");
    assert.deepEqual(mcp.calls[0]?.args, { keyword: "618" });
    assert.equal(result.output, "查到活动：618 大促");
    assert.equal(requests.length, 2, "应有工具调用 + 回灌后的第二轮");
  });

  it("工具清单带 mcp__<server>__<tool> 前缀传给模型", async () => {
    const { client, requests } = mockLlm({ keyword: "x" });
    await invokeSession(
      {
        systemPrompt: "s",
        userMessage: "u",
        mcpConfigPath: ctx.mcpConfigPath,
      },
      ctx,
      "e2e-tools",
      { llm: client },
    );
    const tools = requests[0]?.tools ?? [];
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "mcp__platform__scene_getList");
    assert.equal(tools[0]?.description, "查场景列表");
  });

  it("工具结果被回灌进下一轮上下文", async () => {
    const { client, requests } = mockLlm({ keyword: "618" });
    await invokeSession(
      {
        systemPrompt: "s",
        userMessage: "u",
        mcpConfigPath: ctx.mcpConfigPath,
      },
      ctx,
      "e2e-backfill",
      { llm: client },
    );
    const second = requests[1];
    assert.ok(second);
    // 工具结果挂在「最后一个 user 消息」上
    const userMessages = second.messages.filter((m) => m.role === "user");
    const userMsg = userMessages[userMessages.length - 1];
    assert.ok(userMsg);
    const toolResult = userMsg.content.find((p) => p.type === "tool_result");
    assert.ok(toolResult, "第二轮应包含 tool_result");
    assert.equal(toolResult.toolUseId, "call-1");
    assert.match(toolResult.content, /618 大促/);
  });

  it("allowedTools 白名单外的工具不会被执行", async () => {
    const before = mcp.calls.length;
    const { client } = mockLlm({ keyword: "x" });
    await invokeSession(
      {
        systemPrompt: "s",
        userMessage: "u",
        mcpConfigPath: ctx.mcpConfigPath,
        allowedTools: ["mcp__platform__not_allowed"],
      },
      ctx,
      "e2e-allowlist",
      { llm: client },
    );
    // 模型仍然请求了工具，但工具列表为空 → 不应真实调用 MCP
    assert.equal(mcp.calls.length, before, "白名单外的工具不应触发 MCP 调用");
  });

  it("会话记录落盘，可复盘", async () => {
    const { client } = mockLlm({ keyword: "618" });
    await invokeSession(
      {
        systemPrompt: "s",
        userMessage: "u",
        mcpConfigPath: ctx.mcpConfigPath,
      },
      ctx,
      "e2e-transcript",
      { llm: client },
    );
    const transcript = join(runDir, "sessions", "e2e-transcript.json");
    assert.equal(existsSync(transcript), true, "会话记录应落盘");
    const parsed = JSON.parse(readFileSync(transcript, "utf-8")) as {
      messages: unknown[];
      result: { output: string };
    };
    assert.ok(parsed.messages.length >= 3);
    assert.equal(parsed.result.output, "查到活动：618 大促");
  });
});

describe("端到端：run-context 生成 MCP 配置", () => {
  it("把 {{TOKEN}} 占位符替换成环境变量值", async () => {
    process.env.E2E_TEST_TOKEN = "secret-value";
    try {
      const dir = makeTmp("dah-ctx-");
      const domainDir = join(dir, "domains", "e2edomain");
      mkdirSync(domainDir, { recursive: true });
      writeFileSync(
        join(domainDir, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            platform: {
              type: "http",
              url: "https://mcp.example.com/platform/mcp",
              headers: { "PRIVATE-TOKEN": "{{E2E_TEST_TOKEN}}" },
            },
          },
        }),
      );

      // 直接验证替换函数
      const { resolveTokenPlaceholders } = await import("../src/runtime/run-context.js");
      const resolved = resolveTokenPlaceholders({
        headers: { "PRIVATE-TOKEN": "{{E2E_TEST_TOKEN}}" },
      }) as { headers: Record<string, string> };
      assert.equal(resolved.headers["PRIVATE-TOKEN"], "secret-value");
    } finally {
      delete process.env.E2E_TEST_TOKEN;
    }
  });
});
