#!/usr/bin/env node
/**
 * 本地「剧本模型」—— Anthropic Messages API 兼容，确定性输出。
 *
 * 按 system prompt 认出当前阶段，扮演对应角色：
 *   Catalog 路由 → {"domain": ...}
 *   build brain  → {"skill": ...}
 *   init 规划师  → 先调一次只读工具看模板库，再按 spec.md 输出 plan.json
 *   审查员       → 读执行结果，输出 review JSON
 *   查询助手     → 调 scene_getList 后作答
 *
 * 用来在没有 API Key 的情况下把整条链路跑通、打断点。
 * 想换真模型：不启动它，改 .env 指向 Anthropic / OpenAI 兼容端点（含本地 Ollama）即可。
 */
import { createServer } from "node:http";

const textOf = (content) =>
  typeof content === "string" ? content
    : (content ?? []).map((p) => (p.type === "text" ? p.text : p.type === "tool_result" ? (typeof p.content === "string" ? p.content : JSON.stringify(p.content)) : "")).join("\n");

function firstUserText(messages) {
  const m = (messages ?? []).find((x) => x.role === "user");
  return m ? textOf(m.content) : "";
}

export function planFromPrompt(prompt) {
  const n = Number(prompt.match(/(\d+)\s*个?页面/)?.[1] ?? 4);
  const nation = prompt.match(/巴西|BR/) ? "BR" : prompt.match(/墨西哥|MX/) ? "MX" : "BR";
  const pages = Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? "首页" : `会场${i}`,
    nations: nation,
    floors: [
      { template: { name: "banner" }, floorSetting: { height: 200 } },
      { template: { name: "product-feed" } },
      { template: { name: "coupon" }, hidden: true },
    ],
  }));
  return {
    setup: { childScene: { name: `618 大促-${nation}`, nations: nation, countryTimeRef: `${nation.toLowerCase()}-618-2026` }, initModulePool: true },
    pages,
    schedules: pages.map((p) => ({ nations: [nation], pageName: p.name, floorName: "product-feed", contentData: { title: "爆款直降" } })),
    points: [{ name: "首屏浮层" }],
  };
}

function reviewFrom(userText) {
  const json = userText.slice(userText.indexOf("{"));
  let exec = {};
  try { exec = JSON.parse(json); } catch { /* keep empty */ }
  const items = exec.items ?? [];
  const issues = items.filter((i) => !i.ok).map((i) => ({ level: "error", step: i.step, target: i.target, message: i.error ?? "失败", suggestion: /瞬时|503|timeout/i.test(i.error ?? "") ? "可重试" : "检查计划或平台配置" }));
  const sched = items.find((i) => i.step === "schedules");
  if (sched && /^0\//.test(sched.target)) issues.push({ level: "warning", step: "schedules", target: sched.target, message: "没有写入任何排期", suggestion: "核对 plan 中排期的位置是否与 executor 读取的结构一致" });
  return { ok: issues.every((i) => i.level !== "error"), checked: items.length, issues, summary: `检查 ${items.length} 项，${issues.length} 个问题。${exec.summary ?? ""}` };
}

export function respond(payload) {
  const system = typeof payload.system === "string" ? payload.system : textOf(payload.system);
  const messages = payload.messages ?? [];
  const userText = firstUserText(messages);
  const hadToolResult = JSON.stringify(messages).includes("tool_result");
  const tools = (payload.tools ?? []).map((t) => t.name);
  const text = (t) => [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }];
  const toolUse = (name, input) => [{ type: "tool_use", id: `call_${Date.now()}`, name, input }];

  if (system.includes("Domain Catalog")) return text({ domain: /创建|搭建|新建/.test(userText) ? "build" : /投放|排期包/.test(userText) ? "gop" : "qa" });
  if (system.includes("build 域大脑")) return text({ skill: /修复|修一下|fix/i.test(userText) ? "fix" : /创建|搭建|新建/.test(userText) ? "init" : "query" });
  if (system.includes("活动搭建规划师")) {
    const t = "mcp__platform__modulePool_getModulesWithTemplate";
    if (!hadToolResult && tools.includes(t)) return toolUse(t, {});
    return text(planFromPrompt(userText));
  }
  if (system.includes("搭建结果审查员")) return text(reviewFrom(userText));
  if (system.includes("活动查询助手")) {
    const t = "mcp__platform__scene_getList";
    if (!hadToolResult && tools.includes(t)) return toolUse(t, { keyword: "618" });
    return text("查到 618 大促（scene-618）。");
  }
  return text("{}");
}

export function startMockLlm(port = 0, log = () => {}) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const content = respond(payload);
      log(content);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_local", type: "message", role: "assistant", model: "local-script", content,
        stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMockLlm(Number(process.env.PORT ?? 7802));
  console.error(`local script LLM on http://127.0.0.1:${port}  (ANTHROPIC_BASE_URL)`);
}
