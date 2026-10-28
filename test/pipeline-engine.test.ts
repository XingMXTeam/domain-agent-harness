import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { executePipeline, loadPipeline } from "../src/runtime/pipeline-engine.js";
import { getDomainDir } from "../src/runtime/paths.js";
import type { SessionRequest, SessionResult, RunContext } from "../src/types.js";

const tempDirs: string[] = [];
function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dah-pipe-"));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** 按步骤名返回不同 JSON 的假 invoke */
function fakeInvoke(payloads: Record<string, string>) {
  const calls: string[] = [];
  const fn = async (
    req: SessionRequest,
    _ctx: RunContext,
    label: string,
  ): Promise<SessionResult> => {
    calls.push(label);
    const text = payloads[label] ?? "{}";
    return { output: text };
  };
  return { fn, calls };
}

describe("loadPipeline", () => {
  it("加载 gop 主流水线", () => {
    const path = join(
      getDomainDir("gop"),
      "pipelines",
      "deployment.pipeline.yaml",
    );
    const pipeline = loadPipeline(path);
    assert.equal(pipeline.name, "deployment");
    assert.equal(pipeline.steps.length, 5);
    assert.deepEqual(
      pipeline.steps.map((s) => s.name),
      ["plan", "style", "schedule", "publish", "review"],
    );
  });

  it("加载 gop 子流水线", () => {
    const path = join(
      getDomainDir("gop"),
      "pipelines",
      "floor-deployment.pipeline.yaml",
    );
    const pipeline = loadPipeline(path);
    assert.equal(pipeline.name, "floor-deployment");
    assert.deepEqual(pipeline.steps.map((s) => s.name), ["schedule", "publish"]);
  });

  it("每个 step 都声明了 agent 与 output", () => {
    const pipeline = loadPipeline(
      join(getDomainDir("gop"), "pipelines", "deployment.pipeline.yaml"),
    );
    for (const step of pipeline.steps) {
      assert.ok(step.agent, `step ${step.name} 缺少 agent`);
      assert.ok(step.output, `step ${step.name} 缺少 output`);
    }
  });
});

describe("executePipeline", () => {
  it("按顺序执行所有 step 并把产物传给下游", async () => {
    const { fn, calls } = fakeInvoke({
      plan: JSON.stringify({ activity: "618", floors: [{ floorName: "A" }] }),
      style: JSON.stringify({
        results: [{ floorName: "A", stylePackageId: "sp_1", success: true, error: "" }],
      }),
      schedule: JSON.stringify({
        results: [{ floorName: "A", scheduleId: "sch_1", success: true, error: "" }],
      }),
      publish: JSON.stringify({
        results: [{ floorName: "A", published: true, floorId: "fl_1", error: "" }],
      }),
      review: JSON.stringify({ ok: true, checked: 1, issues: [] }),
    });

    await executePipeline("投放 618", "gop", makeRunDir(), { invoke: fn });

    assert.deepEqual(calls, ["plan", "style", "schedule", "publish", "review"]);
  });

  it("产物不符合 schema 时抛错", async () => {
    const { fn } = fakeInvoke({
      // 缺少必填字段 activity
      plan: JSON.stringify({ floors: [] }),
    });

    await assert.rejects(
      () => executePipeline("投放 618", "gop", makeRunDir(), { invoke: fn }),
      /不符合 schema/,
    );
  });
});
