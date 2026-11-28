/**
 * Phase 3 —— Review：把执行结果交给模型做只读审查。
 *
 * 三阶段模型：
 *   Plan (模型)  →  Execute (代码并发)  →  Review (模型)
 *
 * Review 与执行解耦：它只看结果，不复用执行路径，因此不会因为执行失败而失效。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "../types.js";
import { getDomainDir } from "./paths.js";
import { invokeSession } from "./sdk-client.js";
import type { LlmClient } from "./llm.js";
import { extractJson } from "./pipeline-engine.js";
import { log, logWarn } from "./log.js";

export interface ReviewIssue {
  level: "error" | "warning" | "info";
  step?: string;
  target?: string;
  message: string;
  suggestion?: string;
}

export interface ReviewReport {
  ok: boolean;
  checked: number;
  issues: ReviewIssue[];
  summary: string;
}

export interface RunReviewOptions {
  /** 注入自定义 LLM 客户端（测试用） */
  llm?: LlmClient;
}

/**
 * 执行审查阶段。
 *
 * @param skill 触发本次执行的 skill（审查提示词放在 `skills/<skill>/review.md`）
 * @param executionResult 执行阶段的结果
 * @param domainName 域名
 * @param ctx 运行上下文
 * @returns 审查报告；没有 review.md 时返回 undefined
 */
export async function runReview(
  skill: string,
  executionResult: unknown,
  domainName: string,
  ctx: RunContext,
  options: RunReviewOptions = {},
): Promise<ReviewReport | undefined> {
  const reviewPath = join(getDomainDir(domainName), "skills", skill, "review.md");
  if (!existsSync(reviewPath)) {
    logWarn(`[review] 域 ${domainName} 的 skill ${skill} 没有 review.md，跳过审查`);
    return undefined;
  }

  const systemPrompt = readFileSync(reviewPath, "utf-8");
  const payload =
    typeof executionResult === "string"
      ? executionResult
      : JSON.stringify(executionResult, null, 2);

  const result = await invokeSession(
    {
      systemPrompt,
      userMessage: `以下是执行阶段的结果，请审查：\n\n${payload}`,
      mcpConfigPath: ctx.mcpConfigPath,
    },
    ctx,
    "review",
    options.llm ? { llm: options.llm } : {},
  );

  const parsed = extractJson(result.output) as Partial<ReviewReport>;
  return {
    ok: parsed.ok ?? true,
    checked: parsed.checked ?? 0,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    summary: parsed.summary ?? result.output,
  };
}

/** 把审查报告渲染成人类可读文本 */
export function formatReview(report: ReviewReport): string {
  const lines = [`审查：${report.ok ? "通过" : "有问题"}`, report.summary];
  for (const issue of report.issues) {
    const where = issue.target ? ` ${issue.step ?? ""}/${issue.target}` : "";
    lines.push(`- [${issue.level}]${where}: ${issue.message}`);
    if (issue.suggestion) lines.push(`  建议：${issue.suggestion}`);
  }
  return lines.join("\n");
}
