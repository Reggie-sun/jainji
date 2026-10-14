import { describe, expect, it, vi } from "vitest";
import { MembershipSession, fetchMembership } from "../src/main/membership-session.js";
import { installMembershipIpc, requiresMembership } from "../src/main/membership-ipc.js";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { MembershipConfigSchema, type MembershipStatus } from "../src/shared/membership.js";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMembershipDesktop } from "../src/main/membership-desktop.js";
import * as storageModule from "../src/main/membership-storage.js";
import * as oauthModule from "../src/main/membership-oauth.js";
import { createMembershipNetwork } from "../src/main/membership-network.js";
import { membershipDiagnostics } from "../src/main/membership-diagnostics.js";
import { type MembershipDiagnostic } from "../src/main/membership-check.js";
import type { session as ElectronSessions } from "electron";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture.js";
import { loadOfflineAdmin, provisionOfflineAdmin } from "../src/main/membership-offline-admin.js";

const desktop = vi.hoisted(() => ({ isPackaged: false, root: "", directFetch: vi.fn(), setProxy: vi.fn(async () => {}),
  defaultFetch: vi.fn(), defaultSetProxy: vi.fn(), fromPartition: vi.fn() }));
vi.mock("electron", () => ({
  app: { get isPackaged() { return desktop.isPackaged; }, getAppPath: () => desktop.root,
    commandLine: { hasSwitch: () => true, appendSwitch: () => {} } },
  ipcMain: { handle: () => {} }, net: { fetch: desktop.defaultFetch },
  session: { fromPartition: desktop.fromPartition.mockImplementation(() => ({ setProxy: desktop.setProxy, fetch: desktop.directFetch })),
    defaultSession: { setProxy: desktop.defaultSetProxy } },
  safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: async () => {} },
}));

const config = MembershipConfigSchema.parse({ serviceUrl: "http://127.0.0.1:8789", issuer: "http://127.0.0.1:8000", clientId: "desktop", organization: "jianji", application: "jianji", pricingName: "jianji" });
const allowed: MembershipStatus = { state: "allowed", reason: "trial", message: "试用中", user: { id: "user-id", name: "user", displayName: "用户", isAdmin: false }, expiresAt: "2026-11-10T00:00:00Z" };

