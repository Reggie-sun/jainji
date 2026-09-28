import { chmod, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAccountConfig, QIANCHUAN_PRODUCTS, accountPageUrl } from "../src/shared/qianchuan-account.js";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const config = () => ({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({
  product, cdpEndpoint: `http://127.0.0.1:${9222 + index}`, advertiserId: `${9007199254740993n + BigInt(index)}`, adId: "1876036593854788",
})) });
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-qianchuan-"));
  directories.push(directory);
  const file = path.join(directory, "accounts.json");
  await writeFile(file, JSON.stringify(config()), { mode: 0o600 });
  return { directory, file, reader: new QianchuanAccountConfigReader() };
}

describe("shared account mapping", () => {
  it("preserves decimal strings above Number precision and permits incomplete unselectable accounts", () => {
    const value = config();
    value.accounts[1].advertiserId = ""; value.accounts[1].adId = "";
    const accounts = parseAccountConfig(value);
    expect(accounts[0].advertiserId).toBe("9007199254740993");
    expect(accountPageUrl(accounts[0])).toBe("https://qianchuan.jinritemai.com/uni-prom?aavid=9007199254740993&adId=1876036593854788");
    expect(() => accountPageUrl(accounts[1])).toThrow();
  });

  it.each([
    ["unknown root field", (value: any) => { value.extra = true; }],
    ["unknown entry field", (value: any) => { value.accounts[0].url = "https://example.com"; }],
    ["unknown version", (value: any) => { value.version = 2; }],
    ["missing product", (value: any) => { value.accounts.pop(); }],
    ["duplicate product", (value: any) => { value.accounts[1].product = value.accounts[0].product; }],
    ["unknown product", (value: any) => { value.accounts[0].product = "舒鼻膏"; }],
    ["duplicate account", (value: any) => { value.accounts[1].advertiserId = value.accounts[0].advertiserId; }],
    ["duplicate port", (value: any) => { value.accounts[1].cdpEndpoint = value.accounts[0].cdpEndpoint; }],
    ["numeric ID", (value: any) => { value.accounts[0].advertiserId = 9007199254740993; }],
    ["invalid ID", (value: any) => { value.accounts[0].adId = "123&adId=456"; }],
    ["leading zero", (value: any) => { value.accounts[0].adId = "0123"; }],
    ["oversized ID", (value: any) => { value.accounts[0].adId = "1".repeat(21); }],
    ["plan without account", (value: any) => { value.accounts[0].advertiserId = ""; }],
  ])("rejects %s", (_name, mutate) => { const value = config(); mutate(value); expect(() => parseAccountConfig(value)).toThrow(); });

  it.each(["http://example.com:9222", "http://localhost:9222", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:9222/", "http://user@127.0.0.1:9222", "http://127.0.0.1:9222?x=1", "http://127.0.0.1:9222#x", "http://127.0.0.1:09222", "https://127.0.0.1:9222"])("rejects endpoint %s", endpoint => {
    const value = config(); value.accounts[0].cdpEndpoint = endpoint;
    expect(() => parseAccountConfig(value)).toThrow();
  });
});

