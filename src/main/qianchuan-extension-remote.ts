import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { egressIdentity, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { RemoteExtensionProfileSchema } from "../shared/qianchuan-remote.js";
import { qianchuanRemoteRuntime } from "./qianchuan-remote-runtime.js";
import { sshRemoteArguments } from "./qianchuan-remote-transport.js";
import { extensionUnavailable } from "./qianchuan-extension-protocol.js";
import { QianchuanExtensionBridge } from "./qianchuan-extension-bridge.js";

interface Tunnel { route: QianchuanEgress; port: number; child: ChildProcess; controller: AbortController; }
/** Only owned SSH reverse forwards; local and VPS native hosts share the same narrow bridge. */
export class QianchuanExtensionRemote {
  private readonly tunnels = new Map<string, Promise<Tunnel>>();
  private readonly owned = new Set<Tunnel>();
  private readonly anchors = new Map<string, string>();
  constructor(private readonly bridge: QianchuanExtensionBridge, private readonly runtime = qianchuanRemoteRuntime,
    private readonly launch = (args: string[]) => spawn("/usr/bin/ssh", args, { stdio: "ignore" })) {}
  private async tunnel(route: QianchuanEgress, advertiserId: string): Promise<Tunnel> {
    const key = egressIdentity(route);
    let pending = this.tunnels.get(key);
    if (!pending) {
      pending = (async () => {
        const native = await this.bridge.remoteRoute(key, async identity => {
          const anchor = this.anchors.get(JSON.stringify([key, identity.profile, identity.profileDirectory]));
          if (!anchor) throw extensionUnavailable();
          const result = await this.runtime.extensionRequest(route, anchor, "extension-verify", { extensionProcess: identity });
          return z.object({ startedAt: z.string().regex(/^[0-9]+$/) }).strict().parse(result).startedAt;
        });
        const result = await this.runtime.extensionRequest(route, advertiserId, "extension-setup", { extension: { port: 0, token: native.token } });
        const { port } = z.object({ port: z.number().int().min(1).max(65535) }).strict().parse(result);
        const args = sshRemoteArguments(route).slice(0, -2), clear = args.indexOf("ClearAllForwardings=yes");
        if (clear < 1) throw extensionUnavailable(); args.splice(clear - 1, 2);
        const child = this.launch([...args, "-N", "-o", "ExitOnForwardFailure=yes", "-R", `127.0.0.1:${port}:127.0.0.1:${native.port}`, route.sshHost]);
        const tunnel = { route, port, child, controller: new AbortController() }; this.owned.add(tunnel);
        child.once("error", () => tunnel.controller.abort()); child.once("exit", () => tunnel.controller.abort());
        child.unref(); return tunnel;
      })();
      this.tunnels.set(key, pending);
    }
    const tunnel = await pending; tunnel.controller.signal.throwIfAborted(); return tunnel;
  }
  async prepare(route: QianchuanEgress, advertiserId: string, signal: AbortSignal, configuredEndpoint = `http://127.0.0.1:${route.localPort}`): Promise<{ route: string; profile: string; profileDirectory: string; endpoint: string; uploadEndpointVerified: boolean }> {
    signal.throwIfAborted();
    const tunnel = await this.tunnel(route, advertiserId);
    const profile = RemoteExtensionProfileSchema.parse(await this.runtime.extensionRequest(route, advertiserId, "extension-profile", {}, signal));
    // Route authentication is subject-wide; bind each profile to its own canonical browser anchor on every command.
    const key = egressIdentity(route);
    const profileKey = JSON.stringify([key, profile.profile, profile.profileDirectory]), old = this.anchors.get(profileKey);
    if (old && old !== advertiserId) throw extensionUnavailable();
    this.anchors.set(profileKey, advertiserId);
    signal.throwIfAborted(); tunnel.controller.signal.throwIfAborted();
    return { route: key, profile: profile.profile, profileDirectory: profile.profileDirectory, uploadEndpointVerified: !!profile.browser,
      endpoint: profile.browser ? await this.runtime.attachMetadata(route, advertiserId, profile.browser) : configuredEndpoint };
  }
  async reset(route: QianchuanEgress): Promise<void> {
    const key = egressIdentity(route), pending = this.tunnels.get(key);
    if (!pending) return;
    let tunnel: Tunnel;
    try { tunnel = await pending; } catch { this.tunnels.delete(key); return; }
    if (tunnel.child.exitCode === null && tunnel.child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { tunnel.child.removeListener("exit", done); reject(extensionUnavailable()); }, 5000);
        tunnel.child.once("exit", done); tunnel.controller.abort(); tunnel.child.kill("SIGTERM");
      });
    }
    this.tunnels.delete(key); this.owned.delete(tunnel);
  }
  dispose(): void { for (const tunnel of this.owned) { tunnel.controller.abort(); tunnel.child.kill("SIGTERM"); } this.owned.clear(); }
}
