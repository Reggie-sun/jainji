import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { installQianchuanExtensionHost, registerQianchuanExtensionProfile } from "../src/main/qianchuan-extension-install";
import { QIANCHUAN_EXTENSION_ORIGIN, QIANCHUAN_NATIVE_HOST } from "../src/main/qianchuan-extension-protocol";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-extension-install-")); roots.push(root);
  const profile = path.join(root, "chrome-account"), runtime = path.join(root, "runtime"); await mkdir(profile, { mode: 0o700 });
  const config = { version: 1 as const, port: 12345, token: "t".repeat(43), extensionOrigin: QIANCHUAN_EXTENSION_ORIGIN };
  const options = { profiles: [profile], resources: path.resolve("resources/qianchuan-extension") };
  return { root, profile, runtime, config, options };
}
describe("per-profile native host installation", () => {
  it("registers current and future original profiles without editing login files", async () => {
    const f = await fixture(); await writeFile(path.join(f.profile, "Cookies"), "do not read or rewrite");
    await installQianchuanExtensionHost(f.runtime, f.config, f.options);
    const hostFile = path.join(f.profile, "NativeMessagingHosts", `${QIANCHUAN_NATIVE_HOST}.json`);
    expect(JSON.parse(await readFile(hostFile, "utf8"))).toMatchObject({ name: QIANCHUAN_NATIVE_HOST, allowed_origins: [QIANCHUAN_EXTENSION_ORIGIN], path: path.join(f.runtime, "qianchuan-extension/native-host") });
    expect((await stat(hostFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(f.runtime, "qianchuan-extension/connection.json"))).mode & 0o777).toBe(0o600);
    const future = path.join(f.root, "future-account"); await mkdir(future, { mode: 0o700 }); await registerQianchuanExtensionProfile(f.runtime, future);
    expect(JSON.parse(await readFile(path.join(future, "NativeMessagingHosts", `${QIANCHUAN_NATIVE_HOST}.json`), "utf8"))).toHaveProperty("allowed_origins", [QIANCHUAN_EXTENSION_ORIGIN]);
    expect(await readFile(path.join(f.profile, "Cookies"), "utf8")).toBe("do not read or rewrite");
  });
  it("preserves a foreign registration and rejects symlink or writable profiles", async () => {
    const f = await fixture(); await mkdir(path.join(f.profile, "NativeMessagingHosts"), { mode: 0o700 });
    const file = path.join(f.profile, "NativeMessagingHosts", `${QIANCHUAN_NATIVE_HOST}.json`), foreign = JSON.stringify({ name: QIANCHUAN_NATIVE_HOST, path: "/foreign" });
    await writeFile(file, foreign, { mode: 0o600 });
    await expect(installQianchuanExtensionHost(f.runtime, f.config, f.options)).rejects.toThrow(); expect(await readFile(file, "utf8")).toBe(foreign);
    const alias = path.join(f.root, "alias"); await symlink(f.profile, alias); await expect(registerQianchuanExtensionProfile(f.runtime, alias)).rejects.toThrow();
    await chmod(f.profile, 0o777); await expect(registerQianchuanExtensionProfile(f.runtime, f.profile)).rejects.toThrow();
  });
});
