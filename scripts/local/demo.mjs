#!/usr/bin/env node
/**
 * 一键本地演示：起假平台 MCP + 剧本模型 → 跑真实 CLI（build 域三段式）→ 打印平台最终状态。
 *
 *   npm run demo                              # 剧本模型
 *   npm run demo -- "创建 618 大促，巴西站，8 个页面"
 *   DEMO_REAL_LLM=1 npm run demo              # 模型走 .env 里的真 Provider（如本地 Ollama），只把 MCP 换成本地
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatform, startMcpServer } from "./mock-platform-mcp.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const prompt = process.argv.slice(2).join(" ") || "创建 618 大促，巴西站，4 个页面，首屏放 Banner";
const platform = createPlatform();
const mcp = await startMcpServer(platform);
const useReal = process.env.DEMO_REAL_LLM === "1";
const llm = useReal ? null : await startMockLlm();
const runsRoot = process.env.DAH_RUNS_ROOT ?? mkdtempSync(join(tmpdir(), "dah-demo-"));

const env = {
  ...process.env,
  ...(useReal ? {} : { LLM_PROVIDER: "anthropic", ANTHROPIC_BASE_URL: `http://127.0.0.1:${llm.port}`, ANTHROPIC_API_KEY: "local" }),
  PLATFORM_MCP_URL: `http://127.0.0.1:${mcp.port}/mcp`,
  LOCALE_MCP_URL: `http://127.0.0.1:${mcp.port}/mcp`,
  DAH_RUNS_ROOT: runsRoot,
  DAH_LOG_LEVEL: process.env.DAH_LOG_LEVEL ?? "info",
};

console.log(`\n▶ prompt: ${prompt}\n▶ model : ${useReal ? `real (${process.env.LLM_PROVIDER ?? ".env"})` : "local script"}\n▶ mcp   : http://127.0.0.1:${mcp.port}/mcp\n`);
const t0 = Date.now();
const child = spawn("node", [join(ROOT, "dist", "index.js"), prompt], { cwd: ROOT, env, stdio: ["ignore", "pipe", "inherit"] });
let stdout = "";
child.stdout.on("data", (c) => { stdout += c; });
const code = await new Promise((r) => child.on("close", r));
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const { stats, db } = platform;
console.log("\n──────── 最终答案（stdout）────────\n" + stdout.trim());
console.log("\n──────── 平台状态 ────────");
console.log(`子场景 ${db.childScenes.length} · 页面 ${db.pages.length} · 模块 ${db.modules.length}（隐藏 ${db.modules.filter((m) => m.hidden).length}）· 排期 ${db.schedules.length} · 点位 ${db.points.length} · 预发布 ${db.prepub.length}`);
console.log(`页面 offlineTime: ${[...new Set(db.pages.map((p) => p.offlineTime))].join(", ")}`);
console.log(`MCP 调用 ${stats.calls} 次，失败 ${stats.failures}，最大并发 ${stats.maxInFlight}，总耗时 ${secs}s`);
console.log(`按工具: ${Object.entries(stats.byTool).map(([k, v]) => `${k}×${v}`).join("  ")}`);
console.log(`运行产物: ${runsRoot}`);
mcp.server.close(); llm?.server.close();
process.exit(code ?? 1);
