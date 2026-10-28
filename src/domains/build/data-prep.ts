/**
 * Layer 2A —— 数据准备：解析选品结果，产出外层任务 ID。
 *
 * 平台侧有两条取数路径：
 *   - datapool   → 数据集池
 *   - moduleTask → 外层任务
 * 两者最终都收敛成 `outerTaskIds`，供后续排期写入使用。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { gcpCall } from "./helpers.js";
import type { DataPrepKey, DataPrepResult, ResolvedPlan } from "./types.js";

/** 选品失败时用于兜底的外层任务 ID（调试用） */
const MOCK_SELECTION_ID = process.env.DAH_MOCK_SELECTION_ID ?? "39412075";

/**
 * 并发执行数据准备。
 *
 * @returns 键为 `pageIndex/floorIndex/scheduleIndex` 的结果表
 */
export async function layer2DataPrep(
  pool: McpClientPool,
  plan: ResolvedPlan,
  childSceneId: number,
): Promise<Map<string, DataPrepResult>> {
  const results = new Map<string, DataPrepResult>();

  const jobs: Array<{ key: DataPrepKey; scheduleType: string }> = [];
  for (let pi = 0; pi < plan.pages.length; pi++) {
    const page = plan.pages[pi]!;
    for (let fi = 0; fi < page.floors.length; fi++) {
      const floor = page.floors[fi]!;
      for (let si = 0; si < (floor.schedules?.length ?? 0); si++) {
        const schedule = floor.schedules![si]!;
        const type = schedule.dataSourceType;
        if (type === "datapool" || type === "moduleTask") {
          jobs.push({
            key: { pageIndex: pi, floorIndex: fi, scheduleIndex: si },
            scheduleType: type,
          });
        }
      }
    }
  }

  if (jobs.length === 0) {
    log("[exec] 无需数据准备");
    return results;
  }

  log(`[exec] 数据准备: ${jobs.length} 个排期待取数`);

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const result =
        job.scheduleType === "moduleTask"
          ? await resolveModuleTask(pool, childSceneId, job.key)
          : await resolveDatapool(pool, childSceneId, job.key);
      return { key: job.key, result };
    }),
  );

  settled.forEach((outcome, index) => {
    const job = jobs[index]!;
    const mapKey = formatKey(job.key);
    if (outcome.status === "fulfilled") {
      results.set(mapKey, outcome.value.result);
    } else {
      results.set(mapKey, {
        outerTaskIds: [],
        ok: false,
        error:
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  });

  const failed = [...results.values()].filter((r) => !r.ok).length;
  log(`[exec] 数据准备完成: ${results.size - failed} 成功 / ${failed} 失败`);
  return results;
}

/** moduleTask 路径：读外层任务 ID */
async function resolveModuleTask(
  pool: McpClientPool,
  childSceneId: number,
  key: DataPrepKey,
): Promise<DataPrepResult> {
  const result = await gcpCall(pool, "moduleTask_getOuterTaskId", {
    childSceneId,
    pageIndex: key.pageIndex,
    floorIndex: key.floorIndex,
    scheduleIndex: key.scheduleIndex,
  });
  if (!result.success) {
    return { outerTaskIds: [], ok: false, error: result.error };
  }
  const ids = extractIds(result.data);
  return { outerTaskIds: ids, ok: ids.length > 0 };
}

/** datapool 路径：调用选品接口获取 datasetId */
async function resolveDatapool(
  pool: McpClientPool,
  childSceneId: number,
  key: DataPrepKey,
): Promise<DataPrepResult> {
  const result = await gcpCall(pool, "datapool_getSelection", {
    childSceneId,
    pageIndex: key.pageIndex,
    floorIndex: key.floorIndex,
    scheduleIndex: key.scheduleIndex,
  });
  if (!result.success) {
    return { outerTaskIds: [], ok: false, error: result.error };
  }
  const ids = extractIds(result.data);
  return { outerTaskIds: ids, ok: ids.length > 0 };
}

/** 从返回结构里抽取 ID 列表 */
function extractIds(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "number") return String(item);
        const rec = item as Record<string, unknown>;
        const id = rec.id ?? rec.outerTaskId ?? rec.datasetId;
        return id === undefined || id === null ? "" : String(id);
      })
      .filter(Boolean);
  }
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const list = rec.ids ?? rec.list ?? rec.items;
    if (Array.isArray(list)) return extractIds(list);
    const single = rec.id ?? rec.outerTaskId ?? rec.datasetId;
    if (single !== undefined && single !== null) return [String(single)];
  }
  return [];
}

/** 键格式化：pageIndex/floorIndex/scheduleIndex */
export function formatKey(key: DataPrepKey): string {
  return `${key.pageIndex}/${key.floorIndex}/${key.scheduleIndex}`;
}

/**
 * 选品失败兜底 —— 用 fallbackOuterTaskIds 按 entityType 回填。
 *
 * 选品不可用时不应让整条链路断掉；此时用配置的兜底 ID 顶替，
 * 并在结果里标记失败，便于 Review 阶段暴露出来。
 */
export function applySelectionFallback(
  key: DataPrepKey,
  result: DataPrepResult,
  fallbackOuterTaskIds: string[] = [MOCK_SELECTION_ID],
): DataPrepResult {
  if (result.ok && result.outerTaskIds.length > 0) return result;
  if (fallbackOuterTaskIds.length === 0) return result;
  logError(
    `[exec] 选品失败，回填兜底 ID: ${formatKey(key)} → ${fallbackOuterTaskIds.join(",")}`,
  );
  return {
    outerTaskIds: fallbackOuterTaskIds,
    ok: true,
    error: result.error ? `选品失败，已回退兜底 ID（${result.error}）` : undefined,
  };
}
