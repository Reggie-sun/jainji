import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { egressIdentity, QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import type { EgressLease, QianchuanEgressRuntime } from "./qianchuan-egress-runtime.js";

type Runtime = Pick<QianchuanEgressRuntime, "ensure" | "verify" | "recover" | "retireUnused" | "dispose">;
interface Channel extends Pick<EventEmitter, "on" | "off"> {
  connected?: boolean;
  send(message: object, callback: (error: Error | null) => void): unknown;
}
type Operation = "ensure" | "verify" | "recover" | "retireUnused";
const unavailable = () => new Error("开发启动器的固定出口连接不可用，已停止自动化且不会直连。请检查后明确重连。");

/** Private parent IPC carries leases, never credentials or platform/upload commands. */
export class DevelopmentEgressClient implements Runtime {
  private readonly leases = new Map<string, { lease: EgressLease; controller: AbortController }>();
  private readonly invalidated = new Set<string>();
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;
  constructor(private readonly channel: Channel) {
    channel.on("message", this.message);
    channel.on("disconnect", this.disconnect);
  }
  private readonly message = (message: any): void => {
    if (message?.type === "jianji-egress-aborted" && typeof message.identity === "string") {
      this.invalidated.add(message.identity);
      this.leases.get(message.identity)?.controller.abort(unavailable());
    } else if (message?.type === "jianji-egress-result" && typeof message.requestId === "string") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.requestId);
      if (message.ok === true) pending.resolve(message.identity); else pending.reject(unavailable());
    }
  };
  private readonly disconnect = (): void => { this.dispose(); };
  private request(operation: Operation, payload: object): Promise<unknown> {
    if (this.stopped || !this.channel.connected) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => this.dispose(), 30_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.channel.send({ type: "jianji-egress-request", requestId, operation, ...payload }, error => { if (error) this.dispose(); });
      } catch { this.dispose(); }
    });
  }
  private async acquire(operation: "ensure" | "verify", input: QianchuanEgress): Promise<EgressLease> {
    const route = QianchuanEgressSchema.parse(input), identity = egressIdentity(route);
    if (await this.request(operation, { route }) !== identity || this.stopped || this.invalidated.has(identity)) throw unavailable();
    let entry = this.leases.get(identity);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, lease: Object.freeze({ identity, signal: controller.signal }) };
      this.leases.set(identity, entry);
    }
    entry.controller.signal.throwIfAborted();
    return entry.lease;
  }
  ensure(route: QianchuanEgress): Promise<EgressLease> { return this.acquire("ensure", route); }
  verify(route: QianchuanEgress): Promise<EgressLease> { return this.acquire("verify", route); }
  recover(route: QianchuanEgress): void {
    const identity = egressIdentity(QianchuanEgressSchema.parse(route));
    if (this.leases.get(identity)?.controller.signal.aborted) this.leases.delete(identity);
    this.invalidated.delete(identity);
    void this.request("recover", { route }).catch(() => this.dispose());
  }
  retireUnused(routes: readonly QianchuanEgress[]): void {
    void this.request("retireUnused", { routes }).catch(() => this.dispose());
  }
  /** Electron exit releases local authority; the launcher owns transport shutdown. */
  dispose(): void {
    this.stopped = true;
    this.channel.off("message", this.message); this.channel.off("disconnect", this.disconnect);
    for (const { controller } of this.leases.values()) controller.abort(unavailable());
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    this.pending.clear();
  }
}

/** The existing development launcher retains one canonical runtime across rebuilds. */
export class DevelopmentEgressHost {
  private readonly channels = new Map<Channel, () => void>();
  private readonly observed = new WeakSet<AbortSignal>();
  private stopped = false;
  constructor(private readonly runtime: Runtime) {}
  attach(channel: Channel): void {
    if (this.stopped) throw unavailable();
    if (this.channels.has(channel)) return;
    const message = (request: any) => { void this.receive(channel, request); };
    const detach = () => {
      channel.off("message", message); channel.off("exit", detach); channel.off("disconnect", detach);
      this.channels.delete(channel);
    };
    this.channels.set(channel, detach);
    channel.on("message", message); channel.on("exit", detach); channel.on("disconnect", detach);
  }
  private send(channel: Channel, message: object): void {
    if (!this.channels.has(channel) || !channel.connected) return;
    try { channel.send(message, () => {}); } catch { /* replacement/disconnect never transfers upload authority */ }
  }
  private async receive(channel: Channel, request: any): Promise<void> {
    if (this.stopped || request?.type !== "jianji-egress-request" || typeof request.requestId !== "string" || request.requestId.length > 64) return;
    try {
      let lease: EgressLease | undefined;
      if (request.operation === "retireUnused") {
        if (!Array.isArray(request.routes) || request.routes.length > 64) throw unavailable();
        this.runtime.retireUnused(request.routes.map((route: unknown) => QianchuanEgressSchema.parse(route)));
      } else {
        const route = QianchuanEgressSchema.parse(request.route);
        if (route.mode === "remote-browser") throw unavailable();
        if (request.operation === "ensure") lease = await this.runtime.ensure(route);
        else if (request.operation === "verify") lease = await this.runtime.verify(route);
        else if (request.operation === "recover") this.runtime.recover(route);
        else throw unavailable();
      }
      if (lease) {
        lease.signal.throwIfAborted();
        if (!this.observed.has(lease.signal)) {
          this.observed.add(lease.signal);
          const identity = lease.identity;
          lease.signal.addEventListener("abort", () => {
            for (const peer of this.channels.keys()) this.send(peer, { type: "jianji-egress-aborted", identity });
          }, { once: true });
        }
      }
      this.send(channel, { type: "jianji-egress-result", requestId: request.requestId, ok: true, identity: lease?.identity });
    } catch {
      this.send(channel, { type: "jianji-egress-result", requestId: request.requestId, ok: false });
    }
  }
  dispose(): void {
    this.stopped = true;
    this.runtime.dispose();
    for (const detach of [...this.channels.values()]) detach();
  }
}
