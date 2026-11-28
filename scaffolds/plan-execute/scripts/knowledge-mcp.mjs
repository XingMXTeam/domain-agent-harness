#!/usr/bin/env node
/**
 * 知识库 MCP 服务 —— 把一个 Markdown 目录暴露成三个只读工具（Streamable HTTP）。
 *
 *   kb_list   { path? }          列出目录下的子目录和文档（带 level / consumers / 标题）
 *   kb_read   { path }           读取一篇文档全文
 *   kb_search { query, limit? }  关键词搜索，返回命中行（辅助用，主路径是按目录导航）
 *
 * 设计取向：不做向量检索。Agent 按 L0 总览 → L1 活动定义 → L2 页面知识逐层导航，
 * 靠目录名和文件名定位，不依赖写死的文档 ID。
 *
 *   node scripts/knowledge-mcp.mjs                    # 默认读 ./knowledge，端口 7803
 *   KB_DIR=/path/to/kb PORT=7803 node scripts/knowledge-mcp.mjs
 */
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_KB_DIR = join(ROOT, "knowledge");

/** 解析文档头部的 frontmatter（只取 level / consumers / page_type 这类简单键） */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const list = raw.match(/^\[(.*)\]$/);
    meta[key] = list ? list[1].split(",").map((s) => s.trim()).filter(Boolean) : raw.trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

export function createKnowledgeBase(dir = DEFAULT_KB_DIR) {
  const root = resolve(dir);
  if (!existsSync(root)) throw new Error(`知识库目录不存在: ${root}`);

  /** 把相对路径解析到知识库内，拒绝越界 */
  function safePath(p = "") {
    const cleaned = String(p).replace(/^\/+/, "");
    const abs = resolve(root, cleaned);
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`路径越界: ${p}`);
    return abs;
  }
  const rel = (abs) => relative(root, abs).split(sep).join("/");

  function describeFile(abs) {
    const { meta, body } = parseFrontmatter(readFileSync(abs, "utf-8"));
    const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
    return { path: rel(abs), type: "file", title, ...(meta.level ? { level: meta.level } : {}), ...(meta.consumers ? { consumers: meta.consumers } : {}) };
  }

  function list({ path = "" } = {}) {
    const abs = safePath(path);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`不是目录: ${path || "/"}`);
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => !d.name.startsWith("."))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .flatMap((d) => {
        const child = join(abs, d.name);
        if (d.isDirectory()) return [{ path: rel(child), type: "dir" }];
        return d.name.endsWith(".md") ? [describeFile(child)] : [];
      });
  }

  function read({ path } = {}) {
    if (!path) throw new Error("path 必填");
    const abs = safePath(path);
    if (!abs.endsWith(".md") || !existsSync(abs) || !statSync(abs).isFile()) throw new Error(`文档不存在: ${path}`);
    return readFileSync(abs, "utf-8");
  }

  function walk(abs, out = []) {
    for (const d of readdirSync(abs, { withFileTypes: true })) {
      if (d.name.startsWith(".")) continue;
      const child = join(abs, d.name);
      if (d.isDirectory()) walk(child, out);
      else if (d.name.endsWith(".md")) out.push(child);
    }
    return out;
  }

  function search({ query, limit = 5 } = {}) {
    if (!query) throw new Error("query 必填");
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const abs of walk(root)) {
      readFileSync(abs, "utf-8").split(/\r?\n/).forEach((text, i) => {
        const lower = text.toLowerCase();
        const score = terms.filter((t) => lower.includes(t)).length;
        if (score > 0) hits.push({ path: rel(abs), line: i + 1, text: text.trim(), score });
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, Number(limit) || 5);
  }

  const tools = {
    kb_list: {
      description: "列出知识库目录下的子目录和文档（含 level / consumers / 标题）。从根目录开始逐层导航。",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "相对知识库根的目录，缺省为根" } } },
      run: list,
    },
    kb_read: {
      description: "读取一篇知识库文档全文（Markdown）。",
      inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "相对知识库根的文档路径，如 mega-sale/campaign.md" } } },
      run: read,
    },
    kb_search: {
      description: "关键词搜索知识库，返回命中行。只作辅助，优先按目录导航。",
      inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number" } } },
      run: search,
    },
  };

  return {
    root, list, read, search,
    tools: () => Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
    call(name, args) {
      const t = tools[name];
      if (!t) return { ok: false, error: `未知工具: ${name}` };
      try {
        const data = t.run(args ?? {});
        return { ok: true, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
}

export function startKnowledgeServer(kb, port = 0) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body || "{}"); } catch { res.writeHead(400).end(); return; }
      const send = (result) => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "local-knowledge" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      };
      switch (msg.method) {
        case "initialize":
          return send({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "knowledge", version: "0.1.0" } });
        case "notifications/initialized":
          res.writeHead(202).end(); return;
        case "tools/list":
          return send({ tools: kb.tools() });
        case "tools/call": {
          const r = kb.call(msg.params?.name, msg.params?.arguments);
          return send(r.ok
            ? { content: [{ type: "text", text: r.text }] }
            : { content: [{ type: "text", text: r.error }], isError: true });
        }
        default:
          return send({});
      }
    });
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done({ server, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kb = createKnowledgeBase(process.env.KB_DIR ?? DEFAULT_KB_DIR);
  const { port } = await startKnowledgeServer(kb, Number(process.env.PORT ?? 7803));
  console.error(`knowledge MCP on http://127.0.0.1:${port}/mcp  (dir: ${kb.root})`);
}
