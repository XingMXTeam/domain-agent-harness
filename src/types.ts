/**
 * 全局类型定义 —— 多域 Agent Harness 的公共契约。
 */

/** 执行引擎类型：`session` 为命令式单会话，`pipeline` 为声明式多 Agent 流水线。 */
export type EngineType = "session" | "pipeline";

/** 域元信息：决定该域走哪条执行引擎。 */
export interface DomainMeta {
  /** 执行引擎类型 */
  engine: EngineType;
  /**
   * 单 skill 域专用：声明后 Catalog 路由命中即直接进入该 skill，
   * 跳过域内 brain routing，省一次 LLM 调用。
   */
  singleSkill?: string;
}

/** 域配置：skill 白名单 + 工具白名单。 */
export interface DomainConfig {
  /** 域内允许的 skill 名 */
  validSkills: string[];
  /** 单 skill 域直接进入，跳过 brain routing */
  singleSkill?: string;
  /** query skill 允许调用的工具白名单（逐条列出，不用通配） */
  queryAllowedTools: string[];
}

/** 一次运行的上下文。 */
export interface RunContext {
  /** 运行 ID，同时作为运行目录名 */
  runId: string;
  /** 运行产物目录 */
  runDir: string;
  /** 所属域；Catalog 阶段使用占位域名 `_catalog` */
  domain: string;
  /** 链路追踪器 */
  trace: Trace;
  /** 解析后的 MCP 配置文件路径 */
  mcpConfigPath: string;
}

/** MCP 配置（与 Claude Code 的 `.mcp.json` 结构兼容）。 */
export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

export interface McpServerEntry {
  type?: "http" | "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** 一次 LLM 会话调用的结果。 */
export interface SessionResult {
  /** 模型输出的纯文本 */
  output: string;
  /** 本次调用的元信息 */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  /** 结束原因（provider 相关） */
  finishReason?: string;
}

/** 单次 LLM 调用的入参。 */
export interface SessionRequest {
  /** System Prompt 内容 */
  systemPrompt: string;
  /** 用户消息 */
  userMessage: string;
  /** MCP 配置文件路径 */
  mcpConfigPath: string;
  /** 允许调用的工具白名单 */
  allowedTools?: string[];
  /** 本次调用的业务标签（用于 trace 与日志） */
  label?: string;
}

/** 流水线中的一个步骤。 */
export interface PipelineStep {
  /** 步骤名 */
  name: string;
  /** 使用的 Agent 提示词文件（相对域目录） */
  agent: string;
  /** 上一步的产物键；缺省表示消费 user_prompt */
  input?: string;
  /** 本步骤产物写入 context 的键 */
  output: string;
  /** 对上一步产物做 foreach 展开 */
  foreach?: string;
  /** 该步骤产物的 JSON Schema 文件（相对域目录） */
  schema?: string;
  /** 额外说明 */
  description?: string;
}

/** 声明式流水线定义。 */
export interface Pipeline {
  name: string;
  description?: string;
  steps: PipelineStep[];
}

/** 域执行器接口。 */
export interface DomainExecutor {
  /**
   * 批量执行。纯只读域应显式拒绝。
   */
  execute(plan?: unknown, ctx?: RunContext): Promise<ExecutionResult | unknown>;
}

/** 执行过程中的一条明细 */
export interface ExecutionItem {
  /** 执行步骤：setup / data-prep / page / module / point / schedules / prepub */
  step: string;
  /** 目标标识（ID 或名称） */
  target: string;
  ok: boolean;
  error?: string;
}

/** 域执行结果 */
export interface ExecutionResult {
  success: boolean;
  items: ExecutionItem[];
  summary: string;
}

/** 链路追踪器。 */
export interface Trace {
  /** 记录一条事件 */
  event(name: string, payload?: Record<string, unknown>): void;
  /** 读取全部事件 */
  events(): TraceEvent[];
  /** 落盘为 JSON */
  flush(): void;
}

export interface TraceEvent {
  ts: string;
  name: string;
  payload?: Record<string, unknown>;
}
