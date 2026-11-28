/**
 * 轻量 JSON Schema 校验器 —— 只实现流水线契约校验所需的子集，避免引入额外依赖。
 *
 * 支持：type / properties / required / items / enum / additionalProperties / minimum / maximum。
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

type Schema = Record<string, unknown>;

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验一个值是否符合 schema */
export function validate(value: unknown, schema: Schema, path = "$"): SchemaValidationResult {
  const errors: string[] = [];

  const rawType = schema.type;
  if (typeof rawType === "string") {
    const check = TYPE_CHECKS[rawType];
    if (check && !check(value)) {
      errors.push(`${path}: 期望类型 ${rawType}，实际 ${typeOf(value)}`);
      return { valid: false, errors };
    }
  } else if (Array.isArray(rawType)) {
    const ok = rawType.some((t) => TYPE_CHECKS[t as string]?.(value));
    if (!ok) {
      errors.push(`${path}: 期望类型 ${rawType.join(" | ")}，实际 ${typeOf(value)}`);
      return { valid: false, errors };
    }
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push(`${path}: 不在枚举 ${JSON.stringify(schema.enum)} 中`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: 小于最小值 ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: 大于最大值 ${schema.maximum}`);
    }
  }

  if (typeof value === "string" && typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: 不满足 pattern ${schema.pattern}`);
      }
    } catch {
      // 无效正则，忽略
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, i) => {
      const r = validate(item, schema.items as Schema, `${path}[${i}]`);
      errors.push(...r.errors);
    });
  }

  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;

    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}.${key}: 缺少必填字段`);
    }

    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const r = validate(obj[key], sub, `${path}.${key}`);
        errors.push(...r.errors);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}.${key}: 不允许的额外字段`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
