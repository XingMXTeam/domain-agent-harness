/**
 * Keepalive —— 长任务期间的心跳。
 *
 * 沙箱 / 网关通常有空闲超时，长时间没有出站请求会被判定为失活。
 * 这里周期性打一个轻量请求（默认 MCP 服务的 initialize 或 HEAD）保活。
 */
import { logDebug } from "./log.js";

export interface KeepaliveHandle {
  stop(): void;
}

export interface KeepaliveOptions {
  /** 心跳间隔，默认 60s */
  intervalMs?: number;
  /** 心跳函数；默认什么都不做（纯定时器保活） */
  beat?: () => Promise<void> | void;
}

/** 启动心跳 */
export function startKeepalive(options: KeepaliveOptions = {}): KeepaliveHandle {
  const intervalMs = options.intervalMs ?? 60_000;
  const timer = setInterval(() => {
    void (async () => {
      try {
        await options.beat?.();
      } catch {
        // 心跳失败不影响主流程
      }
    })();
  }, intervalMs);
  // 不阻止进程退出
  timer.unref?.();

  logDebug(`[keepalive] 启动，间隔 ${intervalMs}ms`);

  return {
    stop(): void {
      clearInterval(timer);
      logDebug("[keepalive] 已停止");
    },
  };
}

/** 停止心跳（兼容只传 handle 的调用方式） */
export function stopKeepalive(handle: KeepaliveHandle | undefined): void {
  handle?.stop();
}
