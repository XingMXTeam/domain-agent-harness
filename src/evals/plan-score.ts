/**
 * 规划评测 —— 给一份 plan.json 打分，不碰平台。
 *
 * 期望分两部分：
 *   - **用例金标**（evals/plan-cases.json）：用户需求里能确定的事实 —— 国家、档期引用、页面清单、
 *     每页对应哪篇页面知识、类目 / 品牌。
 *   - **知识库推导**：每页该有哪些楼层、哪些隐藏、哪些要排期、选品提示写什么，全部现读知识库楼层表。
 *     改知识库不用改用例，评测自动跟着变。
 *
 * 每个用例输出一组检查（id / pass / detail），用例分 = 通过数 / 总数。
 * 换模型、改 prompt、改知识库后跑一遍，就知道计划是变好还是变坏。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFloorTable, type KbFloor } from "../domains/build/acceptance.js";
import { validate } from "../runtime/schema-resolver.js";

/** 一个页面的金标 */
export interface CasePage {
  name: string;
  /** 知识库相对路径，如 `mega-sale/pages/category.md` */
  knowledge: string;
  /** 类目会场的类目，用于判断可选楼层与替换 `{类目}` */
  category?: string;
  /** 品牌页的品牌名，用于替换 `{品牌}` */
  brand?: string;
}

/** 一个评测用例 */
export interface PlanCase {
  id: string;
  prompt: string;
  expect: {
    /** 国家码；null 表示用户没给国家，计划不得默认，必须写 notes */
    nations: string | null;
    /** 档期引用；nations 为 null 时不检查 */
    countryTimeRef?: string;
    pages: CasePage[];
    /** 点位名列表；空数组表示不建点位 */
    points: string[];
  };
}

export interface Check {
  id: string;
  pass: boolean;
  detail?: string;
}

export interface CaseScore {
  id: string;
  score: number;
  pass: boolean;
  checks: Check[];
}

interface Floor {
  name?: string;
  template?: { name?: string };
  hidden?: boolean;
}
interface Page {
  name?: string;
  nations?: string;
  knowledge?: string;
  floors?: Floor[];
}
interface Schedule {
  pageName?: string;
  floorName?: string;
  contentData?: Record<string, unknown>;
}
interface Plan {
  setup?: { childScene?: { nations?: string; countryTimeRef?: string } };
  pages?: Page[];
  schedules?: Schedule[];
  manualTodos?: Array<{ pageName?: string; floorName?: string }>;
  points?: Array<{ name?: string }>;
  notes?: unknown[];
  phases?: unknown;
}

const componentOf = (f: Floor) => f.template?.name ?? f.name ?? "";

/** 计划里不该出现的时间：键名像时间，或值像日期（countryTimeRef 除外） */
export function findTimeValues(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findTimeValues(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (k === "countryTimeRef") continue;
      if (k === "phases" || /(start|end|offline|expire|online)Time$|^(time|date)$|Date$/i.test(k)) {
        hits.push(p);
        continue;
      }
      hits.push(...findTimeValues(v, p));
    }
  } else if (typeof value === "string" && /\b20\d{2}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(value)) {
    hits.push(path);
  }
  return hits;
}

/** 某页按知识库应有的楼层（必选 + 类目命中的可选） */
export function expectedFloors(kb: KbFloor[], page: CasePage): KbFloor[] {
  return kb
    .filter((f) => f.required || (page.category !== undefined && f.industries.includes(page.category)))
    .sort((a, b) => a.position - b.position);
}

function fillPrompt(template: string, page: CasePage): string {
  return template.replace(/\{类目\}/g, page.category ?? "").replace(/\{品牌\}/g, page.brand ?? "");
}

/**
 * 给一份计划打分。
 *
 * @param plan 模型产出的计划（已 extractJson）；null 表示没解析出来
 * @param c 用例
 * @param kbDir 知识库根目录
 * @param schema plan.schema.json
 */
