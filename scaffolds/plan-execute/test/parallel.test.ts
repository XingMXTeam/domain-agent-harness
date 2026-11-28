import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parallelMap, parallelFilter } from "../src/runtime/parallel.js";

describe("parallelMap", () => {
  it("保持结果顺序", async () => {
    const results = await parallelMap([
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
      async () => "fast",
    ]);
    assert.equal(results[0]?.value, "slow");
    assert.equal(results[1]?.value, "fast");
  });

  it("单项失败不影响其它任务", async () => {
    const results = await parallelMap([
      async () => {
        throw new Error("boom");
      },
      async () => "ok",
    ]);
    assert.equal(results[0]?.ok, false);
    assert.match(results[0]?.error ?? "", /boom/);
    assert.equal(results[1]?.ok, true);
  });

  it("限制并发数", async () => {
    let active = 0;
    let peak = 0;
    await parallelMap(
      Array.from({ length: 12 }, () => async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return true;
      }),
      { concurrency: 3 },
    );
    assert.ok(peak <= 3, `并发峰值 ${peak} 超过限制 3`);
  });

  it("continueOnError=false 时中止剩余任务", async () => {
    const results = await parallelMap(
      [
        async () => {
          throw new Error("stop");
        },
        async () => "never",
      ],
      { concurrency: 1, continueOnError: false },
    );
    assert.equal(results[1]?.ok, false);
    assert.equal(results[1]?.error, "aborted");
  });

  it("parallelFilter 只返回成功结果", async () => {
    const values = await parallelFilter([
      async () => 1,
      async () => {
        throw new Error("x");
      },
      async () => 3,
    ]);
    assert.deepEqual(values, [1, 3]);
  });
});
