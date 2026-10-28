/**
 * Layer 2B —— 页面搭建：建页面 → 挂模块 → 隐藏模块。
 *
 * 页面之间互不依赖，因此整层并发执行。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { extractNumericId, gcpCall } from "./helpers.js";
import type { ModuleResult, PageResult, ResolvedPlan } from "./types.js";

export interface PageBuildResult {
  pages: PageResult[];
  modules: ModuleResult[];
}

/**
 * 并发创建页面与模块。
 */
export async function layer2PageBuild(
  pool: McpClientPool,
  plan: ResolvedPlan,
  childSceneId: number,
  componentMap: Map<string, string[]>,
): Promise<PageBuildResult> {
  const pages = plan.pages;
  const phases = plan.phases ?? {};
  const offlineTime = phases.full?.endTime;

  // ── 建页面（并发）───────────────────────────────────────
  const pageSettled = await Promise.allSettled(
    pages.map(async (page) => {
      const result = await gcpCall(pool, "pageAgent_create", {
        childSceneId,
        name: page.name,
        nations: page.nations,
        offlineTime,
      });
      if (!result.success) {
        return {
          pageName: page.name,
          ok: false,
          error: result.error,
        } satisfies PageResult;
      }
      const pageId = extractNumericId(result.data);
      return {
        pageName: page.name,
        ...(pageId !== undefined ? { pageId } : {}),
        ok: pageId !== undefined,
        ...(pageId === undefined ? { error: "未返回 pageId" } : {}),
      } satisfies PageResult;
    }),
  );

  const pageResults: PageResult[] = pageSettled.map((outcome, index) => {
    const pageName = pages[index]?.name ?? "";
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      pageName,
      ok: false,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  const pageIdByName = new Map<string, number>();
  for (const result of pageResults) {
    if (result.pageId !== undefined) pageIdByName.set(result.pageName, result.pageId);
  }

  // ── 挂模块（并发）───────────────────────────────────────
  const moduleJobs: Array<{
    pageName: string;
    floorName: string;
    pageId?: number;
    floorSetting: Record<string, unknown>;
    hidden?: boolean;
  }> = [];

  for (const page of pages) {
    const pageId = pageIdByName.get(page.name);
    for (const floor of page.floors) {
      moduleJobs.push({
        pageName: page.name,
        floorName: floor.name,
        ...(pageId !== undefined ? { pageId } : {}),
        floorSetting: resolveFloorSetting(floor, componentMap),
        ...(floor.hidden ? { hidden: true } : {}),
      });
    }
  }

  const moduleSettled = await Promise.allSettled(
    moduleJobs.map(async (job) => {
      const result = await gcpCall(pool, "module_addModule", {
        pageId: job.pageId,
        childSceneId,
        floorSetting: job.floorSetting,
      });
      if (!result.success) {
        return {
          pageName: job.pageName,
          floorName: job.floorName,
          ok: false,
          error: result.error,
        } satisfies ModuleResult;
      }
      const floorId = extractNumericId(result.data);
      return {
        pageName: job.pageName,
        floorName: job.floorName,
        ...(floorId !== undefined ? { floorId } : {}),
        ok: true,
      } satisfies ModuleResult;
    }),
  );

  const moduleResults: ModuleResult[] = moduleSettled.map((outcome, index) => {
    const job = moduleJobs[index]!;
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      pageName: job.pageName,
      floorName: job.floorName,
      ok: false,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  // ── 隐藏端（并发，与挂模块相互独立）─────────────────────
  const hiddenJobs = moduleJobs.filter((job) => job.hidden);
  await Promise.allSettled(
    hiddenJobs.map(async (job) => {
      const result = await gcpCall(pool, "module_showOrHide", {
        childSceneId,
        pageName: job.pageName,
        floorName: job.floorName,
        hidden: true,
      });
      if (!result.success) {
        logError(
          `[exec] module_showOrHide 失败: ${job.pageName}/${job.floorName} — ${result.error}`,
        );
      }
    }),
  );

  const okPages = pageResults.filter((r) => r.ok).length;
  const okModules = moduleResults.filter((r) => r.ok).length;
  log(`[exec] 页面搭建完成: 页面 ${okPages}/${pageResults.length}，模块 ${okModules}/${moduleResults.length}`);

  return { pages: pageResults, modules: moduleResults };
}

/**
 * 标准化模块：只要求 template.name，version 由模块池自动匹配。
 * 非标准化模块：原样透传 floorSetting。
 */
export function resolveFloorSetting(
  floor: { template?: { name?: string; version?: string }; floorSetting?: Record<string, unknown> },
  componentMap: Map<string, string[]>,
): Record<string, unknown> {
  const template = floor.template;
  if (!template?.name) {
    return { ...(floor.floorSetting ?? {}) };
  }
  const versions = componentMap.get(template.name);
  const version = template.version ?? versions?.[0];
  return {
    ...(floor.floorSetting ?? {}),
    template: { name: template.name, ...(version ? { version } : {}) },
  };
}
