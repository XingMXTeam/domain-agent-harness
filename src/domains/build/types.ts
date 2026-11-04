/**
 * build 域的 plan.json 类型定义。
 */

/** 活动模板引用 —— version 由 executor 从模块池自动匹配 */
export interface PlanTemplate {
  name: string;
  version?: string;
  [k: string]: unknown;
}

/** 楼层 */
export interface PlanFloor {
  /** 楼层名 */
  name: string;
  /** 标准化模块：只给模板名 */
  template?: PlanTemplate;
  /** 非标准化模块：原样透传 */
  floorSetting?: Record<string, unknown>;
  /** 是否隐藏 */
  hidden?: boolean;
  /** 该楼层的排期 */
  schedules?: PlanSchedule[];
  [k: string]: unknown;
}

/** 页面 —— nations 是字符串 */
export interface PlanPage {
  name: string;
  nations?: string;
  floors: PlanFloor[];
  [k: string]: unknown;
}

/** 排期 —— nations 是数组 */
export interface PlanSchedule {
  /** 排期名 */
  name?: string;
  nations?: string[];
  pageName?: string;
  floorName?: string;
  /** 数据来源类型：datapool / moduleTask / ... */
  dataSourceType?: string;
  contentData?: Record<string, unknown>;
  [k: string]: unknown;
}

/** 子场景 */
export interface PlanChildScene {
  name: string;
  nations?: string;
  /** 时间引用，executor 据此推导实际时间 */
  countryTimeRef?: { id?: string; name?: string };
  extendInfo?: { renderConfig?: PlanRenderConfig };
  [k: string]: unknown;
}

/** 渲染配置 —— activityTime 由 executor 注入 */
export interface PlanRenderConfig {
  countryTimeRef?: { id?: string; name?: string };
  activityTime?: ActivityTime[];
  [k: string]: unknown;
}

/** 一个时间分区 */
export interface ActivityTime {
  type: "include";
  region: string;
  teasingStartTime: string;
  teasingEndTime: string;
  megaStartTime: string;
  megaEndTime: string;
}

/** setup 段 */
export interface PlanSetup {
  childScene: PlanChildScene;
  /** 是否初始化模块池 */
  initModulePool?: boolean;
  [k: string]: unknown;
}

/** 阶段时间 */
export interface PhaseTime {
  startTime: string;
  endTime: string;
}

/** plan.json 主体 */
export interface Plan {
  setup: PlanSetup;
  pages: PlanPage[];
  /** 时间轴（executor 注入） */
  phases?: Record<string, PhaseTime>;
  [k: string]: unknown;
}

/** 预处理后的 plan —— 附带执行期解析出的内部字段 */
export interface ResolvedPlan extends Plan {
  /** 子场景 ID */
  _childSceneId?: number;
  /** 页面 ID 映射 */
  _pageIds?: Map<string, number>;
  /** 组件名 → 模板版本列表 */
  _componentMap?: Map<string, string[]>;
}

/** 数据准备结果的键：页面/楼层/排期三级下标 */
export interface DataPrepKey {
  pageIndex: number;
  floorIndex: number;
  scheduleIndex: number;
}

/** 数据准备结果 */
export interface DataPrepResult {
  /** 外层任务 ID 列表（选品结果） */
  outerTaskIds: string[];
  ok: boolean;
  error?: string;
}

/** 点位准备结果 */
export interface PointPrepResult {
  pointId?: number;
  ok: boolean;
  error?: string;
}

/** 模块的模型数据（业务模型） */
export interface ModelData {
  processId: string;
  entityType: string;
  dataType: string;
  tagObject: Record<string, unknown>;
  deliveryEntityFields: unknown[];
}

/** 页面创建结果 */
export interface PageResult {
  pageName: string;
  pageId?: number;
  ok: boolean;
  error?: string;
}

/** 模块创建结果 */
export interface ModuleResult {
  pageName: string;
  floorName: string;
  floorId?: number;
  componentId?: number;
  ok: boolean;
  /** 因上游（页面）失败而未执行 */
  skipped?: boolean;
  error?: string;
}

/** 排期统计 */
export interface ScheduleStats {
  total: number;
  success: number;
  /** 写入失败 + 因楼层缺失跳过的总数 */
  failed: number;
  /** 楼层（模块）没挂上而跳过的排期数，已计入 failed */
  skipped?: number;
}
