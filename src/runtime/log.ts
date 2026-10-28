/**
 * 日志 —— 输出到 stderr，保证 stdout 留给结构化结果。
 */
const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const raw = (process.env.DAH_LOG_LEVEL ?? "info").toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : "info";
}

function emit(level: LogLevel, args: unknown[]): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const stamp = new Date().toISOString().slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  process.stderr.write(`[${stamp}] ${tag} ${args.map(String).join(" ")}\n`);
}

/** 普通日志 */
export function log(...args: unknown[]): void {
  emit("info", args);
}

/** 调试日志 */
export function logDebug(...args: unknown[]): void {
  emit("debug", args);
}

/** 错误日志 */
export function logError(...args: unknown[]): void {
  emit("error", args);
}

/** 警告日志 */
export function logWarn(...args: unknown[]): void {
  emit("warn", args);
}
