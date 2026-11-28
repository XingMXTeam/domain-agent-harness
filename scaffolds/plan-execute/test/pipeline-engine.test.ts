import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { executePipeline, loadPipeline, PipelineConfigError } from "../src/runtime/pipeline-engine.js";
import { isTruthy, resolvePath, resolveValue, ExpressionError } from "../src/runtime/expr.js";
import { getDomainDir } from "../src/runtime/paths.js";
import type { PipelineState } from "../src/runtime/pipeline-state.js";
import type { SessionRequest, SessionResult, RunContext } from "../src/types.js";

const tempDirs: string[] = [];
function makeTmp(prefix = "dah-pipe-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const GOP = getDomainDir("gop");
const readState = (runDir: string) => JSON.parse(readFileSync(join(runDir, "state.json"), "utf-8")) as PipelineState;

type Handler = (req: SessionRequest, label: string) => unknown | Promise<unknown>;

/** 按步骤标签的最后一段（plan / style / ...）分派的假 invoke */
function fakeInvoke(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const requests: Record<string, SessionRequest> = {};
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = async (req: SessionRequest, _ctx: RunContext, label: string): Promise<SessionResult> => {
    calls.push(label);
    requests[label] = req;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const key = label.split("/").pop()!.replace(/\[\d+\]$/, "");
      const out = await (handlers[key] ?? (() => ({})))(req, label);
      return { output: typeof out === "string" ? out : JSON.stringify(out) };
    } finally {
      inFlight -= 1;
    }
  };
  return { fn, calls, requests, maxInFlight: () => maxInFlight };
}

const floorName = (req: SessionRequest) => (JSON.parse(req.userMessage) as { floor: { floorName: string } }).floor.floorName;

/** 一套全部成功的 gop 假模型 */
function happyGop(floors: string[], extra: Record<string, Handler> = {}) {
  return fakeInvoke({
    plan: () => ({ activity: "618", nations: ["BR"], floors: floors.map((f) => ({ floorName: f })) }),
    style: (req) => ({ results: [{ floorName: floorName(req), stylePackageId: `sp_${floorName(req)}`, success: true }] }),
    schedule: (req) => ({ results: [{ floorName: floorName(req), scheduleId: `sch_${floorName(req)}`, success: true }] }),
    publish: (req) => ({ results: [{ floorName: floorName(req), published: true, floorId: `fl_${floorName(req)}` }] }),
    review: (req) => {
      const { floors: fs } = JSON.parse(req.userMessage) as { floors: unknown[] };
      return { ok: true, checked: fs.length, issues: [] };
    },
    ...extra,
  });
}

describe("表达式", () => {
  const scope = { plan: { pages: [{ name: "首页" }, { name: "会场" }], ok: true }, n: 0, s: "x" };

  it("整串是单个表达式时返回原始值", () => {
    assert.deepEqual(resolveValue("${plan.pages}", scope), scope.plan.pages);
    assert.equal(resolveValue("${plan.pages.1.name}", scope), "会场");
    assert.equal(resolveValue("${plan.missing.deep}", scope), undefined);
  });

  it("嵌在字符串里做文本替换，对象转 JSON", () => {
    assert.equal(resolveValue("页面 ${plan.pages.0.name} / ${n}", scope), "页面 首页 / 0");
    assert.equal(resolveValue("v=${nope}", scope), "v=");
    assert.equal(resolveValue("${plan.ok}!", scope), "true!");
  });

  it("对象和数组递归解析", () => {
    assert.deepEqual(resolveValue({ a: "${s}", b: ["${n}", "lit"] }, scope), { a: "x", b: [0, "lit"] });
  });

  it("只支持点号路径", () => {
    assert.throws(() => resolvePath(scope, "plan.pages[0]"), ExpressionError);
    assert.throws(() => resolveValue("${a + b}", scope), ExpressionError);
  });

  it("when 的真值规则", () => {
    for (const v of [undefined, null, false, 0, "", "false", "0", " FALSE ", [], {}]) assert.equal(isTruthy(v), false, String(v));
    for (const v of [true, 1, "x", [0], { a: 1 }]) assert.equal(isTruthy(v), true, String(v));
  });
});

