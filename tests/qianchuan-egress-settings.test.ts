import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import { QianchuanAccountSettingsSchema, QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { FrozenAccountSchema } from "../src/shared/douyin-upload";
import { qianchuanEgressRuntime } from "../src/main/qianchuan-egress-runtime";
import * as browserDiscovery from "../src/main/qianchuan-browser-discovery";
import * as browserProcess from "../src/main/qianchuan-browser-process";

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
async function groupFixture(remote = true) {
  const f = await fixture(), expected = remote ? { ...route, mode: "remote-browser" as const } : route;
  await f.settings.savePlan({ product: "蝴蝶贴", productName: "主体一商品", planUrl: planUrl(), egress: expected });
  await f.settings.savePlan({ product: "眼贴", productName: "主体一眼贴", planUrl: planUrl("124"), egress: expected });
  await f.settings.savePlan({ product: "肥皂", planUrl: planUrl("125"), egress: { ...route, group: "主体二", sshHost: "shop-two", localPort: 19382, expectedIp: "203.0.113.12" } });
  f.closed.mockClear();
  return { ...f, expected, change: { expected, advertiserIds: ["123", "124"] } };
}
it.each([true, false])("atomically switches every approved subject member while preserving other targets (remote=%s)", async remote => {
  const f = await groupFixture(remote), before = JSON.parse(await readFile(f.settings.file, "utf8"));
  const guard = vi.fn(), egress = remote ? route : { ...route, mode: "remote-browser" };
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl().replace("adId=456", "adId=789"), egress, egressGroupChange: f.change }, guard);
  expect(summaries.filter(item => ["123", "124"].includes(item.advertiserId)).map(item => item.egress)).toEqual([egress, egress]);
  expect(guard.mock.calls.map(call => call[0])).toEqual([["123", "124"], ["123", "124"]]);
  expect(f.closed.mock.calls).toEqual([["123"], ["124"]]);
  const after = JSON.parse(await readFile(f.settings.file, "utf8"));
  expect(after.accounts[0]).toEqual({ ...before.accounts[0], adId: "789", egress });
  expect(after.accounts[1]).toEqual({ ...before.accounts[1], egress });
  expect(after.accounts[2]).toEqual(before.accounts[2]);
  expect((await new QianchuanAccountSettings(f.root).restore()).map(item => item.egress)).toEqual(after.accounts.map((item: any) => item.egress));
  expect(f.discover).not.toHaveBeenCalled();
});
it("keeps the entire subject unchanged when any approved member has protected work or an open browser", async () => {
  const f = await groupFixture(), input = { product: "蝴蝶贴", planUrl: planUrl(), egress: route, egressGroupChange: f.change };
  const before = await readFile(f.settings.file);
  await expect(f.settings.savePlan(input, ids => { if (ids.includes("124")) throw Error("成员有受保护任务"); })).rejects.toThrow("受保护任务");
  expect(f.closed).not.toHaveBeenCalled();
  f.closed.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("另一成员浏览器未关闭"));
  await expect(f.settings.savePlan(input)).rejects.toThrow("另一成员浏览器");
  expect(await readFile(f.settings.file)).toEqual(before);
});
it("rejects stale subject membership, stale original routes and broader route migrations without changing bytes", async () => {
  const f = await groupFixture(), input = { product: "蝴蝶贴", planUrl: planUrl(), egress: route, egressGroupChange: f.change };
  const before = await readFile(f.settings.file);
  for (const patch of [
    { egressGroupChange: { ...f.change, advertiserIds: ["123"] } },
    { egressGroupChange: { ...f.change, advertiserIds: ["123", "125"] } },
    { egressGroupChange: { ...f.change, advertiserIds: ["123", "124", "125"] } },
    { egressGroupChange: { ...f.change, advertiserIds: ["123", "123"] } },
    { egressGroupChange: { ...f.change, expected: route } },
    { egress: { ...route, expectedIp: "203.0.113.99" } },
    { egress: null },
    { planUrl: planUrl("125") },
    { egress: f.expected },
  ]) await expect(f.settings.savePlan({ ...input, ...patch })).rejects.toThrow();
  expect(await readFile(f.settings.file)).toEqual(before);
  expect(f.closed).not.toHaveBeenCalled();
});
it("derives the whole subject in the backend without a separate group request", async () => {
  const f = await groupFixture();
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route });
  expect(summaries.slice(0, 2).map(account => account.egress)).toEqual([route, route]);
});
it("normally closes all idle subject browsers before publishing the new mode", async () => {
  const f = await groupFixture(), before = await readFile(f.settings.file), guard = vi.fn();
  const close = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async () => {
    expect(await readFile(f.settings.file)).toEqual(before);
  });
  const summaries = await f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route }, guard, true);
  expect(close.mock.calls.map(call => call.slice(0, 2))).toEqual([["123", "close"], ["124", "close"]]);
  expect(summaries.slice(0, 2).map(account => account.egress)).toEqual([route, route]);
  expect(guard.mock.calls[0][1].map((account: any) => account.product)).toEqual(["蝴蝶贴", "眼贴"]);
});
it("does not start closing protected subjects and never partially saves after a close failure", async () => {
  const f = await groupFixture(), before = await readFile(f.settings.file);
  const close = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
  const input = { product: "蝴蝶贴", planUrl: planUrl(), egress: route };
  await expect(f.settings.savePlan(input, () => { throw Error("受保护任务"); }, true)).rejects.toThrow("受保护任务");
  expect(close).not.toHaveBeenCalled();
  close.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("关闭结果未知"));
  await expect(f.settings.savePlan(input, () => {}, true)).rejects.toThrow("关闭结果未知");
  expect(await readFile(f.settings.file)).toEqual(before);
});
it("rechecks protected work immediately before local shutdown and before writing", async () => {
  const f = await groupFixture(), before = await readFile(f.settings.file), browser = { profile: "/fixture/profile", endpoint: "http://127.0.0.1:9222" };
  const shutdown = vi.fn();
  vi.spyOn(QianchuanBrowserManager.prototype, "control").mockImplementation(async (_id, _action, guard) => { guard?.(browser); shutdown(); });
  const input = { product: "蝴蝶贴", planUrl: planUrl(), egress: route };
  await expect(f.settings.savePlan(input, (_ids, _accounts, actual) => { if (actual) throw Error("共享浏览器有任务"); }, true)).rejects.toThrow("共享浏览器");
  expect(shutdown).not.toHaveBeenCalled();
  const verifiedClosed: string[] = [];
  f.closed.mockImplementation(async id => { verifiedClosed.push(id); });
  await expect(f.settings.savePlan(input, () => { if (verifiedClosed.length === 2) throw Error("保护状态已变化"); }, true)).rejects.toThrow("保护状态已变化");
  expect(shutdown).toHaveBeenCalledTimes(2);
  expect(verifiedClosed).toEqual(["123", "124"]);
  expect(await readFile(f.settings.file)).toEqual(before);
});
it("requires a service task guard before any automatic browser shutdown", async () => {
  const f = await groupFixture(), close = vi.spyOn(QianchuanBrowserManager.prototype, "control").mockResolvedValue();
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route }, undefined, true)).rejects.toThrow("保护检查");
  expect(close).not.toHaveBeenCalled();
});
it.each(["idle", "protected", "shared-protected"])("switches an imported unbound original browser safely (%s)", async state => {
  const parent = await mkdtemp(path.join(tmpdir(), "jianji-original-switch-")); roots.push(parent);
  const root = path.join(parent, "app"), profile = path.join(parent, "original");
  await mkdir(path.join(profile, "Profile 9"), { recursive: true, mode: 0o700 });
  const login = path.join(profile, "Profile 9", "login-fixture");
  await writeFile(login, "retained", { mode: 0o600 });
  const accounts = QIANCHUAN_PRODUCTS.map((product, i) => ({ product, advertiserId: String(123 + i), adId: "456", cdpEndpoint: `http://127.0.0.1:${9421 + i}` }));
  const file = path.join(parent, "import.json");
  await writeFile(file, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
  const running = [{ profile, profileDirectory: "Profile 9", windowClass: "cp-original", endpoint: "http://127.0.0.1:9521" }];
  vi.spyOn(browserDiscovery, "runningChromeBrowsers").mockImplementation(async () => running);
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (String(input) !== "http://127.0.0.1:9521/json/list") throw Error("unexpected network activity");
    return new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/home?aavid=123" }]));
  });
  const shutdown = vi.spyOn(browserProcess, "shutdownAccountChrome").mockImplementation(async browser => {
    expect(browser).toEqual(running[0]); running.splice(0);
  });
  const launch = vi.spyOn(QianchuanBrowserManager.prototype, "open");
  const settings = new QianchuanAccountSettings(root);
  await settings.authorizeFile(file);
  const before = await readFile(settings.file), binding = path.join(root, "account-browser-bindings", "bindings.json");
  const guard = vi.fn((_ids: string[], _accounts?: unknown, browser?: browserDiscovery.RunningChromeBrowser) => {
    if (state === "protected" || state === "shared-protected" && browser) throw Error("受保护任务");
  });
  const save = settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route }, guard, true);
  if (state === "idle") {
    expect((await save)[0].egress).toEqual(route);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(binding, "utf8")).bindings[0]).toMatchObject({ profile, profileDirectory: "Profile 9" });
  } else {
    await expect(save).rejects.toThrow("受保护任务");
    expect(shutdown).not.toHaveBeenCalled();
    expect(await readFile(settings.file)).toEqual(before);
    await expect(lstat(binding)).rejects.toMatchObject({ code: "ENOENT" });
  }
  expect(await readFile(login, "utf8")).toBe("retained");
  expect(launch).not.toHaveBeenCalled();
});
it("rejects a previously approved member list after another account joins the subject", async () => {
  const f = await groupFixture();
  await f.settings.savePlan({ product: "氨糖膏", planUrl: planUrl("126"), egress: f.expected });
  const before = await readFile(f.settings.file), guard = vi.fn(); f.closed.mockClear();
  await expect(f.settings.savePlan({ product: "蝴蝶贴", planUrl: planUrl(), egress: route, egressGroupChange: f.change }, guard)).rejects.toThrow("主体账号或原出口设置已变化");
  expect(await readFile(f.settings.file)).toEqual(before);
  expect(guard).not.toHaveBeenCalled(); expect(f.closed).not.toHaveBeenCalled();
});
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
