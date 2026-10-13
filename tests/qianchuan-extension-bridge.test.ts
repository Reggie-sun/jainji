import { afterEach, describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { QianchuanExtensionBridge } from "../src/main/qianchuan-extension-bridge";

const bridges: QianchuanExtensionBridge[] = [], sockets: Socket[] = [];
afterEach(() => { sockets.splice(0).forEach(socket => socket.destroy()); bridges.splice(0).forEach(bridge => bridge.dispose()); });
async function fixture() {
  let config: any, start = "123";
  const bridge = new QianchuanExtensionBridge("/unused", async () => start, async (_root, value) => { config = value; }); bridges.push(bridge);
  const port = await bridge.start(), socket = connect(port, "127.0.0.1"); sockets.push(socket);
  await new Promise<void>(resolve => socket.once("connect", resolve));
  return { bridge, socket, config, setStart: (value: string) => { start = value; } };
}
const identity = { pid: 42, profile: "/owned/profile", profileDirectory: "Default" };
async function hello(f: Awaited<ReturnType<typeof fixture>>, token = f.config.token) {
  f.socket.write(JSON.stringify({ kind: "hello", version: 1, token, ...identity }) + "\n"); await delay(10);
}
describe("native extension bridge", () => {
  it("allows an explicit refresh to register a future account after its profile is created", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qianchuan-profile-registration-"));
    const profile = path.join(root, "future-account");
    const bridge = new QianchuanExtensionBridge(root, async () => "123", async () => undefined); bridges.push(bridge);
    try {
      await expect(bridge.registerProfile(profile)).rejects.toMatchObject({ code: "ENOENT" });
      await mkdir(profile, { mode: 0o700 });
      await expect(bridge.registerProfile(profile)).resolves.toBeUndefined();
      const manifest = JSON.parse(await readFile(path.join(profile, "NativeMessagingHosts", "com.jianji.qianchuan.json"), "utf8"));
      expect(manifest.path).toBe(path.join(root, "qianchuan-extension", "native-host"));
    } finally { bridge.dispose(); await rm(root, { recursive: true, force: true }); }
  });
  it("binds OS profile metadata and a private capability, then correlates replies", async () => {
    const f = await fixture(); await hello(f);
    f.socket.on("data", chunk => { const cmd = JSON.parse(chunk.toString()); f.socket.write(JSON.stringify({ kind: "result", id: cmd.id, ok: true, value: { tabId: 1, documentId: randomUUID() } }) + "\n"); });
    const connection = await f.bridge.connection("local", identity.profile, "Default");
    expect(await connection.call({ kind: "identity" })).toMatchObject({ tabId: 1 });
    f.setStart("456"); await expect(connection.call({ kind: "identity" })).rejects.toThrow("已变化");
  });
  it("rejects an unauthenticated client and duplicate profile connections", async () => {
    const f = await fixture(); await hello(f, "x".repeat(43));
    await expect(f.bridge.connection("local", identity.profile, "Default")).rejects.toThrow("尚未连接");
    const socket = connect(f.config.port, "127.0.0.1"); sockets.push(socket);
    await new Promise<void>(resolve => socket.once("connect", resolve)); socket.write(JSON.stringify({ kind: "hello", version: 1, token: f.config.token, ...identity }) + "\n"); await delay(10);
    expect(await f.bridge.connection("local", identity.profile, "Default")).toHaveProperty("id");
    const duplicate = connect(f.config.port, "127.0.0.1"); sockets.push(duplicate);
    await new Promise<void>(resolve => duplicate.once("connect", resolve)); duplicate.write(JSON.stringify({ kind: "hello", version: 1, token: f.config.token, ...identity }) + "\n"); await delay(10);
    await expect(f.bridge.connection("local", identity.profile, "Default")).rejects.toThrow();
  });
  it("closes on unsolicited or credential-bearing reply fields", async () => {
    const f = await fixture(); await hello(f);
    f.socket.on("data", chunk => { const cmd = JSON.parse(chunk.toString()); f.socket.write(JSON.stringify({ kind: "result", id: cmd.id, ok: true, value: {}, cookie: "secret" }) + "\n"); });
    await expect((await f.bridge.connection("local", identity.profile, "Default")).call({ kind: "identity" })).rejects.toThrow();
  });
  it("waits for cancellation cleanup before releasing the request", async () => {
    const f = await fixture(); await hello(f);
    const controller = new AbortController(); let cancelled = false, settled = false, id = "";
    f.socket.on("data", chunk => {
      for (const line of chunk.toString().trim().split("\n")) {
        const cmd = JSON.parse(line);
        if (cmd.kind === "command") { id = cmd.id; controller.abort(); }
        else if (cmd.kind === "cancel") cancelled = cmd.id === id;
      }
    });
    const request = (await f.bridge.connection("local", identity.profile, "Default")).call({ kind: "identity" }, controller.signal);
    void request.catch(() => { settled = true; });
    await delay(30); expect(cancelled).toBe(true); expect(settled).toBe(false);
    f.socket.write(JSON.stringify({ kind: "result", id, ok: false, error: "UNAVAILABLE" }) + "\n");
    await expect(request).rejects.toThrow(); expect(settled).toBe(true);
    expect(await f.bridge.connection("local", identity.profile, "Default")).toHaveProperty("id");
  });
  it("does not restore a process connection after losing an in-flight cleanup acknowledgement", async () => {
    const f = await fixture(); await hello(f);
    f.socket.once("data", () => f.socket.destroy());
    await expect((await f.bridge.connection("local", identity.profile, "Default")).call({ kind: "identity" })).rejects.toThrow();
    const reconnect = connect(f.config.port, "127.0.0.1"); sockets.push(reconnect);
    await new Promise<void>(resolve => reconnect.once("connect", resolve));
    reconnect.write(JSON.stringify({ kind: "hello", version: 1, token: f.config.token, ...identity }) + "\n"); await delay(15);
    await expect(f.bridge.connection("local", identity.profile, "Default")).rejects.toThrow();
  });
});
