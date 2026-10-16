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
type Generation = { value: string; hostId: string; sequence: number };
const parseGeneration = (value: unknown): Generation | undefined => {
  if (typeof value !== "string") return undefined;
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]*)$/i.exec(value);
  if (!match) return undefined;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) ? { value, hostId: match[1], sequence } : undefined;
};
type LeaseResponse = { identity: string; generation: string };

/** Private parent IPC carries leases, never credentials or platform/upload commands. */
export class DevelopmentEgressClient implements Runtime {
  private readonly leases = new Map<string, { lease: EgressLease; controller: AbortController; generation: Generation }>();
  private readonly generationHighWater = new Map<string, { hostId: string; highest: number; revokedThrough: number }>();
  private readonly pending = new Map<string, { operation: Operation; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;
  constructor(private readonly channel: Channel) {
    channel.on("message", this.message);
    channel.on("disconnect", this.disconnect);
  }
  private readonly message = (message: any): void => {
    if (message?.type === "jianji-egress-aborted") {
      const generation = parseGeneration(message.generation);
      if (typeof message.identity !== "string" || message.identity.length === 0 || message.identity.length > 256 || !generation) {
        void this.dispose(); return;
      }
      let highWater = this.generationHighWater.get(message.identity);
      if (highWater && highWater.hostId !== generation.hostId) { void this.dispose(); return; }
      if (!highWater) {
        highWater = { hostId: generation.hostId, highest: generation.sequence, revokedThrough: generation.sequence };
        this.generationHighWater.set(message.identity, highWater);
      } else {
        highWater.highest = Math.max(highWater.highest, generation.sequence);
        highWater.revokedThrough = Math.max(highWater.revokedThrough, generation.sequence);
      }
      const entry = this.leases.get(message.identity);
      if (entry && entry.generation.sequence <= generation.sequence) entry.controller.abort(unavailable());
    } else if (message?.type === "jianji-egress-result" && typeof message.requestId === "string") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (message.ok === true && (pending.operation === "ensure" || pending.operation === "verify")) {
        if (typeof message.identity !== "string" || message.identity.length === 0 || message.identity.length > 256 || !parseGeneration(message.generation)) {
          void this.dispose(); return;
        }
        clearTimeout(pending.timer); this.pending.delete(message.requestId);
        pending.resolve({ identity: message.identity, generation: message.generation } satisfies LeaseResponse);
      } else if (message.ok === true && (pending.operation === "recover" || pending.operation === "retireUnused")) {
        clearTimeout(pending.timer); this.pending.delete(message.requestId); pending.resolve(undefined);
      } else if (message.ok === false) {
        clearTimeout(pending.timer); this.pending.delete(message.requestId); pending.reject(unavailable());
      } else void this.dispose();
    }
  };
  private readonly disconnect = (): void => { this.dispose(); };
  private request(operation: Operation, payload: object): Promise<unknown> {
    if (this.stopped || !this.channel.connected) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => this.dispose(), 30_000);
      this.pending.set(requestId, { operation, resolve, reject, timer });
      try {
        this.channel.send({ type: "jianji-egress-request", requestId, operation, ...payload }, error => { if (error) this.dispose(); });
      } catch { this.dispose(); }
    });
  }
  private async acquire(operation: "ensure" | "verify", input: QianchuanEgress): Promise<EgressLease> {
    const route = QianchuanEgressSchema.parse(input), identity = egressIdentity(route);
    const result = await this.request(operation, { route }) as LeaseResponse;
    const generation = parseGeneration(result?.generation);
    if (!result || result.identity !== identity || !generation || this.stopped) {
      if (!this.stopped) void this.dispose();
      throw unavailable();
    }
    let highWater = this.generationHighWater.get(identity);
    if (highWater && highWater.hostId !== generation.hostId) { void this.dispose(); throw unavailable(); }
    if (highWater && (generation.sequence <= highWater.revokedThrough || generation.sequence < highWater.highest)) throw unavailable();
    if (!highWater) {
      highWater = { hostId: generation.hostId, highest: generation.sequence, revokedThrough: 0 };
      this.generationHighWater.set(identity, highWater);
    } else highWater.highest = Math.max(highWater.highest, generation.sequence);
    let entry = this.leases.get(identity);
    if (entry?.generation.value === generation.value) {
      entry.controller.signal.throwIfAborted();
      return entry.lease;
    }
    entry?.controller.abort(unavailable());
    const controller = new AbortController();
    entry = { controller, generation,
      lease: Object.freeze({ identity, signal: controller.signal }) };
    this.leases.set(identity, entry);
    entry.controller.signal.throwIfAborted();
    return entry.lease;
  }
  ensure(route: QianchuanEgress): Promise<EgressLease> { return this.acquire("ensure", route); }
  verify(route: QianchuanEgress): Promise<EgressLease> { return this.acquire("verify", route); }
  recover(route: QianchuanEgress): void {
    const identity = egressIdentity(QianchuanEgressSchema.parse(route));
    if (this.leases.get(identity)?.controller.signal.aborted) this.leases.delete(identity);
    void this.request("recover", { route }).catch(() => this.dispose());
  }
  retireUnused(routes: readonly QianchuanEgress[]): void {
    void this.request("retireUnused", { routes }).catch(() => this.dispose());
  }
  /** Electron exit releases local authority; the launcher owns transport shutdown. */
  dispose(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.channel.off("message", this.message); this.channel.off("disconnect", this.disconnect);
    for (const { controller } of this.leases.values()) controller.abort(unavailable());
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    this.pending.clear();
    return Promise.resolve();
  }
}

/** The existing development launcher retains one canonical runtime across rebuilds. */
export class DevelopmentEgressHost {
  private readonly channels = new Map<Channel, () => void>();
  private readonly observed = new WeakSet<AbortSignal>();
  private readonly generations = new WeakMap<AbortSignal, string>();
  private readonly hostId = randomUUID();
  private generationSequence = 0;
  private stopped = false;
  private shutdown?: Promise<void>;
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
      let generation: string | undefined;
      if (lease) {
        lease.signal.throwIfAborted();
        generation = this.generations.get(lease.signal);
        if (!generation) {
          if (this.generationSequence >= Number.MAX_SAFE_INTEGER) throw unavailable();
          generation = `${this.hostId}:${++this.generationSequence}`;
          this.generations.set(lease.signal, generation);
        }
        if (!this.observed.has(lease.signal)) {
          this.observed.add(lease.signal);
          const identity = lease.identity;
          const currentGeneration = generation;
          lease.signal.addEventListener("abort", () => {
            for (const peer of this.channels.keys()) this.send(peer, { type: "jianji-egress-aborted", identity, generation: currentGeneration });
          }, { once: true });
        }
      }
      this.send(channel, { type: "jianji-egress-result", requestId: request.requestId, ok: true, identity: lease?.identity, generation });
    } catch {
      this.send(channel, { type: "jianji-egress-result", requestId: request.requestId, ok: false });
    }
  }
  dispose(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopped = true;
    this.shutdown = this.runtime.dispose();
    for (const detach of [...this.channels.values()]) detach();
    return this.shutdown;
  }
}
