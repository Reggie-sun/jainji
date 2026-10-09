import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { QianchuanAccountSettingsSchema, QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { FrozenAccountSchema } from "../src/shared/douyin-upload";
import { qianchuanEgressRuntime } from "../src/main/qianchuan-egress-runtime";

const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
const planUrl = (id = "123") => `https://qianchuan.jinritemai.com/uni-prom?aavid=${id}&adId=456`;
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-settings-")); roots.push(root);
  const closed = vi.spyOn(QianchuanBrowserManager.prototype, "assertClosed").mockResolvedValue();
  const discover = vi.fn(async () => "http://127.0.0.1:9222");
  return { root, closed, discover, settings: new QianchuanAccountSettings(root, discover) };
}
it("saves before connecting and freezes the route in the existing private account digest", async () => {
  const f = await fixture();
  const summary = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route });
  expect(summary[0].egress).toEqual(route); expect(f.discover).not.toHaveBeenCalled();
  const frozen = await f.settings.preflight("蝴蝶贴");
  expect(FrozenAccountSchema.parse(frozen).egress).toEqual(route);
  await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), productName: "新名称" });
  expect((await f.settings.preflight("蝴蝶贴")).egress).toEqual(route);
  await expect(f.settings.freeze("蝴蝶贴", frozen.configDigest)).rejects.toThrow();
  expect((await new QianchuanAccountSettings(f.root).restore())[0].egress).toEqual(route);
});
it("blocks both enabling and removing egress while Chrome or a protected task is present", async () => {
  const f = await fixture();
  const input = { product: "蝴蝶贴", planUrl: planUrl(), egress: route };
  await f.settings.savePlan(input);
  const bytes = await readFile(f.settings.file);
  f.closed.mockRejectedValueOnce(new Error("浏览器仍打开"));
  await expect(f.settings.savePlan({ ...input, egress: null })).rejects.toThrow("浏览器");
  await expect(f.settings.savePlan({ ...input, egress: null }, () => { throw new Error("受保护任务"); })).rejects.toThrow("受保护任务");
  expect(await readFile(f.settings.file)).toEqual(bytes);
});
it("does not inherit an old advertiser's route and rejects inconsistent shared groups", async () => {
  const f = await fixture(); await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route });
  await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl("124") });
  expect((await f.settings.preflight("蝴蝶贴")).egress).toBeUndefined();
  const accounts = [{ product: "蝴蝶贴", advertiserId: "123", adId: "456", cdpEndpoint: "http://127.0.0.1:9222", egress: route },
    { product: "眼贴", advertiserId: "124", adId: "456", cdpEndpoint: "http://127.0.0.1:9223", egress: { ...route, group: "主体二" } }];
  expect(QianchuanAccountSettingsSchema.safeParse({ version: 1, accounts }).success).toBe(false);
});
it("import cannot bypass the same egress task guard", async () => {
  const f = await fixture();
  const accounts = QIANCHUAN_PRODUCTS.map((product, i) => ({ product, advertiserId: String(123 + i), adId: "456", cdpEndpoint: `http://127.0.0.1:${9222 + i}` }));
  const file = path.join(f.root, "import.json");
  await writeFile(file, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  await f.settings.authorizeFile(file);
  const bytes = await readFile(f.settings.file);
  await writeFile(file, JSON.stringify({ version: 1, accounts: accounts.map((account, i) => i === 0 ? { ...account, egress: route } : account) }));
  await expect(f.settings.authorizeFile(file, () => { throw new Error("任务未结束"); })).rejects.toThrow("任务未结束");
  expect(await readFile(f.settings.file)).toEqual(bytes);
});
it("explicit reconnect only restores the frozen route connection without closing Chrome or discovering pages", async () => {
  const f = await fixture(); await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route });
  const recover = vi.spyOn(qianchuanEgressRuntime, "recover").mockImplementation(() => {});
  const lease = { identity: "fixture", signal: new AbortController().signal };
  vi.spyOn(qianchuanEgressRuntime, "ensure").mockResolvedValue(lease);
  vi.spyOn(qianchuanEgressRuntime, "verify").mockResolvedValue(lease);
  const control = vi.spyOn(QianchuanBrowserManager.prototype, "control");
  const bytes = await readFile(f.settings.file);
  await f.settings.controlBrowser({ product: "蝴蝶贴", expectedAdvertiserId: "123", action: "reconnect-egress" }, () => {});
  expect(recover).toHaveBeenCalledWith(route); expect(control).not.toHaveBeenCalled(); expect(f.discover).not.toHaveBeenCalled();
  expect(await readFile(f.settings.file)).toEqual(bytes);
});
it("startup legacy import cannot introduce an egress route past the protected-task guard", async () => {
  const f = await fixture();
  const file = path.join(f.root, "legacy.json");
  const accounts = QIANCHUAN_PRODUCTS.map((product, i) => ({ product, advertiserId: String(123 + i), adId: "456", cdpEndpoint: `http://127.0.0.1:${9222 + i}`, ...(i === 0 ? { egress: route } : {}) }));
  await writeFile(file, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  await expect(f.settings.restore(file, () => { throw new Error("任务未结束"); })).rejects.toThrow("任务未结束");
  await expect(readFile(f.settings.file)).rejects.toMatchObject({ code: "ENOENT" });
});
