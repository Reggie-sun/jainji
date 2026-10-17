import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { isLoopbackUrl, UploadError } from "../shared/douyin-upload.js";
import { QIANCHUAN_EGRESS_PROBE_ENDPOINTS } from "../shared/qianchuan-egress.js";

const MAX_DISCOVERY_BYTES = 16_384;
const MAX_PROTOCOL_PAYLOAD = 65_536;
const PROBE_TIMEOUT_MS = 15_000;
const CDP_REQUEST_TIMEOUT_MS = 3_000;

const RETRYABLE_TRANSPORT_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const RETRYABLE_NAVIGATION_ERRORS = new Set([
  "net::ERR_CONNECTION_ABORTED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_TIMED_OUT",
  "net::ERR_PROXY_CONNECTION_FAILED",
  "net::ERR_SOCKS_CONNECTION_FAILED",
]);

export class BrowserEgressProbeError extends Error {
  constructor(readonly retryable: boolean) {
    super(retryable ? "浏览器出口探测暂时不可用，未执行平台自动化。" : "浏览器实际出口校验失败，未执行平台自动化。请检查固定出口后重连。");
    this.name = "BrowserEgressProbeError";
  }
}

// Only the uploader's pre-action probe mapper creates this in-memory capability.
// Persisted browser failures cannot grant an in-place retry on an occupied page.
export class EgressProbeUnavailable extends UploadError {
  constructor() {
    super({ code: "CDP_UNAVAILABLE", category: "browser", message: "浏览器出口探测暂时不可用，尚未选择本组文件。", next_action: "程序将在原冻结目标下有限重试；仍失败时检查固定出口。", requires_human: false, retryable: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRetryableTransportCode(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && isRecord(current) && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current.code === "string" && RETRYABLE_TRANSPORT_CODES.has(current.code)) return true;
    current = current.cause;
  }
  return false;
}

function isProbeTimeout(signal: AbortSignal, parentSignal: AbortSignal): boolean {
  return !parentSignal.aborted && signal.aborted && isRecord(signal.reason) && signal.reason.name === "TimeoutError";
}

function isWebSocketHandshakeTimeout(error: unknown): boolean {
  return isRecord(error) && error.message === "Opening handshake has timed out";
}

function classifyFailure(error: unknown, signal: AbortSignal, parentSignal: AbortSignal): BrowserEgressProbeError {
  if (parentSignal.aborted) return new BrowserEgressProbeError(false);
  if (error instanceof BrowserEgressProbeError) return error;
  return new BrowserEgressProbeError(isProbeTimeout(signal, parentSignal) || isWebSocketHandshakeTimeout(error) || hasRetryableTransportCode(error));
}

function navigationFailure(errorText: string): BrowserEgressProbeError {
  return new BrowserEgressProbeError(RETRYABLE_NAVIGATION_ERRORS.has(errorText));
}

/** Probe only an owned background tab; never attach or evaluate a user's platform tabs. */
export async function probeChromeEgress(endpoint: string, expectedIp: string, parentSignal: AbortSignal, attempt = 0): Promise<void> {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= QIANCHUAN_EGRESS_PROBE_ENDPOINTS.length) {
    throw new BrowserEgressProbeError(false);
  }
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new BrowserEgressProbeError(false);
  }
  if (parentSignal.aborted || !isLoopbackUrl(endpoint) || endpointUrl.pathname !== "/") throw new BrowserEgressProbeError(false);

