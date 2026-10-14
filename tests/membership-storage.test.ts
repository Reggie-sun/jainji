import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { membershipStorage } from "../src/main/membership-storage.js";
import { MembershipConfigSchema } from "../src/shared/membership.js";
import { FileBillingSessionStore, BILLING_SESSION_SECONDS } from "../src/membership-server/billing-session-store.js";
import { MembershipServerConfigSchema } from "../src/membership-server/policy.js";
import { configureMembershipKeyring } from "../src/main/membership-keyring.js";
import { createServer } from "node:net";
import { loadOfflineAdmin, provisionOfflineAdmin } from "../src/main/membership-offline-admin.js";
import { MembershipSession } from "../src/main/membership-session.js";
const roots: string[] = [];
const faults = vi.hoisted(() => ({ failCredentialDelete: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rm: async (...args: Parameters<typeof original.rm>) => {
    if (faults.failCredentialDelete && String(args[0]).endsWith("session.enc")) throw new Error("Injected credential deletion failure");
    return original.rm(...args);
  } };
});
afterEach(async () => { faults.failCredentialDelete = false; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const config = MembershipConfigSchema.parse({ serviceUrl: "https://member.example.com", issuer: "https://login.example.com", clientId: "desktop", organization: "jianji", application: "jianji", pricingName: "jianji" });
// Only a storage contract fixture; this is not evidence of OS keychain encryption.
const encryption = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "gnome_libsecret", encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (b: Buffer) => Buffer.from(b).reverse().toString() };
describe("explicit OS-local administrator authority", () => {
  const credentials = { username: "owner@example.test", password: "test-only-local-password" };
  const signal = () => new AbortController().signal;
  async function provision() {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-local-admin-")); roots.push(root);
    await provisionOfflineAdmin(root, credentials, encryption);
    return { root, authority: (await loadOfflineAdmin(root, encryption))!, file: path.join(root, "membership/offline-admin.enc") };
  }
  it("requires the actual password and never stores it or overwrites an existing authorization", async () => {
    const { root, authority, file } = await provision();
    const bytes = await readFile(file); expect(bytes.toString()).not.toContain(credentials.password);
    expect(encryption.decryptString(bytes)).not.toContain(credentials.password);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(authority.login({ ...credentials, password: "incorrect" }, signal())).rejects.toThrow();
    await expect(authority.login({ ...credentials, username: "another@example.test" }, signal())).rejects.toThrow();
    await expect(provisionOfflineAdmin(root, credentials, encryption)).rejects.toThrow();
    expect(await readFile(file)).toEqual(bytes);
    const token = await authority.login(credentials, signal());
    const status = await authority.check(token, signal());
    expect(status).toMatchObject({ state: "allowed", reason: "offline-admin", user: { name: credentials.username, isAdmin: true } });
    expect(status.expiresAt).toBeUndefined(); expect(JSON.stringify(status)).not.toContain(token);
  });
  it("rejects forged sessions, copied sessions from another installation and removed credentials", async () => {
    const first = await provision(), second = await provision();
    const token = await first.authority.login(credentials, signal());
    expect((await first.authority.check(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), signal())).state).toBe("denied");
    expect((await second.authority.check(token, signal())).state).toBe("denied");
    await rm(first.file);
    expect((await first.authority.check(token, signal())).state).toBe("denied");
    expect(await loadOfflineAdmin(first.root, encryption)).toBeUndefined();
  });
  it("does not activate without safe encryption or with malformed or unsafe credential files", async () => {
    const { root, file } = await provision();
    for (const unsafe of [{ ...encryption, isEncryptionAvailable: () => false }, { ...encryption, getSelectedStorageBackend: () => "basic_text" }]) {
      expect(await loadOfflineAdmin(root, unsafe)).toBeUndefined();
      await expect(provisionOfflineAdmin(root, credentials, unsafe)).rejects.toThrow();
    }
    await chmod(file, 0o644); expect(await loadOfflineAdmin(root, encryption)).toBeUndefined();
    await chmod(file, 0o600); await writeFile(file, "corrupt"); expect(await loadOfflineAdmin(root, encryption)).toBeUndefined();
  });
  it("restores encrypted local login offline and revokes admission on changed authority without any account network", async () => {
    const { root, authority, file } = await provision();
    let accountRequests = 0, stops = 0;
    const forbidden = async () => { ++accountRequests; throw new Error("Account network prohibited"); };
    const dependencies = { storage: membershipStorage(root, config, encryption), offlineAdmin: authority,
      login: forbidden, check: forbidden, fetcher: forbidden, recover: forbidden, changed: () => {}, lostAccess: async () => { ++stops; } };
    const session = new MembershipSession(config, dependencies);
    await session.login({ ...credentials, password: "wrong" });
    await expect(session.assertAllowed()).rejects.toThrow();
    await session.login(credentials); await session.assertAllowed();
    session.dispose();
    const restarted = new MembershipSession(config, { ...dependencies, offlineAdmin: (await loadOfflineAdmin(root, encryption))! });
    await restarted.restore(); await restarted.assertAllowed();
    const record = JSON.parse(encryption.decryptString(await readFile(file))); record.sessionKey = "0".repeat(64);
    await writeFile(file, encryption.encryptString(JSON.stringify(record)));
    await expect(restarted.assertAllowed()).rejects.toThrow();
    expect(restarted.snapshot().state).toBe("denied"); expect(stops).toBe(1); expect(accountRequests).toBe(0);
    expect(await dependencies.storage.read()).toBeUndefined(); restarted.dispose();
  });
});
describe("membership credential storage", () => {
  it("binds encrypted credentials to the public service configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-")); roots.push(root);
    const store = membershipStorage(root, config, encryption); await store.write("private-access-token");
    expect((await readFile(path.join(root, "membership/session.enc"))).toString()).not.toContain("private-access-token");
    expect(await store.read()).toBe("private-access-token");
    expect(await membershipStorage(root, { ...config, clientId: "other" }, encryption).read()).toBeUndefined();
    await store.write(); expect(await store.read()).toBeUndefined();
  });
  it("never persists tokens with Linux basic_text fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-")); roots.push(root);
    const store = membershipStorage(root, config, { ...encryption, getSelectedStorageBackend: () => "basic_text" });
    await store.write("private-access-token"); expect(await store.read()).toBeUndefined();
    await expect(readFile(path.join(root, "membership/session.enc"))).rejects.toThrow();
  });
  it("never restores credentials after a logout whose deletion failed, and allows an explicit new login", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-")); roots.push(root);
    const store = membershipStorage(root, config, encryption); await store.write("old-token");
    faults.failCredentialDelete = true; await expect(store.write()).rejects.toThrow("deletion failure");
    expect(await readFile(path.join(root, "membership/session.enc"))).toBeDefined();
    expect(await membershipStorage(root, config, encryption).read()).toBeUndefined();
    faults.failCredentialDelete = false; await store.write("new-token");
    expect(await membershipStorage(root, config, encryption).read()).toBe("new-token");
  });
});