describe("local administrator session boundary", () => {
  it("uses the real password form and session owner, hides cloud actions and closes the workspace on logout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-offline-ui-"));
    const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value).reverse(),
      decryptString: (value: Buffer) => Buffer.from(value).reverse().toString() };
    const credentials = { username: "owner@example.test", password: "test-only-ui-password" };
    await provisionOfflineAdmin(root, credentials, encryption);
    let publicRequests = 0;
    const forbidden = async () => { ++publicRequests; throw new Error("Public account network disabled"); };
    const session = new MembershipSession(config, { offlineAdmin: await loadOfflineAdmin(root, encryption),
      storage: storageModule.membershipStorage(root, config, encryption), check: forbidden, login: forbidden,
      changed: () => {}, lostAccess: async () => {} });
    const browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.exposeFunction("backendStatus", () => session.snapshot());
      await page.exposeFunction("backendLogin", (input: { username: string; password: string }) => session.login(input));
      await page.exposeFunction("backendLogout", () => session.logout());
      await page.exposeFunction("backendAuthorize", () => session.assertAllowed());
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: '* { box-sizing: border-box; } body { margin: 0; }' + await readFile("src/renderer/membership.css", "utf8") });
      const script = buildSync({ stdin: { contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MembershipGate} from './src/renderer/MembershipGate';
        const listeners=new Set(); const emit=status=>{for(const listener of listeners)listener(status);return status;};
        window.jianji={membershipStatus:window.backendStatus,onMembership:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
          loginMembership:async input=>emit(await window.backendLogin(input)),logoutMembership:async()=>emit(await window.backendLogout()),
          refreshMembership:async()=>emit(await window.backendStatus()),openMembershipPricing:async()=>{},openMembershipAdmin:async()=>{}};
        createRoot(document.getElementById('root')).render(<MembershipGate><button onClick={async()=>{await window.backendAuthorize();document.getElementById('authorized').textContent='制作准入成功';}}>检查制作权限</button><span id="authorized"/></MembershipGate>);
      `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, write: false, bundle: true,
        platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
      await page.addScriptTag({ content: script });
      await page.getByLabel("帐号", { exact: true }).fill(credentials.username);
      await page.getByLabel("密码", { exact: true }).fill("incorrect");
      await page.getByRole("button", { name: "帐号密码登录", exact: true }).click();
      await page.getByText("帐号或密码错误，或本机授权不可用。", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "检查制作权限" }).isVisible()).toBe(false);
      expect(await page.getByLabel("密码", { exact: true }).inputValue()).toBe("");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByLabel("密码", { exact: true }).fill(credentials.password);
      await page.getByRole("button", { name: "帐号密码登录", exact: true }).click();
      await page.getByText("超级管理员 · 永久权限", { exact: false }).waitFor();
      expect(await page.getByRole("button", { name: "续费会员", exact: true }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "管理用户", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "检查制作权限" }).click();
      await page.getByText("制作准入成功", { exact: true }).waitFor();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.getByRole("button", { name: "帐号密码登录", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "检查制作权限" }).isVisible()).toBe(false);
      expect(publicRequests).toBe(0);
    } finally { session.dispose(); await browser.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("does not reopen development admission when explicit local authorization is corrupt", async () => {
    desktop.root = await mkdtemp(path.join(tmpdir(), "jianji-offline-corrupt-"));
    const oldConfig = process.env.JIANJI_MEMBERSHIP_CONFIG;
    delete process.env.JIANJI_MEMBERSHIP_CONFIG;
    await mkdir(path.join(desktop.root, "membership"), { mode: 0o700 });
    await writeFile(path.join(desktop.root, "membership/offline-admin.enc"), "corrupt", { mode: 0o600 });
    const session = await createMembershipDesktop({ root: desktop.root, trusted: () => {}, changed: () => {}, lostAccess: async () => {} });
    try { await expect(session.assertAllowed()).rejects.toThrow(); }
    finally {
      session.dispose();
      if (oldConfig === undefined) delete process.env.JIANJI_MEMBERSHIP_CONFIG; else process.env.JIANJI_MEMBERSHIP_CONFIG = oldConfig;
      await rm(desktop.root, { recursive: true, force: true });
    }
  });
  it("rejects password login joining an existing cloud login and ignores a late result after logout", async () => {
    let resolve!: (token: string) => void;
    let saved: string | undefined;
    const session = new MembershipSession(config, { storage: { read: async () => saved, write: async token => { saved = token; } },
      login: () => new Promise<string>(r => { resolve = r; }), check: async () => allowed,
      changed: () => {}, lostAccess: async () => {} });
    const pending = session.login(); await vi.waitFor(() => expect(resolve).toBeDefined());
    expect(() => session.login({ username: "owner@example.test", password: "wrong" })).toThrow("登录正在进行");
    await session.logout(); resolve("late-cloud-token"); await pending;
    expect(saved).toBeUndefined(); await expect(session.assertAllowed()).rejects.toThrow(); session.dispose();
  });
  it("logs in and restores permanent local authority without using cloud checks or browser login", async () => {
    let saved: string | undefined;
    let publicRequests = 0;
    const forbidden = async () => { ++publicRequests; throw new Error("Public account request forbidden"); };
    const localStatus = { state: "allowed", reason: "offline-admin", message: "本机永久权限",
      user: { id: "local-admin-id", name: "owner@example.test", displayName: "owner", isAdmin: true } } as MembershipStatus;
    const dependencies = { storage: { read: async () => saved, write: async (value?: string) => { saved = value; } },
      check: forbidden, login: forbidden, fetcher: forbidden, changed: () => {}, lostAccess: async () => {},
      offlineAdmin: { login: async () => "jianji-offline-admin:test-session", check: async () => localStatus } };
    const session = new MembershipSession(config, dependencies);
    try {
      await session.login({ username: "owner@example.test", password: "test-only-password" });
      expect(session.snapshot()).toMatchObject({ state: "allowed", reason: "offline-admin" });
      expect(session.snapshot().expiresAt).toBeUndefined();
      await session.assertAllowed();
      await expect(session.billingUrl()).rejects.toThrow();
      const restarted = new MembershipSession(undefined, dependencies);
      await restarted.restore(); await restarted.assertAllowed();
      expect(restarted.snapshot().user?.isAdmin).toBe(true);
      await restarted.logout(); await expect(restarted.assertAllowed()).rejects.toThrow(); restarted.dispose();
      expect(saved).toBeUndefined(); expect(publicRequests).toBe(0);
    } finally { session.dispose(); }
  });
  it("cannot obtain local authority from an online membership response", async () => {
    const session = new MembershipSession(config, { storage: { read: async () => "cloud-token", write: async () => {} },
      check: async () => ({ ...allowed, reason: "offline-admin" } as MembershipStatus), login: async () => "cloud-token",
      changed: () => {}, lostAccess: async () => {} });
    await session.restore(); await expect(session.assertAllowed()).rejects.toThrow(); session.dispose();
  });
});
function fixture() {
  let saved: string | undefined = "access-token";
  const storage = { read: async () => saved, write: async (token?: string) => { saved = token; } };
  const check = vi.fn(async () => allowed);
  const stopped = vi.fn(async () => {});
  const changed = vi.fn();
  const session = new MembershipSession(config, { storage, check, login: async () => "new-token", changed, lostAccess: stopped });
  return { session, check, stopped, storage, changed };
}
describe("desktop membership", () => {
  it("only resets the check session and never interrupts login or renewal connections", async () => {
    const account = { setProxy: vi.fn(async () => {}), fetch: vi.fn(async () => Response.json({})), closeAllConnections: vi.fn() };
    const checks = { setProxy: vi.fn(async () => {}), fetch: vi.fn(async () => Response.json(allowed)),
      closeAllConnections: vi.fn(async () => {}), clearHostResolverCache: vi.fn(async () => {}) };
    const sessions = { fromPartition: (name: string) => name === "jianji-membership-check" ? checks : account } as unknown as Pick<typeof ElectronSessions, "fromPartition">;
    const network = await createMembershipNetwork(sessions);
    await network.checkFetcher(`${config.serviceUrl}/v1/membership`);
    await network.fetcher(`${config.serviceUrl}/billing/ticket`, { method: "POST" });
    await network.recover();
    expect(account.setProxy).toHaveBeenCalledWith({ mode: "direct" }); expect(checks.setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(checks.closeAllConnections).toHaveBeenCalledOnce(); expect(checks.clearHostResolverCache).toHaveBeenCalledOnce();
    expect(account.closeAllConnections).not.toHaveBeenCalled(); expect(account.fetch).toHaveBeenCalledOnce();
    expect(checks.fetch).toHaveBeenCalledOnce();
    const controller = new AbortController();
    checks.closeAllConnections.mockImplementationOnce(async () => { controller.abort(); });
    await expect(network.recover(controller.signal)).rejects.toThrow();
    expect(checks.clearHostResolverCache).toHaveBeenCalledOnce();
  });
  it("reconnects once, redacts diagnostics and does not retry a renewal POST", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async (): Promise<MembershipStatus> => allowed), recover = vi.fn(async () => {}), diagnostic = vi.fn();
    const transport = vi.fn(async () => { throw new Error("ticket write outcome unknown"); });
    const session = new MembershipSession(config, { storage: { read: async () => "private-token", write: async () => {} },
      check, recover, diagnostic, fetcher: transport, login: async () => "token", changed: () => {}, lostAccess: async () => {} });
    try {
      await session.restore(); check.mockRejectedValueOnce(new Error("ERR_CONNECTION_RESET Bearer private-token /private/path"));
      const pending = session.assertAllowed(); await vi.advanceTimersByTimeAsync(250); await pending;
      expect(recover).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledTimes(3);
      expect(diagnostic.mock.calls.map(([event]) => event.phase)).toEqual(["retry", "reconnect", "recovered"]);
      expect(diagnostic.mock.calls[2][0]).toMatchObject({ kind: "network", networkCode: "ERR_CONNECTION_RESET", state: "allowed" });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/private-token|private\/path|Bearer/);
      await expect(session.billingUrl()).rejects.toThrow(); expect(transport).toHaveBeenCalledOnce();
      expect(recover).toHaveBeenCalledOnce();
    } finally { session.dispose(); vi.useRealTimers(); }
  });
  it.each(["logout", "dispose"] as const)("stops delayed retries on %s", async action => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.session.restore(); f.check.mockRejectedValueOnce(new TypeError("temporary failure"));
      const pending = f.session.assertAllowed().then(() => true, () => false);
      await vi.advanceTimersByTimeAsync(0);
      if (action === "logout") await f.session.logout(); else f.session.dispose();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toBe(false); expect(f.check).toHaveBeenCalledTimes(2);
      if (action === "logout") expect(f.session.snapshot().state).toBe("signed-out");
    } finally { f.session.dispose(); vi.useRealTimers(); }
  });
  it("keeps repeated transient failure bounded and preserves the saved login", async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.session.restore(); f.check.mockRejectedValue(new TypeError("offline"));
      const denied = f.session.assertAllowed().then(() => true, () => false);
      await vi.advanceTimersByTimeAsync(22_000);
      expect(await denied).toBe(false); expect(f.check).toHaveBeenCalledTimes(3);
      expect(f.stopped).toHaveBeenCalledOnce(); expect(await f.storage.read()).toBe("access-token");
    } finally { f.session.dispose(); vi.useRealTimers(); }
  });
  it.each([401, 403, 404, "invalid-json", "invalid-schema", "oversized", "tls"])("does not retry the permanent failure %s", async failure => {
    const transport = vi.fn(async () => {
      if (typeof failure === "number") return new Response("ignored", { status: failure });
      if (failure === "tls") throw new Error("ERR_CERT_AUTHORITY_INVALID private-token");
      return new Response(failure === "invalid-json" ? "not-json" : failure === "oversized" ? "a".repeat(16_385) : "{}");
    });
    const recover = vi.fn(async () => {});
    const session = new MembershipSession(config, { storage: { read: async () => "token", write: async () => {} },
      check: (token, signal) => fetchMembership(config, token, transport, signal), recover,
      login: async () => "token", changed: () => {}, lostAccess: async () => {} });
    try { await session.restore(); expect(session.snapshot().state).toBe("unavailable");
      expect(transport).toHaveBeenCalledOnce(); expect(recover).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });
  it.each([503, "server-unavailable"])("retries %s once without resetting healthy local connections", async failure => {
    vi.useFakeTimers(); const recover = vi.fn(async () => {});
    const transport = vi.fn().mockResolvedValueOnce(failure === 503 ? new Response("unavailable", { status: 503 })
      : Response.json({ state: "unavailable", reason: "unavailable", message: "服务不可用" })).mockResolvedValueOnce(Response.json(allowed));
    const session = new MembershipSession(config, { storage: { read: async () => "token", write: async () => {} },
      check: (token, signal) => fetchMembership(config, token, transport, signal), recover,
      login: async () => "token", changed: () => {}, lostAccess: async () => {} });
    try { const restoring = session.restore(); await vi.advanceTimersByTimeAsync(250); await restoring;
      expect(session.snapshot().state).toBe("allowed"); expect(transport).toHaveBeenCalledTimes(2); expect(recover).not.toHaveBeenCalled();
    } finally { session.dispose(); vi.useRealTimers(); }
  });
  it("fails closed when reconnecting fails and does not let diagnostic failures change the result", async () => {
    const check = vi.fn(async (): Promise<MembershipStatus> => { throw new TypeError("network failed"); });
    const recover = vi.fn(async () => { throw new Error("recovery failed"); });
    const session = new MembershipSession(config, { storage: { read: async () => "token", write: async () => {} }, check, recover,
      diagnostic: () => { throw new Error("logging failed"); }, login: async () => "token", changed: () => {}, lostAccess: async () => {} });
    try { await session.restore(); expect(session.snapshot().state).toBe("unavailable"); expect(check).toHaveBeenCalledOnce();
      expect(recover).toHaveBeenCalledOnce();
    } finally { session.dispose(); }
  });
  it("writes only safe diagnostic fields and rotates the customer log within a fixed budget", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-log-"));
    try {
      const write = membershipDiagnostics(root);
      const event: MembershipDiagnostic = { at: new Date().toISOString(), phase: "failed", kind: "network", attempt: 2, elapsedMs: 10,
        networkCode: "ERR_CONNECTION_RESET", state: "unavailable" };
      await write({ ...event, token: "private-token", message: "/private/path" } as MembershipDiagnostic);
      const file = path.join(root, "diagnostics", "membership-network.jsonl");
      expect(await readFile(file, "utf8")).not.toMatch(/private-token|private\/path|token|message/);
      await writeFile(file, "a".repeat(64 * 1024)); await write(event);
      expect((await stat(file)).size).toBeLessThan(64 * 1024); expect((await stat(`${file}.1`)).size).toBe(64 * 1024);
      await writeFile(file, "b".repeat(64 * 1024)); await write(event);
      expect(await readdir(path.dirname(file))).toEqual(["membership-network.jsonl", "membership-network.jsonl.1"]);
      expect((await stat(`${file}.1`)).size).toBe(64 * 1024);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("recovers one transient failure without publishing an outage or cancelling work", async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.session.restore(); f.changed.mockClear();
      f.check.mockRejectedValueOnce(new TypeError("secret must never be logged")).mockResolvedValue(allowed);
      const admission = f.session.assertAllowed().then(() => true, () => false);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.stopped).not.toHaveBeenCalled(); expect(f.changed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(await admission).toBe(true); expect(f.check).toHaveBeenCalledTimes(3);
      expect(f.stopped).not.toHaveBeenCalled(); expect(f.session.snapshot()).toEqual(allowed);
    } finally { f.session.dispose(); vi.useRealTimers(); }
  });
  it("waits for the fresh retry result and shares it across concurrent admissions", async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.session.restore(); let resolve!: (value: MembershipStatus) => void;
      f.check.mockRejectedValueOnce(new TypeError("temporary network failure"))
        .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
      let admissions = 0;
      const first = f.session.assertAllowed().then(() => { admissions++; }, () => {});
      const second = f.session.assertAllowed().then(() => { admissions++; }, () => {});
      await vi.advanceTimersByTimeAsync(250);
      expect(admissions).toBe(0); expect(f.session.snapshot().state).toBe("allowed");
      expect(f.check).toHaveBeenCalledTimes(3); resolve(allowed); await Promise.all([first, second]);
      expect(admissions).toBe(2); expect(f.stopped).not.toHaveBeenCalled();
    } finally { f.session.dispose(); vi.useRealTimers(); }
  });
  it("bounds a stuck check and does not turn its previous allowed state into admission", async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.session.restore(); f.check.mockImplementation(() => new Promise(() => {}));
      const admitted = f.session.assertAllowed().then(() => true, () => false);
      await vi.advanceTimersByTimeAsync(22_000);
      expect(await admitted).toBe(false); expect(f.session.snapshot().state).toBe("unavailable");
      expect(f.stopped).toHaveBeenCalledTimes(1); expect(await f.storage.read()).toBe("access-token");
    } finally { f.session.dispose(); vi.useRealTimers(); }
  });
  it("waits for isolated direct routing before restoring and keeps all account requests off the default proxy", async () => {
    desktop.root = await mkdtemp(path.join(tmpdir(), "jianji-membership-direct-"));
    const oldConfig = process.env.JIANJI_MEMBERSHIP_CONFIG;
    await writeFile(path.join(desktop.root, "membership.json"), JSON.stringify(config));
    process.env.JIANJI_MEMBERSHIP_CONFIG = path.join(desktop.root, "membership.json");
    desktop.directFetch.mockReset().mockImplementation(async (url: string) => url.endsWith("/billing/ticket")
      ? Response.json({ ticket: "a".repeat(64) }) : Response.json(allowed));
    desktop.defaultFetch.mockReset().mockRejectedValue(new Error("proxy unavailable"));
    desktop.defaultSetProxy.mockClear(); desktop.fromPartition.mockClear();
    let release!: () => void;
    desktop.setProxy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const storage = vi.spyOn(storageModule, "membershipStorage").mockReturnValue({ read: async () => "saved-token", write: async () => {} });
    const login = vi.spyOn(oauthModule, "loginMembership").mockImplementation(async (_config, _open, _signal, fetcher) => {
      await fetcher!(`${config.issuer}/api/login/oauth/access_token`, { method: "POST", redirect: "error" });
      await fetcher!(`${config.issuer}/.well-known/jwks`, { redirect: "error" });
      return "new-token";
    });
    let session: MembershipSession | undefined;
    try {
      const creating = createMembershipDesktop({ root: desktop.root, trusted: () => {}, changed: () => {}, lostAccess: async () => {} });
      await vi.waitFor(() => expect(desktop.fromPartition).toHaveBeenCalledTimes(2));
      expect(desktop.fromPartition).toHaveBeenCalledWith("jianji-membership", { cache: false });
      expect(desktop.fromPartition).toHaveBeenCalledWith("jianji-membership-check", { cache: false });
      expect(desktop.setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
      expect(desktop.directFetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
      release(); session = await creating;
      await vi.waitFor(() => expect(session!.snapshot().state).toBe("allowed"));
      await session.assertAllowed();
      await expect(session.billingUrl()).resolves.toContain("/billing#ticket=");
      await session.login();
      expect(desktop.directFetch.mock.calls.map(([url]) => url)).toEqual([
        `${config.serviceUrl}/v1/membership`, `${config.serviceUrl}/v1/membership`, `${config.serviceUrl}/billing/ticket`,
        `${config.issuer}/api/login/oauth/access_token`, `${config.issuer}/.well-known/jwks`, `${config.serviceUrl}/v1/membership`,
      ]);
      expect(desktop.defaultFetch).not.toHaveBeenCalled(); expect(desktop.defaultSetProxy).not.toHaveBeenCalled();
      desktop.setProxy.mockRejectedValueOnce(new Error("direct configuration failed"));
      desktop.directFetch.mockClear();
      await expect(createMembershipDesktop({ root: desktop.root, trusted: () => {}, changed: () => {}, lostAccess: async () => {} }))
        .rejects.toThrow("direct configuration failed");
      expect(desktop.directFetch).not.toHaveBeenCalled(); expect(desktop.defaultFetch).not.toHaveBeenCalled();
    } finally {
      session?.dispose(); storage.mockRestore(); login.mockRestore();
      if (oldConfig === undefined) delete process.env.JIANJI_MEMBERSHIP_CONFIG; else process.env.JIANJI_MEMBERSHIP_CONFIG = oldConfig;
      await rm(desktop.root, { recursive: true, force: true });
    }
  });
  it("uses the supplied app network transport for membership and renewal tickets", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("/billing/ticket")
      ? Response.json({ ticket: "a".repeat(64) }) : Response.json(allowed));
    const session = new MembershipSession(config, {
      storage: { read: async () => "saved-token", write: async () => {} },
      check: token => fetchMembership(config, token, transport), fetcher: transport,
      login: async () => "token", changed: () => {}, lostAccess: async () => {},
    });
    await session.restore();
    expect(await session.billingUrl()).toBe(`${config.serviceUrl}/billing#ticket=${"a".repeat(64)}`);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [, options] of transport.mock.calls) {
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({ Authorization: "Bearer saved-token" });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(session.snapshot().state).toBe("allowed");
  });
  it("shows restoration while reading the saved login, then admits without a new login", async () => {
    let resolve!: (token: string) => void;
    const login = vi.fn(async () => "unexpected-token");
    const session = new MembershipSession(config, { storage: { read: () => new Promise(r => { resolve = r; }), write: async () => {} },
      check: async () => allowed, login, changed: () => {}, lostAccess: async () => {} });
    const restoring = session.restore();
    expect(session.snapshot().state).toBe("signing-in");
    expect(session.snapshot().message).toContain("恢复");
    resolve("saved-token"); await restoring;
    await expect(session.assertAllowed()).resolves.toBeUndefined();
    expect(login).not.toHaveBeenCalled();
  });
  it("a logout during restoration never revives the saved login", async () => {
    let resolve!: (token: string) => void;
    const session = new MembershipSession(config, { storage: { read: () => new Promise(r => { resolve = r; }), write: async () => {} },
      check: async () => allowed, login: async () => "token", changed: () => {}, lostAccess: async () => {} });
    const restoring = session.restore(); await session.logout(); resolve("saved-token"); await restoring;
    expect(session.snapshot().state).toBe("signed-out");
    await expect(session.assertAllowed()).rejects.toThrow();
  });
  it("never treats a server response or configured session as local development admission", async () => {
    const dependencies = { storage: { read: async () => "token", write: async () => {} },
      check: async (): Promise<MembershipStatus> => ({ state: "local-development", reason: "local-development", message: "local" }),
      login: async () => "token", changed: () => {}, lostAccess: async () => {}, localDevelopment: true };
    const configured = new MembershipSession(config, dependencies);
    await configured.restore();
    await expect(configured.assertAllowed()).rejects.toThrow();
    const unconfigured = new MembershipSession(undefined, { ...dependencies, localDevelopment: false });
    await expect(unconfigured.assertAllowed()).rejects.toThrow("尚未配置");
  });
  it("keeps an unconfigured source checkout usable but closes explicit, invalid and packaged configurations", async () => {
    desktop.root = await mkdtemp(path.join(tmpdir(), "jianji-membership-development-"));
    const oldConfig = process.env.JIANJI_MEMBERSHIP_CONFIG;
    const oldResources = process.resourcesPath;
    const sessions: MembershipSession[] = [];
    const create = async () => {
      const session = await createMembershipDesktop({ root: desktop.root, trusted: () => {}, changed: () => {}, lostAccess: async () => {} });
      sessions.push(session); return session;
    };
    try {
      delete process.env.JIANJI_MEMBERSHIP_CONFIG;
      const local = await create();
      expect(local.snapshot().state).toBe("local-development");
      await expect(local.assertAllowed()).resolves.toBeUndefined();
      process.env.JIANJI_MEMBERSHIP_CONFIG = path.join(desktop.root, "missing.json");
      await expect((await create()).assertAllowed()).rejects.toThrow("尚未配置");
      delete process.env.JIANJI_MEMBERSHIP_CONFIG;
      await mkdir(path.join(desktop.root, "resources"));
      const file = path.join(desktop.root, "resources", "membership.json");
      await writeFile(file, "invalid JSON");
      await expect((await create()).assertAllowed()).rejects.toThrow("尚未配置");
      await writeFile(file, JSON.stringify(config));
      const configured = await create();
      expect(configured.snapshot().state).toBe("signed-out");
      await expect(configured.assertAllowed()).rejects.toThrow();
      await rm(file);
      desktop.isPackaged = true; Object.defineProperty(process, "resourcesPath", { value: path.join(desktop.root, "resources"), configurable: true });
      await expect((await create()).assertAllowed()).rejects.toThrow("尚未配置");
    } finally {
      await Promise.resolve(); sessions.forEach(session => session.dispose()); desktop.isPackaged = false;
      Object.defineProperty(process, "resourcesPath", { value: oldResources, configurable: true });
      if (oldConfig === undefined) delete process.env.JIANJI_MEMBERSHIP_CONFIG; else process.env.JIANJI_MEMBERSHIP_CONFIG = oldConfig;
      await rm(desktop.root, { recursive: true, force: true });
    }
  });
  it("fails closed without configuration", async () => {
    const { session } = fixture();
    await expect(session.assertAllowed()).rejects.toThrow();
    expect(session.snapshot().state).toBe("signed-out");
  });
  it("restores only after online validation and validates every admission", async () => {
    const f = fixture(); await f.session.restore();
    await f.session.assertAllowed(); await f.session.assertAllowed();
    expect(f.check).toHaveBeenCalledTimes(3);
    expect(f.session.snapshot()).toEqual(allowed);
    expect(JSON.stringify(f.session.snapshot())).not.toContain("access-token");
  });
  it("stops active work when replaced by another login", async () => {
    const f = fixture(); await f.session.restore();
    f.check.mockResolvedValue({ state: "denied", reason: "session-expired", message: "登录已失效" });
    await expect(f.session.assertAllowed()).rejects.toThrow("登录已失效");
    expect(f.stopped).toHaveBeenCalledTimes(1);
    expect(await f.storage.read()).toBeUndefined();
  });
  it("does not turn a network failure into cached authorization", async () => {
    const f = fixture(); await f.session.restore(); f.check.mockRejectedValue(new Error("secret token"));
    await expect(f.session.assertAllowed()).rejects.toThrow();
    expect(f.session.snapshot().state).toBe("unavailable");
    expect(JSON.stringify(f.session.snapshot())).not.toContain("secret token");
    expect(f.stopped).toHaveBeenCalledTimes(1);
  });
  it("recovers from repeated heartbeat outages using the saved login without opening authentication", async () => {
    vi.useFakeTimers();
    const login = vi.fn(async () => "unexpected-new-token");
    const write = vi.fn(async (_token?: string) => {});
    const check = vi.fn(async (_token: string): Promise<MembershipStatus> => allowed);
    const stopped = vi.fn(async () => {});
    const session = new MembershipSession(config, { storage: { read: async () => "saved-token", write },
      check, login, changed: () => {}, lostAccess: stopped });
    try {
      await session.restore(); session.startHeartbeat();
      check.mockRejectedValue(new Error("temporary timeout"));
      await vi.advanceTimersByTimeAsync(30_250);
      expect(session.snapshot().state).toBe("unavailable");
      const rejected = expect(session.assertAllowed()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(250); await rejected;
      expect(stopped).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      check.mockResolvedValue(allowed);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.snapshot()).toEqual(allowed);
      await expect(session.assertAllowed()).resolves.toBeUndefined();
      expect(check.mock.calls.every(([token]) => token === "saved-token")).toBe(true);
      expect(write).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
    } finally { session.dispose(); vi.useRealTimers(); }
  });
  it("retains credentials on a server unavailable response but clears them on confirmed revocation", async () => {
    const f = fixture(); await f.session.restore();
    f.check.mockResolvedValue({ state: "unavailable", reason: "unavailable", message: "服务暂时不可用" });
    await expect(f.session.assertAllowed()).rejects.toThrow("服务暂时不可用");
    expect(await f.storage.read()).toBe("access-token");
    f.check.mockResolvedValue(allowed); await f.session.refresh();
    expect(f.session.snapshot().state).toBe("allowed");
    f.check.mockResolvedValue({ state: "denied", reason: "forbidden", message: "账号已停用" });
    await expect(f.session.assertAllowed()).rejects.toThrow("账号已停用");
    expect(await f.storage.read()).toBeUndefined();
    f.check.mockResolvedValue(allowed);
    expect((await f.session.refresh()).reason).toBe("forbidden");
  });
  it("stops work even when clearing stored credentials fails", async () => {
    for (const action of ["logout", "revocation"] as const) {
      const f = fixture(); await f.session.restore();
      f.storage.write = async () => { throw new Error("disk unavailable"); };
      if (action === "logout") await f.session.logout().catch(() => {});
      else {
        f.check.mockResolvedValue({ state: "denied", reason: "session-expired", message: "登录已失效" });
        await f.session.refresh().catch(() => {});
      }
      expect(f.stopped).toHaveBeenCalledTimes(1);
      await expect(f.session.assertAllowed()).rejects.toThrow();
    }
  });
  it("never restores an in-flight result after logout", async () => {
    const f = fixture(); await f.session.restore();
    let resolve!: (value: MembershipStatus) => void;
    f.check.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = f.session.refresh(); await f.session.logout(); resolve(allowed); await pending;
    expect(f.session.snapshot().state).toBe("signed-out");
    expect(await f.storage.read()).toBeUndefined();
  });
  it("shares concurrent login requests before the browser opens", async () => {
    const login = vi.fn(async () => "token");
    const session = new MembershipSession(config, { storage: { read: async () => undefined, write: async () => {} },
      check: async () => allowed, login, changed: () => {}, lostAccess: async () => {} });
    await Promise.all([session.login(), session.login()]);
    expect(login).toHaveBeenCalledTimes(1);
    expect(session.snapshot().state).toBe("allowed");
  });
  it("requires membership for new/unknown work but keeps recovery available", () => {
    for (const channel of ["agent.start", "export.retry", "export.append", "batchProduction.start", "coverReview.approve", "future.operation", "douyinUpload.queryBackend"]) expect(requiresMembership(channel)).toBe(true);
    for (const channel of ["membership.login", "membership.logout", "app.state", "agent.cancel", "export.cancelAll", "project.save", "artifact.open", "douyinUpload.stop", "douyinUpload.cancelBackendQuery"]) expect(requiresMembership(channel)).toBe(false);
  });
  it("enforces main-process IPC and trusted sender independently of the UI", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const ipc = { handle: (name: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { handlers.set(name, listener); } } as Pick<IpcMain, "handle">;
    const f = fixture();
    const trusted = {} as IpcMainInvokeEvent;
    installMembershipIpc(ipc, f.session, event => { if (event !== trusted) throw new Error("untrusted sender"); });
    const work = vi.fn(() => "started"); ipc.handle("agent.start", work);
    ipc.handle("export.cancelAll", () => "cancelled");
    ipc.handle("douyinUpload.cancelBackendQuery", () => "query cancelled");
    await expect(handlers.get("agent.start")!(trusted)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
    expect(await handlers.get("export.cancelAll")!(trusted)).toBe("cancelled");
    await expect(handlers.get("export.cancelAll")!({} as IpcMainInvokeEvent)).rejects.toThrow("untrusted sender");
    expect(await handlers.get("douyinUpload.cancelBackendQuery")!(trusted)).toBe("query cancelled");
    await expect(handlers.get("douyinUpload.cancelBackendQuery")!({} as IpcMainInvokeEvent)).rejects.toThrow("untrusted sender");
    await f.session.restore(); expect(await handlers.get("agent.start")!(trusted)).toBe("started");
  });
  it("rejects remote HTTP and credential-bearing configuration", () => {
    expect(() => MembershipConfigSchema.parse({ ...config, serviceUrl: "http://example.com" })).toThrow();
    expect(() => MembershipConfigSchema.parse({ ...config, clientSecret: "never-in-desktop" })).toThrow();
    expect(() => MembershipConfigSchema.parse({ ...config, casdoorUrl: "http://127.0.0.1:8000" })).toThrow();
  });
});
