import { execFile, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { EventEmitter } from "node:events";
import { egressIdentity, QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress.js";

const execute = promisify(execFile);
const failure = () => new Error("固定出口连接或 IP 校验失败，已停止自动化且不会直连。请检查 VPS、SSH 密钥与主机指纹，然后明确重连。");
interface TunnelChild extends EventEmitter { kill(signal?: NodeJS.Signals): boolean; exitCode: number | null; signalCode: string | null; }
export interface EgressLease { readonly identity: string; readonly signal: AbortSignal; }
type Tunnel = { route: QianchuanEgress; controller: AbortController; child?: TunnelChild; lease: EgressLease; ready: Promise<EgressLease>; };

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
      "--max-filesize", "64", "--noproxy", "", "--proxy", `socks5h://127.0.0.1:${route.localPort}`, "https://api.ipify.org"],
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
  private fail(tunnel: Tunnel): void {
    if (tunnel.controller.signal.aborted) return;
    tunnel.controller.abort(failure()); tunnel.child?.kill("SIGTERM");
  }
  async ensure(input: QianchuanEgress): Promise<EgressLease> {
    const route = QianchuanEgressSchema.parse(input), identity = egressIdentity(route);
    const existing = this.tunnels.get(route.group);
    if (existing) {
      if (existing.lease.identity !== identity || existing.controller.signal.aborted) throw failure();
      return existing.ready;
    }
    if ([...this.tunnels.values()].some(value => value.route.localPort === route.localPort)) throw failure();
    const controller = new AbortController();
    const tunnel: Tunnel = { route, controller, lease: Object.freeze({ identity, signal: controller.signal }), ready: undefined! };
    this.tunnels.set(route.group, tunnel);
    tunnel.ready = (async () => {
      try {
        if (!await (this.dependencies.portFree ?? portFree)(route.localPort)) throw new Error("固定出口本地端口已被占用，未复用未知代理。请核查后重连。");
        controller.signal.throwIfAborted();
        tunnel.child = this.dependencies.launch ? this.dependencies.launch(route) : spawn("/usr/bin/ssh", sshEgressArguments(route), { stdio: "ignore" });
        tunnel.child.once("error", () => this.fail(tunnel));
        tunnel.child.once("exit", () => this.fail(tunnel));
        // This is bounded startup readiness, not a repeated SSH/provider invocation.
        if (!this.dependencies.launch) await waitForEgressListener(route.localPort, controller.signal);
        this.assert(tunnel);
        await this.verifyTunnel(tunnel);
        return tunnel.lease;
      } catch (error) { this.fail(tunnel); throw error instanceof Error && error.message.includes("端口") ? error : failure(); }
    })();
    return tunnel.ready;
  }
  private assert(tunnel: Tunnel): void {
    if (tunnel.controller.signal.aborted || !tunnel.child || tunnel.child.exitCode !== null || tunnel.child.signalCode !== null) throw failure();
  }
  private async verifyTunnel(tunnel: Tunnel): Promise<void> {
    try {
      this.assert(tunnel);
      const ip = await (this.dependencies.probe ?? probeEgressIp)(tunnel.route, tunnel.controller.signal);
      this.assert(tunnel);
      if (ip !== tunnel.route.expectedIp) throw failure();
    } catch { this.fail(tunnel); throw failure(); }
  }
  async verify(route: QianchuanEgress): Promise<EgressLease> {
    const tunnel = this.tunnels.get(route.group);
    if (!tunnel || tunnel.lease.identity !== egressIdentity(route)) throw failure();
    await tunnel.ready;
    await this.verifyTunnel(tunnel);
    return tunnel.lease;
  }
  /** Only called by an explicit browser restart after the existing task guard. */
  recover(route: QianchuanEgress): void {
    const tunnel = this.tunnels.get(route.group);
    if (tunnel && tunnel.lease.identity === egressIdentity(route) && tunnel.controller.signal.aborted) this.tunnels.delete(route.group);
  }
  retireUnused(routes: readonly QianchuanEgress[]): void {
    const retained = new Set(routes.map(egressIdentity));
    for (const [group, tunnel] of this.tunnels) if (!retained.has(tunnel.lease.identity)) { this.fail(tunnel); this.tunnels.delete(group); }
  }
  dispose(): void { for (const tunnel of this.tunnels.values()) this.fail(tunnel); }
}
export const qianchuanEgressRuntime = new QianchuanEgressRuntime();
process.once("exit", () => qianchuanEgressRuntime.dispose());
