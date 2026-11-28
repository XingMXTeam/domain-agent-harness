import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { runReview, formatReview } from "../src/runtime/review.js";
import type { ChatRequest, ChatResponse, LlmClient } from "../src/runtime/llm.js";
import type { RunContext } from "../src/types.js";
import { join } from "node:path";
import { getDomainDir } from "../src/runtime/paths.js";
import { existsSync } from "node:fs";

function mockLlm(text: string, capture?: ChatRequest[]): LlmClient {
  return {
    provider: "anthropic",
    model: "mock",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      capture?.push(req);
      return { content: [{ type: "text", text }], text };
    },
  };
}

const ctx: RunContext = {
  runId: "test",
  runDir: "/tmp/dah-review-test",
  domain: "build",
  trace: { event: () => {}, events: () => [], flush: () => {} },
  mcpConfigPath: "/tmp/dah-review-test/mcp-config.json",
};

describe("runReview", () => {
  it("解析模型返回的审查报告", async () => {
    const report = await runReview(
      "init",
      { success: false, items: [], summary: "1 个模块失败" },
      "build",
      ctx,
      {
        llm: mockLlm(
          JSON.stringify({
            ok: false,
            checked: 13,
            issues: [
              {
                level: "error",
                step: "module",
                target: "首页/首屏 Banner",
                message: "模块创建失败",
                suggestion: "重试该模块创建",
              },
            ],
            summary: "12/13 成功",
          }),
        ),
      },
    );
    assert.ok(report);
    assert.equal(report.ok, false);
    assert.equal(report.checked, 13);
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0]?.level, "error");
    assert.equal(report.issues[0]?.suggestion, "重试该模块创建");
  });

  it("把执行结果作为审查输入传给模型", async () => {
    const captured: ChatRequest[] = [];
    await runReview(
      "init",
      { success: true, items: [{ step: "setup", target: "1", ok: true }], summary: "全部成功" },
      "build",
      ctx,
      { llm: mockLlm('{"ok":true,"checked":1,"issues":[],"summary":"ok"}', captured) },
    );
    const userMessage = captured[0]?.messages[0]?.content[0];
    assert.ok(userMessage && userMessage.type === "text");
    assert.match(userMessage.text, /全部成功/);
  });

  it("没有 review.md 时返回 undefined（跳过审查）", async () => {
    const report = await runReview("fix", {}, "build", ctx, { llm: mockLlm("{}") });
    assert.equal(report, undefined);
  });
});

describe("formatReview", () => {
  it("渲染问题与建议", () => {
    const text = formatReview({
      ok: false,
      checked: 2,
      issues: [
        {
          level: "error",
          step: "module",
          target: "首页/Banner",
          message: "创建失败",
          suggestion: "重试",
        },
      ],
      summary: "1/2 成功",
    });
    assert.match(text, /审查：有问题/);
    assert.match(text, /1\/2 成功/);
    assert.match(text, /\[error\].*首页\/Banner/);
    assert.match(text, /建议：重试/);
  });

  it("无问题时只输出结论", () => {
    const text = formatReview({ ok: true, checked: 5, issues: [], summary: "全部通过" });
    assert.match(text, /审查：通过/);
    assert.match(text, /全部通过/);
    assert.doesNotMatch(text, /\[error\]/);
  });
});

describe("域资产", () => {
  it("build 域的 init skill 带审查提示词", () => {
    const review = join(getDomainDir("build"), "skills", "init", "review.md");
    assert.equal(existsSync(review), true, "init skill 应有 review.md");
  });
});
