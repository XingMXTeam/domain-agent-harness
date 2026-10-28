import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DOMAIN_CONFIGS, DOMAIN_META } from "../src/orchestrator.js";
import { getDomainDir, PROMPTS_DIR } from "../src/runtime/paths.js";
import { validate } from "../src/runtime/schema-resolver.js";

describe("域资产完整性", () => {
  it("每个域都有 mcp.json 且是合法 JSON", () => {
    for (const domain of Object.keys(DOMAIN_META)) {
      const path = join(getDomainDir(domain), "mcp.json");
      assert.ok(existsSync(path), `域 ${domain} 缺少 mcp.json`);
      const config = JSON.parse(readFileSync(path, "utf-8")) as {
        mcpServers: Record<string, { url?: string; headers?: Record<string, string> }>;
      };
      assert.ok(config.mcpServers && typeof config.mcpServers === "object");
    }
  });

  it("mcp.json 里不含硬编码密钥", () => {
    for (const domain of Object.keys(DOMAIN_META)) {
      const raw = readFileSync(join(getDomainDir(domain), "mcp.json"), "utf-8");
      const config = JSON.parse(raw) as {
        mcpServers: Record<string, { headers?: Record<string, string> }>;
      };
      for (const entry of Object.values(config.mcpServers)) {
        for (const value of Object.values(entry.headers ?? {})) {
          assert.match(
            value,
            /^\{\{[A-Z0-9_]+\}\}$/,
            `域 ${domain} 的 header 应使用 {{ENV_VAR}} 占位符，实际为 ${value}`,
          );
        }
      }
    }
  });

  it("单 skill 域的 spec.md 存在", () => {
    for (const [domain, meta] of Object.entries(DOMAIN_META)) {
      if (!meta.singleSkill) continue;
      const spec = join(getDomainDir(domain), "skills", meta.singleSkill, "spec.md");
      assert.ok(existsSync(spec), `域 ${domain} 缺少 ${meta.singleSkill}/spec.md`);
    }
  });

  it("多 skill 域的 brain.md 与全部 skill spec.md 存在", () => {
    for (const [domain, meta] of Object.entries(DOMAIN_META)) {
      if (meta.singleSkill) continue;
      // pipeline 引擎的域不参与域内 skill 路由，不需要 brain.md
      if (meta.engine === "pipeline") continue;
      const brain = join(getDomainDir(domain), "brain.md");
      assert.ok(existsSync(brain), `域 ${domain} 缺少 brain.md`);
      for (const skill of DOMAIN_CONFIGS[domain]?.validSkills ?? []) {
        const spec = join(getDomainDir(domain), "skills", skill, "spec.md");
        assert.ok(existsSync(spec), `域 ${domain} 缺少 ${skill}/spec.md`);
      }
    }
  });

  it("gop 域的 5 个 Agent / 2 条流水线 / 5 个 schema 齐全", () => {
    const dir = getDomainDir("gop");
    const agents = readdirSync(join(dir, "agents")).filter((f) => f.endsWith(".md"));
    const pipelines = readdirSync(join(dir, "pipelines")).filter((f) => f.endsWith(".yaml"));
    const schemas = readdirSync(join(dir, "schemas")).filter((f) => f.endsWith(".json"));
    assert.equal(agents.length, 5, `期望 5 个 Agent，实际 ${agents.length}`);
    assert.equal(pipelines.length, 2, `期望 2 条流水线，实际 ${pipelines.length}`);
    assert.equal(schemas.length, 5, `期望 5 个 schema，实际 ${schemas.length}`);
  });

  it("所有 schema 都是合法 JSON 且为 object 类型", () => {
    for (const domain of Object.keys(DOMAIN_META)) {
      const dir = join(getDomainDir(domain), "schemas");
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const schema = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<
          string,
          unknown
        >;
        assert.equal(schema.type, "object", `${domain}/${file} 的 type 应为 object`);
        const r = validate({}, schema);
        assert.equal(r.valid, false, `${domain}/${file} 应能检出空对象的缺失字段`);
      }
    }
  });

  it("catalog.md 与 brain.md 声明了输出契约", () => {
    const catalog = readFileSync(join(PROMPTS_DIR, "catalog.md"), "utf-8");
    assert.match(catalog, /只输出 JSON/);
    assert.match(catalog, /"domain"/);

    const brain = readFileSync(join(getDomainDir("build"), "brain.md"), "utf-8");
    assert.match(brain, /只输出 JSON/);
    assert.match(brain, /"skill"/);
  });
});
