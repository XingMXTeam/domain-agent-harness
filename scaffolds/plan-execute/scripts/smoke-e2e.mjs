#!/usr/bin/env node
/**
 * 端到端冒烟测试 —— 用真实 CLI 进程跑完整链路。
 *
 * 流程：
 *   1. 起一个本地 mock LLM（Anthropic Messages API 兼容）
 *   2. 起一个本地 mock MCP（Streamable HTTP）
 *   3. 用环境变量把 CLI 指向这两个本地服务
 *   4. 跑 `node dist/index.js`，断言 stdout 里有期望结果
 *
 * 全程本地，不访问任何外部网络，也不需要真实 API Key。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// ── mock LLM ───────────────────────────────────────────────
function startMockLlm() {
  const state = { toolCalled: false };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
      const alreadyCalled = JSON.stringify(payload.messages ?? []).includes("tool_result");

      let content;
      if (hasTools && !alreadyCalled) {
        state.toolCalled = true;
        content = [
          {
            type: "tool_use",
            id: "call_1",
            name: "mcp__platform__scene_getList",
            input: { keyword: "618" },
          },
        ];
      } else if (hasTools && alreadyCalled) {
        content = [{ type: "text", text: "查到活动：618 大促（场景 ID: scene-1）" }];
      } else {
        // Catalog 路由：没有工具可用，输出域
        content = [{ type: "text", text: '{"domain":"qa"}' }];
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content,
          model: payload.model ?? "mock",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  return { server, state };
}

// ── mock MCP ───────────────────────────────────────────────
function startMockMcp() {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body || "{}");
      const send = (payload) => {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "smoke-session",
        });
        res.end(JSON.stringify(payload));
      };
      if (msg.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "smoke-mcp", version: "0.0.1" },
          },
        });
        return;
      }
      if (msg.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      if (msg.method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
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
      }
      if (msg.method === "tools/call") {
        calls.push({ tool: msg.params?.name, args: msg.params?.arguments });
        send({
          jsonrpc: "2.0",
          id: msg.id,
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
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
    });
  });
  return { server, calls };
}

function listen(server) {
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      res(typeof a === "object" && a ? a.port : 0);
    });
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn("node", ["dist/index.js", ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// ── 主流程 ─────────────────────────────────────────────────
const llm = startMockLlm();
const mcp = startMockMcp();
const llmPort = await listen(llm.server);
const mcpPort = await listen(mcp.server);

const runsRoot = mkdtempSync(join(tmpdir(), "dah-smoke-"));
const env = {
  LLM_PROVIDER: "anthropic",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${llmPort}`,
  ANTHROPIC_API_KEY: "smoke-test-key",
  PLATFORM_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
  LOCALE_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
  DAH_RUNS_ROOT: runsRoot,
  DAH_LOG_LEVEL: "warn",
};

try {
  console.log("\n【场景 1】指定域 qa：模型决策 → MCP 工具 → 结果回灌 → 最终答案\n");
  const r1 = await runCli(["--domain=qa", "查一下 618 大促"], env);
  check("CLI 退出码为 0", r1.code === 0, `实际 ${r1.code}`);
  check(
    "stdout 含最终答案",
    r1.stdout.includes("查到活动：618 大促"),
    r1.stdout.trim().slice(0, 120) || "(空)",
  );
  check("MCP 工具被真实调用", mcp.calls.length >= 1, `调用 ${mcp.calls.length} 次`);
  check(
    "工具参数原样送达",
    mcp.calls[0]?.args?.keyword === "618",
    JSON.stringify(mcp.calls[0]?.args ?? {}),
  );
  check("运行产物已落盘", existsSync(runsRoot) && readdirSync(runsRoot).length > 0);
  check(
    "stdout 只有答案，没有日志污染",
    !r1.stdout.includes("[env]") && r1.stdout.trim().split("\n").length === 1,
    `stdout 行数 ${r1.stdout.trim().split("\n").length}`,
  );
  check("日志走 stderr", r1.stderr.includes("[env]"));

  console.log("\n【场景 2】不指定域：Catalog 自动路由 → qa\n");
  const r2 = await runCli(["查一下 618 大促"], env);
  check("CLI 退出码为 0", r2.code === 0, `实际 ${r2.code}`);
  check(
    "Catalog 路由到 qa 并产出答案",
    r2.stdout.includes("查到活动：618 大促"),
    r2.stdout.trim().slice(0, 120) || "(空)",
  );
  check(
    "Catalog 阶段产生了独立 trace",
    r2.stderr.includes("Catalog Route") || r2.stdout.includes("查到活动"),
  );

  console.log("\n【场景 3】路由兜底：LLM 返回非法域时应退到只读域\n");
  // 复用同一个 mock，但让 Catalog 输出非法域
  const brokenLlm = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: '{"domain":"not-a-real-domain"}' }],
          model: "mock",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  const brokenPort = await listen(brokenLlm);
  const r3 = await runCli(["随便问问"], {
    ...env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${brokenPort}`,
  });
  check("CLI 退出码为 0", r3.code === 0, `实际 ${r3.code}`);
  brokenLlm.close();
} finally {
  llm.server.close();
  mcp.server.close();
  rmSync(runsRoot, { recursive: true, force: true });
}

console.log(
  `\n${failures.length === 0 ? "✅ 全部通过" : "❌ 有失败"}：${checks.length - failures.length}/${checks.length}`,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