export function scorePlan(
  plan: unknown,
  c: PlanCase,
  kbDir: string,
  schema: Record<string, unknown>,
): CaseScore {
  const checks: Check[] = [];
  const add = (id: string, pass: boolean, detail?: string) =>
    checks.push({ id, pass, ...(pass || !detail ? {} : { detail }) });

  if (!plan || typeof plan !== "object") {
    add("parse", false, "没有解析出 JSON 计划");
    return finish(c.id, checks);
  }
  const p = plan as Plan;

  // ── 结构 ────────────────────────────────────────────
  const sv = validate(plan, schema);
  add("schema", sv.valid, sv.errors.slice(0, 3).join("; "));

  const times = findTimeValues(plan);
  add("no-time", times.length === 0, `出现时间值: ${times.slice(0, 3).join(", ")}`);

  // ── 国家与档期 ──────────────────────────────────────
  const pages = p.pages ?? [];
  const sceneNation = p.setup?.childScene?.nations ?? "";
  if (c.expect.nations === null) {
    const defaulted = [sceneNation, ...pages.map((x) => x.nations ?? "")].filter(Boolean);
    add("nation", defaulted.length === 0, `用户没给国家却默认了 ${[...new Set(defaulted)].join(",")}`);
    const asked = (p.notes ?? []).some((n) => /国家|nation|country/i.test(String(n)));
    add("nation-note", asked, "没在 notes 里提示确认国家");
  } else {
    const wrong = pages.filter((x) => x.nations !== c.expect.nations).map((x) => x.name);
    add(
      "nation",
      sceneNation === c.expect.nations && wrong.length === 0,
      `期望 ${c.expect.nations}，子场景 ${sceneNation || "空"}${wrong.length ? `，页面不符: ${wrong.join(",")}` : ""}`,
    );
    const ref = p.setup?.childScene?.countryTimeRef ?? "";
    add("time-ref", ref === c.expect.countryTimeRef, `期望 ${c.expect.countryTimeRef}，实际 ${ref || "空"}`);
  }

  // ── 页面清单 ────────────────────────────────────────
  const want = c.expect.pages.map((x) => x.name);
  const got = pages.map((x) => x.name ?? "");
  const missing = want.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !want.includes(n));
  const dup = got.filter((n, i) => got.indexOf(n) !== i);
  add(
    "pages",
    missing.length === 0 && extra.length === 0 && dup.length === 0,
    [missing.length && `缺 ${missing.join(",")}`, extra.length && `多 ${extra.join(",")}`, dup.length && `重复 ${dup.join(",")}`]
      .filter(Boolean)
      .join("；"),
  );

  // ── 逐页：知识来源、楼层、隐藏、排期 ─────────────────
  const kbCache = new Map<string, KbFloor[]>();
  const kbOf = (file: string) => {
    if (!kbCache.has(file)) {
      let md = "";
      try {
        md = readFileSync(join(kbDir, file), "utf-8");
      } catch {
        /* 用例写错路径时按空表处理，检查会失败并给出原因 */
      }
      kbCache.set(file, parseFloorTable(md));
    }
    return kbCache.get(file)!;
  };

  const badKnowledge: string[] = [];
  const missingFloors: string[] = [];
  const extraFloors: string[] = [];
  const badHidden: string[] = [];
  const missingSchedules: string[] = [];
  const badPrompts: string[] = [];
  const manualScheduled: string[] = [];
  const manualNoTodo: string[] = [];
  const schedules = p.schedules ?? [];
  const todos = p.manualTodos ?? [];

  for (const cp of c.expect.pages) {
    const page = pages.find((x) => x.name === cp.name);
    if (!page) continue; // 缺页已在 pages 检查里扣分
    if (page.knowledge !== cp.knowledge) badKnowledge.push(`${cp.name}(${page.knowledge ?? "空"})`);

    const kb = kbOf(cp.knowledge);
    const expected = expectedFloors(kb, cp);
    const present = (page.floors ?? []).map(componentOf);
    for (const f of expected) if (!present.includes(f.component)) missingFloors.push(`${cp.name}/${f.component}`);
    for (const comp of present) {
      if (!expected.some((f) => f.component === comp)) extraFloors.push(`${cp.name}/${comp}`);
    }
    for (const floor of page.floors ?? []) {
      const kf = expected.find((f) => f.component === componentOf(floor));
      if (kf && !!floor.hidden !== kf.hidden) badHidden.push(`${cp.name}/${kf.component}`);
    }

    for (const f of expected) {
      const hits = schedules.filter((s) => s.pageName === cp.name && s.floorName === f.component);
      if (f.scheduling_type === "selection" || f.scheduling_type === "strategy") {
        if (hits.length === 0) {
          missingSchedules.push(`${cp.name}/${f.component}`);
          continue;
        }
        if (f.scheduling_type === "selection") {
          const wantPrompt = fillPrompt(f.selection_prompt, cp);
          if (!hits.some((s) => s.contentData?.selectionPrompt === wantPrompt)) {
            badPrompts.push(`${cp.name}/${f.component}(期望「${wantPrompt}」)`);
          }
        } else if (!hits.some((s) => s.contentData?.strategy === "auto")) {
          badPrompts.push(`${cp.name}/${f.component}(strategy 应为 auto)`);
        }
      } else if (f.scheduling_type === "manual") {
        if (hits.length > 0) manualScheduled.push(`${cp.name}/${f.component}`);
        if (!todos.some((t) => t.pageName === cp.name && t.floorName === f.component)) {
          manualNoTodo.push(`${cp.name}/${f.component}`);
        }
      }
    }
  }

  add("knowledge", badKnowledge.length === 0, `页面知识不符: ${badKnowledge.join(",")}`);
  add("required-floors", missingFloors.length === 0, `缺楼层: ${missingFloors.join(",")}`);
  add("no-extra-floors", extraFloors.length === 0, `多余楼层: ${extraFloors.join(",")}`);
  add("hidden", badHidden.length === 0, `隐藏状态不符: ${badHidden.join(",")}`);
  add("schedules", missingSchedules.length === 0, `缺排期: ${missingSchedules.join(",")}`);
  add("schedule-content", badPrompts.length === 0, `排期内容不符: ${badPrompts.join(",")}`);
  add(
    "manual",
    manualScheduled.length === 0 && manualNoTodo.length === 0,
    [manualScheduled.length && `人工楼层被写了排期: ${manualScheduled.join(",")}`, manualNoTodo.length && `缺人工待办: ${manualNoTodo.join(",")}`]
      .filter(Boolean)
      .join("；"),
  );

  // ── 点位 ────────────────────────────────────────────
  const pts = (p.points ?? []).map((x) => x.name ?? "").sort();
  const wantPts = [...c.expect.points].sort();
  add("points", JSON.stringify(pts) === JSON.stringify(wantPts), `期望 [${wantPts.join(",")}]，实际 [${pts.join(",")}]`);

  return finish(c.id, checks);
}

function finish(id: string, checks: Check[]): CaseScore {
  const passed = checks.filter((x) => x.pass).length;
  const score = checks.length ? passed / checks.length : 0;
  return { id, score, pass: checks.length > 0 && passed === checks.length, checks };
}

/** 汇总：用例通过率、平均分、每项检查的通过率（看是哪类能力退化） */
export function summarize(scores: CaseScore[]) {
  const byCheck: Record<string, { pass: number; total: number }> = {};
  for (const s of scores) {
    for (const ch of s.checks) {
      const b = (byCheck[ch.id] ??= { pass: 0, total: 0 });
      b.total += 1;
      if (ch.pass) b.pass += 1;
    }
  }
  const n = scores.length || 1;
  return {
    cases: scores.length,
    passed: scores.filter((s) => s.pass).length,
    meanScore: scores.reduce((a, s) => a + s.score, 0) / n,
    byCheck,
  };
}