  try {
    const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal });
    if (!response.ok) throw new BrowserEgressProbeError(false);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_DISCOVERY_BYTES)) {
      throw new BrowserEgressProbeError(false);
    }
    const discoveryBody = await response.text();
    if (new TextEncoder().encode(discoveryBody).byteLength > MAX_DISCOVERY_BYTES) throw new BrowserEgressProbeError(false);
    const info: unknown = JSON.parse(discoveryBody);
    if (!isRecord(info) || typeof info.webSocketDebuggerUrl !== "string") throw new BrowserEgressProbeError(false);
    const debuggerUrl = new URL(info.webSocketDebuggerUrl);
    if (!isLoopbackUrl(info.webSocketDebuggerUrl, true) || debuggerUrl.host !== endpointUrl.host) throw new BrowserEgressProbeError(false);

    const socket = new WebSocket(info.webSocketDebuggerUrl, {
      followRedirects: false,
      handshakeTimeout: 5_000,
      maxPayload: MAX_PROTOCOL_PAYLOAD,
    });
    let id = 0;
    let targetId: string | undefined;
    let socketFailure: BrowserEgressProbeError | undefined;
    const pending = new Map<number, {
      resolve(value: Record<string, unknown>): void;
      reject(error: BrowserEgressProbeError): void;
      timer: ReturnType<typeof setTimeout>;
    }>();
    const fail = (error = new BrowserEgressProbeError(false)) => {
      socketFailure ??= parentSignal.aborted ? new BrowserEgressProbeError(false) : error;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(socketFailure);
      }
      pending.clear();
    };
    const onSocketError = (error: Error) => fail(classifyFailure(error, signal, parentSignal));
    const onSocketClose = (code: number) => fail(new BrowserEgressProbeError(code === 1006 && !parentSignal.aborted));
    socket.on("error", onSocketError);
    socket.on("close", onSocketClose);

    const abort = () => fail(classifyFailure(signal.reason, signal, parentSignal));
    signal.addEventListener("abort", abort, { once: true });

    const call = (method: string, params: object, sessionId?: string): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(socketFailure ?? new BrowserEgressProbeError(false));
        return;
      }
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new BrowserEgressProbeError(!parentSignal.aborted));
      }, CDP_REQUEST_TIMEOUT_MS);
      pending.set(key, { resolve, reject, timer });
      const onSend = (error?: Error) => {
        if (!error) return;
        const request = pending.get(key);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(key);
        request.reject(classifyFailure(error, signal, parentSignal));
      };
      try {
        socket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }), onSend);
      } catch (error) {
        const request = pending.get(key);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(key);
        reject(classifyFailure(error, signal, parentSignal));
      }
    });

    socket.on("message", bytes => {
      let message: unknown;
      try {
        message = JSON.parse(bytes.toString());
      } catch {
        fail(new BrowserEgressProbeError(false));
        socket.terminate();
        return;
      }
      if (!isRecord(message)) {
        fail(new BrowserEgressProbeError(false));
        socket.terminate();
        return;
      }
      if (!Object.hasOwn(message, "id")) {
        if (typeof message.method === "string") return;
        fail(new BrowserEgressProbeError(false));
        socket.terminate();
        return;
      }
      if (!Number.isSafeInteger(message.id)) {
        fail(new BrowserEgressProbeError(false));
        socket.terminate();
        return;
      }
      const request = pending.get(message.id as number);
      // A timed-out command may reply while its owned target is being closed.
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id as number);
      if (Object.hasOwn(message, "error") || !isRecord(message.result)) {
        request.reject(new BrowserEgressProbeError(false));
        return;
      }
      request.resolve(message.result);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.off("open", onOpen);
          socket.off("error", onError);
          socket.off("close", onClose);
          signal.removeEventListener("abort", onAbort);
        };
        const onOpen = () => { cleanup(); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(classifyFailure(error, signal, parentSignal)); };
        const onClose = (code: number) => { cleanup(); reject(new BrowserEgressProbeError(code === 1006 && !parentSignal.aborted)); };
        const onAbort = () => { cleanup(); reject(classifyFailure(signal.reason, signal, parentSignal)); };
        socket.once("open", onOpen);
        socket.once("error", onError);
        socket.once("close", onClose);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });

      signal.throwIfAborted();
      const created = await call("Target.createTarget", { url: "about:blank", background: true });
      if (typeof created.targetId !== "string" || !created.targetId) throw new BrowserEgressProbeError(false);
      targetId = created.targetId;
      const attached = await call("Target.attachToTarget", { targetId, flatten: true });
      if (typeof attached.sessionId !== "string" || !attached.sessionId) throw new BrowserEgressProbeError(false);
      const sessionId = attached.sessionId;
      await call("Network.enable", {}, sessionId);
      await call("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
      await call("Network.setBypassServiceWorker", { bypass: true }, sessionId);

      const url = `${QIANCHUAN_EGRESS_PROBE_ENDPOINTS[attempt]}/?jianji=${randomUUID()}`;
      const navigation = await call("Page.navigate", { url }, sessionId);
      if (typeof navigation.frameId !== "string" || !navigation.frameId) throw new BrowserEgressProbeError(false);
      if (Object.hasOwn(navigation, "errorText")) {
        if (typeof navigation.errorText !== "string") throw new BrowserEgressProbeError(false);
        if (navigation.errorText) throw navigationFailure(navigation.errorText);
      }

      for (;;) {
        signal.throwIfAborted();
        const evaluated = await call("Runtime.evaluate", {
          expression: "JSON.stringify({url:location.href,ready:document.readyState,text:(document.body?.textContent??'').slice(0,128)})",
          returnByValue: true,
        }, sessionId);
        if (!isRecord(evaluated.result) || Object.hasOwn(evaluated, "exceptionDetails") || typeof evaluated.result.value !== "string") {
          throw new BrowserEgressProbeError(false);
        }
        const value: unknown = JSON.parse(evaluated.result.value);
        if (!isRecord(value) || typeof value.url !== "string" || typeof value.ready !== "string" || typeof value.text !== "string") {
          throw new BrowserEgressProbeError(false);
        }
        if (value.url !== "about:blank" && value.url !== url) throw new BrowserEgressProbeError(false);
        if (value.ready === "complete" && value.url === url) {
          if (value.text.trim() !== expectedIp) throw new BrowserEgressProbeError(false);
          return;
        }
        if (value.ready !== "loading" && value.ready !== "interactive" && value.ready !== "complete") {
          throw new BrowserEgressProbeError(false);
        }
        await delay(100, undefined, { signal });
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (targetId && socket.readyState === WebSocket.OPEN) await call("Target.closeTarget", { targetId }).catch(() => undefined);
      socket.terminate();
      fail();
    }
  } catch (error) {
    throw classifyFailure(error, signal, parentSignal);
  }
}
