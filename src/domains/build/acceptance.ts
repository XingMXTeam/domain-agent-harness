/**
 * build 域验收 —— 按 `knowledge/shared/review-rules.md` 的 R1–R5，
 * **只读**核对平台上的真实状态。
 *
 * 与模型审查的分工：
 *   - 验收（本文件）：代码判定 pass / fail，期望值取自知识库，实际值取自平台。
 *     不看执行器的自报结果，也不看计划写了什么楼层 —— 计划漏了楼层同样会被抓到。
 *   - 模型审查（review.md）：解释失败原因、给修复建议。它可以多报问题，
 *     但不能把验收没通过的结果改判成通过。
 *
 * 只读保证：平台调用一律经过 READ_TOOLS 白名单，白名单外的工具名直接抛错，
 * 不发请求。注意排期用的是纯读的 `schedule_getList`，不是执行器用的
 * `schedule_createOrGetList`（名字里带 create，不能保证只读）。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import type { ExecutionResult } from "../../types.js";

/** 验收用到的平台只读工具。接真实平台时只改这里。 */
export const READ_TOOLS = {
  listPages: "page_getList",
  listModules: "page_listModules",
  listSchedules: "schedule_getList",
} as const;

const ALLOWED_PLATFORM_TOOLS = new Set<string>(Object.values(READ_TOOLS));
const KB_READ_TOOL = "kb_read";

/** 已实现的规则编号；与 review-rules.md 的规则表由测试互相对齐 */
export const IMPLEMENTED_RULES = ["R1", "R2", "R3", "R4", "R5"] as const;
export type RuleId = (typeof IMPLEMENTED_RULES)[number] | "R0";

export interface RuleResult {
  rule: RuleId;
  target: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface AcceptanceReport {
  /** 是否执行了验收（计划没有任何页面标注知识库来源时跳过） */
  ran: boolean;
  ok: boolean;
  results: RuleResult[];
  /** 跳过原因 */
  skipped?: string;
}

export interface PlatformPage {
  id: number | string;
  name: string;
  offlineTime?: unknown;
}

export interface PlatformModule {
  id?: number | string;
  hidden?: boolean;
  floorSetting?: { template?: { name?: string } };
  templateName?: string;
}

/** 验收的数据来源；生产环境走 MCP，测试注入假实现 */
export interface AcceptanceSource {
  readKnowledge(path: string): Promise<string>;
  listPages(childSceneId: string): Promise<PlatformPage[]>;
  listModules(pageId: number | string): Promise<PlatformModule[]>;
  listSchedules(pageName: string, floorName: string): Promise<unknown[]>;
}

export interface KbFloor {
  position: number;
  component: string;
  name: string;
  required: boolean;
  scheduling_type: string;
  hidden: boolean;
}

interface PlanPage {
  name?: string;
  knowledge?: string;
}

// ── 只读平台访问 ─────────────────────────────────────────────

/** 对平台的只读调用；白名单外的工具不发请求，直接抛错 */
export async function readPlatform(
  pool: Pick<McpClientPool, "callTool">,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!ALLOWED_PLATFORM_TOOLS.has(tool)) {
    throw new Error(`验收只允许只读工具，拒绝调用 ${tool}`);
  }
  const res = await pool.callTool("platform", tool, args);
  if (!res.success) throw new Error(`${tool} 失败: ${res.error ?? "未知错误"}`);
  return res.data;
}

