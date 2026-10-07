import type { ConnectOverCDPTransport } from "playwright-core";
import WebSocket from "ws";
import { isLoopbackUrl } from "../shared/douyin-upload.js";

interface Message { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; error?: { message: string }; }

/** The catalog owns a new tab; attaching every user tab can hang on a sleeping renderer. */
export class QianchuanPickerTransport implements ConnectOverCDPTransport {
  onmessage?: (message: object) => void;
  onclose?: (reason?: string) => void;
  private nextId = -1;
  private readonly pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  private constructor(private readonly socket: WebSocket, signal: AbortSignal) {
    const aborted = () => this.close();
    signal.addEventListener("abort", aborted, { once: true });
    socket.on("error", () => this.close());
    socket.on("close", () => {
      signal.removeEventListener("abort", aborted);
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("账号 Chrome 连接已断开，请刷新计划。")); }
      this.pending.clear();
      this.onclose?.();
    });
    socket.on("message", data => {
      let message: Message;
      try { message = JSON.parse(data.toString()); } catch { this.close(); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { this.close(); return; }
      const request = message.id === undefined ? undefined : this.pending.get(message.id);
      if (request && !message.sessionId) {
        this.pending.delete(message.id!); clearTimeout(request.timer);
        if (message.error) request.reject(new Error("无法连接计划读取页面，请刷新计划。")); else request.resolve();
      } else this.onmessage?.(message);
    });
    if (signal.aborted) this.close();
  }

  static async connect(url: string, signal: AbortSignal): Promise<QianchuanPickerTransport> {
    signal.throwIfAborted();
    if (!isLoopbackUrl(url, true)) throw new Error("Unsafe websocket endpoint");
    const socket = new WebSocket(url, { followRedirects: false, handshakeTimeout: 10_000, maxPayload: 16 * 1024 * 1024 });
    const transport = new QianchuanPickerTransport(socket, signal);
    await new Promise<void>((resolve, reject) => {
      const opened = () => { cleanup(); resolve(); };
      const closed = () => { cleanup(); reject(new Error("无法连接账号 Chrome，请检查浏览器后刷新计划。")); };
      const cleanup = () => { socket.off("open", opened); socket.off("close", closed); };
      socket.once("open", opened); socket.once("close", closed);
    });
    signal.throwIfAborted();
    return transport;
  }

  send(message: object): void {
    const command = message as Message;
    // Keep nested iframe/worker attachment intact inside the explicitly attached picker.
    const output = command.method === "Target.setAutoAttach" && !command.sessionId
      ? { ...command, params: { ...command.params, autoAttach: false, waitForDebuggerOnStart: false } } : command;
    this.socket.send(JSON.stringify(output));
  }

  attach(targetId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) { reject(new Error("账号 Chrome 连接已断开，请刷新计划。")); return; }
      const id = this.nextId--;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("连接计划读取页面超时，请刷新计划。")); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method: "Target.attachToTarget", params: { targetId, flatten: true } }));
    });
  }

  close(): void { this.socket.terminate(); }
}
