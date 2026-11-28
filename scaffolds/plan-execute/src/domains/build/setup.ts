/**
 * Layer 1 —— Setup：建子场景 → 推导时间轴 → 建模块池。
 */
import type { McpClientPool } from "../../runtime/mcp-client.js";
import { log, logError } from "../../runtime/log.js";
import { extractNumericId, gcpCall } from "./helpers.js";
import { resolveCountryTimeRef, resolvePhasesFromCountryTimeRef } from "./resolve-time.js";
import type { ResolvedPlan } from "./types.js";

export interface SetupResult {
  childSceneId?: number;
  /** 组件名 → 可用模板版本列表 */
  componentMap: Map<string, string[]>;
  /** 推导出的时间轴 */
  phases: Record<string, { startTime: string; endTime: string }>;
}

/**
 * Layer 1 执行体。
 */
export async function layer1Setup(
  pool: McpClientPool,
  plan: ResolvedPlan,
): Promise<SetupResult> {
  // ── 1.1 建子场景 ──────────────────────────────────────
  const childScene = plan.setup.childScene;
  const createResult = await gcpCall(
    pool,
    "childScene_create",
    { name: childScene.name, nations: childScene.nations },
    "创建子场景",
  );
  if (!createResult.success) {
    logError("[exec] childScene_create 失败:", createResult.error);
    return { componentMap: new Map(), phases: {} };
  }

  const childSceneId = extractNumericId(createResult.data);
  if (!childSceneId) {
    logError("[exec] childScene_create 未返回 ID");
    return { componentMap: new Map(), phases: {} };
  }
  plan._childSceneId = childSceneId;
  log(`[exec] 子场景已创建: ${childSceneId}`);

  // ── 1.2 时间轴推导 ────────────────────────────────────
  await resolveCountryTimeRef(pool, plan.setup);
  const phases = resolvePhasesFromCountryTimeRef(plan);
  plan.phases = phases;

  // ── 1.3 模块池 ────────────────────────────────────────
  const componentMap = await buildComponentMap(pool, childSceneId, plan);

  return { childSceneId, componentMap, phases };
}

/**
 * 建立模块池，得到「组件名 → 模板版本列表」映射。
 */
export async function buildComponentMap(
  pool: McpClientPool,
  childSceneId: number,
  plan: ResolvedPlan,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!plan.setup.initModulePool) {
    log("[exec] setup.initModulePool=false，跳过模块池创建");
    return map;
  }

  log(`[exec] 调用 modulePool_create, childSceneId=${childSceneId}`);
  const poolResult = await gcpCall(pool, "modulePool_create", { childSceneId });
  log(
    `[exec] modulePool_create: success=${poolResult.success}, isArray=${Array.isArray(poolResult.data)}`,
  );
  if (!poolResult.success || !Array.isArray(poolResult.data)) {
    logError("[exec] modulePool_create 失败:", poolResult.error);
    return map;
  }

  for (const raw of poolResult.data) {
    const item = raw as {
      name?: string;
      templateList?: Array<{ version?: string }>;
    };
    const name = item.name ?? "";
    if (!name) continue;
    const versions = (item.templateList ?? [])
      .map((t) => t.version ?? "")
      .filter(Boolean);
    map.set(name, versions);
  }

  log(`[exec] 模块池就绪: ${map.size} 个组件`);
  plan._componentMap = map;
  return map;
}
