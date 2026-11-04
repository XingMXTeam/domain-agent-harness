/**
 * build 域通用工具 —— MCP 调用封装、时间格式化、plan 预处理。
 */
import type { McpCallResult, McpClientPool } from "../../runtime/mcp-client.js";
import { log, logWarn } from "../../runtime/log.js";
import { DEFAULT_CONCURRENCY, Semaphore } from "../../runtime/parallel.js";
import type { Plan, PlanSchedule, ResolvedPlan } from "./types.js";

/** 平台 MCP 服务名 */
export const PLATFORM_SERVER = "platform";

/** 打到平台的全局并发上限（`DAH_CONCURRENCY`，默认 8） */
export function platformConcurrency(): number {
  const raw = Number(process.env.DAH_CONCURRENCY);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CONCURRENCY;
}

/** 瞬时错误最多重试次数（`DAH_RETRY_MAX`，默认 3） */
function retryMax(): number {
  const raw = Number(process.env.DAH_RETRY_MAX);
  return Number.isInteger(raw) && raw >= 0 ? raw : 3;
}

/** 重试退避基数毫秒（`DAH_RETRY_BASE_MS`，默认 500；指数退避 + 抖动） */
function retryBaseMs(): number {
  const raw = Number(process.env.DAH_RETRY_BASE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}

/**
 * 判断是否为瞬时错误 —— 只有这类错误才值得重试。
 *
 * 参数错误、权限错误、业务校验失败（如「模板不存在」）重试也不会好，直接失败。
 * HTTP 层的 5xx / 网络错误已由 McpHttpClient 重试过；这里处理的是
 * 平台以工具结果（isError）形式返回的瞬时错误。
 */
export function isTransientError(error: string | undefined): boolean {
  if (!error) return false;
  return /\b(429|500|502|503|504)\b|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|rate.?limit|too many requests|temporarily|unavailable|瞬时|限流|超时|繁忙|稍后重试/i.test(
    error,
  );
}

/** 单次调用的重试策略 */
export interface CallOptions {
  /** 日志标签 */
  label?: string;
  /**
   * 重试前的「是否已经写成功」核查。
   *
   * 写接口报瞬时错误时，请求可能已经在平台落地（响应丢了）。盲目重试会重复创建。
   * 提供 recover 时，每次重试前先调用它：返回结果即视为已成功，不再重写。
   */
  recover?: () => Promise<McpCallResult | undefined>;
}

const limiters = new WeakMap<McpClientPool, Semaphore>();

function limiterFor(pool: McpClientPool): Semaphore {
  let limiter = limiters.get(pool);
  if (!limiter) {
    limiter = new Semaphore(platformConcurrency());
    limiters.set(pool, limiter);
  }
  return limiter;
}

/**
 * 调用搭建平台的 MCP 工具。
 *
 * - **全局限流**：同一个 pool 上所有平台调用共用一个信号量，任何时刻不超过 `DAH_CONCURRENCY`。
 * - **瞬时错误重试**：仅对 isTransientError 判定的错误重试，指数退避；重试期间不占并发名额。
 * - **写前核查**：带 recover 的写接口，重试前先核查是否已落地，避免重复创建。
 *
 * @param pool 客户端池
 * @param tool 工具名（不带 `mcp__<server>__` 前缀）
 * @param args 参数
 * @param options 日志标签（兼容旧签名直接传字符串）或重试策略
 */
export async function gcpCall(
  pool: McpClientPool,
  tool: string,
  args: Record<string, unknown> = {},
  options?: string | CallOptions,
): Promise<McpCallResult> {
  const opts: CallOptions = typeof options === "string" ? { label: options } : (options ?? {});
  if (opts.label) log(`[exec] ${opts.label}`);
  const limiter = limiterFor(pool);
  const max = retryMax();

  let result: McpCallResult = { success: false, error: "未调用" };
  for (let attempt = 0; attempt <= max; attempt++) {
    if (attempt > 0 && opts.recover) {
      const recovered = await limiter.run(() => opts.recover!()).catch(() => undefined);
      if (recovered?.success) {
        logWarn(`[exec] ${tool} 上次报错但平台已落地，按成功处理（不重写）`);
        return recovered;
      }
    }
    result = await limiter.run(() => pool.callTool(PLATFORM_SERVER, tool, args));
    if (result.success || !isTransientError(result.error) || attempt === max) break;
    const delay = retryBaseMs() * 2 ** attempt * (0.5 + Math.random());
    logWarn(
      `[exec] ${tool} 瞬时错误，${Math.round(delay)}ms 后重试 (${attempt + 1}/${max}): ${result.error}`,
    );
    await sleep(delay);
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
