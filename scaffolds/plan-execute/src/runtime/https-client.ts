/**
 * HTTPS 客户端 —— 普通 POST 与 SSE 流式 POST。
 *
 * 直接使用 node:https / node:http，不引入第三方依赖，
 * 便于在受限沙箱（无 root、无外网代理配置）中使用。
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

export interface HttpPostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpPostResult {
  statusCode: number;
  body: string;
}

export interface SsePostResult {
  statusCode: number;
  /** 累积后的完整文本 */
  content: string;
  /** 结束原因 */
  finishReason: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

function buildRequest(url: string, options: HttpPostOptions) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  return isHttps ? httpsRequest : httpRequest;
}

/** 普通 POST，返回完整响应体。 */
export function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: HttpPostOptions = {},
): Promise<HttpPostResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const req = buildRequest(url, options)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
      ...options.headers,
    },
    timeout: timeoutMs,
  });

  return new Promise((resolve, reject) => {
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP request timeout ${timeoutMs}ms: ${url}`));
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.write(body);
    req.end();
  });
}

/**
 * SSE 流式 POST：逐行解析 `data:` 帧，累积 delta.content。
 * 兼容 OpenAI 风格（choices[].delta.content）与 DashScope 风格（output.choices[].message.content）。
 */
export function httpsPostSSE(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: HttpPostOptions = {},
): Promise<SsePostResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const req = buildRequest(url, options)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...headers,
      ...options.headers,
    },
    timeout: timeoutMs,
  });

  return new Promise((resolve, reject) => {
    let buffer = "";
    let content = "";
    let finishReason = "unknown";
    let usage: SsePostResult["usage"];
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    const handleFrame = (raw: string) => {
      const line = raw.trim();
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return; // 跳过无法解析的帧
      }
      const delta = extractDelta(parsed);
      if (delta.text) content += delta.text;
      if (delta.finishReason) finishReason = delta.finishReason;
      if (delta.usage) usage = delta.usage;
    };

    req.on("error", fail);
    req.on("timeout", () => fail(new Error(`HTTP request timeout ${timeoutMs}ms: ${url}`)));
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      if (status !== 200) {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          fail(
            new Error(
              `SSE 请求失败 ${status}: ${Buffer.concat(chunks).toString("utf-8").slice(0, 500)}`,
            ),
          );
        });
        return;
      }
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        // 保留最后一行（可能是不完整的行），等下一个 chunk 拼接
        buffer = lines.pop() ?? "";
        for (const line of lines) handleFrame(line);
      });
      res.on("end", () => {
        if (buffer.trim()) handleFrame(buffer);
        if (settled) return;
        settled = true;
        resolve({ statusCode: status, content, finishReason, usage });
      });
    });
    req.write(body);
    req.end();
  });
}

interface Delta {
  text?: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** 从不同 provider 的 SSE 帧里抽出统一的增量文本 / 结束原因 / token 用量。 */
function extractDelta(frame: Record<string, unknown>): Delta {
  const out: Delta = {};

  const pickUsage = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const u = raw as Record<string, unknown>;
    const prompt = u.prompt_tokens ?? u.input_tokens;
    const completion = u.completion_tokens ?? u.output_tokens;
    if (typeof prompt === "number" || typeof completion === "number") {
      out.usage = {
        promptTokens: typeof prompt === "number" ? prompt : undefined,
        completionTokens: typeof completion === "number" ? completion : undefined,
      };
    }
  };

  pickUsage(frame.usage);

  // OpenAI 风格
  const choices = frame.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const delta = first.delta as Record<string, unknown> | undefined;
    if (delta && typeof delta.content === "string") out.text = delta.content;
    if (typeof first.finish_reason === "string") out.finishReason = first.finish_reason;
    return out;
  }

  // DashScope 风格：output.choices[].message.content
  const output = frame.output as Record<string, unknown> | undefined;
  if (output) {
    pickUsage(output.usage);
    const outChoices = output.choices;
    if (Array.isArray(outChoices) && outChoices.length > 0) {
      const first = outChoices[0] as Record<string, unknown>;
      const message = first.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === "string") out.text = message.content;
      if (typeof first.finish_reason === "string") out.finishReason = first.finish_reason;
    }
    if (typeof output.finish_reason === "string") out.finishReason = output.finish_reason;
  }

  return out;
}
