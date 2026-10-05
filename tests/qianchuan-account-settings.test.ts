import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as persistence from "../src/main/douyin-upload-store";
import { parseQianchuanPlanUrl, QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const planUrl = (advertiserId = "1876024170199244", adId = "1876036593854788") => `https://qianchuan.jinritemai.com/uni-prom?aavid=${advertiserId}&adId=${adId}`;
it("resolves catalog connections without starting browsers or changing saved settings", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const existing = vi.fn(async () => "http://127.0.0.1:9441");
  const settings = new QianchuanAccountSettings(path.join(f.root, "app"), f.discover, existing);
  await settings.restore();
  const before = await readFile(settings.file);
  const target = await settings.prepareCatalog("蝴蝶贴");
  expect(target.cdpEndpoint).toBe("http://127.0.0.1:9441");
  expect(await settings.freeze(target.product, target.configDigest)).toEqual(target);
  expect(await readFile(settings.file)).toEqual(before);
  expect(existing).toHaveBeenCalledWith(target.advertiserId); expect(f.discover).not.toHaveBeenCalled();
  existing.mockImplementationOnce(async () => { await settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(target.advertiserId, "456") }); return "http://127.0.0.1:9442"; });
  await expect(settings.prepareCatalog("蝴蝶贴")).rejects.toThrow("已变化");
});
it("persists multiple template bindings independently without invalidating account digests", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const before = await readFile(f.settings.file), old = await f.settings.preflight("蝴蝶贴");
  const first = { recentProjectId: crypto.randomUUID(), projectId: crypto.randomUUID(), accountProduct: "蝴蝶贴", advertiserId: old.advertiserId };
  const second = { ...first, recentProjectId: crypto.randomUUID(), projectId: crypto.randomUUID() };
  await Promise.all([f.settings.saveTemplateAccount(first), f.settings.saveTemplateAccount(second)]);
  expect(await readFile(f.settings.file)).toEqual(before);
  expect(await f.settings.freeze("蝴蝶贴", old.configDigest)).toEqual(old);
  const reloaded = new QianchuanAccountSettings(path.join(f.root, "app")); await reloaded.restore();
  expect(await reloaded.templateAccount(first.recentProjectId, first.projectId)).toEqual(first);
  expect(await reloaded.templateAccount(second.recentProjectId, second.projectId)).toEqual(second);
  await expect(reloaded.templateAccount(first.recentProjectId, crypto.randomUUID())).rejects.toThrow("项目已变化");
  await expect(reloaded.saveTemplateAccount({ ...first, advertiserId: "123" })).rejects.toThrow("已变化");
  expect(f.discover).not.toHaveBeenCalled();
});
it("preserves corrupt and lost template bindings instead of falling back to name matching", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const binding = { recentProjectId: crypto.randomUUID(), projectId: crypto.randomUUID(), accountProduct: "蝴蝶贴", advertiserId: "1876024170199244" };
  await f.settings.saveTemplateAccount(binding);
  const file = path.join(path.dirname(f.settings.file), "template-accounts.json");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  await writeFile(file, "broken");
  await expect(f.settings.templateAccount(binding.recentProjectId, binding.projectId)).rejects.toThrow();
  await expect(f.settings.saveTemplateAccount(binding)).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("broken");
  await rm(file);
  await expect(f.settings.templateAccount(binding.recentProjectId, binding.projectId)).rejects.toThrow("关联丢失");
});
it("keeps template preference writes behind the same private-file and exclusive-writer boundary", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const binding = { recentProjectId: crypto.randomUUID(), projectId: crypto.randomUUID(), accountProduct: "蝴蝶贴", advertiserId: "1876024170199244" };
  const file = path.join(path.dirname(f.settings.file), "template-accounts.json"), lock = path.join(path.dirname(file), "write.lock");
  await writeFile(lock, "other writer", { mode: 0o600 });
  await expect(f.settings.saveTemplateAccount(binding)).rejects.toThrow("正在保存");
  await rm(lock); await f.settings.saveTemplateAccount(binding);
  await chmod(file, 0o644);
  await expect(f.settings.templateAccount(binding.recentProjectId, binding.projectId)).rejects.toThrow();
  await expect(f.settings.saveTemplateAccount(binding)).rejects.toThrow();
  await rm(file); await symlink(f.source, file);
  await expect(f.settings.saveTemplateAccount(binding)).rejects.toThrow();
  expect(f.discover).not.toHaveBeenCalled();
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-settings-")); roots.push(root);
  const source = path.join(root, "external.json");
  await writeFile(source, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, i) => ({ product, cdpEndpoint: `http://127.0.0.1:${9222 + i}`, advertiserId: `${1876024170199244n + BigInt(i)}`, adId: "1876036593854788" })) }), { mode: 0o600 });
  const discover = vi.fn(async (advertiserId: string) => `http://127.0.0.1:${advertiserId === "9007199254740993" ? 9230 : 9222 + Number(BigInt(advertiserId) - 1876024170199244n)}`);
  return { root, source, discover, settings: new QianchuanAccountSettings(path.join(root, "app"), discover) };
}
it("binds library clearing to the saved advertiser before browser discovery and holds the existing account writer lock", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const bytes = await readFile(f.settings.file);
  const account = { product: "蝴蝶贴", expectedAdvertiserId: "1876024170199244" };
  const input = { confirmation: "DELETE_ALL_VIDEOS", accounts: [account] };
  await expect(f.settings.withVideoLibraryTargets({ ...input, accounts: [{ ...account, expectedAdvertiserId: "999" }] }, async () => {})).rejects.toThrow("已变化");
  expect(f.discover).not.toHaveBeenCalled();
  f.discover.mockResolvedValue("http://127.0.0.1:41001");
  await f.settings.withVideoLibraryTargets(input, async (targets, fresh, connect) => {
    expect(targets[0].advertiserId).toBe(account.expectedAdvertiserId);
    expect((await connect(targets[0])).cdpEndpoint).toBe("http://127.0.0.1:41001");
    expect((await stat(path.join(path.dirname(f.settings.file), "write.lock"))).isFile()).toBe(true);
    await fresh();
  });
  expect(await readFile(f.settings.file)).toEqual(bytes);
});
it("rejects out-of-process mapping drift before the library deletion guard can succeed", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const input = { confirmation: "DELETE_ALL_VIDEOS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "1876024170199244" }] };
  await f.settings.withVideoLibraryTargets(input, async (_targets, fresh) => {
    const value = JSON.parse(await readFile(f.settings.file, "utf8")); value.accounts[0].advertiserId = "999";
    await writeFile(f.settings.file, JSON.stringify(value));
    await expect(fresh()).rejects.toThrow("已变化");
  });
});
it("binds plan cleanup to the saved plan before any browser discovery", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const input = { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "1876024170199244", expectedAdId: "999" }] };
  await expect(f.settings.withVideoLibraryTargets(input, async () => {})).rejects.toThrow("已变化");
  expect(f.discover).not.toHaveBeenCalled();
  await f.settings.withVideoLibraryTargets({ ...input, accounts: [{ ...input.accounts[0], expectedAdId: "1876036593854788" }] }, async (targets, fresh, connect) => {
    expect((await connect(targets[0])).adId).toBe("1876036593854788"); await fresh();
  });
});
it("prepares current browser bindings without changing the persisted mapping or earlier frozen batches", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const bytes = await readFile(f.settings.file), old = await f.settings.preflight("蝴蝶贴");
  f.discover.mockImplementation(async id => id === old.advertiserId ? "http://127.0.0.1:41001" : "http://127.0.0.1:41002");
  const first = await f.settings.prepare("蝴蝶贴"), second = await f.settings.prepare("眼贴");
  expect(first).toMatchObject({ ...old, cdpEndpoint: "http://127.0.0.1:41001" });
  expect(await f.settings.freeze("蝴蝶贴", first.configDigest)).toEqual(first);
  expect(await f.settings.freeze("眼贴", second.configDigest)).toEqual(second);
  expect(await readFile(f.settings.file)).toEqual(bytes);
  expect(old.cdpEndpoint).toBe("http://127.0.0.1:9222");
  f.discover.mockRejectedValueOnce(new Error("ambiguous browser"));
  await expect(f.settings.prepare("蝴蝶贴")).rejects.toThrow("ambiguous");
  expect(await f.settings.preflight("蝴蝶贴")).toEqual(first);
  await f.settings.savePlan({ product: "蝴蝶贴", productName: "改显示名", planUrl: planUrl(old.advertiserId, old.adId) });
  expect(await f.settings.preflight("蝴蝶贴")).toMatchObject({ cdpEndpoint: first.cdpEndpoint, productName: "改显示名" });
});
it("rejects browser-opening inputs with arbitrary paths or endpoints before starting Chrome", async () => {
  const f = await fixture();
  for (const extra of [{ profile: "/tmp/arbitrary" }, { cdpEndpoint: "http://127.0.0.1:1" }, { args: ["--no-sandbox"] }]) {
    await expect(f.settings.openBrowser({ product: "蝴蝶贴", planUrl: planUrl(), ...extra })).rejects.toThrow();
  }
  await expect(f.settings.openBrowser({ product: "蝴蝶贴", planUrl: "https://example.com/" })).rejects.toThrow();
});
it("controls only the saved account, clears its prepared connection and keeps mapping and frozen targets unchanged", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  f.discover.mockResolvedValue("http://127.0.0.1:41001");
  const old = await f.settings.prepare("蝴蝶贴"), before = await readFile(f.settings.file);
  const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
  const guard = vi.fn();
  await f.settings.controlBrowser({ product: "蝴蝶贴", expectedAdvertiserId: old.advertiserId, action: "restart" }, guard);
  expect(guard).toHaveBeenCalledWith(old.advertiserId); expect(control).toHaveBeenCalledWith(old.advertiserId, "restart", expect.any(Function));
  expect(await readFile(f.settings.file)).toEqual(before);
  expect((await f.settings.preflight("蝴蝶贴")).cdpEndpoint).toBe("http://127.0.0.1:9222");
  expect(old.cdpEndpoint).toBe("http://127.0.0.1:41001");
});
it("rejects changed account identity, unsafe control input and upload protection before any shutdown", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const control = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
  const input = { product: "蝴蝶贴", expectedAdvertiserId: "1876024170199244", action: "close" };
  await expect(f.settings.controlBrowser({ ...input, expectedAdvertiserId: "123" }, () => {})).rejects.toThrow("已变化");
  for (const extra of [{ pid: 42 }, { profile: "/tmp/other" }, { cdpEndpoint: "http://127.0.0.1:1" }]) await expect(f.settings.controlBrowser({ ...input, ...extra }, () => {})).rejects.toThrow();
  await expect(f.settings.controlBrowser(input, () => { throw new Error("pending upload"); })).rejects.toThrow("pending upload");
  expect(control).not.toHaveBeenCalled();
});
it("rejects mapping changes during browser discovery and never freezes a stale prepared binding", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  f.discover.mockImplementationOnce(async () => {
    await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("1876024170199244", "9999") });
    return "http://127.0.0.1:41001";
  });
  await expect(f.settings.prepare("蝴蝶贴")).rejects.toThrow("已变化");
  expect(await f.settings.preflight("蝴蝶贴")).toMatchObject({ adId: "9999", cdpEndpoint: "http://127.0.0.1:9222" });
});

