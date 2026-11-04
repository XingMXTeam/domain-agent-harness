import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  IMPLEMENTED_RULES,
  READ_TOOLS,
  formatAcceptance,
  mcpAcceptanceSource,
  parseCampaignPages,
  parseFloorTable,
  requestedPageCount,
  readPlatform,
  runAcceptance,
  type AcceptanceSource,
  type PlatformModule,
  type PlatformPage,
} from "../src/domains/build/acceptance.js";
import type { ExecutionResult } from "../src/types.js";

const KB = join(import.meta.dirname, "..", "knowledge");
const kb = (p: string) => readFileSync(join(KB, p), "utf-8");

const execution: ExecutionResult = {
  success: true,
  items: [{ step: "setup", target: "1001", ok: true }],
  summary: "",
};

const plan = {
  pages: [{ name: "首页", knowledge: "mega-sale/pages/home.md" }],
};

/** 大促首页全部合格时平台上的样子 */
function goodPlatform() {
  const pages: PlatformPage[] = [{ id: 1, name: "首页", offlineTime: "2026-06-11 00:00:00" }];
  const mod = (name: string, hidden = false): PlatformModule => ({ floorSetting: { template: { name } }, hidden });
  const modules: Record<string, PlatformModule[]> = {
    "1": [mod("banner"), mod("countdown"), mod("coupon", true), mod("product-feed")],
  };
  const schedules: Record<string, unknown[]> = { "首页/product-feed": [{ id: 9 }] };
  return { pages, modules, schedules };
}

function fakeSource(state: ReturnType<typeof goodPlatform>, calls: string[] = []): AcceptanceSource {
  return {
    async readKnowledge(path) {
      calls.push(`kb:${path}`);
      return kb(path);
    },
    async listPages() {
      return state.pages;
    },
    async listModules(pageId) {
      return state.modules[String(pageId)] ?? [];
    },
    async listSchedules(pageName, floorName) {
      return state.schedules[`${pageName}/${floorName}`] ?? [];
    },
  };
}

const failed = (r: Awaited<ReturnType<typeof runAcceptance>>) =>
  r.results.filter((x) => !x.pass).map((x) => `${x.rule} ${x.target}`);

describe("parseFloorTable", () => {
  it("读出大促首页的楼层表", () => {
    const floors = parseFloorTable(kb("mega-sale/pages/home.md"));
    assert.deepEqual(
      floors.map((f) => f.component),
      ["banner", "countdown", "coupon", "product-feed", "brand-wall"],
    );
    const coupon = floors.find((f) => f.component === "coupon")!;
    assert.equal(coupon.required, true);
    assert.equal(coupon.hidden, true);
    assert.equal(coupon.scheduling_type, "manual");
    assert.equal(floors.find((f) => f.component === "brand-wall")!.required, false);
  });

  it("没有楼层表返回空数组", () => {
    assert.deepEqual(parseFloorTable("# 标题\n\n没有表"), []);
  });
});

describe("runAcceptance", () => {
  it("平台状态合格时全部通过", async () => {
    const report = await runAcceptance(plan, execution, fakeSource(goodPlatform()));
    assert.equal(report.ran, true);
    assert.equal(report.ok, true, JSON.stringify(failed(report)));
    const rules = new Set(report.results.map((r) => r.rule));
    for (const r of IMPLEMENTED_RULES) assert.ok(rules.has(r), `缺少 ${r} 的结果`);
  });

  it("R1：计划和执行器都没提到的必选楼层，平台上缺了也会被抓到", async () => {
    const s = goodPlatform();
    s.modules["1"] = s.modules["1"]!.filter((m) => m.floorSetting?.template?.name !== "countdown");
    const report = await runAcceptance(plan, execution, fakeSource(s));
    assert.equal(report.ok, false);
    assert.deepEqual(failed(report), ["R1 首页"]);
    assert.match(report.results.find((r) => r.rule === "R1")!.actual, /countdown/);
  });

  it("R2：selection 楼层没有排期", async () => {
    const s = goodPlatform();
    s.schedules = {};
    assert.deepEqual(failed(await runAcceptance(plan, execution, fakeSource(s))), ["R2 首页/product-feed"]);
  });

  it("R3：manual 楼层被自动写了排期", async () => {
    const s = goodPlatform();
    s.schedules["首页/coupon"] = [{ id: 10 }];
    assert.deepEqual(failed(await runAcceptance(plan, execution, fakeSource(s))), ["R3 首页/coupon"]);
  });

  it("R4：hidden 楼层没隐藏", async () => {
    const s = goodPlatform();
    s.modules["1"]!.find((m) => m.floorSetting?.template?.name === "coupon")!.hidden = false;
    assert.deepEqual(failed(await runAcceptance(plan, execution, fakeSource(s))), ["R4 首页/coupon"]);
  });

  it("R5：offlineTime 为空", async () => {
    const s = goodPlatform();
    s.pages[0]!.offlineTime = null;
    assert.deepEqual(failed(await runAcceptance(plan, execution, fakeSource(s))), ["R5 首页"]);
  });

  it("可选楼层没建时不检查它的排期", async () => {
    const report = await runAcceptance(plan, execution, fakeSource(goodPlatform()));
    assert.ok(!report.results.some((r) => r.target.endsWith("brand-wall")));
  });

  it("计划里的页面平台上不存在", async () => {
    const s = goodPlatform();
    s.pages = [];
    assert.deepEqual(failed(await runAcceptance(plan, execution, fakeSource(s))), ["R0 首页", "R1 首页", "R5 首页"]);
  });

  it("子场景没建成时记 R0 失败，不调平台", async () => {
    const report = await runAcceptance(plan, { success: false, items: [], summary: "" }, fakeSource(goodPlatform()));
    assert.equal(report.ok, false);
    assert.equal(report.results[0]?.rule, "R0");
  });

  it("计划没有任何页面标注 knowledge 时跳过并说明原因", async () => {
    const report = await runAcceptance({ pages: [{ name: "首页" }] }, execution, fakeSource(goodPlatform()));
    assert.equal(report.ran, false);
    assert.match(formatAcceptance(report), /未执行/);
  });

  it("同一篇页面知识只读一次", async () => {
    const calls: string[] = [];
    const s = goodPlatform();
    s.pages.push({ id: 2, name: "首页2", offlineTime: "x" });
    s.modules["2"] = s.modules["1"]!;
    s.schedules["首页2/product-feed"] = [{}];
    const twoPages = { pages: [...plan.pages, { name: "首页2", knowledge: "mega-sale/pages/home.md" }] };
    const report = await runAcceptance(twoPages, execution, fakeSource(s, calls));
    assert.equal(report.ok, true);
    assert.deepEqual(calls, ["kb:mega-sale/campaign.md", "kb:mega-sale/pages/home.md"]);
  });
});

