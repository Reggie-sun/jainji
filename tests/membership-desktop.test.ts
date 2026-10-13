import { describe, expect, it, vi } from "vitest";
import { MembershipSession, fetchMembership } from "../src/main/membership-session.js";
import { installMembershipIpc, requiresMembership } from "../src/main/membership-ipc.js";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { MembershipConfigSchema, type MembershipStatus } from "../src/shared/membership.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMembershipDesktop } from "../src/main/membership-desktop.js";
import * as storageModule from "../src/main/membership-storage.js";
import * as oauthModule from "../src/main/membership-oauth.js";

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
function fixture() {
  let saved: string | undefined = "access-token";
  const storage = { read: async () => saved, write: async (token?: string) => { saved = token; } };
  const check = vi.fn(async () => allowed);
  const stopped = vi.fn(async () => {});
  const session = new MembershipSession(config, { storage, check, login: async () => "new-token", changed: vi.fn(), lostAccess: stopped });
  return { session, check, stopped, storage };
}
describe("desktop membership", () => {
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
      await vi.waitFor(() => expect(desktop.fromPartition).toHaveBeenCalledOnce());
      expect(desktop.fromPartition).toHaveBeenCalledWith("jianji-membership", { cache: false });
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
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.snapshot().state).toBe("unavailable");
      await expect(session.assertAllowed()).rejects.toThrow();
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
