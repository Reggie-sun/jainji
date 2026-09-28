import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as persistence from "../src/main/douyin-upload-store";
import { parseQianchuanPlanUrl, QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const planUrl = (advertiserId = "1876024170199244", adId = "1876036593854788") => `https://qianchuan.jinritemai.com/uni-prom?aavid=${advertiserId}&adId=${adId}`;
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-settings-")); roots.push(root);
  const source = path.join(root, "external.json");
  await writeFile(source, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, i) => ({ product, cdpEndpoint: `http://127.0.0.1:${9222 + i}`, advertiserId: `${1876024170199244n + BigInt(i)}`, adId: "1876036593854788" })) }), { mode: 0o600 });
  return { root, source, settings: new QianchuanAccountSettings(path.join(root, "app")) };
}

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
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow("浏览器端口");
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), browserPort: 9222 });
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
  await expect(f.settings.freeze("蝴蝶贴", old.configDigest)).rejects.toThrow("已变化");
  expect(old.adId).toBe("1876036593854788");
  const saved = await readFile(f.settings.file, "utf8"); expect(saved).not.toContain("utm_source"); expect(saved).not.toContain("planUrl");
  await rm(f.source);
  expect(await new QianchuanAccountSettings(path.join(f.root, "app")).restore(f.source)).toHaveLength(6);
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
    f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), browserPort: 9222 }),
    f.settings.savePlan({ product: "眼贴", planUrl: planUrl("9007199254740993"), browserPort: 9223 }),
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
  await expect(reloaded.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), browserPort: 9222 })).rejects.toThrow("丢失");
});
it("blocks configuration use after an uncertain directory-sync failure", async () => {
  const f = await fixture(); await f.settings.authorizeFile(f.source);
  vi.spyOn(persistence, "strictSyncDirectory").mockRejectedValue(new Error("sync failure"));
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("1876024170199244", "9999") })).rejects.toThrow("sync failure");
  await expect(f.settings.preflight("蝴蝶贴")).rejects.toThrow("结果未知");
  await expect(f.settings.refresh()).rejects.toThrow("结果未知");
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl() })).rejects.toThrow("结果未知");
});