describe("loadPipeline", () => {
  it("gop 主流水线：规划 → 按楼层跑子流水线 → 审查", () => {
    const p = loadPipeline(join(GOP, "pipelines", "deployment.pipeline.yaml"));
    assert.equal(p.name, "deployment");
    assert.deepEqual(p.steps.map((s) => s.id), ["plan", "floors", "review"]);
    const floors = p.steps[1]!;
    assert.equal(floors.pipeline, "pipelines/floor-deployment.pipeline.yaml");
    assert.equal(floors.parallel, 4);
  });

  it("gop 子流水线：样式包 → 排期 → 发布，带 when 守卫", () => {
    const p = loadPipeline(join(GOP, "pipelines", "floor-deployment.pipeline.yaml"));
    assert.deepEqual(p.steps.map((s) => s.id), ["style", "schedule", "publish"]);
    assert.ok(p.steps[1]!.when && p.steps[2]!.when);
    assert.ok(p.output && typeof p.output === "object");
  });

  const bad = (yaml: string) => {
    const f = join(makeTmp(), "p.yaml");
    writeFileSync(f, yaml);
    return () => loadPipeline(f);
  };

  it("拒绝非法定义", () => {
    assert.throws(bad("name: x\nsteps: []\n"), /缺少 steps/);
    assert.throws(bad("steps:\n  - id: a\n    agent: a.md\n    pipeline: p.yaml\n"), /agent 或 pipeline/);
    assert.throws(bad("steps:\n  - id: a\n    agent: a.md\n  - id: a\n    agent: b.md\n"), /重复/);
    assert.throws(bad("steps:\n  - id: a\n    agent: a.md\n    parallel: 2\n"), /没有 foreach/);
    assert.throws(bad("steps:\n  - id: a\n    agent: a.md\n    retries: -1\n"), /retries/);
    assert.throws(bad("steps:\n  - agent: a.md\n"), /缺少 id/);
    assert.throws(() => loadPipeline("/nope/p.yaml"), PipelineConfigError);
  });
});

describe("executePipeline · gop", () => {
  it("每个楼层跑完整子流水线，审查拿到所有楼层结果", async () => {
    const runDir = makeTmp();
    const fake = happyGop(["A", "B", "C"]);
    const report = await executePipeline("投放 618", "gop", runDir, { invoke: fake.fn });

    assert.deepEqual(report, { ok: true, checked: 3, issues: [] });
    for (const i of [0, 1, 2]) {
      for (const s of ["style", "schedule", "publish"]) assert.ok(fake.calls.includes(`floors[${i}]/${s}`), `${i}/${s}`);
    }
    assert.equal(fake.calls[0], "plan");
    assert.equal(fake.calls.at(-1), "review");

    const reviewInput = JSON.parse(fake.requests.review!.userMessage) as { floors: Array<{ floorName: string; publish: unknown }> };
    assert.deepEqual(reviewInput.floors.map((f) => f.floorName), ["A", "B", "C"]);
    assert.ok(reviewInput.floors.every((f) => f.publish));
  });

  it("Agent frontmatter 生效：规划师只拿到只读工具，outputSchema 用于校验", async () => {
    const fake = happyGop(["A"]);
    await executePipeline("投放", "gop", makeTmp(), { invoke: fake.fn });
    const tools = fake.requests.plan!.allowedTools ?? [];
    assert.ok(tools.length > 0 && tools.every((t) => t.startsWith("mcp__knowledge__")));
    assert.equal(fake.requests.plan!.maxTurns, 12);
    assert.ok(!fake.requests.plan!.systemPrompt.startsWith("---"));

    const bad = happyGop(["A"], { plan: () => ({ floors: [] }) }); // 缺 activity
    await assert.rejects(() => executePipeline("投放", "gop", makeTmp(), { invoke: bad.fn }), /deployment-plan\.schema\.json/);
  });

  it("写盘 state.json 与每步产物", async () => {
    const runDir = makeTmp();
    await executePipeline("投放", "gop", runDir, { invoke: happyGop(["A", "B"]).fn });
    const state = readState(runDir);
    assert.equal(state.status, "done");
    for (const id of ["plan", "floors", "floors[0]", "floors[0]/style", "floors[1]/publish", "review"]) {
      assert.equal(state.steps[id]?.status, "done", id);
    }
    assert.equal(state.steps.plan!.attempts, 1);
    assert.ok(existsSync(join(runDir, state.steps.plan!.artifact!)));
    const art = JSON.parse(readFileSync(join(runDir, "artifacts", "floors_0_.json"), "utf-8"));
    assert.equal(art.floorName, "A");
  });

  it("when：样式包失败的楼层跳过排期和发布，其他楼层照常", async () => {
    const runDir = makeTmp();
    const fake = happyGop(["A", "B"], {
      style: (req) => ({ results: [{ floorName: floorName(req), success: floorName(req) !== "B", error: floorName(req) === "B" ? "样式不存在" : "" }] }),
    });
    await executePipeline("投放", "gop", runDir, { invoke: fake.fn });
    const state = readState(runDir);
    assert.equal(state.steps["floors[1]/schedule"]?.status, "skipped");
    assert.equal(state.steps["floors[1]/publish"]?.status, "skipped");
    assert.equal(state.steps["floors[0]/publish"]?.status, "done");
    assert.ok(!fake.calls.includes("floors[1]/schedule"));
    const reviewInput = JSON.parse(fake.requests.review!.userMessage) as { floors: Array<{ floorName: string; publish?: unknown }> };
    assert.equal(reviewInput.floors[1]!.publish, undefined);
  });

  it("when：没有楼层时跳过审查", async () => {
    const runDir = makeTmp();
    const fake = happyGop([]);
    await executePipeline("投放", "gop", runDir, { invoke: fake.fn });
    assert.ok(!fake.calls.includes("review"));
    assert.equal(readState(runDir).steps.review?.status, "skipped");
  });

  it("retries：输出不是 JSON 时重试，attempts 记 2", async () => {
    const runDir = makeTmp();
    let n = 0;
    const fake = happyGop(["A"], {
      plan: () => (++n === 1 ? "抱歉我先想想" : { activity: "618", floors: [{ floorName: "A" }] }),
    });
    await executePipeline("投放", "gop", runDir, { invoke: fake.fn });
    assert.equal(readState(runDir).steps.plan!.attempts, 2);
  });

  it("没有 retries 的写步骤失败一次就停，整条流水线标记失败", async () => {
    const runDir = makeTmp();
    let styleCalls = 0;
    const fake = happyGop(["A"], { style: () => { styleCalls += 1; throw new Error("503"); } });
    await assert.rejects(() => executePipeline("投放", "gop", runDir, { invoke: fake.fn }), /503/);
    assert.equal(styleCalls, 1);
    const state = readState(runDir);
    assert.equal(state.status, "failed");
    assert.equal(state.steps["floors[0]/style"]?.status, "failed");
    assert.ok(state.errors.length > 0);
    assert.ok(!fake.calls.includes("review"));
  });

  it("parallel：并发不超过上限，且确实并发", async () => {
    const floors = Array.from({ length: 10 }, (_, i) => `F${i}`);
    const slow = (out: Handler): Handler => async (req, label) => {
      await new Promise((r) => setTimeout(r, 15));
      return out(req, label);
    };
    const fake = happyGop(floors, {
      style: slow((req) => ({ results: [{ floorName: floorName(req), success: true }] })),
    });
    await executePipeline("投放", "gop", makeTmp(), { invoke: fake.fn });
    assert.ok(fake.maxInFlight() <= 4, `max ${fake.maxInFlight()}`);
    assert.ok(fake.maxInFlight() > 1, `max ${fake.maxInFlight()}`);
  });

  it("foreach fail-fast：一项失败后不再派发新项", async () => {
    const floors = Array.from({ length: 12 }, (_, i) => `F${i}`);
    const fake = happyGop(floors, {
      style: async (req) => {
        if (floorName(req) === "F0") throw new Error("坏楼层");
        await new Promise((r) => setTimeout(r, 10));
        return { results: [{ floorName: floorName(req), success: true }] };
      },
    });
    await assert.rejects(() => executePipeline("投放", "gop", makeTmp(), { invoke: fake.fn }), /1 项失败[\s\S]*坏楼层/);
    const styled = fake.calls.filter((c) => c.endsWith("/style")).length;
    assert.ok(styled < floors.length, `派发了 ${styled} 项`);
  });
});

