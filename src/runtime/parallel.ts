/**
 * 并发执行器 —— 带并发上限的批量执行。
 *
 * Harness 的分层执行（数据准备 / 页面搭建）都是「互不依赖、并发跑」，
 * 这里统一控制并发度，避免打爆下游 MCP 服务。
 */

/** 并发上限默认值 —— 与原实现一致（32 页面并发时稳定） */
export const DEFAULT_CONCURRENCY = 8;

export interface ParallelOptions {
  /** 最大并发数，默认 6 */
  concurrency?: number;
  /** 单项失败是否继续，默认 true */
  continueOnError?: boolean;
}

export interface ParallelOutcome<T> {
  index: number;
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * 并发执行一组任务，保持结果顺序与输入顺序一致。
 */
export async function parallelMap<T, R>(
  tasks: Array<(index: number) => Promise<T>>,
  options: ParallelOptions = {},
): Promise<Array<ParallelOutcome<R>>> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const continueOnError = options.continueOnError ?? true;

  const results = new Array<ParallelOutcome<R>>(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index]!;
      try {
        const value = await task(index);
        results[index] = { index, ok: true, value: value as unknown as R };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[index] = { index, ok: false, error: message };
        if (!continueOnError) {
          // 中止：把剩余任务标记为未执行
          for (let i = index + 1; i < tasks.length; i++) {
            results[i] = { index: i, ok: false, error: "aborted" };
          }
          return;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 并发执行一组任务，只返回成功的结果。
 */
export async function parallelFilter<T>(
  tasks: Array<(index: number) => Promise<T>>,
  options: ParallelOptions = {},
): Promise<T[]> {
  const outcomes = await parallelMap(tasks, options);
  return outcomes.filter((o) => o.ok && o.value !== undefined).map((o) => o.value as T);
}

/**
 * 计数信号量 —— 给「散落在多层、各自 Promise.all」的调用设一个全局并发上限。
 *
 * parallelMap 只能管住一次批量；executor 的页面、模块、排期、点位各自并发，
 * 叠起来会超过下游能承受的量（demo 实测 13，设定 8）。把信号量挂在调用入口上，
 * 不管上层怎么并发，同一时刻打到平台的请求都不超过上限。
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`并发上限必须是正整数: ${limit}`);
  }

  get inFlight(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      // 名额直接交给下一个等待者，active 不变；没人等才释放
      if (next) next();
      else this.active -= 1;
    }
  }
}
