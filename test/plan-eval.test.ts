import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { findTimeValues, scorePlan, summarize, type PlanCase } from "../src/evals/plan-score.js";
// @ts-expect-error —— 剧本模型是 .mjs，没有类型
import { planFromKnowledge } from "../scripts/local/mock-llm.mjs";

const ROOT = join(import.meta.dirname, "..");
const KB = join(ROOT, "knowledge");
const schema = JSON.parse(readFileSync(join(ROOT, "src/domains/build/schemas/plan.schema.json"), "utf-8"));
const { cases } = JSON.parse(readFileSync(join(ROOT, "evals/plan-cases.json"), "utf-8")) as { cases: PlanCase[] };
const byId = (id: string) => cases.find((c) => c.id === id)!;

/** 用剧本规划师按知识库出一份「标准答案」计划 */
function goldenPlan(c: PlanCase) {
  const dir = c.expect.pages[0]!.knowledge.split("/")[0]!;
  const docs: Record<string, string> = {};
  const read = (p: string) => (docs[p] = readFileSync(join(KB, p), "utf-8"));
  read(`${dir}/campaign.md`);
  for (const p of new Set(c.expect.pages.map((x) => x.knowledge))) read(p);
  return planFromKnowledge(c.prompt, dir, docs);
}

const fails = (s: ReturnType<typeof scorePlan>) => s.checks.filter((c) => !c.pass).map((c) => c.id);

describe("规划评测 —— 打分器", () => {
  it("用例文件里的每条，按知识库出的计划都满分", () => {
    for (const c of cases) {
      const s = scorePlan(goldenPlan(c), c, KB, schema);
      assert.ok(s.pass, `${c.id}: ${JSON.stringify(s.checks.filter((x) => !x.pass))}`);
    }
  });

  it("漏必选楼层、多楼层、隐藏错、排期缺都会扣分", () => {
    const c = byId("mega-br-4");
    const plan = goldenPlan(c);
    const home = plan.pages.find((p: { name: string }) => p.name === "首页");
    home.floors = home.floors.filter((f: { template: { name: string } }) => f.template.name !== "countdown");
    home.floors.push({ template: { name: "brand-wall" } });
    home.floors.find((f: { template: { name: string } }) => f.template.name === "coupon").hidden = false;
    plan.schedules = plan.schedules.filter((s: { pageName: string }) => s.pageName !== "服饰会场");
    const got = fails(scorePlan(plan, c, KB, schema));
    for (const id of ["required-floors", "no-extra-floors", "hidden", "schedules"]) assert.ok(got.includes(id), id);
  });

  it("计划里写时间值会扣分（countryTimeRef 除外）", () => {
    assert.deepEqual(findTimeValues({ setup: { childScene: { countryTimeRef: "br-618-2026" } } }), []);
    assert.deepEqual(findTimeValues({ phases: { full: {} } }), ["$.phases"]);
    assert.deepEqual(findTimeValues({ pages: [{ offlineTime: "x" }] }), ["$.pages[0].offlineTime"]);
    assert.deepEqual(findTimeValues({ notes: ["2026-06-01 开始"] }), ["$.notes[0]"]);
  });

  it("用户没给国家时默认国家会扣分，必须写 notes", () => {
    const c = byId("mega-no-nation");
    const plan = goldenPlan(byId("mega-br-4"));
    const got = fails(scorePlan(plan, c, KB, schema));
    assert.ok(got.includes("nation"));
    assert.ok(got.includes("nation-note"));
  });

  it("人工楼层写了排期、选品提示没替换类目都会扣分", () => {
    const c = byId("mega-br-4");
    const plan = goldenPlan(c);
    plan.schedules.push({ pageName: "首页", floorName: "coupon", contentData: {} });
    const feed = plan.schedules.find((s: { pageName: string; floorName: string }) => s.pageName === "服饰会场" && s.floorName === "product-feed");
    feed.contentData.selectionPrompt = "{类目}会场爆款";
    const got = fails(scorePlan(plan, c, KB, schema));
    assert.ok(got.includes("manual"));
    assert.ok(got.includes("schedule-content"));
  });

  it("没解析出计划时给 0 分", () => {
    const s = scorePlan(null, byId("mega-br-4"), KB, schema);
    assert.equal(s.score, 0);
    assert.equal(s.pass, false);
  });

  it("summarize 按检查项汇总通过率", () => {
    const a = scorePlan(goldenPlan(byId("mega-br-4")), byId("mega-br-4"), KB, schema);
    const b = scorePlan(null, byId("mega-br-4"), KB, schema);
    const sum = summarize([a, b]);
    assert.equal(sum.cases, 2);
    assert.equal(sum.passed, 1);
    assert.equal(sum.byCheck.pages?.pass, 1);
  });
});
