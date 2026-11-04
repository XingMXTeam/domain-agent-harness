/**
 * Layer 3 —— 排期配置：读排期列表 → 写排期数据 → 预发布。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { gcpCall } from "./helpers.js";
import type {
  DataPrepResult,
  ModuleResult,
  PageResult,
  PlanPage,
  PlanSchedule,
  ResolvedPlan,
  ScheduleStats,
} from "./types.js";

/** 排期类型 */
const SCHEDULE_TYPES = ["locale", "theme"] as const;

/**
 * 写入排期。
 *
 * 缺失的 locale / theme 排期由 executor 自动补齐（空 contentData），
 * 避免模型为不存在的排期编造内容。
 */
export async function layer3Schedules(
  pool: McpClientPool,
  pages: PlanPage[],
  pageResults: PageResult[],
  moduleResults: ModuleResult[],
  dataPrepResults: Map<string, DataPrepResult>,
  phases: Record<string, { startTime: string; endTime: string }> = {},
): Promise<ScheduleStats> {
  const stats: ScheduleStats = { total: 0, success: 0, failed: 0 };

  const jobs: Array<{
    pageIndex: number;
    floorIndex: number;
    scheduleIndex: number;
    page: PlanPage;
    schedule: PlanSchedule;
  }> = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    for (let fi = 0; fi < page.floors.length; fi++) {
      const floor = page.floors[fi]!;
      for (let si = 0; si < (floor.schedules?.length ?? 0); si++) {
        jobs.push({
          pageIndex: pi,
          floorIndex: fi,
          scheduleIndex: si,
          page,
          schedule: floor.schedules![si]!,
        });
      }
    }
  }

  stats.total = jobs.length;
  if (jobs.length === 0) {
    log("[exec] 无排期需要写入");
    return stats;
  }

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      // ── 3.1 读已有排期 ────────────────────────────────
      const existing = await gcpCall(pool, "schedule_createOrGetList", {
        pageName: job.page.name,
        floorName: job.schedule.floorName ?? job.schedule.name,
        nations: job.schedule.nations ?? [],
      });
      if (!existing.success) {
        throw new Error(existing.error ?? "schedule_createOrGetList 失败");
      }

      // ── 3.2 组装写入载荷 ──────────────────────────────
      const payload = {
        // 写排期必须带上落到哪个页面的哪个楼层，否则平台无法关联、验收也查不到
        pageName: job.page.name,
        floorName: job.schedule.floorName ?? job.schedule.name,
        ...buildSchedulePayload(job.schedule, existing.data, phases, dataPrepResults.get(
          `${job.pageIndex}/${job.floorIndex}/${job.scheduleIndex}`,
        )),
      };

      // ── 3.3 写入 ──────────────────────────────────────
      const update = await gcpCall(pool, "schedule_update", payload);
      if (!update.success) {
        throw new Error(update.error ?? "schedule_update 失败");
      }
      return payload;
    }),
  );

  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      stats.success += 1;
    } else {
      stats.failed += 1;
      const job = jobs[index]!;
      logError(
        `[exec] 排期写入失败 ${job.page.name}/${job.schedule.name}:`,
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      );
    }
  });

  log(`[exec] 排期完成: ${stats.success}/${stats.total} 成功`);
  return stats;
}

/**
 * 组装排期写入载荷。
 *
 * - 自动补齐缺失的 locale / theme 排期（空 contentData）
 * - 选品结果（outerTaskIds）注入到 datasetId / strategy 之外的内容位
 */
export function buildSchedulePayload(
  schedule: PlanSchedule,
  existing: unknown,
  phases: Record<string, { startTime: string; endTime: string }>,
  dataPrep?: DataPrepResult,
): Record<string, unknown> {
  const existingList = Array.isArray(existing) ? existing : [];
  const payload: Record<string, unknown> = {
    contentData: { ...(schedule.contentData ?? {}) },
    phases,
    ...(schedule.nations ? { nations: schedule.nations } : {}),
  };

  if (dataPrep?.outerTaskIds?.length) {
    payload.outerTaskIds = dataPrep.outerTaskIds;
  }
  if (schedule.dataSourceType) {
    payload.dataSourceType = schedule.dataSourceType;
  }
  if (typeof (schedule as { datasetId?: string }).datasetId === "string") {
    payload.datasetId = (schedule as { datasetId: string }).datasetId;
  }
  if (typeof (schedule as { strategy?: string }).strategy === "string") {
    payload.strategy = (schedule as { strategy: string }).strategy;
  }

  for (const type of SCHEDULE_TYPES) {
    const present = existingList.some((item) => isScheduleType(item, type));
    if (!present) {
      payload[type] = { contentData: {} };
      log(`[exec] 自动注入缺失的 ${type} 排期（空 contentData）`);
    }
  }

  return payload;
}

function isScheduleType(item: unknown, type: string): boolean {
  if (!item || typeof item !== "object") return false;
  const rec = item as Record<string, unknown>;
  return rec.type === type || rec.scheduleType === type;
}

/**
 * 预发布 —— 把子场景推到预发环境。
 */
export async function stagePrepub(
  pool: McpClientPool,
  childSceneId: number,
): Promise<boolean> {
  const result = await gcpCall(pool, "childScene_stagePrepub", { childSceneId });
  if (!result.success) {
    logError("[exec] 预发布失败:", result.error);
    return false;
  }
  log(`[exec] 已预发布: childSceneId=${childSceneId}`);
  return true;
}

/**
 * 取模块的模型数据 —— 用于把业务模型信息带入排期。
 */
export async function fetchModuleModel(
  pool: McpClientPool,
  moduleId: number,
): Promise<Record<string, unknown> | undefined> {
  const result = await gcpCall(pool, "modelCenter_getModuleModel", { moduleId });
  if (!result.success || !result.data) return undefined;
  const raw = result.data as { model?: unknown; data?: unknown };
  const model = (raw.model ?? raw.data ?? raw) as {
    businessModel?: Record<string, unknown>;
    tagObject?: Record<string, unknown>;
  };
  const businessModel = model?.businessModel ?? {};
  return {
    processId: String(businessModel.processId ?? ""),
    entityType: String(businessModel.entityType ?? "ITEM"),
    dataType: String(businessModel.dataType ?? "standard"),
    tagObject: model?.tagObject ?? {},
    deliveryEntityFields: [],
  };
}
