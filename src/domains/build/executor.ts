/**
 * build 域 Executor —— 把 plan.json 分层落地到搭建平台。
 *
 * 设计原则：**模型只出结构化计划，绝不输出时间值**。
 * 所有时间（phases / offlineTime / expireTime / 点位素材起止）都由 executor
 * 从 countryTimeRef 推导，避免模型编造出不可执行的排期。
 *
 *   Layer 1    Setup         建子场景 → 推导时间轴 → 建模块池
 *   Layer 2A   数据准备       素材任务 / 数据集 / 点位（并发）
 *   Layer 2B   页面搭建       建页面 / 挂模块 / 隐藏模块（并发）
 *   Layer 2.5  点位素材       挂点位素材
 *   Layer 3    排期配置       读排期列表 → 写排期数据 → 预发布
 */
import type { DomainExecutor, ExecutionItem, ExecutionResult, RunContext } from "../../types.js";
import { createMcpClientPool, type McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { preprocessPlan } from "./helpers.js";
import { layer1Setup } from "./setup.js";
import { applySelectionFallback, formatKey, layer2DataPrep } from "./data-prep.js";
import { layer2PageBuild } from "./page-build.js";
import { layer25PointMaterials } from "./point-material.js";
import { layer3Schedules, stagePrepub } from "./schedules.js";
import type { DataPrepResult, ResolvedPlan } from "./types.js";

export const executor: DomainExecutor = {
  async execute(plan: unknown, ctx?: RunContext): Promise<ExecutionResult> {
    if (!ctx) throw new Error("Executor 需要 RunContext");

    const resolved = preprocessPlan(plan as ResolvedPlan);
    const items: ExecutionItem[] = [];
    const pool = await createMcpClientPool(ctx.mcpConfigPath);

    try {
      // ── Layer 1: Setup ────────────────────────────────
      const setup = await layer1Setup(pool, resolved);
      if (!setup.childSceneId) {
        return {
          success: false,
          items,
          summary: "子场景创建失败，后续步骤未执行",
        };
      }
      items.push({
        step: "setup",
        target: String(setup.childSceneId),
        ok: true,
      });

      // ── Layer 2A: 数据准备（并发）─────────────────────
      const dataPrep = await layer2DataPrep(pool, resolved, setup.childSceneId);
      applyFallbacks(dataPrep);
      items.push(...toItems("data-prep", dataPrep));

      // ── Layer 2B: 页面搭建（并发）─────────────────────
      const pageBuild = await layer2PageBuild(
        pool,
        resolved,
        setup.childSceneId,
        setup.componentMap,
      );
      items.push(
        ...pageBuild.pages.map((p) => ({
          step: "page",
          target: p.pageName,
          ok: p.ok,
          ...(p.error ? { error: p.error } : {}),
        })),
        ...pageBuild.modules.map((m) => ({
          step: m.skipped ? "module-skipped" : "module",
          target: `${m.pageName}/${m.floorName}`,
          ok: m.ok,
          ...(m.error ? { error: m.error } : {}),
        })),
      );

      // ── Layer 2.5: 点位素材 ──────────────────────────
      const points = await layer25PointMaterials(pool, resolved, setup.childSceneId);
      items.push(
        ...points.map((p, i) => ({
          step: "point",
          target: `point[${i}]`,
          ok: p.ok,
          ...(p.error ? { error: p.error } : {}),
        })),
      );

      // ── Layer 3: 排期配置 ────────────────────────────
      const scheduleStats = await layer3Schedules(
        pool,
        resolved.pages,
        pageBuild.pages,
        pageBuild.modules,
        dataPrep,
        setup.phases,
      );
      items.push({
        step: "schedules",
        target: `${scheduleStats.success}/${scheduleStats.total}`,
        ok: scheduleStats.failed === 0,
      });

      // ── 预发布 ────────────────────────────────────────
      const prepublished = await stagePrepub(pool, setup.childSceneId);
      items.push({
        step: "prepub",
        target: String(setup.childSceneId),
        ok: prepublished,
      });

      const success = items.every((item) => item.ok);
      const summary = [
        `页面 ${pageBuild.pages.filter((p) => p.ok).length}/${pageBuild.pages.length}`,
        `模块 ${pageBuild.modules.filter((m) => m.ok).length}/${pageBuild.modules.length}`,
        `排期 ${scheduleStats.success}/${scheduleStats.total}` +
          (scheduleStats.skipped ? `（跳过 ${scheduleStats.skipped}）` : ""),
      ].join("，");

      return { success, items, summary };
    } finally {
      await pool.close();
    }
  },
};

/**
 * 选品失败兜底 —— 逐条用兜底 ID 回填。
 */
function applyFallbacks(dataPrep: Map<string, DataPrepResult>): void {
  for (const [key, result] of dataPrep) {
    const parts = key.split("/");
    const pageIndex = Number(parts[0]);
    const floorIndex = Number(parts[1]);
    const scheduleIndex = Number(parts[2]);
    if ([pageIndex, floorIndex, scheduleIndex].some((n) => !Number.isFinite(n))) continue;
    const fallback = applySelectionFallback(
      { pageIndex, floorIndex, scheduleIndex },
      result,
    );
    dataPrep.set(key, fallback);
  }
}

function toItems(step: string, dataPrep: Map<string, DataPrepResult>): ExecutionItem[] {
  return [...dataPrep.entries()].map(([key, result]) => ({
    step,
    target: key,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  }));
}

/** 导出一个便于测试的键格式化函数 */
export { formatKey };
