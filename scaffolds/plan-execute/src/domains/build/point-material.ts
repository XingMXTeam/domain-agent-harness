/**
 * Layer 2.5 —— 点位素材：给点位挂素材。
 *
 * 素材的起止时间一律取自阶段时间轴，模型不产出时间值。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { extractNumericId, gcpCall } from "./helpers.js";
import type { PointPrepResult, ResolvedPlan } from "./types.js";

/**
 * 为点位创建记录并挂载素材。
 */
export async function layer25PointMaterials(
  pool: McpClientPool,
  plan: ResolvedPlan,
  childSceneId: number,
): Promise<PointPrepResult[]> {
  const points = (plan as ResolvedPlan & { points?: Array<{ name: string }> }).points ?? [];
  const phases = plan.phases ?? {};
  const startTime = phases.full?.startTime;
  const endTime = phases.full?.endTime;

  if (points.length === 0) {
    log("[exec] 无点位，跳过点位素材");
    return [];
  }

  const settled = await Promise.allSettled(
    points.map(async (point) => {
      // ── 2.5.1 创建点位 ────────────────────────────────
      const createResult = await gcpCall(pool, "point_create", {
        childSceneId,
        name: point.name,
      });
      if (!createResult.success) {
        return { ok: false, error: createResult.error } satisfies PointPrepResult;
      }
      const pointId = extractNumericId(createResult.data);

      // ── 2.5.2 挂素材 ──────────────────────────────────
      const materialResult = await gcpCall(pool, "point_addMaterial", {
        childSceneId,
        ...(pointId !== undefined ? { pointId } : {}),
        name: point.name,
        startTime,
        endTime,
      });
      if (!materialResult.success) {
        return {
          ...(pointId !== undefined ? { pointId } : {}),
          ok: false,
          error: materialResult.error,
        } satisfies PointPrepResult;
      }
      return {
        ...(pointId !== undefined ? { pointId } : {}),
        ok: true,
      } satisfies PointPrepResult;
    }),
  );

  const results: PointPrepResult[] = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      ok: false,
      error:
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  const failed = results.filter((r) => !r.ok).length;
  log(`[exec] 点位素材完成: ${results.length - failed} 成功 / ${failed} 失败`);
  if (failed > 0) {
    logError("[exec] 部分点位素材失败，详见 execution items");
  }
  return results;
}
