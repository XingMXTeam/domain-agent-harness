#!/usr/bin/env node
/**
 * 规划评测：对 evals/plan-cases.json 里每条需求，只跑规划（DAH_PLAN_ONLY=1），给 plan.json 打分。
 *
 *   npm run eval                          # 剧本模型（基线）
 *   EVAL_REAL_LLM=1 npm run eval          # 模型走 .env 里的真 Provider（如本地 Ollama / Qwen）
 *   npm run eval -- mega-br-4 brand-nike-br   # 只跑指定用例
 *   EVAL_MIN_SCORE=0.9 npm run eval       # 平均分低于阈值时退出码 1（接 CI）
 *
 * 期望值里的楼层 / 隐藏 / 排期现读知识库（KB_DIR，默认 ./knowledge），改知识库不用改用例。
 * 报告写到 <runsRoot>/eval-report.json。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatform, startMcpServer } from "./local/mock-platform-mcp.mjs";
import { startMockLlm } from "./local/mock-llm.mjs";
import { createKnowledgeBase, startKnowledgeServer } from "./knowledge-mcp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { scorePlan, summarize } = await import(join(ROOT, "dist", "evals", "plan-score.js"));

const kbDir = process.env.KB_DIR ?? join(ROOT, "knowledge");
const casesFile = process.env.EVAL_CASES ?? join(ROOT, "evals", "plan-cases.json");
const only = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesFile, "utf-8")).cases.filter((c) => !only.length || only.includes(c.id));
const schema = JSON.parse(readFileSync(join(ROOT, "src", "domains", "build", "schemas", "plan.schema.json"), "utf-8"));
const useReal = process.env.EVAL_REAL_LLM === "1";

// 规划阶段不写平台，但 MCP 配置里有平台服务；起一个假平台让连接成功
const platform = await startMcpServer(createPlatform());
const km = await startKnowledgeServer(createKnowledgeBase(kbDir));
const llm = useReal ? null : await startMockLlm();
const runsRoot = process.env.DAH_RUNS_ROOT ?? mkdtempSync(join(tmpdir(), "dah-eval-"));

console.log(`▶ 用例 ${cases.length} 条 · 模型 ${useReal ? `real (${process.env.LLM_PROVIDER ?? ".env"})` : "local script"} · 知识库 ${kbDir}\n`);

function runCase(c) {
  const caseRoot = join(runsRoot, c.id);
  mkdirSync(caseRoot, { recursive: true });
  const env = {
    ...process.env,
    ...(useReal ? {} : { LLM_PROVIDER: "anthropic", ANTHROPIC_BASE_URL: `http://127.0.0.1:${llm.port}`, ANTHROPIC_API_KEY: "local" }),
    PLATFORM_MCP_URL: `http://127.0.0.1:${platform.port}/mcp`,
    LOCALE_MCP_URL: `http://127.0.0.1:${platform.port}/mcp`,
    KM_MCP_URL: `http://127.0.0.1:${km.port}/mcp`,
    DAH_RUNS_ROOT: caseRoot,
    DAH_PLAN_ONLY: "1",
    DAH_LOG_LEVEL: process.env.DAH_LOG_LEVEL ?? "warn",
  };
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn("node", [join(ROOT, "dist", "index.js"), "--domain=build", c.prompt], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      // 每次运行一个子目录，plan.json 在里面
      const runDir = readdirSync(caseRoot).map((d) => join(caseRoot, d)).find((d) => existsSync(join(d, "plan.json")));
      let plan = null;
      if (runDir) {
        try { plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf-8")); } catch { /* 留空 */ }
      }
      done({ plan, code, secs: (Date.now() - t0) / 1000, stderr: stderr.trim().split("\n").slice(-3).join("\n") });
    });
  });
}

const scores = [];
for (const c of cases) {
  const r = await runCase(c);
  const s = scorePlan(r.plan, c, kbDir, schema);
  s.secs = r.secs;
  if (!r.plan && r.stderr) s.checks.push({ id: "run", pass: false, detail: r.stderr });
  scores.push(s);
  const failed = s.checks.filter((x) => !x.pass);
  console.log(`${s.pass ? "✓" : "✗"} ${c.id.padEnd(18)} ${(s.score * 100).toFixed(0).padStart(3)}%  ${r.secs.toFixed(1)}s`);
  for (const f of failed) console.log(`    - ${f.id}: ${f.detail ?? "未通过"}`);
}

const sum = summarize(scores);
console.log(`\n用例通过 ${sum.passed}/${sum.cases} · 平均分 ${(sum.meanScore * 100).toFixed(1)}%`);
console.log("各项通过率: " + Object.entries(sum.byCheck).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join("  "));

const report = { model: useReal ? process.env.LLM_PROVIDER ?? "real" : "local-script", kbDir, at: new Date().toISOString(), summary: sum, cases: scores };
writeFileSync(join(runsRoot, "eval-report.json"), JSON.stringify(report, null, 2));
console.log(`报告: ${join(runsRoot, "eval-report.json")}`);

platform.server.close(); km.server.close(); llm?.server.close();
const min = Number(process.env.EVAL_MIN_SCORE ?? 0);
process.exit(sum.meanScore + 1e-9 < min ? 1 : 0);
