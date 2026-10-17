import { execFile, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { EventEmitter } from "node:events";
import { egressIdentity, QIANCHUAN_EGRESS_PROBE_ENDPOINTS, QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { DevelopmentEgressClient } from "./qianchuan-egress-development.js";
export { DevelopmentEgressHost } from "./qianchuan-egress-development.js";

const execute = promisify(execFile);
const failure = () => new Error("固定出口连接或 IP 校验失败，已停止自动化且不会直连。请检查 VPS、SSH 密钥与主机指纹，然后明确重连。");
const PORT_BUSY_CODE = "EGRESS_LOCAL_PORT_BUSY";
const TRANSIENT_PROBE_UNAVAILABLE_CODE = "EGRESS_TRANSIENT_PROBE_UNAVAILABLE";
const transientProbeFailure = () => Object.assign(failure(), { code: TRANSIENT_PROBE_UNAVAILABLE_CODE });
const RETRYABLE_CURL_EXIT_CODES = new Set([5, 6, 7, 28, 55, 56]);
const PROBE_RETRY_DELAYS = [100, 250] as const;
const MAX_PROBE_ATTEMPTS = 3;
const PROBE_REQUEST_TIMEOUT_MS = 12_000;
const MAX_OWNED_CHILD_RECOVERIES = 3;
const CONNECTION_DEADLINE_MS = 25_000;
interface TunnelChild extends EventEmitter { kill(signal?: NodeJS.Signals): boolean; exitCode: number | null; signalCode: string | null; pid?: number; }
export interface EgressLease { readonly identity: string; readonly signal: AbortSignal; }
type Transport = { child?: TunnelChild; stopped: boolean; unexpectedlyLost: boolean; deadline?: number; termination?: Promise<boolean>; };
type Tunnel = { route: QianchuanEgress; controller: AbortController; transport: Transport; lease: EgressLease;
  ready?: Promise<EgressLease>; verification?: Promise<void>; recovery?: Promise<EgressLease>; recoveryAttempts: number; attested: boolean;
  failureKind?: "hard" | "transient-probe-exhausted"; };

/** Internal marker for allowlisted curl network exits; its message carries no transport details. */
export class TransientEgressProbeError extends Error {
  constructor() { super("固定出口 IP 探测暂时不可用。"); this.name = "TransientEgressProbeError"; }
}

function hasTransientCurlExitCode(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && RETRYABLE_CURL_EXIT_CODES.has(code);
}

export function sshEgressArguments(route: QianchuanEgress): string[] {
  QianchuanEgressSchema.parse(route);
  return ["-N", "-T", "-D", `127.0.0.1:${route.localPort}`, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1", "-o", "ServerAliveInterval=10",
    "-o", "ServerAliveCountMax=1", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", route.sshHost];
}
async function portFree(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise(resolve => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
/** Readiness must never bind the port that the SSH child is about to acquire. */
export async function waitForEgressListener(port: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    signal.throwIfAborted();
    const listening = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host: "127.0.0.1", port, signal });
      const finish = (ready: boolean) => { socket.destroy(); resolve(ready); };
      socket.setTimeout(250, () => finish(false));
      socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
    });
    signal.throwIfAborted();
    if (listening) return;
    if (Date.now() >= deadline) throw failure();
    await delay(100, undefined, { signal });
  }
}
/** Explicit SOCKS5 remote DNS; no proxy environment, redirects, cookies or platform credentials. */
export async function probeEgressIp(route: QianchuanEgress, signal: AbortSignal, attempt = 0): Promise<string> {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= QIANCHUAN_EGRESS_PROBE_ENDPOINTS.length) throw failure();
  try {
    const { stdout } = await execute("/usr/bin/curl", ["--disable", "--silent", "--show-error", "--fail", "--proto", "=https", "--max-time", "10",
      "--max-filesize", "64", "--noproxy", "", "--proxy", `socks5h://127.0.0.1:${route.localPort}`, QIANCHUAN_EGRESS_PROBE_ENDPOINTS[attempt]],
    { signal, timeout: PROBE_REQUEST_TIMEOUT_MS, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
    const ip = stdout.trim();
    if (!QianchuanEgressSchema.shape.expectedIp.safeParse(ip).success) throw failure();
    return ip;
  } catch (error) {
    if (signal.aborted) throw failure();
    if (hasTransientCurlExitCode(error)) throw new TransientEgressProbeError();
    throw failure();
  }
}

/** One process owns its tunnels; old leases stay revoked when a fresh route generation is recovered. */
export class QianchuanEgressRuntime {
  private readonly tunnels = new Map<string, Tunnel>();
  private disposed = false;
  private shutdown?: Promise<void>;
  constructor(private readonly dependencies: {
    launch?: (route: QianchuanEgress) => TunnelChild;
    probe?: typeof probeEgressIp;
    portFree?: typeof portFree;
  } = {}) {}
  private revoke(tunnel: Tunnel, kind: "hard" | "transient-probe-exhausted" = "hard"): void {
    if (kind === "hard" || !tunnel.controller.signal.aborted && tunnel.failureKind === undefined) tunnel.failureKind = kind;
    tunnel.controller.abort(failure());
  }
  private stop(tunnel: Tunnel): void {
    this.revoke(tunnel);
    const current = this.tunnels.get(tunnel.route.group);
    if (current?.transport === tunnel.transport) this.revoke(current);
    if (tunnel.transport.stopped) return;
    tunnel.transport.stopped = true;
    try { tunnel.transport.child?.kill("SIGTERM"); } catch { /* never escalate beyond the owned SIGTERM */ }
  }
  private unexpectedChildEnd(tunnel: Tunnel): void {
    const { transport } = tunnel;
    if (transport.stopped) return;
    const current = this.tunnels.get(tunnel.route.group);
    const revoked = current?.transport === transport ? current : tunnel;
    // An earlier hard failure is not cleared by a later transport exit.
    const mayRecover = !revoked.controller.signal.aborted;
    transport.unexpectedlyLost = mayRecover;
    transport.stopped = true;
    transport.deadline ??= Date.now() + CONNECTION_DEADLINE_MS;
    const child = transport.child;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGTERM"); } catch { /* only signal the owned SSH child */ }
      transport.termination = this.waitForOwnedChildExit(child);
    }
    this.revoke(revoked);
    if (mayRecover && !this.disposed && this.tunnels.get(revoked.route.group) === revoked) {
      void this.recoverUnexpectedChild(revoked).catch(() => {});
    }
  }
  private createTunnel(route: QianchuanEgress, transport: Transport = { stopped: false, unexpectedlyLost: false }, recoveryAttempts = 1): Tunnel {
    const controller = new AbortController();
    return { route, controller, transport, recoveryAttempts, attested: false,
      lease: Object.freeze({ identity: egressIdentity(route), signal: controller.signal }) };
  }
  async ensure(input: QianchuanEgress): Promise<EgressLease> {
    if (this.disposed) throw failure();
    const route = QianchuanEgressSchema.parse(input), identity = egressIdentity(route);
    let tunnel = this.tunnels.get(route.group);
    if (tunnel) {
      if (tunnel.lease.identity !== identity) throw failure();
      if (tunnel.recovery) return tunnel.recovery;
      if (tunnel.controller.signal.aborted) {
        if (tunnel.failureKind === "transient-probe-exhausted") return this.renewAfterTransientProbeFailure(tunnel);
        if (!tunnel.transport.unexpectedlyLost) throw failure();
        return this.recoverUnexpectedChild(tunnel);
      }
    } else {
      if ([...this.tunnels.values()].some(value => value.route.localPort === route.localPort)) throw failure();
      tunnel = this.createTunnel(route);
      this.tunnels.set(route.group, tunnel);
    }
    try { return await (tunnel.ready ??= this.connect(tunnel)); }
    catch (error) {
      if (!tunnel.transport.unexpectedlyLost || this.tunnels.get(route.group) !== tunnel || this.disposed) throw error;
      return this.recoverUnexpectedChild(tunnel);
    }
  }
  private async connect(tunnel: Tunnel): Promise<EgressLease> {
    return this.withinDeadline(tunnel, async signal => {
      const { route, transport } = tunnel;
      if (!transport.child) {
        try {
          const available = await (this.dependencies.portFree ?? portFree)(route.localPort);
          signal.throwIfAborted();
          if (!available) {
            // No child or lease was acquired. Refuse this listener, but let a
            // later ensure check again after its independent owner releases it.
            if (!transport.child && !transport.stopped && this.tunnels.get(route.group) === tunnel) this.tunnels.delete(route.group);
            throw Object.assign(new Error("固定出口本地端口已被占用，未复用未知代理；下次连接会重新检查。"), { code: PORT_BUSY_CODE });
          }
          transport.child = this.dependencies.launch ? this.dependencies.launch(route) : spawn("/usr/bin/ssh", sshEgressArguments(route), { stdio: "ignore" });
          // These callbacks own the transport, including any later lease generation.
          transport.child.once("error", () => this.unexpectedChildEnd(tunnel));
          transport.child.once("exit", () => this.unexpectedChildEnd(tunnel));
          // This is bounded startup readiness, not a repeated SSH/provider invocation.
          if (!this.dependencies.launch) await waitForEgressListener(route.localPort, signal);
        } catch (error) {
          if (error instanceof Error && (error as Error & { code?: unknown }).code === PORT_BUSY_CODE) throw error;
          this.stop(tunnel); throw failure();
        }
      }
      await this.verifyTunnelWithRetries(tunnel, signal);
      tunnel.attested = true;
      tunnel.recoveryAttempts = 0;
      return tunnel.lease;
    });
  }
  private withinDeadline<T>(tunnel: Tunnel, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const { transport, controller } = tunnel;
    transport.deadline ??= Date.now() + CONNECTION_DEADLINE_MS;
    const deadline = transport.deadline, remaining = deadline - Date.now();
    if (remaining <= 0) {
      this.revoke(tunnel);
      if (!transport.unexpectedlyLost) transport.deadline = undefined;
      return Promise.reject(failure());
    }
    const timer = setTimeout(() => this.revoke(tunnel), remaining);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => queueMicrotask(() => reject(tunnel.failureKind === "transient-probe-exhausted" ? transientProbeFailure() : failure()));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    let pending: Promise<T>;
    try { pending = Promise.resolve(operation(controller.signal)); }
    catch (error) { pending = Promise.reject(error); }
    return Promise.race([pending, aborted]).finally(() => {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      if (!transport.unexpectedlyLost && transport.deadline === deadline) transport.deadline = undefined;
    });
  }
  private async withinAbsoluteDeadline<T>(pending: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(failure()), remaining);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  private assertOwnedTransport(tunnel: Tunnel): void {
    const { child, stopped } = tunnel.transport;
    if (!child) throw failure();
    if (!stopped && (child.exitCode !== null || child.signalCode !== null)) this.unexpectedChildEnd(tunnel);
    if (tunnel.transport.stopped || child.exitCode !== null || child.signalCode !== null) throw failure();
  }
  private assert(tunnel: Tunnel): void {
    this.assertOwnedTransport(tunnel);
    if (tunnel.controller.signal.aborted) throw failure();
  }
  private renewAfterTransientProbeFailure(tunnel: Tunnel): Promise<EgressLease> {
    if (tunnel.recovery) return tunnel.recovery;
    let recovery!: Promise<EgressLease>;
    recovery = Promise.resolve().then(async () => {
      const previousOperations: Array<Promise<unknown>> = [];
      if (tunnel.ready) previousOperations.push(tunnel.ready);
      if (tunnel.verification) previousOperations.push(tunnel.verification);
      await Promise.all(previousOperations.map(operation => operation.then(() => undefined, () => undefined)));
      const identity = tunnel.lease.identity;
      if (this.disposed || this.tunnels.get(tunnel.route.group) !== tunnel || tunnel.failureKind !== "transient-probe-exhausted" ||
          !tunnel.controller.signal.aborted || egressIdentity(tunnel.route) !== identity || tunnel.transport.deadline !== undefined) throw failure();
      this.assertOwnedTransport(tunnel);
      if (this.tunnels.get(tunnel.route.group) !== tunnel || this.disposed || tunnel.failureKind !== "transient-probe-exhausted") throw failure();
      const next = this.createTunnel(tunnel.route, tunnel.transport, tunnel.recoveryAttempts);
      next.recovery = recovery;
      this.tunnels.set(next.route.group, next);
      return await (next.ready ??= this.connect(next));
    }).finally(() => {
      if (tunnel.recovery === recovery) tunnel.recovery = undefined;
      const current = this.tunnels.get(tunnel.route.group);
      if (current?.recovery === recovery) current.recovery = undefined;
    });
    tunnel.recovery = recovery;
    return recovery;
  }
  private verifyTunnel(tunnel: Tunnel): Promise<void> {
    if (tunnel.verification) return tunnel.verification;
    let verification!: Promise<void>;
    verification = this.withinDeadline(tunnel, signal => this.verifyTunnelWithRetries(tunnel, signal)).finally(() => {
      if (tunnel.verification === verification) tunnel.verification = undefined;
    });
    tunnel.verification = verification;
    return verification;
  }
  private async verifyTunnelWithRetries(tunnel: Tunnel, signal: AbortSignal): Promise<void> {
    this.assert(tunnel);
    for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt++) {
      let ip: string;
      try { ip = await (this.dependencies.probe ?? probeEgressIp)(tunnel.route, signal, attempt); }
      catch (error) {
        if (signal.aborted) throw failure();
        if (!(error instanceof TransientEgressProbeError)) {
          this.revoke(tunnel); throw failure();
        }
        this.assert(tunnel);
        const nextDelay = PROBE_RETRY_DELAYS[attempt] ?? 0;
        const deadline = tunnel.transport.deadline;
        const insufficientBudget = deadline !== undefined && deadline - Date.now() <= PROBE_REQUEST_TIMEOUT_MS + nextDelay;
        if (attempt === MAX_PROBE_ATTEMPTS - 1 || insufficientBudget) {
          this.revoke(tunnel, "transient-probe-exhausted"); throw transientProbeFailure();
        }
        try { await delay(PROBE_RETRY_DELAYS[attempt], undefined, { signal }); }
        catch { throw failure(); }
        this.assert(tunnel);
        continue;
      }
      if (!QianchuanEgressSchema.shape.expectedIp.safeParse(ip).success) { this.revoke(tunnel); throw failure(); }
      // A positive mismatch concerns this transport even if another check revoked its lease.
      if (ip !== tunnel.route.expectedIp) { this.stop(tunnel); throw failure(); }
      this.assert(tunnel);
      return;
    }
    this.revoke(tunnel);
    throw failure();
  }
  async verify(route: QianchuanEgress): Promise<EgressLease> {
    const checked = QianchuanEgressSchema.parse(route);
    const identity = egressIdentity(checked), tunnel = this.tunnels.get(checked.group);
    if (!tunnel) return this.ensure(checked);
    if (tunnel.lease.identity !== identity) throw failure();
    // A fresh verification waits for the owned network recovery. A verification
    // already in flight below remains bound to its captured, revoked tunnel.
    if (tunnel.recovery || tunnel.controller.signal.aborted) return this.ensure(checked);
    if (!tunnel.attested) return this.ensure(checked);
    await this.verifyTunnel(tunnel);
    return tunnel.lease;
  }
  /** Only called by an explicit browser restart after the existing task guard. */
  recover(route: QianchuanEgress): void {
    if (this.disposed) return;
    const tunnel = this.tunnels.get(route.group);
    if (!tunnel || tunnel.lease.identity !== egressIdentity(route) || !tunnel.controller.signal.aborted) return;
    const { child, stopped } = tunnel.transport;
    if (child && !stopped && child.exitCode === null && child.signalCode === null) {
      this.tunnels.set(route.group, this.createTunnel(tunnel.route, tunnel.transport));
    } else {
      this.stop(tunnel);
      this.tunnels.delete(route.group);
    }
  }
  retireUnused(routes: readonly QianchuanEgress[]): void {
    const retained = new Set(routes.map(egressIdentity));
    for (const [group, tunnel] of this.tunnels) if (!retained.has(tunnel.lease.identity)) { this.stop(tunnel); this.tunnels.delete(group); }
  }
  dispose(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.disposed = true;
    const children = [...new Set([...this.tunnels.values()].flatMap(tunnel => tunnel.transport.child ? [tunnel.transport.child] : []))];
    for (const tunnel of this.tunnels.values()) this.stop(tunnel);
    this.shutdown = Promise.all(children.map(child => this.waitForOwnedChildExit(child))).then(results => {
      if (results.some(exited => !exited)) throw new Error("固定出口 SSH 进程未在 5 秒内退出。");
    });
    return this.shutdown;
  }
  private async waitForOwnedChildExit(child: TunnelChild): Promise<boolean> {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise(resolve => {
      let finished = false;
      const finish = (exited: boolean) => {
        if (finished) return;
        finished = true; clearTimeout(timer); child.off("exit", onExit); child.off("close", onExit); resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(child.exitCode !== null || child.signalCode !== null), 5_000);
      child.once("exit", onExit); child.once("close", onExit);
    });
  }
  private recoverUnexpectedChild(tunnel: Tunnel): Promise<EgressLease> {
    if (tunnel.recovery) return tunnel.recovery;
    let recovery!: Promise<EgressLease>;
    recovery = Promise.resolve().then(() => this.restoreUnexpectedChild(tunnel, () => recovery)).then(lease => {
      const current = this.tunnels.get(tunnel.route.group);
      if (current?.recovery === recovery && current.lease === lease) current.recovery = undefined;
      return lease;
    }, error => {
      const current = this.tunnels.get(tunnel.route.group);
      const child = current?.transport.child;
      const transientExhaustion = error instanceof Error && (error as Error & { code?: unknown }).code === TRANSIENT_PROBE_UNAVAILABLE_CODE;
      if (transientExhaustion && tunnel.recovery === recovery && current?.recovery === recovery &&
          current.failureKind === "transient-probe-exhausted" && current.controller.signal.aborted &&
          current.lease.identity === egressIdentity(tunnel.route) && !this.disposed &&
          current.transport.deadline === undefined && !current.transport.stopped && !current.transport.unexpectedlyLost &&
          child && child.exitCode === null && child.signalCode === null) {
        tunnel.recovery = undefined;
        current.recovery = undefined;
      }
      throw error;
    });
    tunnel.recovery = recovery;
    return recovery;
  }
  private async restoreUnexpectedChild(failed: Tunnel, sharedRecovery: () => Promise<EgressLease>): Promise<EgressLease> {
    let current = failed;
    while (current.recoveryAttempts < MAX_OWNED_CHILD_RECOVERIES) {
      const deadline = current.transport.deadline;
      if (!deadline || deadline <= Date.now()) throw failure();
      const recoveryAttempts = current.recoveryAttempts + 1;
      try { await delay(Math.min(PROBE_RETRY_DELAYS[Math.min(recoveryAttempts - 1, PROBE_RETRY_DELAYS.length - 1)], deadline - Date.now())); }
      catch { throw failure(); }
      if (Date.now() >= deadline || this.disposed || this.tunnels.get(current.route.group) !== current || !current.transport.unexpectedlyLost) throw failure();
      const priorChildExited = current.transport.termination ?? (current.transport.child ? this.waitForOwnedChildExit(current.transport.child) : Promise.resolve(true));
      if (!await this.withinAbsoluteDeadline(priorChildExited, deadline)) throw failure();
      if (Date.now() >= deadline || this.disposed || this.tunnels.get(current.route.group) !== current || !current.transport.unexpectedlyLost) throw failure();
      if ([...this.tunnels.values()].some(value => value.route.group !== current.route.group && value.route.localPort === current.route.localPort)) throw failure();
      const next = this.createTunnel(current.route, { stopped: false, unexpectedlyLost: false, deadline: current.transport.deadline }, recoveryAttempts);
      next.recovery = sharedRecovery();
      this.tunnels.set(next.route.group, next);
      try { return await (next.ready ??= this.connect(next)); }
      catch (error) {
        if (!next.transport.unexpectedlyLost || recoveryAttempts >= MAX_OWNED_CHILD_RECOVERIES || this.disposed || this.tunnels.get(next.route.group) !== next) throw error;
        current = next;
      }
    }
    throw failure();
  }
}
// A dev rebuild replaces Electron, but its launcher and original Chrome survive.
// A missing/disconnected opted-in IPC owner must fail closed, never create another tunnel.
export const qianchuanEgressRuntime = process.env.JIANJI_DEV_EGRESS === "1"
  ? new DevelopmentEgressClient({ on: process.on.bind(process), off: process.off.bind(process),
    get connected() { return process.connected; }, send: (message, callback) => {
      if (!process.send) throw failure();
      return process.send(message, callback);
    } })
  : new QianchuanEgressRuntime();
process.once("exit", () => qianchuanEgressRuntime.dispose());
