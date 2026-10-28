/**
 * 链路追踪 —— 以 JSONL 追加写入运行目录，方便事后复盘。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Trace, TraceEvent } from "../types.js";

/** 创建追踪器 */
export function createTrace(runDir: string): Trace {
  const events: TraceEvent[] = [];
  const tracePath = join(runDir, "trace.jsonl");

  return {
    event(name: string, payload?: Record<string, unknown>): void {
      const record: TraceEvent = {
        ts: new Date().toISOString(),
        name,
        ...(payload ? { payload } : {}),
      };
      events.push(record);
      try {
        mkdirSync(runDir, { recursive: true });
        appendFileSync(tracePath, `${JSON.stringify(record)}\n`, "utf-8");
      } catch {
        // 追踪失败不应影响主流程
      }
    },
    events(): TraceEvent[] {
      return [...events];
    },
    flush(): void {
      // 事件已实时落盘，这里只做兜底重写，保证文件存在且是合法 JSONL。
      try {
        mkdirSync(runDir, { recursive: true });
        appendFileSync(tracePath, "", "utf-8");
      } catch {
        // ignore
      }
    },
  };
}
