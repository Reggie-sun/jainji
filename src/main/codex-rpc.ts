import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { ProviderError } from "./api-transport.js";

export interface RpcClient {
  request(method: string, params: unknown): Promise<any>;
  on(event: "notification" | "closed", listener: (...args: any[]) => void): this;
  off(event: "notification" | "closed", listener: (...args: any[]) => void): this;
  close(): void | Promise<void>;
}

// The stdio child is private to this application. No protocol traffic is logged.
export class CodexRpc extends EventEmitter implements RpcClient {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;
  private readonly exited: Promise<void>;
  constructor(command: string, args: string[], environment: NodeJS.ProcessEnv, cwd: string) {
    super();
    this.child = spawn(command, args, { cwd, env: environment, windowsHide: true, stdio: "pipe" });
    this.exited = new Promise((resolve) => { this.child.once("exit", () => resolve()); this.child.once("error", () => resolve()); });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close());
    this.child.on("error", () => this.close());
    this.child.on("exit", () => this.close());
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.method && message.id !== undefined) {
          // This client never authorizes tool calls, file access, or approvals.
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "This client does not execute tools or approvals." } }) + "\n");
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(new ProviderError("Codex 请求未完成，请检查登录状态、账户额度或网络。"));
          else pending.resolve(message.result);
        } else if (typeof message.method === "string") this.emit("notification", message.method, message.params);
      } catch { this.close(); }
    });
    this.once("closed", () => lines.close());
  }
  async initialize(): Promise<void> {
    await this.request("initialize", { clientInfo: { name: "jianji", title: "简辑", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.stopped) return Promise.reject(new ProviderError("Codex 连接已关闭，请重新连接。"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.close(); }, 45_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  close(): Promise<void> {
    if (this.stopped) return this.exited;
    this.stopped = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new ProviderError("Codex 连接中断或超时，请重新连接。")); }
    this.pending.clear();
    this.child.kill();
    const timer = setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL"); }, 2000);
    this.emit("closed");
    return this.exited.finally(() => clearTimeout(timer));
  }
}