it("extracts exact decimal strings from a pasted plan URL without carrying tracking or fragment state", () => {
  expect(parseQianchuanPlanUrl(` ${planUrl()}&awemeId=&dr=2026-09-28%2C2026-09-28#uni=%7B%22ad%22%3A%22ignored%22%7D `)).toEqual({ advertiserId: "1876024170199244", adId: "1876036593854788" });
});
it.each([
  "https://example.com/uni-prom?aavid=123&adId=456", "http://qianchuan.jinritemai.com/uni-prom?aavid=123&adId=456",
  "https://user:pass@qianchuan.jinritemai.com/uni-prom?aavid=123&adId=456", "https://qianchuan.jinritemai.com:444/uni-prom?aavid=123&adId=456",
  "https://qianchuan.jinritemai.com/other?aavid=123&adId=456", `${planUrl()}&aavid=123`, `${planUrl()}&adId=456`,
  "https://qianchuan.jinritemai.com/uni-prom?aavid=123", planUrl("0123"), planUrl("1e16"), planUrl("123", ""), planUrl("1".repeat(21)),
])("rejects ambiguous or unsupported plan URLs: %s", url => { expect(() => parseQianchuanPlanUrl(url)).toThrow(); });
it("supports a fresh installation entirely within the application without choosing JSON or guessing a browser", async () => {
  const f = await fixture(); expect(await f.settings.restore()).toEqual([]);
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() });
  expect(f.discover).toHaveBeenCalledTimes(1); expect(f.discover).toHaveBeenCalledWith("1876024170199244");
  expect(summaries).toEqual([{ product: "蝴蝶贴", advertiserId: "1876024170199244", adId: "1876036593854788", browserPort: 9222, available: true }]);
  const reloaded = new QianchuanAccountSettings(path.join(f.root, "app")); expect(await reloaded.restore()).toEqual(summaries);
  expect((await stat(f.settings.file)).mode & 0o777).toBe(0o600);
  expect((await reloaded.preflight("蝴蝶贴")).cdpEndpoint).toBe("http://127.0.0.1:9222");
  await expect(reloaded.preflight("眼贴")).rejects.toThrow();
});
it("imports existing six-account configuration once, preserving source bytes and owning subsequent edits internally", async () => {
  const f = await fixture(), bytes = await readFile(f.source);
  expect(await f.settings.authorizeFile(f.source)).toHaveLength(6);
  const old = await f.settings.preflight("蝴蝶贴");
  await f.settings.savePlan({ product: "蝴蝶贴", planUrl: `${planUrl(old.advertiserId, "9007199254740993")}&utm_source=ignored#ignored` });
  expect(await readFile(f.source)).toEqual(bytes);
  expect((await f.settings.preflight("蝴蝶贴"))).toMatchObject({ adId: "9007199254740993", cdpEndpoint: old.cdpEndpoint });
  expect(f.discover).not.toHaveBeenCalled();
  await expect(f.settings.freeze("蝴蝶贴", old.configDigest)).rejects.toThrow("已变化");
  expect(old.adId).toBe("1876036593854788");
  const saved = await readFile(f.settings.file, "utf8"); expect(saved).not.toContain("utm_source"); expect(saved).not.toContain("planUrl");
  await rm(f.source);
  expect(await new QianchuanAccountSettings(path.join(f.root, "app")).restore(f.source)).toHaveLength(6);
});
it("renames a product without discovering or changing its Chrome, advertiser or plan, and restores the name", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const old = await f.settings.preflight("蝴蝶贴"), sourceBytes = await readFile(f.source);
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", productName: "  新产品  ", planUrl: planUrl() });
  expect(summaries.find(account => account.product === "蝴蝶贴")).toMatchObject({ productName: "新产品", browserPort: 9222 });
  expect(f.discover).not.toHaveBeenCalled();
  expect(await f.settings.preflight("蝴蝶贴")).toMatchObject({ product: old.product, productName: "新产品", cdpEndpoint: old.cdpEndpoint, advertiserId: old.advertiserId, adId: old.adId });
  expect(old).not.toHaveProperty("productName");
  await expect(f.settings.freeze("蝴蝶贴", old.configDigest)).rejects.toThrow("已变化");
  expect(await readFile(f.source)).toEqual(sourceBytes);
  expect(await new QianchuanAccountSettings(path.join(f.root, "app")).restore()).toEqual(summaries);
  await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(old.advertiserId, "9999") });
  expect(await f.settings.preflight("蝴蝶贴")).toMatchObject({ productName: "新产品", cdpEndpoint: old.cdpEndpoint, adId: "9999" });
});
it.each(["", "  ", "x".repeat(41), "名称\n换行", "眼贴"])("rejects invalid or ambiguous product names without changing the mapping: %s", async productName => {
  const f = await fixture(); await f.settings.authorizeFile(f.source); const before = await readFile(f.settings.file);
  await expect(f.settings.savePlan({ product: "蝴蝶贴", productName, planUrl: planUrl() })).rejects.toThrow();
  expect(await readFile(f.settings.file)).toEqual(before); expect(f.discover).not.toHaveBeenCalled();
});
it("rejects duplicate custom names even when the other account is already renamed", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  await f.settings.savePlan({ product: "蝴蝶贴", productName: "新产品", planUrl: planUrl() });
  const before = await readFile(f.settings.file);
  const other = await f.settings.preflight("眼贴");
  await expect(f.settings.savePlan({ product: "眼贴", productName: "新产品", planUrl: planUrl(other.advertiserId, other.adId) })).rejects.toThrow();
  expect(await readFile(f.settings.file)).toEqual(before);
});
it("migrates a previously authorized external mapping and never falls back from corrupt internal settings", async () => {
  const f = await fixture(); expect(await f.settings.restore(f.source)).toHaveLength(6);
  await writeFile(f.settings.file, "invalid JSON");
  await expect(new QianchuanAccountSettings(path.join(f.root, "app")).restore(f.source)).rejects.toThrow();
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow();
  expect(await readFile(f.settings.file, "utf8")).toBe("invalid JSON");
});
it("rejects unsafe import, duplicate bindings and forged fields without changing the saved mapping", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source); const before = await readFile(f.settings.file);
  const link = path.join(f.root, "link.json"); await symlink(f.source, link); await expect(f.settings.authorizeFile(link)).rejects.toThrow();
  await expect(f.settings.savePlan({ product: "眼贴", planUrl: planUrl() })).rejects.toThrow();
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), browserPort: 9223 })).rejects.toThrow();
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), cdpEndpoint: "http://example.com" })).rejects.toThrow();
  expect(await readFile(f.settings.file)).toEqual(before);
});
it("serializes edits so saving two products preserves both mappings", async () => {
  const f = await fixture(); await Promise.all([
    f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() }),
    f.settings.savePlan({ product: "眼贴", planUrl: planUrl("9007199254740993") }),
  ]); expect(await f.settings.refresh()).toHaveLength(2);
});
it("keeps lost, unsafe and locked settings blocked without erasing their evidence", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source); const before = await readFile(f.settings.file);
  await writeFile(path.join(path.dirname(f.settings.file), "write.lock"), "owned elsewhere", { mode: 0o600 });
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow("正在保存");
  expect(await readFile(f.settings.file)).toEqual(before);
  await rm(path.join(path.dirname(f.settings.file), "write.lock"));
  await chmod(f.settings.file, 0o644);
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow();
  await rm(f.settings.file);
  const reloaded = new QianchuanAccountSettings(path.join(f.root, "app"));
  await expect(reloaded.restore(f.settings.file)).rejects.toThrow("丢失");
  await expect(reloaded.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow("丢失");
});
it("rediscovers changed advertisers, preserving frozen targets and leaving the mapping untouched on discovery failure", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  const old = await f.settings.preflight("蝴蝶贴"), before = await readFile(f.settings.file);
  f.discover.mockRejectedValueOnce(new Error("未找到该账户的可连接浏览器"));
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("9007199254740993") })).rejects.toThrow("未找到");
  expect(await readFile(f.settings.file)).toEqual(before);
  expect((await f.settings.preflight("蝴蝶贴")).cdpEndpoint).toBe(old.cdpEndpoint);
  await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("9007199254740993") });
  expect(await f.settings.preflight("蝴蝶贴")).toMatchObject({ advertiserId: "9007199254740993", cdpEndpoint: "http://127.0.0.1:9230" });
  expect(old).toMatchObject({ advertiserId: "1876024170199244", cdpEndpoint: "http://127.0.0.1:9222" });
});
it("blocks configuration use after an uncertain directory-sync failure", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  vi.spyOn(persistence, "strictSyncDirectory").mockRejectedValue(new Error("sync failure"));
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("1876024170199244", "9999") })).rejects.toThrow("sync failure");
  await expect(f.settings.preflight("蝴蝶贴")).rejects.toThrow("结果未知");
  await expect(f.settings.refresh()).rejects.toThrow("结果未知");
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow("结果未知");
});