describe("R0 页面清单", () => {
  it("解析活动定义的页面清单", () => {
    const types = parseCampaignPages(kb("mega-sale/campaign.md"));
    assert.deepEqual(types.map((t) => [t.type, t.count, t.knowledge]), [
      ["首页", 1, "pages/home.md"],
      ["类目会场", undefined, "pages/category.md"],
    ]);
  });

  it("需求要 4 个页面、计划只写了首页：总页数不符", async () => {
    const report = await runAcceptance(plan, execution, fakeSource(goodPlatform()), { request: "创建 618 大促，巴西站，4 个页面" });
    assert.equal(report.ok, false);
    assert.deepEqual(failed(report), ["R0 总页数"]);
  });

  it("首页建了两个：固定数量不符", async () => {
    const s = goodPlatform();
    s.pages.push({ id: 9, name: "首页", offlineTime: "x" });
    assert.ok(failed(await runAcceptance(plan, execution, fakeSource(s))).includes("R0 首页"));
  });

  it("页面知识不在活动定义里：拒绝按错的标准验收", async () => {
    const wrong = { pages: [{ name: "首页", knowledge: "mega-sale/pages/brand-home.md" }] };
    const report = await runAcceptance(wrong, execution, fakeSource(goodPlatform()));
    assert.ok(failed(report).some((f) => f.startsWith("R0")));
  });

  it("从需求里读总页数", () => {
    assert.equal(requestedPageCount("巴西站，32 个页面"), 32);
    assert.equal(requestedPageCount("4个页面"), 4);
    assert.equal(requestedPageCount("巴西站"), undefined);
  });
});

describe("只读保证", () => {
  it("白名单外的工具不发请求，直接拒绝", async () => {
    const sent: string[] = [];
    const pool = {
      async callTool(_server: string, tool: string) {
        sent.push(tool);
        return { success: true, data: [] };
      },
    };
    for (const tool of ["schedule_createOrGetList", "schedule_update", "module_showOrHide", "pageAgent_create"]) {
      await assert.rejects(readPlatform(pool, tool, {}), /只允许只读工具/);
    }
    assert.deepEqual(sent, []);
  });

  it("MCP 来源只会调用白名单里的工具", async () => {
    const sent: string[] = [];
    const pool = {
      async callTool(server: string, tool: string) {
        sent.push(`${server}:${tool}`);
        return { success: true, data: server === "knowledge" ? kb("mega-sale/pages/home.md") : [] };
      },
    };
    await runAcceptance(plan, execution, mcpAcceptanceSource(pool));
    const allowed = new Set([...Object.values(READ_TOOLS).map((t) => `platform:${t}`), "knowledge:kb_read"]);
    for (const call of sent) assert.ok(allowed.has(call), `调用了白名单外的工具 ${call}`);
  });
});

describe("验收规则与实现对齐", () => {
  it("review-rules.md 里的每条规则都有实现，反之亦然", () => {
    const ids = [...kb("shared/review-rules.md").matchAll(/^\|\s*(R\d+)\s*\|/gm)].map((m) => m[1]);
    assert.deepEqual([...ids].sort(), [...IMPLEMENTED_RULES].sort());
  });
});
