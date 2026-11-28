/**
 * Provider 无关的 LLM 客户端。
 *
 * 对上暴露统一的 ChatRequest / ChatResponse，对下分别翻译成
 * Anthropic Messages API 与 OpenAI 兼容 API（DashScope 兼容模式同 OpenAI）。
 */
import { httpsPost } from "./https-client.js";
import type { LlmConfig, LlmProvider } from "./config.js";
import { log, logDebug } from "./log.js";

/** 工具声明（内部统一形状） */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 消息内容块 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentPart[];
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: ContentPart[];
  /** 纯文本输出（拼接所有 text 块） */
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  finishReason?: string;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

class HttpLlmClient implements LlmClient {
  constructor(private readonly cfg: LlmConfig) {}

  get provider(): LlmProvider {
    return this.cfg.provider;
  }

  get model(): string {
    return this.cfg.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.cfg.provider === "anthropic"
      ? this.chatAnthropic(req)
      : this.chatOpenAiCompatible(req);
  }

  // ── Anthropic Messages API ────────────────────────────────
  private async chatAnthropic(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.cfg.model,
      max_tokens: req.maxTokens ?? this.cfg.maxTokens,
      temperature: req.temperature ?? this.cfg.temperature,
      system: req.system,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content.map((part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "tool_use")
            return { type: "tool_use", id: part.id, name: part.name, input: part.input };
          return {
            type: "tool_result",
            tool_use_id: part.toolUseId,
            content: part.content,
            ...(part.isError ? { is_error: true } : {}),
          };
        }),
      })),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };

    const res = await httpsPost(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/v1/messages`,
      {
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      JSON.stringify(body),
      { timeoutMs: this.cfg.timeoutMs },
    );

    const parsed = parseJson(res.body);
    if (res.statusCode !== 200) {
      throw new Error(`Anthropic 调用失败 ${res.statusCode}: ${res.body.slice(0, 500)}`);
    }
    const rawBlocks = Array.isArray(parsed.content) ? parsed.content : [];
    const content: ContentPart[] = [];
    for (const block of rawBlocks) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        content.push({ type: "text", text: b.text });
      } else if (b.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: String(b.id ?? ""),
          name: String(b.name ?? ""),
          input: (b.input as Record<string, unknown>) ?? {},
        });
      }
    }
    return {
      content,
      text: content
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n"),
      usage: readUsage(parsed),
      finishReason: typeof parsed.stop_reason === "string" ? parsed.stop_reason : undefined,
    };
  }

  // ── OpenAI 兼容 API（含 DashScope compatible-mode）─────────
  private async chatOpenAiCompatible(req: ChatRequest): Promise<ChatResponse> {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: req.system },
    ];
    for (const m of req.messages) {
      if (m.role === "assistant") {
        const text = m.content
          .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const toolCalls = m.content.filter(
          (p): p is Extract<ContentPart, { type: "tool_use" }> => p.type === "tool_use",
        );
        if (toolCalls.length === 0) {
          messages.push({ role: "assistant", content: text });
        } else {
          messages.push({
            role: "assistant",
            content: text || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          });
        }
        continue;
      }
      // user 消息：tool_result 单独成条，其余合并为文本
      for (const part of m.content) {
        if (part.type === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: part.toolUseId,
            content: part.content,
          });
        } else if (part.type === "text") {
          messages.push({ role: "user", content: part.text });
        }
      }
    }

    const body = {
      model: this.cfg.model,
      messages,
      max_tokens: req.maxTokens ?? this.cfg.maxTokens,
      temperature: req.temperature ?? this.cfg.temperature,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
          }
        : {}),
    };

    const res = await httpsPost(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
      { authorization: `Bearer ${this.cfg.apiKey}` },
      JSON.stringify(body),
      { timeoutMs: this.cfg.timeoutMs },
    );

    const parsed = parseJson(res.body);
    if (res.statusCode !== 200) {
      throw new Error(
        `${this.cfg.provider} 调用失败 ${res.statusCode}: ${res.body.slice(0, 500)}`,
      );
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = (choices[0] ?? {}) as Record<string, unknown>;
    const message = (first.message ?? {}) as Record<string, unknown>;

    const content: ContentPart[] = [];
    if (typeof message.content === "string" && message.content) {
      content.push({ type: "text", text: message.content });
    }
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const raw of rawCalls) {
      const call = raw as Record<string, unknown>;
      const fn = (call.function ?? {}) as Record<string, unknown>;
      let input: Record<string, unknown> = {};
      if (typeof fn.arguments === "string" && fn.arguments.trim()) {
        try {
          input = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          input = { _raw: fn.arguments };
        }
      }
      content.push({
        type: "tool_use",
        id: String(call.id ?? ""),
        name: String(fn.name ?? ""),
        input,
      });
    }

    return {
      content,
      text: content
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n"),
      usage: readUsage(parsed),
      finishReason: typeof first.finish_reason === "string" ? first.finish_reason : undefined,
    };
  }
}

function parseJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readUsage(parsed: Record<string, unknown>): ChatResponse["usage"] {
  const raw = parsed.usage;
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const prompt = u.input_tokens ?? u.prompt_tokens;
  const completion = u.output_tokens ?? u.completion_tokens;
  if (typeof prompt !== "number" && typeof completion !== "number") return undefined;
  return {
    promptTokens: typeof prompt === "number" ? prompt : undefined,
    completionTokens: typeof completion === "number" ? completion : undefined,
  };
}

/** 创建 LLM 客户端 */
export function createLlmClient(cfg: LlmConfig): LlmClient {
  logDebug(`LLM provider=${cfg.provider} model=${cfg.model}`);
  return new HttpLlmClient(cfg);
}
