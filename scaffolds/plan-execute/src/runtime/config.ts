/**
 * LLM Provider 配置 —— 统一读取环境变量，三家 provider 同一套配置形状。
 */
export type LlmProvider = "anthropic" | "openai" | "dashscope";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

function num(key: string, fallback: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/** 读取 LLM 配置；缺少必要项时抛 {@link LlmConfigError} */
export function loadLlmConfig(): LlmConfig {
  const rawProvider = (env("LLM_PROVIDER") ?? "anthropic").toLowerCase();
  if (rawProvider !== "anthropic" && rawProvider !== "openai" && rawProvider !== "dashscope") {
    throw new LlmConfigError(
      `未知的 LLM_PROVIDER: ${rawProvider}（可选 anthropic | openai | dashscope）`,
    );
  }
  const provider = rawProvider;

  const defaults = {
    anthropic: {
      apiKeyKey: "ANTHROPIC_API_KEY",
      baseUrlKey: "ANTHROPIC_BASE_URL",
      baseUrl: "https://api.anthropic.com",
      modelKey: "ANTHROPIC_MODEL",
      model: "claude-sonnet-4-5",
    },
    openai: {
      apiKeyKey: "OPENAI_API_KEY",
      baseUrlKey: "OPENAI_BASE_URL",
      baseUrl: "https://api.openai.com/v1",
      modelKey: "OPENAI_MODEL",
      model: "gpt-4o-mini",
    },
    dashscope: {
      apiKeyKey: "DASHSCOPE_API_KEY",
      baseUrlKey: "DASHSCOPE_BASE_URL",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelKey: "DASHSCOPE_MODEL",
      model: "qwen-plus",
    },
  } as const;

  const preset = defaults[provider];
  const apiKey = env(preset.apiKeyKey);
  if (!apiKey) {
    throw new LlmConfigError(
      `缺少 ${preset.apiKeyKey} 环境变量（LLM_PROVIDER=${provider}）`,
    );
  }

  return {
    provider,
    apiKey,
    baseUrl: env(preset.baseUrlKey) ?? preset.baseUrl,
    model: env(preset.modelKey) ?? preset.model,
    timeoutMs: num("LLM_TIMEOUT_MS", 600_000),
    maxTokens: num("LLM_MAX_TOKENS", 8192),
    temperature: num("LLM_TEMPERATURE", 0),
  };
}