/** 基于 MCP 客户端池的数据来源 */
export function mcpAcceptanceSource(pool: Pick<McpClientPool, "callTool">): AcceptanceSource {
  return {
    async readKnowledge(path) {
      const res = await pool.callTool("knowledge", KB_READ_TOOL, { path });
      if (!res.success) throw new Error(res.error ?? `读取 ${path} 失败`);
      const data = res.data as unknown;
      if (typeof data === "string") return data;
      const rec = data as { content?: unknown; text?: unknown } | null;
      if (typeof rec?.content === "string") return rec.content;
      if (typeof rec?.text === "string") return rec.text;
      throw new Error(`kb_read(${path}) 返回结构无法识别`);
    },
    async listPages(childSceneId) {
      return asArray<PlatformPage>(await readPlatform(pool, READ_TOOLS.listPages, { childSceneId: toId(childSceneId) }));
    },
    async listModules(pageId) {
      return asArray<PlatformModule>(await readPlatform(pool, READ_TOOLS.listModules, { pageId }));
    },
    async listSchedules(pageName, floorName) {
      return asArray(await readPlatform(pool, READ_TOOLS.listSchedules, { pageName, floorName }));
    },
  };
}

// ── 知识库楼层表 ─────────────────────────────────────────────

/** 解析页面知识里的楼层表（表头含 `component` 的那张 Markdown 表） */
export function parseFloorTable(markdown: string): KbFloor[] {
  const lines = markdown.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim().startsWith("|") && /\|\s*component\s*\|/.test(l));
  if (headerAt < 0) return [];
  const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const header = cells(lines[headerAt]!);
  const floors: KbFloor[] = [];
  for (const line of lines.slice(headerAt + 2)) {
    if (!line.trim().startsWith("|")) break;
    const row = Object.fromEntries(cells(line).map((v, i) => [header[i] ?? `col${i}`, v]));
    if (!row.component) continue;
    floors.push({
      position: Number(row.position ?? 0),
      component: row.component,
      name: row.name ?? row.component,
      required: row.required === "yes",
      scheduling_type: row.scheduling_type ?? "none",
      hidden: row.hidden === "yes",
    });
  }
  return floors;
}

// ── 验收 ─────────────────────────────────────────────────────

/**
 * 跑 R1–R5。期望来自知识库，实际来自平台，计划只用来确定「建了哪些页、每页对应哪篇页面知识」。
 */
