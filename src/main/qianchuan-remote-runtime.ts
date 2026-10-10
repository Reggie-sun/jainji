import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { egressIdentity, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { REMOTE_CHUNK_BYTES, RemoteBrowserSchema, RemoteFileStatusSchema } from "../shared/qianchuan-remote.js";
import { RemoteChannel, remoteUnavailable, sshRemoteArguments } from "./qianchuan-remote-transport.js";
import { waitForEgressListener, type EgressLease } from "./qianchuan-egress-runtime.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";

type RemoteBrowser = { route: QianchuanEgress; advertiserId: string; endpoint: string; browserPath: string; remotePort: number; child: ChildProcess; controller: AbortController };
type Channel = Pick<RemoteChannel, "route" | "controller" | "request" | "close">;
async function freePort(preferred = 0): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(remoteUnavailable()); return; }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

/** Transport/lifecycle only. The existing local service and store remain sole task authority. */
export class QianchuanRemoteRuntime {
  private readonly channels = new Map<string, Channel>();
  private readonly browsers = new Map<string, RemoteBrowser>();
  private readonly preparing = new Map<string, Promise<string>>();
  constructor(private readonly createChannel: (route: QianchuanEgress) => Channel = route => new RemoteChannel(route)) {}
  private channel(route: QianchuanEgress): Channel {
    if (route.mode !== "remote-browser") throw remoteUnavailable();
    let channel = this.channels.get(route.group);
    if (channel && (egressIdentity(channel.route) !== egressIdentity(route) || channel.controller.signal.aborted)) throw remoteUnavailable();
    if (!channel) { channel = this.createChannel(route); this.channels.set(route.group, channel); }
    return channel;
  }
  private drop(browser: RemoteBrowser): void { browser.controller.abort(remoteUnavailable()); browser.child.kill("SIGTERM"); }
  private async stopTunnel(browser: RemoteBrowser): Promise<void> {
    if (browser.child.exitCode !== null || browser.child.signalCode !== null) { this.drop(browser); return; }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { browser.child.removeListener("exit", done); reject(remoteUnavailable()); }, 5000);
      const done = () => { clearTimeout(timer); resolve(); };
      browser.child.once("exit", done); this.drop(browser);
    });
  }
  async assertClosed(route: QianchuanEgress, advertiserId: string): Promise<void> {
    if (this.preparing.has(advertiserId)) throw remoteUnavailable();
    await this.channel(route).request("assert-closed", advertiserId);
  }
  private async desktop(route: QianchuanEgress, advertiserId: string, endpoint: string, displayName?: string): Promise<string> {
    if (displayName !== undefined) await this.channel(route).request("desktop-sync", advertiserId, { displayName });
    return endpoint;
  }
  open(route: QianchuanEgress, advertiserId: string, existingOnly = false, displayName?: string): Promise<string> {
    const pending = this.preparing.get(advertiserId);
    if (pending) return pending.then(endpoint => this.desktop(route, advertiserId, endpoint, existingOnly ? undefined : displayName));
    const work = this.prepare(route, advertiserId, existingOnly).then(endpoint => this.desktop(route, advertiserId, endpoint, existingOnly ? undefined : displayName)).finally(() => this.preparing.delete(advertiserId));
    this.preparing.set(advertiserId, work); return work;
  }
  private async prepare(route: QianchuanEgress, advertiserId: string, existingOnly: boolean, preferredPort?: number): Promise<string> {
    const channel = this.channel(route), old = this.browsers.get(advertiserId);
    if (old) { await this.verify(old.endpoint, route, advertiserId); return old.endpoint; }
    const info = RemoteBrowserSchema.parse(await channel.request(existingOnly ? "existing" : "open", advertiserId));
    const localPort = await freePort(preferredPort ?? ([...this.browsers.values()].some(value => value.route.group === route.group) ? 0 : route.localPort));
    channel.controller.signal.throwIfAborted();
    const base = sshRemoteArguments(route).slice(0, -2);
    const clear = base.indexOf("ClearAllForwardings=yes"); if (clear >= 1) base.splice(clear - 1, 2);
    const child = spawn("/usr/bin/ssh", [...base, "-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${info.port}`, route.sshHost], { stdio: "ignore" });
    const browser: RemoteBrowser = { route, advertiserId, endpoint: `http://127.0.0.1:${localPort}`, browserPath: info.browserPath, remotePort: info.port, child, controller: new AbortController() };
    this.browsers.set(advertiserId, browser);
    child.on("error", () => this.drop(browser)); child.on("exit", () => this.drop(browser));
    channel.controller.signal.addEventListener("abort", () => this.drop(browser), { once: true });
    try { await waitForEgressListener(localPort, browser.controller.signal); await this.verify(browser.endpoint, route, advertiserId); return browser.endpoint; }
    catch (error) { this.drop(browser); throw error; }
  }
  async verify(endpoint: string, route: QianchuanEgress, advertiserId?: string): Promise<EgressLease> {
    const matches = [...this.browsers.values()].filter(value => value.endpoint === endpoint && (!advertiserId || value.advertiserId === advertiserId));
    const browser = matches[0];
    if (matches.length !== 1 || egressIdentity(browser.route) !== egressIdentity(route)) throw remoteUnavailable();
    browser.controller.signal.throwIfAborted();
    try {
      const info = RemoteBrowserSchema.parse(await this.channel(route).request("probe", browser.advertiserId, {}, undefined, browser.controller.signal));
      if (info.port !== browser.remotePort || info.browserPath !== browser.browserPath) throw remoteUnavailable();
      const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal: AbortSignal.any([browser.controller.signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) throw remoteUnavailable();
      const value = await response.json() as { webSocketDebuggerUrl?: string };
      const socket = new URL(value.webSocketDebuggerUrl ?? "invalid");
      if (socket.protocol !== "ws:" || socket.host !== new URL(endpoint).host || socket.pathname !== browser.browserPath) throw remoteUnavailable();
      return { identity: egressIdentity(route), signal: browser.controller.signal };
    } catch { this.drop(browser); throw remoteUnavailable(); }
  }
  async stage(task: UploadTaskRecord, signal: AbortSignal): Promise<string> {
    const route = task.authorization.target.egress;
    if (route?.mode !== "remote-browser" || task.result.upload_outcome !== "NOT_SELECTED") throw remoteUnavailable();
    const lease = await this.verify(task.authorization.target.cdpEndpoint, route, task.authorization.target.advertiserId);
    const combined = AbortSignal.any([signal, lease.signal]);
    const file = { advertiserId: task.authorization.target.advertiserId, sha256: task.input.artifact_sha256, size: task.input.size_bytes, fileName: task.result.file_name };
    const channel = this.channel(route), handle = await open(task.snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== file.size || stat.mode & 0o7377 || stat.uid !== process.getuid?.()) throw remoteUnavailable();
      let status = RemoteFileStatusSchema.parse(await channel.request("file-status", file.advertiserId, { file }, undefined, combined));
      if (status.offset > file.size || status.complete && status.offset !== file.size) throw remoteUnavailable();
      while (!status.complete) {
        combined.throwIfAborted();
        const data = Buffer.alloc(Math.min(REMOTE_CHUNK_BYTES, file.size - status.offset));
        const { bytesRead } = await handle.read(data, 0, data.length, status.offset);
        if (!bytesRead) throw remoteUnavailable();
        const next = RemoteFileStatusSchema.parse(await channel.request("file-append", file.advertiserId, { file, offset: status.offset }, data.subarray(0, bytesRead), combined));
        if (next.offset !== status.offset + bytesRead || next.complete !== (next.offset === file.size)) throw remoteUnavailable();
        status = next;
      }
      if (!status.path.endsWith(`/${file.advertiserId}/${file.sha256}/${file.fileName}`)) throw remoteUnavailable();
      combined.throwIfAborted(); return status.path;
    } finally { await handle.close(); }
  }
  async control(route: QianchuanEgress, advertiserId: string, action: "close" | "restart", displayName?: string): Promise<void> {
    const channel = this.channels.get(route.group);
    if (channel?.controller.signal.aborted && egressIdentity(channel.route) === egressIdentity(route)) this.channels.delete(route.group);
    await this.channel(route).request("close", advertiserId);
    const old = this.browsers.get(advertiserId);
    if (old) { await this.stopTunnel(old); this.browsers.delete(advertiserId); }
    if (action === "restart") await this.open(route, advertiserId, false, displayName);
  }
  /** Explicit recovery reattaches only the same remote browser, never opens a replacement. */
  async reconnect(route: QianchuanEgress, advertiserId: string): Promise<void> {
    const channel = this.channels.get(route.group);
    if (channel && egressIdentity(channel.route) !== egressIdentity(route)) throw remoteUnavailable();
    if (channel?.controller.signal.aborted) this.channels.delete(route.group);
    const old = this.browsers.get(advertiserId);
    if (old) {
      const info = RemoteBrowserSchema.parse(await this.channel(route).request("probe", advertiserId));
      if (info.browserPath !== old.browserPath || info.port !== old.remotePort) throw remoteUnavailable();
      if (!old.controller.signal.aborted) { await this.verify(old.endpoint, route, advertiserId); return; }
      await this.stopTunnel(old);
      this.browsers.delete(advertiserId);
      const endpoint = await this.prepare(route, advertiserId, true, Number(new URL(old.endpoint).port));
      if (endpoint !== old.endpoint || this.browsers.get(advertiserId)?.browserPath !== old.browserPath) throw remoteUnavailable();
      return;
    }
    await this.open(route, advertiserId, true);
  }
  retireUnused(routes: readonly QianchuanEgress[]): void {
    const retained = new Set(routes.filter(route => route.mode === "remote-browser").map(egressIdentity));
    for (const [id, browser] of this.browsers) if (!retained.has(egressIdentity(browser.route))) { this.drop(browser); this.browsers.delete(id); }
    for (const [group, channel] of this.channels) if (!retained.has(egressIdentity(channel.route))) { channel.close(); this.channels.delete(group); }
  }
  dispose(): void { for (const browser of this.browsers.values()) this.drop(browser); for (const channel of this.channels.values()) channel.close(); }
}
export const qianchuanRemoteRuntime = new QianchuanRemoteRuntime();
process.once("exit", () => qianchuanRemoteRuntime.dispose());
