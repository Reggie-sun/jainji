import { execFile, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { EventEmitter } from "node:events";
import { egressIdentity, QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { DevelopmentEgressClient } from "./qianchuan-egress-development.js";
export { DevelopmentEgressHost } from "./qianchuan-egress-development.js";

const execute = promisify(execFile);
const failure = () => new Error("固定出口连接或 IP 校验失败，已停止自动化且不会直连。请检查 VPS、SSH 密钥与主机指纹，然后明确重连。");
interface TunnelChild extends EventEmitter { kill(signal?: NodeJS.Signals): boolean; exitCode: number | null; signalCode: string | null; }
export interface EgressLease { readonly identity: string; readonly signal: AbortSignal; }
type Transport = { child?: TunnelChild; stopped: boolean; };
type Tunnel = { route: QianchuanEgress; controller: AbortController; transport: Transport; lease: EgressLease; ready?: Promise<EgressLease>; };

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
export async function probeEgressIp(route: QianchuanEgress, signal: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execute("/usr/bin/curl", ["--disable", "--silent", "--show-error", "--fail", "--proto", "=https", "--max-time", "10",
      "--max-filesize", "64", "--noproxy", "", "--proxy", `socks5h://127.0.0.1:${route.localPort}`, "https://checkip.amazonaws.com"],
    { signal, timeout: 12_000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
    const ip = stdout.trim();
    if (!QianchuanEgressSchema.shape.expectedIp.safeParse(ip).success) throw failure();
    return ip;
  } catch { throw failure(); }
}

/** One process owns its tunnels. Failed entries stay failed until explicit user recovery. */
export class QianchuanEgressRuntime {
  private readonly tunnels = new Map<string, Tunnel>();
  constructor(private readonly dependencies: {
    launch?: (route: QianchuanEgress) => TunnelChild;
    probe?: typeof probeEgressIp;
    portFree?: typeof portFree;
  } = {}) {}
  private revoke(tunnel: Tunnel): void {
    tunnel.controller.abort(failure());
  }
  private stop(tunnel: Tunnel): void {
    this.revoke(tunnel);
    const current = this.tunnels.get(tunnel.route.group);
    if (current?.transport === tunnel.transport) this.revoke(current);
    if (tunnel.transport.stopped) return;
    tunnel.transport.stopped = true;
    tunnel.transport.child?.kill("SIGTERM");
  }
  private createTunnel(route: QianchuanEgress, transport: Transport = { stopped: false }): Tunnel {
    const controller = new AbortController();
    return { route, controller, transport, lease: Object.freeze({ identity: egressIdentity(route), signal: controller.signal }) };
  }
  async ensure(input: QianchuanEgress): Promise<EgressLease> {
    const route = QianchuanEgressSchema.parse(input), identity = egressIdentity(route);
    let tunnel = this.tunnels.get(route.group);
    if (tunnel) {
      if (tunnel.lease.identity !== identity || tunnel.controller.signal.aborted) throw failure();
    } else {
      if ([...this.tunnels.values()].some(value => value.route.localPort === route.localPort)) throw failure();
      tunnel = this.createTunnel(route);
      this.tunnels.set(route.group, tunnel);
    }
    tunnel.ready ??= this.connect(tunnel);
    return tunnel.ready;
  }
  private async connect(tunnel: Tunnel): Promise<EgressLease> {
    const { route, controller, transport } = tunnel;
    if (!transport.child) {
      try {
        if (!await (this.dependencies.portFree ?? portFree)(route.localPort)) throw new Error("固定出口本地端口已被占用，未复用未知代理。请核查后重连。");
        controller.signal.throwIfAborted();
        transport.child = this.dependencies.launch ? this.dependencies.launch(route) : spawn("/usr/bin/ssh", sshEgressArguments(route), { stdio: "ignore" });
        // These callbacks own the transport, including any later lease generation.
        transport.child.once("error", () => this.stop(tunnel));
        transport.child.once("exit", () => this.stop(tunnel));
        // This is bounded startup readiness, not a repeated SSH/provider invocation.
        if (!this.dependencies.launch) await waitForEgressListener(route.localPort, controller.signal);
      } catch (error) { this.stop(tunnel); throw error instanceof Error && error.message.includes("端口") ? error : failure(); }
    }
    await this.verifyTunnel(tunnel);
    return tunnel.lease;
  }
  private assert(tunnel: Tunnel): void {
    const { child, stopped } = tunnel.transport;
    if (!child || stopped || child.exitCode !== null || child.signalCode !== null) { this.stop(tunnel); throw failure(); }
    if (tunnel.controller.signal.aborted) throw failure();
  }
  private async verifyTunnel(tunnel: Tunnel): Promise<void> {
    this.assert(tunnel);
    let ip: string;
    try {
      ip = await (this.dependencies.probe ?? probeEgressIp)(tunnel.route, tunnel.controller.signal);
      if (!QianchuanEgressSchema.shape.expectedIp.safeParse(ip).success) throw failure();
    } catch { this.revoke(tunnel); throw failure(); }
    // A positive mismatch concerns this transport even if another check revoked its lease.
    if (ip !== tunnel.route.expectedIp) { this.stop(tunnel); throw failure(); }
    this.assert(tunnel);
  }
  async verify(route: QianchuanEgress): Promise<EgressLease> {
    const tunnel = this.tunnels.get(route.group);
    if (!tunnel || tunnel.lease.identity !== egressIdentity(route)) throw failure();
    await this.ensure(route);
    await this.verifyTunnel(tunnel);
    return tunnel.lease;
  }
  /** Only called by an explicit browser restart after the existing task guard. */
  recover(route: QianchuanEgress): void {
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
  dispose(): void { for (const tunnel of this.tunnels.values()) this.stop(tunnel); }
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
