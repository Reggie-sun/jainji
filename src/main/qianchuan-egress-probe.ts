import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { isLoopbackUrl } from "../shared/douyin-upload.js";

/** Probe only an owned background tab; never attach or evaluate a user's platform tabs. */
export async function probeChromeEgress(endpoint: string, expectedIp: string, parentSignal: AbortSignal): Promise<void> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)]);
  if (!isLoopbackUrl(endpoint) || new URL(endpoint).pathname !== "/") throw new Error("Unsafe discovery endpoint");
  const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal });
  if (!response.ok || Number(response.headers.get("content-length")) > 16384) throw new Error("出口浏览器连接不可用。");
  const info = await response.json() as { webSocketDebuggerUrl?: unknown };
  if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) || new URL(info.webSocketDebuggerUrl).host !== new URL(endpoint).host) throw new Error("Unsafe discovery websocket");
  const socket = new WebSocket(info.webSocketDebuggerUrl, { followRedirects: false, handshakeTimeout: 5000, maxPayload: 65536 });
  let id = 0, targetId: string | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const unavailable = () => new Error("浏览器实际出口校验失败，未执行平台自动化。请检查固定出口后重连。");
  const fail = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(unavailable()); } pending.clear(); };
  socket.on("error", fail); socket.on("close", fail);
  socket.on("message", bytes => {
    try {
      const message = JSON.parse(bytes.toString()), request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(unavailable()); else request.resolve(message.result);
    } catch { fail(); socket.terminate(); }
  });
  const call = (method: string, params: object, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(unavailable()); return; }
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(unavailable()); }, 3000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const abort = () => fail(); signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", () => reject(unavailable())); socket.once("close", () => reject(unavailable())); });
    signal.throwIfAborted();
    targetId = (await call("Target.createTarget", { url: "about:blank", background: true })).targetId;
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Network.enable", {}, sessionId);
    await call("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await call("Network.setBypassServiceWorker", { bypass: true }, sessionId);
    const url = `https://api.ipify.org/?format=text&jianji=${randomUUID()}`;
    const navigation = await call("Page.navigate", { url }, sessionId);
    if (navigation.errorText) throw unavailable();
    for (;;) {
      signal.throwIfAborted();
      const result = await call("Runtime.evaluate", { expression: "JSON.stringify({url:location.href,ready:document.readyState,text:(document.body?.textContent??'').slice(0,128)})", returnByValue: true }, sessionId);
      const value = JSON.parse(result.result?.value ?? "null");
      if (value?.ready === "complete" && value.url !== "about:blank") {
        if (value.url !== url || value.text.trim() !== expectedIp) throw unavailable();
        return;
      }
      await delay(100, undefined, { signal });
    }
  } catch { throw unavailable(); }
  finally {
    signal.removeEventListener("abort", abort);
    if (targetId && socket.readyState === WebSocket.OPEN) await call("Target.closeTarget", { targetId }).catch(() => undefined);
    socket.terminate(); fail();
  }
}
