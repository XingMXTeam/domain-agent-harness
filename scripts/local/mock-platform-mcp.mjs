#!/usr/bin/env node
/**
 * 本地「假平台」MCP 服务 —— Streamable HTTP，内存存储。
 *
 * 模拟活动搭建平台的写接口（建子场景 / 页面 / 模块 / 排期 / 点位 / 预发布）
 * 和常用只读接口，让 build / qa 域在本机完整跑通 Plan → Execute → Review。
 *
 *   node scripts/local/mock-platform-mcp.mjs            # 默认 :7801
 *   PORT=7801 LATENCY_MS=300 FAIL_RATE=0 node ...
 *
 * 额外的 HTTP 端点（非 MCP）：
 *   GET  /state   当前内存里的平台数据 + 调用统计（含最大并发）
 *   POST /reset   清空
 */
import { createServer } from "node:http";

const LATENCY_MS = Number(process.env.LATENCY_MS ?? 300);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0);

export function createPlatform() {
  let seq = 1000;
  const id = () => ++seq;
  const db = { childScenes: [], pages: [], modules: [], schedules: [], points: [], prepub: [] };
  const stats = { calls: 0, byTool: {}, inFlight: 0, maxInFlight: 0, failures: 0 };

  const TEMPLATES = [
    { name: "banner", templateList: [{ version: "3.2.0" }, { version: "3.1.0" }] },
    { name: "coupon", templateList: [{ version: "1.4.1" }] },
    { name: "product-feed", templateList: [{ version: "2.0.3" }] },
    { name: "countdown", templateList: [{ version: "1.0.0" }] },
    { name: "brand-wall", templateList: [{ version: "0.9.2" }] },
  ];
  const now = Date.UTC(2026, 5, 1, 7, 0, 0); // 2026-06-01 00:00 PDT

  const tools = {
    // ── 只读 ──
    scene_getList: { desc: "查场景列表", run: ({ keyword } = {}) => ({ scenes: [{ id: "scene-618", name: "618 大促" }, { id: "scene-1111", name: "双 11" }].filter((s) => !keyword || s.name.includes(keyword)) }) },
    childScene_getList: { desc: "查子场景列表", run: () => db.childScenes },
    childScene_getById: { desc: "按 ID 查子场景", run: ({ childSceneId }) => db.childScenes.find((c) => c.id === childSceneId) ?? null },
    childScene_getCountryTimeList: {
      desc: "按 countryTimeRef 取国家档期（regionBigSaleTime）",
      run: ({ id: ref, name } = {}) => ({
        ref: ref ?? name,
        regionBigSaleTime: [
          { regionList: ["BR"], showStartTime: now, startTime: now + 3 * 864e5, endTime: now + 10 * 864e5 },
          { regionList: ["MX"], showStartTime: now, startTime: now + 3 * 864e5, endTime: now + 9 * 864e5 },
          { regionList: [], feature: { shipToType4Display: "DEFAULT" }, showStartTime: now, startTime: now + 3 * 864e5, endTime: now + 8 * 864e5 },
        ],
      }),
    },
    modulePool_getModulesWithTemplate: { desc: "模板库：组件及可用版本", run: () => TEMPLATES },
    page_listModules: { desc: "列出页面的模块", run: ({ pageId }) => db.modules.filter((m) => m.pageId === pageId) },
    schedule_getContent: { desc: "取排期内容", run: ({ scheduleId }) => db.schedules.find((s) => s.id === scheduleId) ?? null },

    // ── 写 ──
    childScene_create: { desc: "创建子场景", write: true, run: ({ name, nations }) => { const c = { id: id(), name, nations }; db.childScenes.push(c); return { id: c.id }; } },
    modulePool_create: { desc: "初始化模块池，返回组件与模板版本", write: true, run: () => TEMPLATES },
    pageAgent_create: {
      desc: "创建页面", write: true,
      run: ({ childSceneId, name, nations, offlineTime }) => {
        if (!childSceneId) throw new Error("childSceneId 必填");
        const p = { id: id(), childSceneId, name, nations, offlineTime: offlineTime ?? null }; db.pages.push(p); return { id: p.id };
      },
    },
    module_addModule: {
      desc: "页面挂模块", write: true,
      run: ({ pageId, childSceneId, floorSetting }) => {
        if (!pageId) throw new Error("pageId 必填");
        const tpl = floorSetting?.template;
        if (tpl?.name && !TEMPLATES.some((t) => t.name === tpl.name)) throw new Error(`模板不存在: ${tpl.name}`);
        if (tpl?.name && !tpl.version) throw new Error(`模板 ${tpl.name} 缺少 version`);
        const m = { id: id(), pageId, childSceneId, floorSetting, hidden: false }; db.modules.push(m); return { id: m.id };
      },
    },
    module_showOrHide: {
      desc: "隐藏/显示模块", write: true,
      run: ({ pageName, floorName, hidden }) => { db.modules.filter((m) => m.floorSetting?.template?.name === floorName).forEach((m) => { m.hidden = !!hidden; }); return { ok: true, pageName, floorName }; },
    },
    moduleTask_getOuterTaskId: { desc: "取模块外层任务 ID", write: true, run: (a) => [{ outerTaskId: `task-${a.pageIndex}-${a.floorIndex}-${a.scheduleIndex}` }] },
    datapool_getSelection: { desc: "选品，返回 datasetId", write: true, run: (a) => [{ datasetId: `ds-${a.pageIndex}-${a.floorIndex}-${a.scheduleIndex}` }] },
    point_create: { desc: "创建点位", write: true, run: ({ childSceneId, name }) => { const p = { id: id(), childSceneId, name, materials: [] }; db.points.push(p); return { id: p.id }; } },
    point_addMaterial: { desc: "点位挂素材", write: true, run: ({ pointId, ...rest }) => { const p = db.points.find((x) => x.id === pointId); if (!p) throw new Error("点位不存在"); p.materials.push(rest); return { ok: true }; } },
    schedule_createOrGetList: { desc: "读（或创建）模块排期列表", run: ({ pageName, floorName }) => db.schedules.filter((s) => s.pageName === pageName && s.floorName === floorName) },
    schedule_update: { desc: "写排期", write: true, run: (payload) => { const s = { id: id(), ...payload }; db.schedules.push(s); return { id: s.id }; } },
    childScene_stagePrepub: { desc: "预发布子场景", write: true, run: ({ childSceneId }) => { db.prepub.push(childSceneId); return { ok: true, env: "prepub" }; } },
  };

  async function call(name, args) {
    const tool = tools[name];
    stats.calls += 1;
    stats.byTool[name] = (stats.byTool[name] ?? 0) + 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await new Promise((r) => setTimeout(r, LATENCY_MS));
      if (!tool) throw new Error(`未知工具: ${name}`);
      if (tool.write && FAIL_RATE > 0 && Math.random() < FAIL_RATE) throw new Error("模拟瞬时错误 (503)");
      return { ok: true, data: tool.run(args ?? {}) };
    } catch (e) {
      stats.failures += 1;
      return { ok: false, error: e.message };
    } finally {
      stats.inFlight -= 1;
    }
  }

  return {
    db, stats, call,
    list: () => Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: { type: "object", additionalProperties: true } })),
    reset() { for (const k of Object.keys(db)) db[k] = []; Object.assign(stats, { calls: 0, byTool: {}, inFlight: 0, maxInFlight: 0, failures: 0 }); },
  };
}

export function startMcpServer(platform, port = 0) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stats: platform.stats, db: platform.db }, null, 2));
      return;
    }
    if (req.method === "POST" && req.url === "/reset") { platform.reset(); res.writeHead(204).end(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let msg;
      try { msg = JSON.parse(body || "{}"); } catch { res.writeHead(400).end(); return; }
      const send = (result) => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "local-platform" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      };
      switch (msg.method) {
        case "initialize":
          return send({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "local-platform", version: "0.1.0" } });
        case "notifications/initialized":
          res.writeHead(202).end(); return;
        case "tools/list":
          return send({ tools: platform.list() });
        case "tools/call": {
          const r = await platform.call(msg.params?.name, msg.params?.arguments);
          return send(r.ok
            ? { content: [{ type: "text", text: JSON.stringify(r.data) }] }
            : { content: [{ type: "text", text: r.error }], isError: true });
        }
        default:
          return send({});
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMcpServer(createPlatform(), Number(process.env.PORT ?? 7801));
  console.error(`local platform MCP on http://127.0.0.1:${port}/mcp  (state: /state, latency ${LATENCY_MS}ms, failRate ${FAIL_RATE})`);
}