export async function runAcceptance(
  plan: unknown,
  execution: ExecutionResult | undefined,
  source: AcceptanceSource,
): Promise<AcceptanceReport> {
  const pages = (((plan as { pages?: unknown } | null)?.pages ?? []) as PlanPage[]).filter(
    (p) => p && typeof p.name === "string",
  );
  if (!pages.some((p) => typeof p.knowledge === "string" && p.knowledge)) {
    return {
      ran: false,
      ok: false,
      results: [],
      skipped: "计划里没有任何页面标注 pages[].knowledge，无法对照知识库验收",
    };
  }

  const results: RuleResult[] = [];
  const kbCache = new Map<string, Promise<string>>();
  const readKnowledge = (path: string) => {
    if (!kbCache.has(path)) kbCache.set(path, source.readKnowledge(path));
    return kbCache.get(path)!;
  };
  const childSceneId = execution?.items?.find((i) => i.step === "setup" && i.ok)?.target;
  if (!childSceneId) {
    results.push({ rule: "R0", target: "子场景", expected: "已创建", actual: "未创建，无法验收", pass: false });
    return { ran: true, ok: false, results };
  }

  let platformPages: PlatformPage[];
  try {
    platformPages = await source.listPages(childSceneId);
  } catch (err) {
    results.push({ rule: "R0", target: `子场景 ${childSceneId}`, expected: "可读取页面列表", actual: (err as Error).message, pass: false });
    return { ran: true, ok: false, results };
  }

  for (const page of pages) {
    const pageName = page.name!;
    const onPlatform = platformPages.find((p) => p.name === pageName);
    if (!onPlatform) {
      results.push({ rule: "R1", target: pageName, expected: "页面存在", actual: "平台上没有这个页面", pass: false });
      results.push({ rule: "R5", target: pageName, expected: "offlineTime 非空", actual: "页面不存在", pass: false });
      continue;
    }

    // R5 不依赖知识库，先查
    const offline = onPlatform.offlineTime;
    const hasOffline = offline !== undefined && offline !== null && String(offline).trim() !== "";
    results.push({ rule: "R5", target: pageName, expected: "offlineTime 非空", actual: hasOffline ? String(offline) : "空", pass: hasOffline });

    let floors: KbFloor[];
    try {
      if (!page.knowledge) throw new Error("计划未标注 pages[].knowledge");
      floors = parseFloorTable(await readKnowledge(page.knowledge));
      if (!floors.length) throw new Error(`${page.knowledge} 里没有楼层表`);
    } catch (err) {
      results.push({ rule: "R1", target: pageName, expected: "能读到页面知识", actual: (err as Error).message, pass: false });
      continue;
    }

    let modules: PlatformModule[];
    try {
      modules = await source.listModules(onPlatform.id);
    } catch (err) {
      results.push({ rule: "R1", target: pageName, expected: "能列出页面模块", actual: (err as Error).message, pass: false });
      continue;
    }
    const byComponent = new Map<string, PlatformModule[]>();
    for (const m of modules) {
      const c = componentOf(m);
      if (!c) continue;
      byComponent.set(c, [...(byComponent.get(c) ?? []), m]);
    }
    const present = (f: KbFloor) => byComponent.has(f.component);

    // R1 必选楼层齐全
    const required = floors.filter((f) => f.required).map((f) => f.component);
    const missing = required.filter((c) => !byComponent.has(c));
    results.push({
      rule: "R1",
      target: pageName,
      expected: `必选楼层 ${required.join(", ") || "无"}`,
      actual: missing.length ? `缺少 ${missing.join(", ")}` : `已有 ${[...byComponent.keys()].join(", ")}`,
      pass: missing.length === 0,
    });

    // R4 hidden = yes 的楼层处于隐藏
    for (const f of floors.filter((x) => x.hidden && present(x))) {
      const visible = byComponent.get(f.component)!.filter((m) => m.hidden !== true).length;
      results.push({
        rule: "R4",
        target: `${pageName}/${f.component}`,
        expected: "隐藏",
        actual: visible ? `${visible} 个模块未隐藏` : "隐藏",
        pass: visible === 0,
      });
    }

    // R2 / R3 排期
    for (const f of floors.filter((x) => present(x) && (x.scheduling_type === "selection" || x.scheduling_type === "manual"))) {
      const rule: RuleId = f.scheduling_type === "selection" ? "R2" : "R3";
      let count: number;
      try {
        count = (await source.listSchedules(pageName, f.component)).length;
      } catch (err) {
        results.push({ rule, target: `${pageName}/${f.component}`, expected: "能读取排期", actual: (err as Error).message, pass: false });
        continue;
      }
      results.push(
        rule === "R2"
          ? { rule, target: `${pageName}/${f.component}`, expected: "有排期", actual: `${count} 条排期`, pass: count > 0 }
          : { rule, target: `${pageName}/${f.component}`, expected: "没有自动排期", actual: `${count} 条排期`, pass: count === 0 },
      );
    }
  }

  return { ran: true, ok: results.every((r) => r.pass), results };
}

/** 渲染验收结果：失败项逐条列出，通过项只计数 */
export function formatAcceptance(report: AcceptanceReport): string {
  if (!report.ran) return `验收：未执行（${report.skipped ?? "原因未知"}）`;
  const failed = report.results.filter((r) => !r.pass);
  const lines = [`验收：${report.ok ? "通过" : "未通过"}（${report.results.length - failed.length}/${report.results.length}）`];
  for (const r of failed) lines.push(`- ✗ ${r.rule} ${r.target}：期望 ${r.expected}，实际 ${r.actual}`);
  return lines.join("\n");
}

function componentOf(m: PlatformModule): string | undefined {
  return m.floorSetting?.template?.name ?? m.templateName;
}

function asArray<T = unknown>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const rec = data as { list?: unknown; items?: unknown; data?: unknown } | null;
  for (const v of [rec?.list, rec?.items, rec?.data]) if (Array.isArray(v)) return v as T[];
  return [];
}

function toId(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}
