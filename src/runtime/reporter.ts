/**
 * 进度上报 —— 把长任务的阶段信息写到 stdout（JSON Lines），
 * 便于外部调度器 / CI 消费。
 */
import { logDebug } from "./log.js";

export interface ProgressEvent {
  /** 阶段名，如 "plan" / "execute" / "review" */
  stage: string;
  /** 阶段状态 */
  status: "start" | "progress" | "done" | "failed";
  /** 已完成 / 总数 */
  done?: number;
  total?: number;
  /** 附加信息 */
  detail?: string;
}

export interface ReporterOptions {
  /** 输出目标，默认 stderr（stdout 留给最终答案） */
  write?: (line: string) => void;
}

/**
 * 创建一个进度上报器。
 *
 * ```
 * const reporter = createReporter();
 * reporter.report({ stage: "execute", status: "start", total: 12 });
 * ```
 */
export function createReporter(options: ReporterOptions = {}) {
  const write =
    options.write ?? ((line: string) => process.stderr.write(`${line}\n`));

  return {
    report(event: ProgressEvent): void {
      const payload = {
        type: "progress",
        ts: new Date().toISOString(),
        ...event,
      };
      write(JSON.stringify(payload));
      logDebug(`[progress] ${event.stage} ${event.status}`);
    },

    start(stage: string, total?: number): void {
      this.report({ stage, status: "start", ...(total !== undefined ? { total } : {}) });
    },

    advance(stage: string, done: number, total?: number): void {
      this.report({
        stage,
        status: "progress",
        done,
        ...(total !== undefined ? { total } : {}),
      });
    },

    done(stage: string, detail?: string): void {
      this.report({ stage, status: "done", ...(detail ? { detail } : {}) });
    },

    failed(stage: string, detail?: string): void {
      this.report({ stage, status: "failed", ...(detail ? { detail } : {}) });
    },
  };
}

export type Reporter = ReturnType<typeof createReporter>;

/** 便捷函数：一次性上报 */
export function reportProgress(event: ProgressEvent): void {
  createReporter().report(event);
}