describe("executePipeline · 旧写法兼容", () => {
  it("input / foreach 写键名仍然可用", async () => {
    const dir = makeTmp();
    writeFileSync(join(dir, "agent.md"), "# 测试 Agent");
    const file = join(dir, "legacy.yaml");
    writeFileSync(file, [
      "name: legacy",
      "steps:",
      `  - name: plan\n    agent: ${join(dir, "agent.md")}\n    output: plan`,
      `  - name: each\n    agent: ${join(dir, "agent.md")}\n    foreach: plan\n    output: done`,
    ].join("\n"));

    const seen: string[] = [];
    const fn = async (req: SessionRequest, _c: RunContext, label: string): Promise<SessionResult> => {
      seen.push(`${label}:${req.userMessage}`);
      return { output: label === "plan" ? '[{"x":1},{"x":2}]' : '{"ok":true}' };
    };
    const out = await executePipeline("hi", "gop", makeTmp(), { invoke: fn, pipelineFile: file });
    assert.deepEqual(out, [{ ok: true }, { ok: true }]);
    assert.equal(seen[0], "plan:hi");
    assert.match(seen[1]!, /^each\[0\]:\{\s*"x": 1\s*\}$/);
  });

  it("foreach 解析不出数组时报配置错误，不重试", async () => {
    const dir = makeTmp();
    writeFileSync(join(dir, "agent.md"), "# A");
    const file = join(dir, "p.yaml");
    writeFileSync(file, `steps:\n  - id: each\n    agent: ${join(dir, "agent.md")}\n    foreach: \${user_prompt}\n    retries: 3\n`);
    let calls = 0;
    const fn = async (): Promise<SessionResult> => { calls += 1; return { output: "{}" }; };
    await assert.rejects(() => executePipeline("not array", "gop", makeTmp(), { invoke: fn, pipelineFile: file }), PipelineConfigError);
    assert.equal(calls, 0);
  });

  it("子流水线循环引用会被拦下", async () => {
    const dir = makeTmp();
    const file = join(dir, "loop.yaml");
    writeFileSync(file, `name: loop\nsteps:\n  - id: again\n    pipeline: ${file}\n`);
    const fn = async (): Promise<SessionResult> => ({ output: "{}" });
    await assert.rejects(() => executePipeline("x", "gop", makeTmp(), { invoke: fn, pipelineFile: file }), /嵌套超过/);
  });
});
