import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { membershipStorage } from "../src/main/membership-storage.js";
import { MembershipConfigSchema } from "../src/shared/membership.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const config = MembershipConfigSchema.parse({ serviceUrl: "https://member.example.com", issuer: "https://login.example.com", clientId: "desktop", organization: "jianji", application: "jianji", pricingName: "jianji" });
// Only a storage contract fixture; this is not evidence of OS keychain encryption.
const encryption = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "gnome_libsecret", encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (b: Buffer) => Buffer.from(b).reverse().toString() };
describe("membership credential storage", () => {
  it("binds encrypted credentials to the public service configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-")); roots.push(root);
    const store = membershipStorage(root, config, encryption); await store.write("private-access-token");
    expect((await readFile(path.join(root, "membership/session.enc"))).toString()).not.toContain("private-access-token");
    expect(await store.read()).toBe("private-access-token");
    expect(await membershipStorage(root, { ...config, clientId: "other" }, encryption).read()).toBeUndefined();
    await store.write(); await expect(store.read()).rejects.toThrow();
  });
  it("never persists tokens with Linux basic_text fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-membership-")); roots.push(root);
    const store = membershipStorage(root, config, { ...encryption, getSelectedStorageBackend: () => "basic_text" });
    await store.write("private-access-token"); expect(await store.read()).toBeUndefined();
    await expect(readFile(path.join(root, "membership/session.enc"))).rejects.toThrow();
  });
});
