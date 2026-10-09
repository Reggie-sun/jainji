import { describe, expect, it, vi } from "vitest";
import { MembershipSession } from "../src/main/membership-session.js";
import { installMembershipIpc, requiresMembership } from "../src/main/membership-ipc.js";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { MembershipConfigSchema, type MembershipStatus } from "../src/shared/membership.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMembershipDesktop } from "../src/main/membership-desktop.js";

const desktop = vi.hoisted(() => ({ isPackaged: false, root: "" }));
vi.mock("electron", () => ({
  app: { get isPackaged() { return desktop.isPackaged; }, getAppPath: () => desktop.root },
  ipcMain: { handle: () => {} }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: async () => {} },
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
    for (const channel of ["agent.start", "export.retry", "export.append", "batchProduction.start", "coverReview.approve", "future.operation"]) expect(requiresMembership(channel)).toBe(true);
    for (const channel of ["membership.login", "membership.logout", "app.state", "agent.cancel", "export.cancelAll", "project.save", "artifact.open", "douyinUpload.stop"]) expect(requiresMembership(channel)).toBe(false);
  });
  it("enforces main-process IPC and trusted sender independently of the UI", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const ipc = { handle: (name: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { handlers.set(name, listener); } } as Pick<IpcMain, "handle">;
    const f = fixture();
    const trusted = {} as IpcMainInvokeEvent;
    installMembershipIpc(ipc, f.session, event => { if (event !== trusted) throw new Error("untrusted sender"); });
    const work = vi.fn(() => "started"); ipc.handle("agent.start", work);
    ipc.handle("export.cancelAll", () => "cancelled");
    await expect(handlers.get("agent.start")!(trusted)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
    expect(await handlers.get("export.cancelAll")!(trusted)).toBe("cancelled");
    await expect(handlers.get("export.cancelAll")!({} as IpcMainInvokeEvent)).rejects.toThrow("untrusted sender");
    await f.session.restore(); expect(await handlers.get("agent.start")!(trusted)).toBe("started");
  });
  it("rejects remote HTTP and credential-bearing configuration", () => {
    expect(() => MembershipConfigSchema.parse({ ...config, serviceUrl: "http://example.com" })).toThrow();
    expect(() => MembershipConfigSchema.parse({ ...config, clientSecret: "never-in-desktop" })).toThrow();
  });
});
