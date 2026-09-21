import { z } from "zod";
import type { ConnectionInput } from "../shared/agent.js";
import { DEFAULT_QWEN_CONNECTION } from "../shared/connections.js";

export type ModelMessage = { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: string } })[] };
export class ProviderError extends Error {}
export interface CompletionOptions {
  maxOutputTokens?: number;
  maxOutputCharacters?: number;
  jsonObject?: boolean;
  // Codex turn/start only; API connections keep their existing format capabilities.
  chatgptOutputSchema?: Record<string, unknown>;
}

const DEFAULT_MAX_OUTPUT_CHARACTERS = 16_000;

function supportsJsonObject(connection: ConnectionInput): boolean {
  if (connection.model !== DEFAULT_QWEN_CONNECTION.model) return false;
  const baseUrl = connection.baseUrl.replace(/\/+$/, "");
  // These are the deployed vLLM endpoints whose JSON output support we verify.
  return [DEFAULT_QWEN_CONNECTION.baseUrl, "http://127.0.0.1:8000/v1", "http://localhost:8000/v1", "http://[::1]:8000/v1"].includes(baseUrl);
}

export async function completeApi(connection: ConnectionInput, messages: ModelMessage[], signal: AbortSignal, request: typeof fetch, options: CompletionOptions = {}): Promise<string> {
  const protocol = connection.protocol ?? "chat-completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers[connection.authHeader === "x-api-key" ? "x-api-key" : "Authorization"] = connection.authHeader === "x-api-key" ? connection.apiKey : `Bearer ${connection.apiKey}`;
  let endpoint = "/chat/completions";
  let body: unknown = { model: connection.model, messages, stream: false, ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}), ...(options.jsonObject && supportsJsonObject(connection) ? { response_format: { type: "json_object" } } : {}), ...(connection.reasoningEffort ? { reasoning_effort: connection.reasoningEffort } : {}) };
  if (protocol === "anthropic") {
    endpoint = connection.baseUrl.endsWith("/v1") ? "/messages" : "/v1/messages";
    headers["anthropic-version"] = "2023-06-01";
    body = { model: connection.model, max_tokens: options.maxOutputTokens ?? 2048, stream: false, ...(connection.reasoningEffort ? { output_config: { effort: connection.reasoningEffort } } : {}),
      system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n"),
      messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((item) => {
        if (item.type === "text") return item;
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(item.image_url.url);
        if (!match) throw new ProviderError("抽帧图片格式无效。");
        return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: match[1] } };
      }) })),
    };
  } else if (protocol === "responses") {
    endpoint = "/responses";
    body = { model: connection.model, store: false, stream: false, ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}), ...(connection.reasoningEffort ? { reasoning: { effort: connection.reasoningEffort } } : {}), input: messages.map((m) => ({ role: m.role,
      content: typeof m.content === "string" ? m.content : m.content.map((item) => item.type === "text" ? { type: "input_text", text: item.text } : { type: "input_image", image_url: item.image_url.url, detail: item.image_url.detail }),
    })) };
  }
  try {
    const response = await request(`${connection.baseUrl}${endpoint}`, {
      method: "POST", redirect: "error", headers, body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const reason = response.status === 401 || response.status === 403 ? "API Key 无效或没有模型权限" : response.status === 429 ? "额度不足或请求过于频繁" : `服务返回 HTTP ${response.status}`;
      throw new ProviderError(`${reason}，请检查 API 配置。`);
    }
    const raw: unknown = await response.json();
    let content: string;
    if (protocol === "anthropic") {
      const parsed = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(raw);
      content = parsed.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("");
    } else if (protocol === "responses") {
      const parsed = z.object({ status: z.literal("completed"), output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })) }).parse(raw);
      content = parsed.output.filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("");
    } else {
      const choice = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string() }) })).min(1) }).parse(raw).choices[0];
      if (choice.finish_reason === "length") throw new ProviderError("模型输出达到长度上限，结果不完整。请检查模型服务的输出长度配置后重新生成。");
      content = choice.message.content;
    }
    if (!content || content.length > (options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS)) throw new ProviderError("模型返回内容为空或过长。");
    if (content.includes(connection.apiKey)) throw new ProviderError("服务响应包含敏感信息，已丢弃。");
    return content;
  } catch (error) {
    if (signal.aborted) throw new ProviderError("已停止生成。");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("API 请求失败、响应格式不符或超时，请检查地址、网络和模型支持。");
  }
}