describe("persistent billing credentials", () => {
  const serverConfig = MembershipServerConfigSchema.parse({ ...config, clientSecret: "test-only-server-secret", monthlyPlan: "jianji-monthly", yearlyPlan: "jianji-yearly", grantPlan: "jianji-grant" });
  const id = "a".repeat(64), otherId = "b".repeat(64), csrf = "c".repeat(64);
  it("survives store reconstruction, encrypts credentials, binds deployment and persists logout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-billing-")); roots.push(root);
    const record = { token: "private-upstream-token", csrf, expires: Date.now() + BILLING_SESSION_SECONDS * 1000 };
    await new FileBillingSessionStore(root, serverConfig).put(id, record);
    const file = path.join(root, "sessions", id), bytes = await readFile(file);
    expect(bytes.toString()).not.toContain(record.token); expect(bytes.toString()).not.toContain(csrf);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const restarted = new FileBillingSessionStore(root, serverConfig);
    expect(await restarted.get(id)).toEqual(record);
    expect(await new FileBillingSessionStore(root, { ...serverConfig, clientId: "other" }).get(id)).toBeUndefined();
    expect(await new FileBillingSessionStore(root, { ...serverConfig, clientSecret: "changed-test-only-secret" }).get(id)).toBeUndefined();
    await writeFile(path.join(root, "sessions", otherId), bytes, { mode: 0o600 });
    expect(await restarted.get(otherId)).toBeUndefined();
    await restarted.remove(id); expect(await new FileBillingSessionStore(root, serverConfig).get(id)).toBeUndefined();
  });
  it("expires after thirty days, rejects tampering, unsafe permissions and path traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-billing-")); roots.push(root);
    let now = 1000;
    const store = new FileBillingSessionStore(root, serverConfig, () => now);
    const record = { token: "test-token", csrf, expires: now + BILLING_SESSION_SECONDS * 1000 };
    await store.put(id, record); now = record.expires;
    expect(await store.get(id)).toBeUndefined();
    await store.put(id, { ...record, expires: now + 1000 });
    const file = path.join(root, "sessions", id), bytes = await readFile(file); bytes[bytes.length - 1] ^= 1; await writeFile(file, bytes);
    expect(await store.get(id)).toBeUndefined();
    expect(await store.get("../../server.json")).toBeUndefined();
    await chmod(path.join(root, "sessions"), 0o755); await expect(store.get(id)).rejects.toThrow();
  });
  it("keeps concurrent logins durable during expired-record cleanup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-billing-")); roots.push(root);
    const store = new FileBillingSessionStore(root, serverConfig);
    const record = { token: "test-token", csrf, expires: Date.now() + 10000 };
    await Promise.all([store.put(id, record), store.put(otherId, record)]);
    expect(await store.get(id)).toEqual(record); expect(await store.get(otherId)).toEqual(record);
  });
});

describe("Linux membership keyring preparation", () => {
  it("uses the private native bus before safeStorage initialization and respects explicit stores", async () => {
    if (process.platform !== "linux") return;
    const root = await mkdtemp(path.join(tmpdir(), "jianji-keyring-")); roots.push(root);
    const bus = createServer(); await new Promise<void>(resolve => bus.listen(path.join(root, "bus"), resolve));
    const calls: string[][] = [];
    const commandLine = { hasSwitch: () => false, appendSwitch: (name: string, value: string) => { calls.push([name, value]); } };
    try {
      const env = { XDG_RUNTIME_DIR: root, DBUS_SESSION_BUS_ADDRESS: "disabled:" };
      configureMembershipKeyring(commandLine, env);
      expect(env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=${root}/bus`);
      expect(calls).toEqual([["password-store", "gnome-libsecret"]]);
      configureMembershipKeyring({ ...commandLine, hasSwitch: () => true }, env); expect(calls).toHaveLength(1);
      await chmod(root, 0o755); configureMembershipKeyring(commandLine, env); expect(calls).toHaveLength(1);
    } finally { await new Promise<void>(resolve => bus.close(() => resolve())); }
  });
});
