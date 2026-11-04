/**
 * build 域通用工具 —— MCP 调用封装、时间格式化、plan 预处理。
 */
import type { McpCallResult, McpClientPool } from "../../runtime/mcp-client.js";
import { log, logWarn } from "../../runtime/log.js";
import type { Plan, PlanSchedule, ResolvedPlan } from "./types.js";

/** 平台 MCP 服务名 */
export const PLATFORM_SERVER = "platform";

/**
 * 调用搭建平台的 MCP 工具。
 *
 * @param pool 客户端池
 * @param tool 工具名（不带 `mcp__<server>__` 前缀）
 * @param args 参数
 * @param label 日志标签
 */
export async function gcpCall(
  pool: McpClientPool,
  tool: string,
  args: Record<string, unknown> = {},
  label?: string,
): Promise<McpCallResult> {
  if (label) log(`[exec] ${label}`);
  return pool.callTool(PLATFORM_SERVER, tool, args);
}

/**
 * 把 epoch 毫秒格式化为平台时间字符串（PDT 时区）。
 */
export function msToPDTString(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // en-CA 的格式为 YYYY-MM-DD
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hms = `${parts.hour}:${parts.minute}:${parts.second}`;
  return `${ymd} ${hms}`;
}

/**
 * plan 预处理 —— 补齐缺省字段、把 spec.md 约定的「模型视角」结构归一成 executor 读取的结构。
 *
 * 只做**结构性**归一化，不产生任何业务值；时间仍由 resolve-time 依据 countryTimeRef 注入。
 *
 *   - `floors[].name` 缺省时取 `template.name`（模型只写模板名）
 *   - `setup.childScene.countryTimeRef` 是字符串引用 → 挪到 `extendInfo.renderConfig.countryTimeRef`
 *   - 顶层 `schedules[]` 按 `pageName` + `floorName` 挂到对应楼层的 `floors[].schedules`
 */
export function preprocessPlan(plan: Plan): ResolvedPlan {
  const resolved: ResolvedPlan = {
    ...plan,
    pages: (plan.pages ?? []).map((page) => ({
      ...page,
      floors: (page.floors ?? []).map((floor) => ({
        ...floor,
        name: floor.name ?? floor.template?.name ?? "",
        schedules: [...(floor.schedules ?? [])],
      })),
    })),
  };

  const childScene = resolved.setup?.childScene;
  if (childScene) {
    childScene.extendInfo ??= {};
    const ref = childScene.countryTimeRef as unknown;
    if (ref && !childScene.extendInfo.renderConfig?.countryTimeRef) {
      childScene.extendInfo.renderConfig ??= {};
      childScene.extendInfo.renderConfig.countryTimeRef =
        typeof ref === "string" ? { name: ref } : (ref as { id?: string; name?: string });
    }
  }

  const topLevel = (plan as { schedules?: unknown }).schedules;
  if (Array.isArray(topLevel)) {
    for (const raw of topLevel as PlanSchedule[]) {
      const page = resolved.pages.find((p) => p.name === raw.pageName);
      const floor = page?.floors.find((f) => f.name === raw.floorName);
      if (!floor) {
        logWarn(`[plan] 排期找不到楼层: ${raw.pageName ?? "?"}/${raw.floorName ?? "?"}，已跳过`);
        continue;
      }
      floor.schedules!.push({ ...raw, name: raw.name ?? raw.floorName ?? floor.name });
    }
  }

  return resolved;
}

/** 从各种返回结构里抽取数字 ID */
export function extractNumericId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const rec = data as Record<string, unknown>;
  const candidates = [rec.id, rec.data, rec.result];
  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
    if (typeof candidate === "string" && candidate && /^\d+$/.test(candidate)) {
      return Number(candidate);
    }
    if (candidate && typeof candidate === "object") {
      const nested = (candidate as Record<string, unknown>).id;
      if (typeof nested === "number") return nested;
      if (typeof nested === "string" && nested && /^\d+$/.test(nested)) return Number(nested);
    }
  }
  return undefined;
}
