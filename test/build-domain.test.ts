import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolveFloorSetting } from "../src/domains/build/page-build.js";
import { buildSchedulePayload } from "../src/domains/build/schedules.js";
import { toActivityTime } from "../src/domains/build/resolve-time.js";
import { msToPDTString } from "../src/domains/build/helpers.js";
import { applySelectionFallback } from "../src/domains/build/data-prep.js";

describe("resolveFloorSetting —— 标准化模块", () => {
  const componentMap = new Map([["banner", ["v1", "v2"]]]);

  it("只给模板名时，version 从模块池自动匹配", () => {
    const result = resolveFloorSetting({ template: { name: "banner" } }, componentMap);
    assert.deepEqual(result, { template: { name: "banner", version: "v1" } });
  });

  it("显式给出 version 时以显式值为准", () => {
    const result = resolveFloorSetting(
      { template: { name: "banner", version: "v2" } },
      componentMap,
    );
    assert.equal((result.template as { version: string }).version, "v2");
  });

  it("模块池里没有该组件时不编造 version", () => {
    const result = resolveFloorSetting({ template: { name: "unknown" } }, componentMap);
    assert.deepEqual(result, { template: { name: "unknown" } });
  });

  it("非标准化模块原样透传 floorSetting", () => {
    const result = resolveFloorSetting(
      { floorSetting: { custom: true, height: 100 } },
      componentMap,
    );
    assert.deepEqual(result, { custom: true, height: 100 });
  });

  it("保留 floorSetting 的其它字段", () => {
    const result = resolveFloorSetting(
      { template: { name: "banner" }, floorSetting: { height: 200 } },
      componentMap,
    );
    assert.deepEqual(result, { height: 200, template: { name: "banner", version: "v1" } });
  });
});

describe("buildSchedulePayload —— 排期载荷", () => {
  it("自动注入缺失的 locale / theme 排期", () => {
    const payload = buildSchedulePayload({ nations: ["BR"] }, [], {});
    assert.deepEqual(payload.locale, { contentData: {} });
    assert.deepEqual(payload.theme, { contentData: {} });
  });

  it("已存在的排期不重复注入", () => {
    const payload = buildSchedulePayload(
      { nations: ["BR"] },
      [{ type: "locale" }, { type: "theme" }],
      {},
    );
    assert.equal(payload.locale, undefined);
    assert.equal(payload.theme, undefined);
  });

  it("注入选品结果", () => {
    const payload = buildSchedulePayload(
      { nations: ["BR"] },
      [],
      {},
      { outerTaskIds: ["123"], ok: true },
    );
    assert.deepEqual(payload.outerTaskIds, ["123"]);
  });

  it("透传 contentData 与 nations", () => {
    const payload = buildSchedulePayload(
      { nations: ["BR", "MX"], contentData: { title: "x" } },
      [],
      {},
    );
    assert.deepEqual(payload.contentData, { title: "x" });
    assert.deepEqual(payload.nations, ["BR", "MX"]);
  });
});

describe("时间解析", () => {
  it("regionBigSaleTime → activityTime", () => {
    const result = toActivityTime([
      {
        regionList: ["BR", "MX"],
        showStartTime: 1710000000000,
        startTime: 1710100000000,
        endTime: 1710200000000,
      },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.region, "BR,MX");
    assert.equal(result[0]?.type, "include");
    assert.notEqual(result[0]?.megaStartTime, "");
    assert.equal(result[0]?.megaEndTime, result[0]?.megaEndTime);
  });

  it("缺时间时返回空串而不是编造", () => {
    const result = toActivityTime([{ regionList: [] }]);
    assert.equal(result[0]?.megaStartTime, "");
  });

  it("msToPDTString 对非法输入返回空串", () => {
    assert.equal(msToPDTString(undefined), "");
    assert.equal(msToPDTString(null), "");
    assert.equal(msToPDTString(Number.NaN), "");
  });

  it("msToPDTString 输出可解析的时间戳", () => {
    const out = msToPDTString(1710000000000);
    assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("选品失败兜底", () => {
  it("成功时不回填", () => {
    const result = { outerTaskIds: ["a"], ok: true };
    assert.deepEqual(applySelectionFallback({ pageIndex: 0, floorIndex: 0, scheduleIndex: 0 }, result), result);
  });

  it("失败时回填兜底 ID 并保留错误信息", () => {
    const result = applySelectionFallback(
      { pageIndex: 0, floorIndex: 0, scheduleIndex: 0 },
      { outerTaskIds: [], ok: false, error: "选品超时" },
      ["fallback-1"],
    );
    assert.deepEqual(result.outerTaskIds, ["fallback-1"]);
    assert.equal(result.ok, true);
    assert.match(result.error ?? "", /选品超时/);
  });
});
