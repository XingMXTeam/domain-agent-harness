/**
 * 提示词文件加载 —— 支持可选的 YAML frontmatter。
 *
 * ```markdown
 * ---
 * allowedTools:
 *   - mcp__knowledge__kb_list
 *   - mcp__knowledge__kb_read
 * maxTurns: 12
 * outputSchema: plan.schema.json
 * ---
 * # 正文即 system prompt
 * ```
 *
 * frontmatter 只承载「这个角色能用什么工具、最多几轮」这类运行约束；
 * 正文原样作为 system prompt。没有 frontmatter 的文件行为不变。
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface PromptFile {
  /** 去掉 frontmatter 后的正文 */
  body: string;
  /** 工具白名单；缺省表示不限制 */
  allowedTools?: string[];
  /** 最大工具轮数 */
  maxTurns?: number;
  /** 输出 JSON Schema 文件名（流水线步骤未写 schema 时使用） */
  outputSchema?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePromptFile(text: string, source = "<inline>"): PromptFile {
  const m = text.match(FRONTMATTER);
  if (!m) return { body: text };

  let meta: Record<string, unknown>;
  try {
    meta = (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`提示词文件 ${source} 的 frontmatter 不是合法 YAML: ${(err as Error).message}`);
  }

  const out: PromptFile = { body: text.slice(m[0].length) };
  if (meta.allowedTools !== undefined) {
    if (!Array.isArray(meta.allowedTools) || !meta.allowedTools.every((t) => typeof t === "string")) {
      throw new Error(`提示词文件 ${source} 的 allowedTools 必须是字符串数组`);
    }
    out.allowedTools = meta.allowedTools as string[];
  }
  if (meta.maxTurns !== undefined) {
    const n = Number(meta.maxTurns);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`提示词文件 ${source} 的 maxTurns 必须是正整数`);
    }
    out.maxTurns = n;
  }
  if (meta.outputSchema !== undefined) {
    if (typeof meta.outputSchema !== "string" || !meta.outputSchema) {
      throw new Error(`提示词文件 ${source} 的 outputSchema 必须是非空字符串`);
    }
    out.outputSchema = meta.outputSchema;
  }
  return out;
}

export function loadPromptFile(path: string): PromptFile {
  return parsePromptFile(readFileSync(path, "utf-8"), path);
}
