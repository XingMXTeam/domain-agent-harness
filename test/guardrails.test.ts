/**
 * 「模型不碰写接口、代码说了算」的几道闸：
 *   1. 计划不过 schema：回给模型修一次，仍不过就拦截，不执行
 *   2. fix：只执行 allowedActions 里的工具，默认拒绝
 *   3. 审查员：只给 review.md 里列的只读工具；ok 缺省按未通过
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runDomainSkill, runFix } from "../src/runtime/domain-skill.js";
import { runReview } from "../src/runtime/review.js";
import { loadPromptFile } from "../src/runtime/prompt-file.js";
import { getDomainDir } from "../src/runtime/paths.js";
import type { ChatRequest, ChatResponse, LlmClient } from "../src/runtime/llm.js";
import type { RunContext, SessionRequest } from "../src/types.js";

function makeCtx(): RunContext {
  const runDir = mkdtempSync(join(tmpdir(), "dah-guard-"));
  return {
    runId: "guard",
    runDir,
    domain: "build",
    trace: { event: () => {}, events: () => [], flush: () => {} },
    mcpConfigPath: join(runDir, "mcp-config.json"),
  };
}

/** 按顺序返回给定输出的假会话 */
function fakeInvoke(outputs: string[]) {
  const requests: SessionRequest[] = [];
  const fn = async (req: SessionRequest) => {
    requests.push(req);
    return { output: outputs[Math.min(requests.length - 1, outputs.length - 1)]! };
  };
  return { fn: fn as never, requests };
}

const VALID = JSON.stringify({ setup: { childScene: { name: "618" } }, pages: [] });
const INVALID = JSON.stringify({ pages: [] }); // 缺 setup

describe("计划 schema 闸", () => {
  it("连续两次不合格：拦截，不执行", async () => {
    const inv = fakeInvoke([INVALID, INVALID]);
    const out = await runDomainSkill("init", "创建 618", "build", makeCtx(), { invoke: inv.fn });
    assert.equal(out.blocked, true);
    assert.match(out.summary, /已拦截/);
    assert.equal(inv.requests.length, 2);
    assert.match(inv.requests[1]!.userMessage, /不符合 schema/);
  });

  it("第一次不合格、修正后合格：继续往下走", async () => {
    process.env.DAH_PLAN_ONLY = "1";
    try {
      const ctx = makeCtx();
      const inv = fakeInvoke([INVALID, VALID]);
      const out = await runDomainSkill("init", "创建 618", "build", ctx, { invoke: inv.fn });
      assert.equal(out.blocked, undefined);
      assert.equal(out.planOnly, true);
      assert.ok(existsSync(join(ctx.runDir, "plan.json")));
    } finally {
      delete process.env.DAH_PLAN_ONLY;
    }
  });

  it("模型没输出 JSON 也拦截", async () => {
    const inv = fakeInvoke(["我觉得应该先建首页", "还是不给 JSON"]);
    const out = await runDomainSkill("init", "创建 618", "build", makeCtx(), { invoke: inv.fn });
    assert.equal(out.blocked, true);
  });
});

describe("fix 动作闸", () => {
  function fakeRunner() {
    const called: string[] = [];
    return {
      called,
      runner: {
        async call(tool: string) {
          called.push(tool);
          return {};
        },
        async close() {},
      } as never,
    };
  }

  it("只执行 allowedActions 里的工具，其余拒绝且计入失败", async () => {
    const r = fakeRunner();
    const out = await runFix(
      "fix",
      { actions: [
        { tool: "mcp__platform__module_showOrHide", args: {} },
        { tool: "mcp__platform__childScene_delete", args: {} },
      ] },
      makeCtx(),
      ["mcp__platform__module_showOrHide"],
      r.runner,
    );
    assert.deepEqual(r.called, ["mcp__platform__module_showOrHide"]);
    const exec = out.execution as { success: boolean; items: { ok: boolean; target: string }[] };
    assert.equal(exec.success, false);
    assert.equal(exec.items.find((i) => i.target === "mcp__platform__childScene_delete")?.ok, false);
  });

  it("没配置 allowedActions：一个都不执行", async () => {
    const r = fakeRunner();
    await runFix("fix", { actions: [{ tool: "mcp__platform__schedule_update", args: {} }] }, makeCtx(), [], r.runner);
    assert.deepEqual(r.called, []);
  });

  it("build/fix 的定位阶段只读，动作白名单只含修复类工具", () => {
    const spec = loadPromptFile(join(getDomainDir("build"), "skills", "fix", "spec.md"));
    assert.ok(spec.allowedTools?.length);
    for (const t of spec.allowedTools!) assert.match(t, /_(get|list)/, `${t} 不像只读工具`);
    assert.deepEqual(spec.allowedActions?.sort(), [
      "mcp__platform__module_showOrHide",
      "mcp__platform__module_updateSetting",
      "mcp__platform__schedule_delete",
      "mcp__platform__schedule_update",
    ]);
  });
});

describe("审查员闸", () => {
  function mockLlm(text: string, capture: ChatRequest[] = []): LlmClient {
    return {
      provider: "anthropic",
      model: "mock",
      async chat(req: ChatRequest): Promise<ChatResponse> {
        capture.push(req);
        return { content: [{ type: "text", text }], text };
      },
    };
  }

  it("review.md 只列只读工具", () => {
    const spec = loadPromptFile(join(getDomainDir("build"), "skills", "init", "review.md"));
    assert.ok(spec.allowedTools?.length);
    for (const t of spec.allowedTools!) assert.match(t, /_(get|list|read)/, `${t} 不像只读工具`);
  });

  it("模型没明确给出 ok: true 时按未通过", async () => {
    const report = await runReview("init", {}, "build", makeCtx(), { llm: mockLlm('{"summary":"看起来没问题"}') });
    assert.equal(report?.ok, false);
  });
});
