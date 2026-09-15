import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DEFAULT_QWEN_CONNECTION } from "../shared/connections.js";

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 2048;
const UPSTREAM_TIMEOUT_MS = 85_000;
const UPSTREAM_BASE_URL = "http://127.0.0.1:8000/v1";
const ALLOWED_PAYLOAD_KEYS = new Set(["model", "messages", "stream", "reasoning_effort", "n", "max_tokens", "max_completion_tokens"]);

export type ModelGatewayOptions = {
  keys: string[];
  upstreamKey: string;
  fetcher?: typeof fetch;
};

class GatewayError extends Error {
  constructor(readonly status: number, readonly message: string) { super(message); }
}

export function createModelGateway(options: ModelGatewayOptions): Server {
  const keys = options.keys.map((key) => key.trim()).filter(Boolean);
  const upstreamKey = options.upstreamKey.trim();
  if (!keys.length || !upstreamKey) throw new Error("Model gateway credentials are invalid.");
  const fetcher = options.fetcher ?? fetch;
  return createServer((request, response) => {
    void handle(request, response, keys, upstreamKey, fetcher).catch(() => reply(response, 500, "服务暂时不可用。"));
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, keys: string[], upstreamKey: string, fetcher: typeof fetch): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const allowed = !url.search && ((pathname === "/v1/models" && request.method === "GET") || (pathname === "/v1/chat/completions" && request.method === "POST"));
  if (!allowed) {
    if (pathname === "/v1/models" || pathname === "/v1/chat/completions") reply(response, 405, "请求方法不支持。");
    else reply(response, 404, "未找到接口。");
    return;
  }
  if (!hasAuthorizedBearer(request.headers.authorization, keys)) { reply(response, 401, "认证失败。"); return; }
  if (pathname === "/v1/models") {
    try { await forward(undefined, "/models", request, response, upstreamKey, fetcher); }
    catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (error instanceof GatewayError) reply(response, error.status, error.message);
      else reply(response, 502, "模型服务暂时不可用。");
    }
    return;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) { reply(response, 415, "请求内容类型必须为 application/json。"); return; }
  try {
    const payload = normalizePayload(await readJson(request));
    await forward(payload, "/chat/completions", request, response, upstreamKey, fetcher);
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (error instanceof GatewayError) reply(response, error.status, error.message);
    else reply(response, 502, "模型服务暂时不可用。");
  }
}

function hasAuthorizedBearer(value: string | undefined, keys: string[]): boolean {
  const candidate = /^Bearer ([^\s]+)$/i.exec(value ?? "")?.[1];
  if (!candidate) return false;
  let authorized = false;
  for (const key of keys) authorized = constantTimeEqual(candidate, key) || authorized;
  return authorized;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (Array.isArray(contentLength) || !/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES) {
      request.resume();
      throw new GatewayError(413, "请求内容过大。");
    }
  }
  const chunks: Buffer[] = [];
  let length = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      request.off("data", onData); request.off("end", onEnd); request.off("error", onError); request.off("aborted", onAborted);
      callback();
    };
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) { request.resume(); finish(() => reject(new GatewayError(413, "请求内容过大。"))); return; }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve);
    const onError = () => finish(() => reject(new GatewayError(400, "请求读取失败。")));
    const onAborted = () => finish(() => reject(new GatewayError(400, "请求已中断。")));
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onAborted);
  });
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new GatewayError(400, "请求不是有效 JSON。"); }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new GatewayError(400, "请求格式无效。");
  return payload as Record<string, unknown>;
}

function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(payload).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) throw new GatewayError(400, "请求格式无效。");
  if (payload.model !== DEFAULT_QWEN_CONNECTION.model) throw new GatewayError(400, "不支持的模型。");
  validateMessages(payload.messages);
  if ("stream" in payload && typeof payload.stream !== "boolean") throw new GatewayError(400, "请求格式无效。");
  if ("reasoning_effort" in payload && (typeof payload.reasoning_effort !== "string" || !payload.reasoning_effort.trim() || payload.reasoning_effort.length > 32)) throw new GatewayError(400, "请求格式无效。");
  if ("n" in payload && payload.n !== 1) throw new GatewayError(400, "仅支持 n=1。");
  for (const key of ["max_tokens", "max_completion_tokens"] as const) {
    if (key in payload && (!Number.isInteger(payload[key]) || (payload[key] as number) < 1 || (payload[key] as number) > MAX_OUTPUT_TOKENS)) {
      throw new GatewayError(400, "输出长度必须在允许范围内。");
    }
  }
  if (!("max_tokens" in payload) && !("max_completion_tokens" in payload)) return { ...payload, max_tokens: MAX_OUTPUT_TOKENS };
  return payload;
}

