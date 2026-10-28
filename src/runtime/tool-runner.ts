/**
 * 工具执行器 —— 让「代码」而不是「模型」去调用平台 MCP 接口。
 *
 * Harness 的核心分工：模型负责决策，代码负责并发执行。
 * 编排层可以直接拿到 ToolRunner，按工具名发起确定性的调用。
 */
import type { RunContext } from "../types.js";
import { createMcpClientPool, type McpClientPool } from "./mcp-client.js";
import { log } from "./log.js";

export interface ToolCallTask {
  /** 完整工具名，`mcp__<server>__<tool>` */
  tool: string;
  /** 工具入参 */
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export class ToolRunner {
  private constructor(
    readonly ctx: RunContext,
    private readonly pool: McpClientPool,
    private readonly ownsPool: boolean,
  ) {}

  /** 依据运行上下文中的 MCP 配置建立连接 */
  static async open(ctx: RunContext, pool?: McpClientPool): Promise<ToolRunner> {
    if (pool) return new ToolRunner(ctx, pool, false);
    const created = await createMcpClientPool(ctx.mcpConfigPath);
    return new ToolRunner(ctx, created, true);
  }

  /** 调用单个工具，返回解析后的数据 */
  async call<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const parts = tool.split("__");
    if (parts.length < 3 || parts[0] !== "mcp") {
      throw new Error(`工具名格式非法（应为 mcp__<server>__<tool>）: ${tool}`);
    }
    const serverName = parts[1] ?? "";
    const toolName = parts.slice(2).join("__");

    const result = await this.pool.callTool(serverName, toolName, args);
    if (!result.success) {
      throw new Error(`工具 ${tool} 返回错误: ${result.error ?? "未知错误"}`);
    }
    return result.data as T;
  }

  /**
   * 并发执行多个工具调用。
   * 单个任务失败不影响其它任务，失败信息进入对应结果项。
   */
  async callMany(tasks: ToolCallTask[]): Promise<ToolCallResult[]> {
    const settled = await Promise.allSettled(
      tasks.map(async (task) => {
        const data = await this.call(task.tool, task.args);
        return { tool: task.tool, success: true, data } as ToolCallResult;
      }),
    );
    return settled.map((r, i) => {
      const task = tasks[i];
      if (!task) return { tool: "", success: false, error: "任务索引越界" };
      if (r.status === "fulfilled") return r.value;
      return {
        tool: task.tool,
        success: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      } satisfies ToolCallResult;
    });
  }

  /** 关闭连接（仅当自己创建了池） */
  async close(): Promise<void> {
    if (this.ownsPool) {
      log("[tools] 关闭 MCP 客户端池");
      await this.pool.close();
    }
  }
}
