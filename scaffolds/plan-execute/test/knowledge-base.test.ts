/**
 * 知识库：MCP 服务、知识内容自洽、规划阶段的只读约束、知识库驱动的计划。
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { createKnowledgeBase, startKnowledgeServer, parseFrontmatter } from "../scripts/knowledge-mcp.mjs";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { parseTable, plannerStep } from "../scripts/local/mock-llm.mjs";
import { createMcpClientPool } from "../src/runtime/mcp-client.js";
import { parsePromptFile, loadPromptFile } from "../src/runtime/prompt-file.js";
import { manualTodosOf } from "../src/runtime/domain-skill.js";
import { DOMAINS_DIR } from "../src/runtime/paths.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const KB_DIR = join(import.meta.dirname, "..", "knowledge");
const kb = createKnowledgeBase(KB_DIR);

describe("知识库 MCP · 本地调用", () => {
  it("根目录列出活动类型目录、共享目录和 L0 总览", () => {
    const entries = kb.list({});
    const paths = entries.map((e: { path: string }) => e.path);
    assert.ok(paths.includes("mega-sale"));
    assert.ok(paths.includes("brand-day"));
    assert.ok(paths.includes("shared"));
    const readme = entries.find((e: { path: string }) => e.path === "README.md");
    assert.equal(readme.level, "L0");
    assert.deepEqual(readme.consumers, ["planner", "reviewer"]);
  });

  it("读取文档全文", () => {
    assert.match(kb.read({ path: "mega-sale/campaign.md" }), /页面清单/);
  });

  it("拒绝越界路径和非 Markdown 文件", () => {
    assert.throws(() => kb.read({ path: "../package.json" }), /越界|不存在/);
    assert.throws(() => kb.list({ path: "../../" }), /越界/);
    assert.throws(() => kb.read({ path: "mega-sale" }), /不存在/);
  });

  it("关键词搜索返回命中行", () => {
    const hits = kb.search({ query: "selection_prompt 爆款", limit: 3 });
    assert.ok(hits.length > 0 && hits.length <= 3);
    assert.ok(hits.every((h: { path: string; line: number }) => h.path.endsWith(".md") && h.line > 0));
  });

  it("frontmatter 解析 level 和 consumers", () => {
    const { meta, body } = parseFrontmatter("---\nlevel: L2\nconsumers: [planner]\n---\n# 标题\n");
    assert.equal(meta.level, "L2");
    assert.deepEqual(meta.consumers, ["planner"]);
    assert.equal(body.trim(), "# 标题");
  });
});

describe("知识库 MCP · HTTP 服务", () => {
  let server: { close: () => void };
  let url = "";
  before(async () => {
    const started = await startKnowledgeServer(kb);
    server = started.server;
    url = `http://127.0.0.1:${started.port}/mcp`;
  });
  after(() => server.close());

  it("通过 harness 的 MCP 客户端拿到三个只读工具并能读文档", async () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "dah-kb-"));
    const cfg = join(cfgDir, "mcp.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { knowledge: { type: "http", url } } }));
    const pool = await createMcpClientPool(cfg);
    try {
      const names = (await pool.listTools()).map((t) => t.tool.name).sort();
      assert.deepEqual(names, ["kb_list", "kb_read", "kb_search"]);
      const res = await pool.callTool("knowledge", "kb_read", { path: "README.md" });
      assert.ok(res.success);
      assert.match(String(res.data), /活动知识库总览/);
    } finally {
      await pool.close();
    }
  });
});

describe("知识库内容自洽", () => {
  const components = parseTable(kb.read({ path: "shared/components.md" }), "用途").map(
    (r: Record<string, string>) => r["组件"],
  );

  for (const dir of ["mega-sale", "brand-day"]) {
    it(`${dir}：页面清单引用的页面知识都存在，楼层组件都在组件字典里`, () => {
      const pages = parseTable(kb.read({ path: `${dir}/campaign.md` }), "页面类型");
      assert.ok(pages.length > 0);
      for (const p of pages) {
        const file = `${dir}/${p["页面知识"]}`;
        assert.ok(existsSync(join(KB_DIR, file)), `缺少 ${file}`);
        const floors = parseTable(kb.read({ path: file }), "component");
        assert.ok(floors.length > 0, `${file} 没有楼层表`);
        for (const f of floors) {
          assert.ok(components.includes(f.component), `${file} 的组件 ${f.component} 不在组件字典`);
          assert.ok(["none", "selection", "strategy", "manual"].includes(f.scheduling_type));
          if (f.scheduling_type === "selection") assert.ok(f.selection_prompt, `${file} 的 ${f.component} 缺少 selection_prompt`);
        }
      }
    });
  }
});

describe("规划阶段 · 提示词 frontmatter", () => {
  it("没有 frontmatter 时原样返回正文", () => {
    assert.deepEqual(parsePromptFile("# 正文"), { body: "# 正文" });
  });

  it("解析 allowedTools 和 maxTurns，并从正文里去掉 frontmatter", () => {
    const p = parsePromptFile("---\nallowedTools:\n  - a\n  - b\nmaxTurns: 5\n---\n# 正文\n");
    assert.deepEqual(p.allowedTools, ["a", "b"]);
    assert.equal(p.maxTurns, 5);
    assert.equal(p.body, "# 正文\n");
  });

  it("非法取值报错", () => {
    assert.throws(() => parsePromptFile("---\nallowedTools: abc\n---\n"), /字符串数组/);
    assert.throws(() => parsePromptFile("---\nmaxTurns: 0\n---\n"), /正整数/);
  });

  it("build/init 规划师只拿到知识库和模板库的只读工具", () => {
    const spec = loadPromptFile(join(DOMAINS_DIR, "build", "skills", "init", "spec.md"));
    const tools = spec.allowedTools ?? [];
    assert.ok(tools.includes("mcp__knowledge__kb_read"));
    assert.ok(tools.every((t) => t.startsWith("mcp__knowledge__") || t === "mcp__platform__modulePool_getModulesWithTemplate"));
    assert.ok(!spec.body.startsWith("---"));
  });

  it("build 域 mcp.json 声明了 knowledge 服务", () => {
    const cfg = JSON.parse(readFileSync(join(DOMAINS_DIR, "build", "mcp.json"), "utf-8"));
    assert.ok(cfg.mcpServers.knowledge?.url);
  });
});

describe("知识库驱动的计划（剧本规划师）", () => {
  const read = "mcp__knowledge__kb_read";

  /** 模拟会话：规划师要读哪篇就喂哪篇，直到它出计划 */
  function runPlanner(prompt: string) {
    const messages: unknown[] = [{ role: "user", content: [{ type: "text", text: prompt }] }];
    const reads: string[] = [];
    for (let i = 0; i < 10; i++) {
      const step = plannerStep(prompt, messages, [read]);
      if (step.plan) return { plan: step.plan, reads };
      const id = `t${i}`;
      reads.push(step.read);
      messages.push({ role: "assistant", content: [{ type: "tool_use", id, name: read, input: { path: step.read } }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: kb.read({ path: step.read }) }] });
    }
    throw new Error("规划师没有收敛");
  }

  it("按 L0 → L1 → L2 顺序读，不重复读", () => {
    const { reads } = runPlanner("创建 618 大促，巴西站，4 个页面");
    assert.deepEqual(reads, ["README.md", "mega-sale/campaign.md", "mega-sale/pages/home.md", "mega-sale/pages/category.md"]);
  });

  it("楼层、隐藏、排期、人工待办都来自知识库", () => {
    const { plan } = runPlanner("创建 618 大促，巴西站，4 个页面");
    assert.equal(plan.setup.childScene.countryTimeRef, "br-618-2026");
    assert.deepEqual(plan.pages.map((p: { name: string }) => p.name), ["首页", "3C数码会场", "服饰会场", "家居会场"]);

    const home = plan.pages[0];
    assert.deepEqual(home.floors.map((f: { template: { name: string } }) => f.template.name), ["banner", "countdown", "coupon", "product-feed"]);
    assert.equal(home.floors[2].hidden, true);

    const fashion = plan.pages.find((p: { name: string }) => p.name === "服饰会场");
    assert.ok(fashion.floors.some((f: { template: { name: string } }) => f.template.name === "brand-wall"), "服饰命中品牌墙的 industries");
    assert.ok(!fashion.floors.some((f: { template: { name: string } }) => f.template.name === "coupon"), "服饰不命中类目券");

    const sel = plan.schedules.find((s: { pageName: string; floorName: string }) => s.pageName === "服饰会场" && s.floorName === "product-feed");
    assert.equal(sel.contentData.selectionPrompt, "服饰会场爆款");
    assert.ok(plan.schedules.some((s: { contentData: { strategy?: string } }) => s.contentData.strategy === "auto"));
    assert.ok(!plan.schedules.some((s: { floorName: string }) => s.floorName === "coupon"), "manual 楼层不写排期");
    assert.ok(manualTodosOf(plan).some((t) => t.pageName === "首页" && t.floorName === "coupon"));
    assert.deepEqual(plan.points, [{ name: "首屏浮层" }]);
  });

  it("品牌日走另一套知识", () => {
    const { plan, reads } = runPlanner("创建 Nike 品牌日，墨西哥站");
    assert.ok(reads.includes("brand-day/pages/brand-home.md"));
    assert.equal(plan.pages[0].name, "Nike品牌日");
    assert.equal(plan.setup.childScene.countryTimeRef, "mx-brand-day-2026");
    assert.equal(plan.points, undefined);
  });

  it("知识库工具不可用时退回固定计划", () => {
    const step = plannerStep("创建 618 大促，巴西站", [], []);
    assert.ok(step.plan?.pages?.length);
  });
});
