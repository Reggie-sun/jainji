import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { REMOTE_CHUNK_BYTES, RemoteRequestSchema, type RemoteRequest } from "../shared/qianchuan-remote.js";

export const remoteUnavailable = () => new Error("远端浏览器连接不可用，已停止且不会回退本机。请检查 VPS worker、SSH 和主机指纹后明确重连。");
export function sshRemoteArguments(route: QianchuanEgress): string[] {
  QianchuanEgressSchema.parse(route);
  if (route.mode !== "remote-browser") throw remoteUnavailable();
  return ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1",
    "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=1", "-o", "ControlMaster=no", "-o", "ControlPath=none",
    "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes", route.sshHost,
    'exec node "$HOME/.local/share/jianji-remote/worker.cjs"'];
}

/** Length-framed binary avoids base64 overhead for video bytes. One bounded request at a time. */
export class RemoteFrames {
  private buffer = Buffer.alloc(0);
  private request?: RemoteRequest;
  push(chunk: Buffer): { request: RemoteRequest; body: Buffer }[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > REMOTE_CHUNK_BYTES + 16384) throw remoteUnavailable();
    const result: { request: RemoteRequest; body: Buffer }[] = [];
    for (;;) {
      if (!this.request) {
        const end = this.buffer.indexOf(10);
        if (end < 0) { if (this.buffer.length > 16384) throw remoteUnavailable(); break; }
        if (end > 16384) throw remoteUnavailable();
        this.request = RemoteRequestSchema.parse(JSON.parse(this.buffer.subarray(0, end).toString("utf8")));
        this.buffer = this.buffer.subarray(end + 1);
      }
      if (this.buffer.length < this.request.bodyBytes) break;
      const request = this.request, body = Buffer.from(this.buffer.subarray(0, request.bodyBytes));
      this.buffer = this.buffer.subarray(request.bodyBytes); this.request = undefined;
      result.push({ request, body });
    }
    return result;
  }
}

export class RemoteChannel {
  readonly controller = new AbortController();
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending?: { resolve(value: unknown): void; reject(error: Error): void };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly route: QianchuanEgress, launch = () => spawn("/usr/bin/ssh", sshRemoteArguments(route), { stdio: "pipe" })) {
    this.child = launch();
    this.child.on("error", () => this.close()); this.child.on("exit", () => this.close());
    this.child.stdin.on("error", () => this.close()); this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 16384) { this.close(); return; }
      const end = this.buffer.indexOf("\n"); if (end < 0) return;
      try {
        if (!this.pending || end !== this.buffer.length - 1) throw remoteUnavailable();
        const response = JSON.parse(this.buffer);
        if (typeof response?.ok !== "boolean") throw remoteUnavailable();
        const pending = this.pending; this.pending = undefined; this.buffer = "";
        if (response?.ok === true) pending.resolve(response.value);
        else pending.reject(remoteUnavailable());
      } catch { this.close(); }
    });
  }
  request(action: RemoteRequest["action"], advertiserId: string, extras: Partial<Pick<RemoteRequest, "file" | "offset">> = {}, body = Buffer.alloc(0), signal?: AbortSignal): Promise<unknown> {
    const request = RemoteRequestSchema.parse({ version: 1, route: this.route, action, advertiserId, ...extras, bodyBytes: body.length });
    const run = this.queue.catch(() => undefined).then(async () => {
      this.controller.signal.throwIfAborted(); signal?.throwIfAborted();
      const abort = () => this.close(), timer = setTimeout(abort, action === "file-append" ? 120_000 : 45_000);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          this.pending = { resolve, reject };
          this.child.stdin.write(Buffer.from(JSON.stringify(request) + "\n"));
          if (body.length) this.child.stdin.write(body);
        });
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    });
    this.queue = run; return run;
  }
  close(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort(remoteUnavailable()); this.pending?.reject(remoteUnavailable()); this.pending = undefined;
    this.child.stdin.destroy(); this.child.kill("SIGTERM");
  }
}
