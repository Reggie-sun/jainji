import { createServer, type Server, type Socket } from "node:net";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ExtensionHelloSchema, EXTENSION_MESSAGE_BYTES, extensionChanged, extensionUnavailable, type ExtensionCall, type ExtensionProcess } from "./qianchuan-extension-protocol.js";
import { verifyExtensionProcess } from "./qianchuan-extension-process.js";
import { installQianchuanExtensionHost, registerQianchuanExtensionProfile } from "./qianchuan-extension-install.js";
import { QIANCHUAN_EXTENSION_ORIGIN } from "./qianchuan-extension-protocol.js";

interface BridgeConnection { id: string; process: ExtensionProcess; start: string; socket: Socket; route: string; call: ExtensionCall; }
interface Route { token: string; verify: (identity: ExtensionProcess) => Promise<string>; }
/** Private native-host capability plus live OS profile identity. No HTTP server, platform credential or renderer API. */
export class QianchuanExtensionBridge {
  private server?: Server;
  private starting?: Promise<number>;
  private readonly connections = new Set<BridgeConnection>();
  private readonly sockets = new Set<Socket>();
  private readonly routes = new Map<string, Route>();
  private readonly blocked = new Set<string>();
  private readonly profiles = new Map<string, Promise<void>>();
  private readonly localToken = randomBytes(32).toString("base64url");
  constructor(private readonly root: string, localVerify = verifyExtensionProcess, private readonly install = installQianchuanExtensionHost) {
    this.routes.set("local", { token: this.localToken, verify: localVerify });
  }
  start(): Promise<number> {
    if (this.starting) return this.starting;
    this.starting = new Promise<number>((resolve, reject) => {
      const server = createServer(socket => this.accept(socket)); this.server = server;
      server.once("error", () => { this.dispose(); reject(extensionUnavailable()); });
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        if (!address || typeof address === "string") { reject(extensionUnavailable()); return; }
        try { await this.install(this.root, { version: 1, port: address.port, token: this.localToken, extensionOrigin: QIANCHUAN_EXTENSION_ORIGIN }); server.unref(); resolve(address.port); }
        catch { this.dispose(); reject(extensionUnavailable()); }
      });
    });
    return this.starting;
  }
  async remoteRoute(key: string, verify: Route["verify"]): Promise<{ port: number; token: string }> {
    const port = await this.start();
    if (!this.routes.has(key)) this.routes.set(key, { token: randomBytes(32).toString("base64url"), verify });
    return { port, token: this.routes.get(key)!.token };
  }
  private accept(socket: Socket): void {
    if (this.sockets.size >= 32 || socket.remoteAddress !== "127.0.0.1") { socket.destroy(); return; }
    this.sockets.add(socket); socket.unref();
    let buffer = Buffer.alloc(0), connection: BridgeConnection | undefined, authenticating = false;
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const helloTimer = setTimeout(() => socket.destroy(), 5000); helloTimer.unref();
    const close = () => { clearTimeout(helloTimer); this.sockets.delete(socket); if (connection) { this.connections.delete(connection); if (pending.size) this.blocked.add(JSON.stringify([connection.route, connection.process.profile, connection.process.profileDirectory, connection.start])); } for (const item of pending.values()) item.reject(extensionUnavailable()); pending.clear(); socket.destroy(); };
    socket.on("error", close); socket.on("close", close);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > EXTENSION_MESSAGE_BYTES) { close(); return; }
      for (;;) {
        const end = buffer.indexOf(10); if (end < 0) break;
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        let value: any;
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); } catch { close(); return; }
        if (!connection) {
          if (authenticating) { close(); return; } authenticating = true;
          void (async () => {
            try {
              const hello = ExtensionHelloSchema.parse(value);
              const routes = [...this.routes].filter(([, route]) => { const left = Buffer.from(hello.token), right = Buffer.from(route.token); return left.length === right.length && timingSafeEqual(left, right); });
              if (routes.length !== 1) throw extensionUnavailable();
              const [routeKey, route] = routes[0], identity = { pid: hello.pid, profile: hello.profile, profileDirectory: hello.profileDirectory };
              const start = await route.verify(identity);
              const processKey = JSON.stringify([routeKey, identity.profile, identity.profileDirectory, start]);
              if (this.blocked.has(processKey)) throw extensionUnavailable();
              if (socket.destroyed) return;
              const call: ExtensionCall = async (operation, signal) => {
                signal?.throwIfAborted();
                if (socket.destroyed || await route.verify(identity) !== start) throw extensionChanged();
                signal?.throwIfAborted();
                if (pending.size >= 64) throw extensionUnavailable();
                const id = randomUUID(), combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
                return new Promise((resolve, reject) => {
                  let cancelled = false, cleanupTimer: ReturnType<typeof setTimeout> | undefined;
                  const cleanup = () => { combined.removeEventListener("abort", aborted); clearTimeout(cleanupTimer); };
                  const aborted = () => {
                    if (cancelled) return; cancelled = true;
                    socket.write(JSON.stringify({ kind: "cancel", id }) + "\n", error => { if (error) close(); });
                    cleanupTimer = setTimeout(() => { this.blocked.add(processKey); close(); }, 5000);
                  };
                  combined.addEventListener("abort", aborted, { once: true });
                  pending.set(id, { resolve: result => { cleanup(); cancelled ? reject(extensionUnavailable()) : resolve(result); }, reject: error => { cleanup(); reject(error); } });
                  const message = Buffer.from(JSON.stringify({ kind: "command", id, operation }) + "\n");
                  if (message.length > EXTENSION_MESSAGE_BYTES) { close(); return; }
                  socket.write(message, error => { if (error) close(); });
                  if (combined.aborted) aborted();
                });
              };
              connection = { id: randomUUID(), process: identity, start, socket, route: routeKey, call }; this.connections.add(connection); clearTimeout(helloTimer);
            } catch { close(); }
          })();
        } else {
          const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
          if (value?.kind !== "result" || typeof value.id !== "string" || typeof value.ok !== "boolean" || keys.length !== 4 || keys.some(key => !["kind", "id", "ok", value.ok ? "value" : "error"].includes(key))) { close(); return; }
          const item = pending.get(value.id); if (!item) { close(); return; } pending.delete(value.id);
          if (value.ok) item.resolve(value.value); else item.reject(value.error === "CHANGED" ? extensionChanged() : extensionUnavailable());
        }
      }
    });
  }
  async connection(route: string, profile: string, profileDirectory: string): Promise<{ id: string; call: ExtensionCall; process: ExtensionProcess }> {
    await this.start();
    const matches = [...this.connections].filter(value => value.route === route && value.process.profile === profile && value.process.profileDirectory === profileDirectory && !value.socket.destroyed);
    if (matches.length !== 1) throw extensionUnavailable();
    const found = matches[0], verifier = this.routes.get(route);
    if (!verifier || await verifier.verify(found.process) !== found.start) throw extensionChanged();
    return { id: found.id, call: found.call, process: structuredClone(found.process) };
  }
  async registerProfile(profile: string): Promise<void> {
    await this.start();
    if (!this.profiles.has(profile)) this.profiles.set(profile, registerQianchuanExtensionProfile(this.root, profile).catch(error => { this.profiles.delete(profile); throw error; }));
    await this.profiles.get(profile);
  }
  dispose(): void { for (const socket of this.sockets) socket.destroy(); this.connections.clear(); this.server?.close(); this.server = undefined; }
}
