import type { ConnectOverCDPTransport } from "playwright-core";
import { QianchuanPickerTransport } from "./qianchuan-picker-transport.js";

interface Message { id?: number; method?: string; sessionId?: string; params?: { sessionId?: string; targetInfo?: { targetId?: string } }; error?: unknown }
/** Existing-page contexts can arrive before Playwright binds its frame tree. Reannounce on the same SDK session. */
export class QianguanjiaTransport implements ConnectOverCDPTransport {
  onmessage?: (message: object) => void;
  onclose?: (reason?: string) => void;
  private sessionId?: string;
  private nextId = -1000000;
  private readonly pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private readonly inner: QianchuanPickerTransport, private readonly targetId: string) {
    inner.onmessage = value => {
      const message = value as Message, request = message.id === undefined ? undefined : this.pending.get(message.id);
      if (request) {
        this.pending.delete(message.id!); clearTimeout(request.timer);
        if (message.sessionId !== this.sessionId || message.error) request.reject(new Error("千管家页面上下文无法核对。"));
        else request.resolve();
        return;
      }
      if (message.method === "Target.attachedToTarget" && !message.sessionId && message.params?.targetInfo?.targetId === this.targetId) this.sessionId = message.params.sessionId;
      this.onmessage?.(value);
    };
    inner.onclose = reason => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("千管家连接已断开。")); }
      this.pending.clear(); this.onclose?.(reason);
    };
  }
  static async connect(url: string, targetId: string, signal: AbortSignal): Promise<QianguanjiaTransport> {
    return new QianguanjiaTransport(await QianchuanPickerTransport.connect(url, signal), targetId);
  }
  send(message: object): void { this.inner.send(message); }
  attach(): Promise<void> { return this.inner.attach(this.targetId); }
  close(): void { this.inner.close(); }
  private command(method: "Runtime.disable" | "Runtime.enable"): Promise<void> {
    if (!this.sessionId) return Promise.reject(new Error("千管家页面上下文无法核对。"));
    return new Promise((resolve, reject) => {
      const id = this.nextId--;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("千管家上下文连接超时。")); }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.inner.send({ id, method, sessionId: this.sessionId }); }
      catch { this.pending.delete(id); clearTimeout(timer); reject(new Error("千管家连接已断开。")); }
    });
  }
  async refreshMainWorld(): Promise<void> { await this.command("Runtime.disable"); await this.command("Runtime.enable"); }
}
