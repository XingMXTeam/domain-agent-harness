import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { catalogRoute, DOMAIN_CONFIGS, DOMAIN_META } from "../src/orchestrator.js";
import type { ChatRequest, ChatResponse, LlmClient } from "../src/runtime/llm.js";

/** 只会返回固定文本的 mock LLM */
function mockLlm(text: string): LlmClient {
  return {
    provider: "anthropic",
    model: "mock",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: [{ type: "text", text }], text };
    },
  };
}

const tempDirs: string[] = [];

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dah-test-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("catalogRoute", () => {
  it("按模型返回的 domain 路由", async () => {
    const domain = await catalogRoute(
      "查一下活动页面结构",
      makeRunDir(),
      { llm: mockLlm('{"domain":"qa"}') },
    );
    assert.equal(domain, "qa");
  });

  it("模型返回非法 domain 时兜底到 qa", async () => {
    const domain = await catalogRoute(
      "随便问问",
      makeRunDir(),
      { llm: mockLlm('{"domain":"unknown-domain"}') },
    );
    assert.equal(domain, "qa");
  });

  it("模型输出非 JSON 时兜底到 qa", async () => {
    const domain = await catalogRoute(
      "随便问问",
      makeRunDir(),
      { llm: mockLlm("我觉得应该去 build 域") },
    );
    assert.equal(domain, "qa");
  });

  it("模型抛错时兜底到 qa", async () => {
    const broken: LlmClient = {
      provider: "anthropic",
      model: "mock",
      async chat(): Promise<ChatResponse> {
        throw new Error("network down");
      },
    };
    const domain = await catalogRoute("随便问问", makeRunDir(), { llm: broken });
    assert.equal(domain, "qa");
  });

  it("写出临时的空 MCP 配置", async () => {
    const runDir = makeRunDir();
    await catalogRoute("查一下", runDir, { llm: mockLlm('{"domain":"qa"}') });
    const { readFileSync, existsSync } = await import("node:fs");
    const p = join(runDir, "mcp-catalog.json");
    assert.equal(existsSync(p), true);
    assert.deepEqual(JSON.parse(readFileSync(p, "utf-8")), { mcpServers: {} });
  });
});

describe("域注册表", () => {
  it("每个域都有 meta 与 config", () => {
    for (const name of Object.keys(DOMAIN_META)) {
      assert.ok(DOMAIN_CONFIGS[name], `域 ${name} 缺少 DOMAIN_CONFIGS`);
    }
  });

  it("单 skill 域声明的 skill 在 validSkills 内", () => {
    for (const [name, meta] of Object.entries(DOMAIN_META)) {
      if (!meta.singleSkill) continue;
      const config = DOMAIN_CONFIGS[name];
      assert.ok(config);
      assert.ok(
        config.validSkills.includes(meta.singleSkill),
        `域 ${name} 的 singleSkill=${meta.singleSkill} 不在 validSkills 中`,
      );
    }
  });

  it("工具白名单采用 mcp__<server>__<tool> 三段式", () => {
    for (const tool of DOMAIN_CONFIGS.qa.queryAllowedTools) {
      assert.match(tool, /^mcp__[^_]+(?:_[^_]+)*__[^_]+(?:_[^_]+)*$/, `工具名不合规: ${tool}`);
    }
  });

  it("工具白名单不重复", () => {
    const tools = DOMAIN_CONFIGS.qa.queryAllowedTools;
    assert.equal(new Set(tools).size, tools.length);
  });
});
