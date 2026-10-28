/**
 * 时间解析 —— 把 countryTimeRef 解析成实际的时间分区。
 *
 * 这是「模型不产出任何时间值」这条约束的落地点：
 * 模型只给一个引用（id 或 name），executor 去平台查真实档期并注入 activityTime。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { gcpCall, msToPDTString } from "./helpers.js";
import type { ActivityTime, PlanSetup, PhaseTime, ResolvedPlan } from "./types.js";

/**
 * 从 MCP 获取 regionBigSaleTime 并转换为 activityTime 数组。
 * 如果 setup.childScene 中已有 activityTime 则跳过（向后兼容）。
 */
export async function resolveCountryTimeRef(
  pool: McpClientPool,
  setup: PlanSetup,
): Promise<void> {
  const extendInfo = setup.childScene?.extendInfo;
  const renderConfig = extendInfo?.renderConfig;
  if (!renderConfig) return;

  // 已有 activityTime 则跳过（向后兼容）
  if (renderConfig.activityTime?.length) return;

  const ref = renderConfig.countryTimeRef;
  if (!ref) return;

  log(`[exec] 解析 countryTimeRef: id=${ref.id}, name=${ref.name}`);

  const args: Record<string, unknown> = {};
  if (ref.id) args.id = ref.id;
  else if (ref.name) args.name = ref.name;

  const result = await gcpCall(
    pool,
    "childScene_getCountryTimeList",
    args,
    "获取时间分区",
  );
  if (!result.success) {
    logError("[exec] countryTimeRef 获取失败:", result.error);
    return;
  }

  const data = result.data as { regionBigSaleTime?: unknown[] } | undefined;
  const regionBigSaleTime = data?.regionBigSaleTime;
  if (!Array.isArray(regionBigSaleTime) || regionBigSaleTime.length === 0) {
    logError("[exec] regionBigSaleTime 为空");
    return;
  }

  const activityTime = toActivityTime(regionBigSaleTime);

  // 确保 DEFAULT 条目排在最后
  const defaultIdx = regionBigSaleTime.findIndex(
    (item) =>
      (item as { feature?: { shipToType4Display?: string } }).feature
        ?.shipToType4Display === "DEFAULT",
  );
  if (defaultIdx >= 0 && defaultIdx !== activityTime.length - 1) {
    const [defaultEntry] = activityTime.splice(defaultIdx, 1);
    if (defaultEntry) activityTime.push(defaultEntry);
  }

  log(`[exec] activityTime 已生成: ${activityTime.length} 个分区`);

  // 注入 activityTime，移除 countryTimeRef
  renderConfig.activityTime = activityTime;
  delete renderConfig.countryTimeRef;
}

/** 把平台的 regionBigSaleTime 转成 activityTime 数组 */
export function toActivityTime(items: unknown[]): ActivityTime[] {
  return items.map((raw) => {
    const item = raw as {
      regionList?: unknown[];
      showStartTime?: number;
      startTime?: number;
      endTime?: number;
    };
    const region = (item.regionList ?? []).join(",");
    return {
      type: "include",
      region,
      teasingStartTime: msToPDTString(item.showStartTime),
      teasingEndTime: msToPDTString(item.startTime),
      megaStartTime: msToPDTString(item.startTime),
      megaEndTime: msToPDTString(item.endTime),
    };
  });
}

/**
 * 从 countryTimeRef 推导阶段时间轴。
 *
 * 推导规则：
 *   - teaser 段：showStartTime → startTime
 *   - mega 段：startTime → endTime
 * 没有档期时返回空对象，调用方应跳过时间字段而不是编造。
 */
export function resolvePhasesFromCountryTimeRef(plan: ResolvedPlan): Record<string, PhaseTime> {
  const activityTime =
    plan.setup?.childScene?.extendInfo?.renderConfig?.activityTime ?? [];

  const phases: Record<string, PhaseTime> = {};
  for (const entry of activityTime) {
    phases.full = {
      startTime: entry.megaStartTime,
      endTime: entry.megaEndTime,
    };
    if (entry.teasingStartTime && entry.teasingEndTime) {
      phases.teaser = {
        startTime: entry.teasingStartTime,
        endTime: entry.teasingEndTime,
      };
    }
    break; // 只取第一个分区作为主档期
  }
  return phases;
}
