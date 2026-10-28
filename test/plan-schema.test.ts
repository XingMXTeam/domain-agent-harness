import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validate } from "../src/runtime/schema-resolver.js";
import { getDomainDir } from "../src/runtime/paths.js";

const planSchema = JSON.parse(
  readFileSync(join(getDomainDir("build"), "schemas", "plan.schema.json"), "utf-8"),
) as Record<string, unknown>;

describe("plan.schema.json", () => {
  it("接受一份规范的 plan", () => {
    const plan = {
      setup: {
        childScene: { name: "618 大促", nations: "BR", countryTimeRef: "br-618-2026" },
        initModulePool: true,
      },
      pages: [
        {
          name: "首页",
          nations: "BR",
          floors: [{ template: { name: "banner" }, floorSetting: { height: 200 } }],
        },
      ],
      schedules: [
        { nations: ["BR"], pageName: "首页", floorName: "banner", contentData: {} },
      ],
      points: [{ name: "首屏浮层" }],
    };
    const r = validate(plan, planSchema);
    assert.equal(r.valid, true, r.errors.join("; "));
  });

  it("拒绝缺少 setup 的 plan", () => {
    const r = validate({}, planSchema);
    assert.equal(r.valid, false);
  });

  it("拒绝缺少 childScene.name 的 plan", () => {
    const r = validate({ setup: { childScene: {} } }, planSchema);
    assert.equal(r.valid, false);
  });

  it("pages[].nations 必须是字符串", () => {
    const plan = {
      setup: { childScene: { name: "x" } },
      pages: [{ name: "首页", nations: ["BR"] }],
    };
    const r = validate(plan, planSchema);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /nations/);
  });

  it("schedules[].nations 必须是数组", () => {
    const plan = {
      setup: { childScene: { name: "x" } },
      schedules: [{ nations: "BR" }],
    };
    const r = validate(plan, planSchema);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /nations/);
  });

  it("template 必须有 name", () => {
    const plan = {
      setup: { childScene: { name: "x" } },
      pages: [{ name: "首页", floors: [{ template: {} }] }],
    };
    const r = validate(plan, planSchema);
    assert.equal(r.valid, false);
  });
});
