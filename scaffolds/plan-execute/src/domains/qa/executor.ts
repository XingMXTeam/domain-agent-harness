/**
 * qa 域执行器 —— 纯只读域，批量执行能力被显式拒绝。
 */
import type { DomainExecutor } from "../../types.js";

export const executor: DomainExecutor = {
  async execute(): Promise<never> {
    // QA 域为纯 LLM 查询模式，无需代码执行器
    throw new Error("QA domain does not support batch execution");
  },
};
