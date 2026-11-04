/**
 * 流水线表达式 —— 只支持点号路径取值，刻意不做图灵完备，不用 eval。
 *
 *   "${plan.pages}"            整串是单个表达式 → 返回原始值（数组 / 对象保持不变）
 *   "页面 ${item.name} 已建好"  嵌在字符串里 → 文本替换（对象转 JSON）
 *   { page: "${item}" }        对象 / 数组 → 递归解析
 *
 * 路径段支持数组下标：`${pages.0.name}`。取不到返回 undefined（嵌入时替换为空串）。
 */

const WHOLE = /^\$\{\s*([^}]+?)\s*\}$/;
const EMBEDDED = /\$\{\s*([^}]+?)\s*\}/g;
const PATH = /^[A-Za-z_][\w-]*(\.[\w-]+)*$/;

/** 表达式写错（语法层面）时抛出，不会被重试 */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

/** 按点号路径从作用域取值 */
export function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  if (!PATH.test(path)) throw new ExpressionError(`表达式只支持点号路径: \${${path}}`);
  let cur: unknown = scope;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** 解析任意值里的表达式 */
export function resolveValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = value.match(WHOLE);
    if (whole?.[1] && !whole[1].includes("${")) return resolvePath(scope, whole[1]);
    if (!value.includes("${")) return value;
    return value.replace(EMBEDDED, (_m, path: string) => {
      const v = resolvePath(scope, path);
      if (v === undefined || v === null) return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v, scope);
    return out;
  }
  return value;
}

/** 字符串里是否含表达式 */
export function hasExpression(value: unknown): boolean {
  return typeof value === "string" && value.includes("${");
}

/**
 * when 的真值判断。
 * 假值：undefined、null、false、0、空串、"false"、"0"、空数组、空对象。
 */
export function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0";
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}