function validateMessages(messages: unknown): void {
  if (!Array.isArray(messages) || !messages.length) throw new GatewayError(400, "消息格式无效。");
  for (const message of messages) {
    if (!message || Array.isArray(message) || typeof message !== "object") throw new GatewayError(400, "消息格式无效。");
    const value = message as { role?: unknown; content?: unknown };
    if (Object.keys(value).some((key) => key !== "role" && key !== "content")) throw new GatewayError(400, "消息格式无效。");
    if (value.role !== "system" && value.role !== "user" && value.role !== "assistant") throw new GatewayError(400, "消息格式无效。");
    if (typeof value.content === "string") continue;
    if (!Array.isArray(value.content) || !value.content.length) throw new GatewayError(400, "消息格式无效。");
    for (const part of value.content) {
      if (!part || Array.isArray(part) || typeof part !== "object") throw new GatewayError(400, "消息格式无效。");
      const item = part as { type?: unknown; text?: unknown; image_url?: unknown };
      if (item.type === "text" && typeof item.text === "string" && Object.keys(item).every((key) => key === "type" || key === "text")) continue;
      if (item.type === "image_url" && validImageUrl(item.image_url) && Object.keys(item).every((key) => key === "type" || key === "image_url")) continue;
      throw new GatewayError(400, "消息格式无效。");
    }
  }
}

function validImageUrl(value: unknown): boolean {
  if (!value || Array.isArray(value) || typeof value !== "object" || typeof (value as { url?: unknown }).url !== "string") return false;
  if (!Object.keys(value).every((key) => key === "url" || key === "detail")) return false;
  if ("detail" in value && !["auto", "low", "high"].includes((value as { detail?: unknown }).detail as string)) return false;
  const match = /^data:image\/(?:jpeg|png|webp);base64,/.exec((value as { url: string }).url);
  return Boolean(match && validBase64((value as { url: string }).url.slice(match[0].length)));
}

function validBase64(value: string): boolean {
  if (!value || value.length % 4) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const alphabet = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (index < contentLength ? !alphabet : code !== 61) return false;
  }
  return true;
}

async function forward(payload: Record<string, unknown> | undefined, resource: "/models" | "/chat/completions", request: IncomingMessage, response: ServerResponse, upstreamKey: string, fetcher: typeof fetch): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, UPSTREAM_TIMEOUT_MS);
  timeout.unref();
  const abortForDisconnect = () => { if (!response.writableEnded) controller.abort(); };
  request.once("aborted", abortForDisconnect);
  response.once("close", abortForDisconnect);
  try {
    const streaming = payload?.stream === true;
    const upstream = await fetcher(`${UPSTREAM_BASE_URL}${resource}`, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${upstreamKey}`,
        ...(payload ? { "Content-Type": "application/json", Accept: streaming ? "text/event-stream" : "application/json" } : { Accept: "application/json" }),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new GatewayError(502, "模型服务暂时不可用。");
    }
    if (streaming) {
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      if (upstream.body) await relayStream(upstream.body, response, controller.signal);
      if (!response.destroyed) response.end();
      return;
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(bytes);
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) { response.destroy(); return; }
    if (timedOut) throw new GatewayError(504, "模型服务响应超时。");
    if (controller.signal.aborted) return;
    throw error;
  } finally {
    clearTimeout(timeout);
    request.off("aborted", abortForDisconnect);
    response.off("close", abortForDisconnect);
  }
}

async function relayStream(body: ReadableStream<Uint8Array>, response: ServerResponse, signal: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("stream cancelled");
      if (done) return;
      if (!response.write(value)) await waitForDrain(response, signal);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (response.destroyed) cancel();
    reader.releaseLock();
  }
}

async function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted || response.destroyed) throw new Error("client disconnected");
  await new Promise<void>((resolve, reject) => {
    const finish = (callback: () => void) => {
      response.off("drain", onDrain); response.off("close", onClose); signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(() => reject(new Error("client disconnected")));
    const onAbort = () => finish(() => reject(new Error("client disconnected")));
    response.once("drain", onDrain); response.once("close", onClose); signal.addEventListener("abort", onAbort, { once: true });
  });
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(typeof value === "string" ? { error: { message: value } } : value));
}