describe.skipIf(process.platform === "win32")("authorized local configuration", () => {
  it("requires explicit main-process authorization and emits a summary without private paths/endpoints", async () => {
    const { file, reader } = await fixture();
    await expect(reader.refresh()).rejects.toMatchObject({ code: "CONFIG_NOT_AUTHORIZED" });
    await expect(reader.authorizeFile("relative.json")).rejects.toMatchObject({ code: "CONFIG_PATH_INVALID" });
    const summary = await reader.authorizeFile(file);
    expect(summary).toHaveLength(6);
    expect(summary[0]).toEqual({ product: "蝴蝶贴", advertiserId: "9007199254740993", adId: "1876036593854788", available: true, browserPort: 9222 });
    expect(JSON.stringify(summary)).not.toContain(file);
    expect(JSON.stringify(summary)).not.toContain("cdpEndpoint");
  });

  it("freezes a fresh target, rejects changed digests, and leaves previous frozen bytes unchanged", async () => {
    const { file, reader } = await fixture();
    await reader.authorizeFile(file);
    const preflight = await reader.preflight("蝴蝶贴");
    expect(preflight.configDigest).toBe(createHash("sha256").update(JSON.stringify(config())).digest("hex"));
    const target = await reader.freeze("蝴蝶贴", preflight.configDigest);
    expect(Object.isFrozen(target)).toBe(true);
    const updated = config(); updated.accounts[0].adId = "123";
    await writeFile(file, JSON.stringify(updated));
    await expect(reader.freeze("蝴蝶贴", preflight.configDigest)).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    expect((await reader.preflight("蝴蝶贴")).adId).toBe("123");
    expect(target.adId).toBe("1876036593854788");
    await expect(reader.freeze("蝴蝶贴", "invalid")).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    await expect(reader.preflight("unknown" as any)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });

  it("disables incomplete mappings and rejects them before freezing", async () => {
    const { file, reader } = await fixture();
    const value = config(); value.accounts[0].adId = "";
    await writeFile(file, JSON.stringify(value));
    expect((await reader.authorizeFile(file))[0].available).toBe(false);
    await expect(reader.preflight("蝴蝶贴")).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });

  it("rejects symlinks, directories, unsafe permissions and oversized files on every read", async () => {
    const { directory, file, reader } = await fixture();
    const link = path.join(directory, "link.json"); await symlink(file, link);
    await expect(reader.authorizeFile(link)).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
    await expect(reader.authorizeFile(directory)).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
    await chmod(file, 0o644);
    await expect(reader.authorizeFile(file)).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
    await chmod(file, 0o400); await reader.authorizeFile(file);
    await chmod(file, 0o600); await writeFile(file, " ".repeat(65537));
    await expect(reader.refresh()).rejects.toMatchObject({ code: "CONFIG_TOO_LARGE" });
    await writeFile(file, JSON.stringify(config()));
    await chmod(file, 0o640);
    await expect(reader.preflight("蝴蝶贴")).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
    await chmod(file, 0o600); await rm(file); await symlink(link, file);
    await expect(reader.refresh()).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
  });

  it("rejects parent symlinks and unsafe special permission bits", async () => {
    const { directory, file, reader } = await fixture();
    const link = path.join(directory, "linked-directory");
    await symlink(directory, link);
    await expect(reader.authorizeFile(path.join(link, "accounts.json"))).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
    await chmod(file, 0o1600);
    await expect(reader.authorizeFile(file)).rejects.toMatchObject({ code: "CONFIG_FILE_UNSAFE" });
  });

  it("sanitizes malformed JSON/UTF-8 and I/O errors without retaining a failed new authorization", async () => {
    const { directory, file, reader } = await fixture();
    await reader.authorizeFile(file);
    const bad = path.join(directory, "secret-name.json");
    await writeFile(bad, "{broken", { mode: 0o600 });
    await expect(reader.authorizeFile(bad)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await reader.refresh()).toHaveLength(6);
    await writeFile(file, Buffer.from([0xff]));
    await expect(reader.refresh()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await rm(file);
    const error = await reader.refresh().catch(error => error);
    expect(error.code).toBe("CONFIG_UNAVAILABLE");
    expect(error.message).not.toContain(directory);
  });

  it("rejects a private replacement between lstat and open instead of authorizing its new mapping", async () => {
    const { directory, file, reader } = await fixture();
    const { open: actualOpen } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const replacement = path.join(directory, "replacement.json");
    const updated = config(); updated.accounts[0].adId = "123";
    await writeFile(replacement, JSON.stringify(updated), { mode: 0o600 });
    vi.mocked(filesystem.open).mockImplementationOnce(async (...args: Parameters<typeof filesystem.open>) => {
      await rename(replacement, file);
      return actualOpen(...args);
    });
    await expect(reader.authorizeFile(file)).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    await expect(reader.refresh()).rejects.toMatchObject({ code: "CONFIG_NOT_AUTHORIZED" });
  });

  it("bounds a file that grows after open and closes the descriptor on rejection", async () => {
    const { file, reader } = await fixture();
    const { open: actualOpen } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let close: ReturnType<typeof vi.spyOn> | undefined;
    vi.mocked(filesystem.open).mockImplementationOnce(async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await actualOpen(...args);
      const actualRead = handle.read.bind(handle);
      close = vi.spyOn(handle, "close");
      vi.spyOn(handle, "read").mockImplementationOnce(async (...readArgs: any[]) => {
        await writeFile(file, " ".repeat(65537));
        return (actualRead as any)(...readArgs);
      });
      return handle;
    });
    await expect(reader.authorizeFile(file)).rejects.toMatchObject({ code: "CONFIG_TOO_LARGE" });
    expect(close).toHaveBeenCalledOnce();
  });
});

it("blocks Windows before reading a file until file permission qualification exists", async () => {
  const reader = new QianchuanAccountConfigReader();
  vi.stubGlobal("process", { platform: "win32" });
  await expect(reader.authorizeFile(path.resolve("not-read.json"))).rejects.toMatchObject({ code: "PLATFORM_UNQUALIFIED" });
});
