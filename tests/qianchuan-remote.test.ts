import { describe, expect, it } from "vitest";
import { RemoteBrowserProfileSchema, RemoteRequestSchema } from "../src/shared/qianchuan-remote";
import { sshRemoteArguments, RemoteFrames } from "../src/main/qianchuan-remote-transport";
import { AutomationBrowserAccounts } from "../src/main/qianchuan-automation-browsers";
import { QianchuanRemoteRuntime } from "../src/main/qianchuan-remote-runtime";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";

const route = { mode: "remote-browser" as const, group: "one", sshHost: "shop-one", expectedIp: "8.8.8.8", localPort: 19381 };
describe("remote browser transport", () => {
  it("pins authentication, disables inherited forwarding and never accepts command text from config", () => {
    const args = sshRemoteArguments(route);
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ClearAllForwardings=yes");
    expect(args).toContain("ForwardAgent=no");
    expect(args.at(-1)).toBe('exec node "$HOME/.local/share/jianji-remote/worker.cjs"');
    expect(() => sshRemoteArguments({ ...route, sshHost: "a;touch /tmp/x" })).toThrow();
  });
  it("decodes fragmented headers and binary chunks without treating payload newlines as commands", () => {
    const frames = new RemoteFrames();
    const request = { version: 1, route, action: "file-append", advertiserId: "123", file: { advertiserId: "123", sha256: "a".repeat(64), size: 5, fileName: "视频.mp4" }, offset: 0, bodyBytes: 5 };
    const buffer = Buffer.concat([Buffer.from(JSON.stringify(request) + "\n"), Buffer.from([0, 10, 255, 13, 1])]);
    expect(frames.push(buffer.subarray(0, 15))).toEqual([]);
    const result = frames.push(buffer.subarray(15));
    expect(result).toHaveLength(1); expect(result[0].body).toEqual(Buffer.from([0, 10, 255, 13, 1]));
  });
  it("rejects unbounded frames, cross-account files and request bodies on browser operations", () => {
    expect(() => new RemoteFrames().push(Buffer.alloc(16385, 65))).toThrow();
    const request = { version: 1, route, action: "open", advertiserId: "123", bodyBytes: 1 };
    expect(RemoteRequestSchema.safeParse(request).success).toBe(false);
    expect(RemoteRequestSchema.safeParse({ ...request, action: "file-status", bodyBytes: 0, file: { advertiserId: "456", sha256: "a".repeat(64), size: 1, fileName: "a.mp4" } }).success).toBe(false);
  });
  it("accepts display labels only on the zero-body desktop synchronization action", () => {
    const request = { version: 1, route, action: "desktop-sync", advertiserId: "123", bodyBytes: 0, displayName: "予浅好物" };
    expect(RemoteRequestSchema.safeParse(request).success).toBe(true);
    for (const value of [{ ...request, bodyBytes: 1 }, { ...request, displayName: "\nExec=bad" }, { ...request, displayName: undefined }, { ...request, action: "probe" }]) {
      expect(RemoteRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it("accepts a fixed zero-body browser-profile request and validates its complete process proof", async () => {
    const request = { version: 1, route, action: "browser-profile", advertiserId: "123", bodyBytes: 0 };
    expect(RemoteRequestSchema.safeParse(request).success).toBe(true);
    expect(RemoteRequestSchema.safeParse({ ...request, extensionProcess: { pid: 45, profile: "/profile", profileDirectory: "Default" } }).success).toBe(false);
    const profile = { profile: "/profile", profileDirectory: "Default", processId: 45, startedAt: "12345", browser: { port: 43123, browserPath: "/devtools/browser/abc-123" } };
    expect(RemoteBrowserProfileSchema.parse(profile)).toEqual(profile);
    for (const invalid of [
      { ...profile, processId: 1 }, { ...profile, startedAt: "" }, { ...profile, browser: undefined },
      { ...profile, extra: true }, { ...profile, browser: { ...profile.browser, browserPath: "/devtools/page/id" } },
    ]) expect(RemoteBrowserProfileSchema.safeParse(invalid).success).toBe(false);
    const channel = { route, controller: new AbortController(), close() {}, request: async (...args: unknown[]) => { expect(args).toEqual(["browser-profile", "123", {}, undefined, undefined]); return profile; } };
    const runtime = new QianchuanRemoteRuntime(() => channel as never);
    await expect(runtime.browserProfile(route, "123")).resolves.toEqual(profile);
  });
});

describe("account-serial automation browsers", () => {
  const accounts: FrozenQianchuanAccount[] = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂"].map((product, i) => ({
    product: product as FrozenQianchuanAccount["product"], advertiserId: String(1000 + i), adId: "2222", configDigest: "a".repeat(64),
    cdpEndpoint: `http://127.0.0.1:${19400 + i}`, egress: route,
  }));
  it("holds one account across chunks and closes it before the next of five accounts", async () => {
    const open = new Set<string>(accounts.map(a => a.advertiserId)), events: string[] = [];
    const owner = new AutomationBrowserAccounts({ accounts: async () => accounts, guard: () => {}, close: async target => {
      events.push(`close:${target.advertiserId}`); open.delete(target.advertiserId);
    } });
    const signal = new AbortController().signal;
    for (const account of accounts) {
      await owner.prepare(account, signal); open.add(account.advertiserId);
      expect(open.size).toBe(1); events.push(`open:${account.advertiserId}`);
      const before = events.length; await owner.prepare(account, signal); expect(events).toHaveLength(before);
      await owner.finish(account, signal); expect(open.size).toBe(0); expect(owner.busy).toBe(false);
    }
    for (let i = 1; i < accounts.length; i++) expect(events.indexOf(`close:${accounts[i - 1].advertiserId}`, events.indexOf(`open:${accounts[i - 1].advertiserId}`))).toBeLessThan(events.indexOf(`open:${accounts[i].advertiserId}`));
  });
  it("checks all peers before closing any draft, and stops on close failure or cancellation", async () => {
    const closed: string[] = [], signal = new AbortController().signal;
    const deps = { accounts: async () => accounts, guard: (id: string) => { if (id === "1003") throw new Error("UNKNOWN draft"); }, close: async (target: FrozenQianchuanAccount) => { closed.push(target.advertiserId); } };
    const owner = new AutomationBrowserAccounts(deps);
    await expect(owner.prepare(accounts[0], signal)).rejects.toThrow("UNKNOWN"); expect(closed).toEqual([]);
    deps.guard = () => {}; deps.close = async () => { throw new Error("close failed"); };
    await expect(owner.prepare(accounts[0], signal)).rejects.toThrow("close failed"); expect(owner.busy).toBe(false);
    const abort = new AbortController(); abort.abort();
    await expect(owner.prepare(accounts[0], abort.signal)).rejects.toThrow();
  });
  it("retains the window when completion is unsafe and never rotates implicitly", async () => {
    let unsafe = false; const closed: string[] = [];
    const owner = new AutomationBrowserAccounts({ accounts: async () => [accounts[0]], guard: () => { if (unsafe) throw new Error("READY draft"); }, close: async a => { closed.push(a.advertiserId); } });
    const signal = new AbortController().signal;
    await owner.prepare(accounts[0], signal); unsafe = true;
    await expect(owner.finish(accounts[0], signal)).rejects.toThrow("READY"); expect(closed).toEqual([]);
    await expect(owner.prepare(accounts[1], signal)).rejects.toThrow("账号");
    owner.release(); expect(owner.busy).toBe(false);
  });
  it("rejects a changed configuration and leaves local and proxy Chrome alone", async () => {
    const closed: string[] = [];
    const owner = new AutomationBrowserAccounts({ accounts: async () => accounts, guard: () => {}, close: async a => { closed.push(a.advertiserId); } });
    const signal = new AbortController().signal;
    await expect(owner.prepare({ ...accounts[0], configDigest: "b".repeat(64) }, signal)).rejects.toThrow("变化");
    for (const egress of [undefined, { ...route, mode: undefined }]) { await owner.prepare({ ...accounts[0], egress }, signal); await owner.finish({ ...accounts[0], egress }, signal); }
    expect(closed).toEqual([]);
  });
});
