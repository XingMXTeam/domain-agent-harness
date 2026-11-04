import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { preprocessPlan } from "../src/domains/build/helpers.js";
import type { Plan } from "../src/domains/build/types.js";

// spec.md 里给模型看的 plan 结构，原样作为输入
const specShaped = {
  setup: { childScene: { name: "618", nations: "BR", countryTimeRef: "br-618-2026" }, initModulePool: true },
  pages: [
    {
      name: "首页",
      nations: "BR",
      floors: [{ template: { name: "banner" } }, { template: { name: "coupon" }, hidden: true }],
    },
  ],
  schedules: [
    { nations: ["BR"], pageName: "首页", floorName: "banner", contentData: { a: 1 } },
    { nations: ["BR"], pageName: "不存在", floorName: "banner" },
  ],
} as unknown as Plan;

describe("preprocessPlan —— spec.md 结构归一化", () => {
  const plan = preprocessPlan(structuredClone(specShaped));

  it("楼层名缺省取模板名", () => {
    assert.deepEqual(plan.pages[0]!.floors.map((f) => f.name), ["banner", "coupon"]);
  });

  it("字符串 countryTimeRef 挪到 renderConfig，供时间推导使用", () => {
    assert.deepEqual(plan.setup.childScene.extendInfo?.renderConfig?.countryTimeRef, { name: "br-618-2026" });
  });

  it("顶层排期挂到对应楼层，找不到楼层的丢弃", () => {
    const banner = plan.pages[0]!.floors[0]!;
    assert.equal(banner.schedules?.length, 1);
    assert.equal(banner.schedules?.[0]?.name, "banner");
    assert.deepEqual(banner.schedules?.[0]?.contentData, { a: 1 });
    assert.equal(plan.pages[0]!.floors[1]!.schedules?.length, 0);
  });

  it("不改动入参", () => {
    const input = structuredClone(specShaped);
    preprocessPlan(input);
    assert.equal((input.pages[0]!.floors[0] as { schedules?: unknown }).schedules, undefined);
  });
});
