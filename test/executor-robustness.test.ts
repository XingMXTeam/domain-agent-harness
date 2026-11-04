import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { McpCallResult, McpClientPool } from "../src/runtime/mcp-client.js";
import { Semaphore } from "../src/runtime/parallel.js";
import { gcpCall, isTransientError } from "../src/domains/build/helpers.js";
import { layer2PageBuild } from "../src/domains/build/page-build.js";
import { layer3Schedules } from "../src/domains/build/schedules.js";
import type { ResolvedPlan } from "../src/domains/build/types.js";

process.env.DAH_RETRY_BASE_MS = "1";

type Handler = (tool: string, args: Record<string, unknown>) => McpCallResult | Promise<McpCallResult>;

/** 假 pool：记录调用与并发峰值 */
function fakePool(handler: Handler, latencyMs = 2) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let inFlight = 0;
  let peak = 0;
  const pool = {
    async callTool(_server: string, tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, latencyMs));
        return await handler(tool, args);
      } finally {
        inFlight -= 1;
      }
    },
  } as unknown as McpClientPool;
  return { pool, calls, peak: () => peak };
}

const ok = (data: unknown = { id: 1 }): McpCallResult => ({ success: true, data });

describe("Semaphore", () => {
  it("任何时刻不超过上限，且全部任务都执行", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    const done = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        sem.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active -= 1;
          return i;
        }),
      ),
    );
    assert.equal(done.length, 20);
    assert.ok(peak <= 3, `峰值 ${peak}`);
    assert.equal(sem.inFlight, 0);
  });

  it("任务抛错也会释放名额", async () => {
    const sem = new Semaphore(1);
    await assert.rejects(sem.run(async () => { throw new Error("x"); }));
    assert.equal(await sem.run(async () => "next"), "next");
  });
});

describe("isTransientError", () => {
  it("识别 5xx / 限流 / 超时", () => {
    for (const e of ["模拟瞬时错误 (503)", "HTTP 429 Too Many Requests", "request timed out", "ECONNRESET", "系统繁忙，请稍后重试"]) {
      assert.ok(isTransientError(e), e);
    }
  });
  it("业务错误不重试", () => {
    for (const e of ["模板不存在: banner", "pageId 必填", "无权限", undefined]) {
      assert.ok(!isTransientError(e), String(e));
    }
  });
});

describe("gcpCall —— 全局限流与重试", () => {
  it("多层各自并发时，打到平台的并发仍不超过 DAH_CONCURRENCY", async () => {
    process.env.DAH_CONCURRENCY = "4";
    const fake = fakePool(() => ok(), 3);
    // 模拟「页面层 × 模块层」嵌套并发
    await Promise.all(
      Array.from({ length: 6 }, () =>
        Promise.all(Array.from({ length: 5 }, () => gcpCall(fake.pool, "module_addModule", {}))),
      ),
    );
    delete process.env.DAH_CONCURRENCY;
    assert.equal(fake.calls.length, 30);
    assert.ok(fake.peak() <= 4, `峰值 ${fake.peak()}`);
  });

  it("瞬时错误重试后成功", async () => {
    let n = 0;
    const fake = fakePool(() => (++n < 3 ? { success: false, error: "模拟瞬时错误 (503)" } : ok()));
    const res = await gcpCall(fake.pool, "schedule_update", {});
    assert.equal(res.success, true);
    assert.equal(fake.calls.length, 3);
  });

  it("业务错误不重试", async () => {
    const fake = fakePool(() => ({ success: false, error: "模板不存在: x" }));
    const res = await gcpCall(fake.pool, "module_addModule", {});
    assert.equal(res.success, false);
    assert.equal(fake.calls.length, 1);
  });

  it("重试次数用尽后返回最后一次错误", async () => {
    process.env.DAH_RETRY_MAX = "2";
    const fake = fakePool(() => ({ success: false, error: "503" }));
    const res = await gcpCall(fake.pool, "schedule_update", {});
    delete process.env.DAH_RETRY_MAX;
    assert.equal(res.success, false);
    assert.equal(fake.calls.length, 3);
  });

  it("写接口重试前先核查：已落地就不再重写", async () => {
    const fake = fakePool(() => ({ success: false, error: "504 gateway timeout" }));
    let recovered = 0;
    const res = await gcpCall(fake.pool, "pageAgent_create", { name: "首页" }, {
      recover: async () => {
        recovered += 1;
        return ok({ id: 42 });
      },
    });
    assert.equal(res.success, true);
    assert.deepEqual(res.data, { id: 42 });
    assert.equal(fake.calls.filter((c) => c.tool === "pageAgent_create").length, 1);
    assert.equal(recovered, 1);
  });
});

function planOf(pages: string[]): ResolvedPlan {
  return {
    pages: pages.map((name) => ({
      name,
      nations: ["BR"],
      floors: [
        { name: "banner", template: { name: "banner" }, schedules: [{ name: "banner", floorName: "banner" }] },
        { name: "product-feed", template: { name: "product-feed" }, schedules: [{ name: "product-feed", floorName: "product-feed" }] },
      ],
    })),
  } as unknown as ResolvedPlan;
}

describe("失败隔离", () => {
  it("一个页面失败：只跳过它自己的模块，不发请求，其它页面照常", async () => {
    let seq = 100;
    const fake = fakePool((tool, args) => {
      if (tool === "pageAgent_create") {
        return args.name === "坏页" ? { success: false, error: "名称重复" } : ok({ id: ++seq });
      }
      if (tool === "page_getList") return ok([]);
      return ok({ id: ++seq });
    });
    const plan = planOf(["首页", "坏页", "3C"]);
    const res = await layer2PageBuild(fake.pool, plan, 1, new Map([["banner", ["1"]], ["product-feed", ["1"]]]));

    assert.deepEqual(res.pages.map((p) => p.ok), [true, false, true]);
    const bad = res.modules.filter((m) => m.pageName === "坏页");
    assert.equal(bad.length, 2);
    assert.ok(bad.every((m) => m.skipped && !m.ok));
    assert.equal(res.modules.filter((m) => m.ok).length, 4);
    // 坏页的模块一个请求都没发
    const addCalls = fake.calls.filter((c) => c.tool === "module_addModule");
    assert.equal(addCalls.length, 4);
    assert.ok(addCalls.every((c) => c.args.pageId !== undefined));
  });

  it("楼层没挂上的排期计入失败，不再写入，也不会报全部成功", async () => {
    const fake = fakePool(() => ok([]));
    const plan = planOf(["首页"]);
    const stats = await layer3Schedules(
      fake.pool,
      plan.pages,
      [{ pageName: "首页", pageId: 1, ok: true }],
      [
        { pageName: "首页", floorName: "banner", floorId: 2, ok: true },
        { pageName: "首页", floorName: "product-feed", ok: false, error: "模板不存在" },
      ],
      new Map(),
    );
    assert.deepEqual(stats, { total: 2, success: 1, failed: 1, skipped: 1 });
    const writes = fake.calls.filter((c) => c.tool === "schedule_update");
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.args.floorName, "banner");
  });
});
