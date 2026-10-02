import { spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanBrowserManager, accountChromeArguments } from "../src/main/qianchuan-browser-manager";
import { runningChromeBrowsers, type RunningChromeBrowser } from "../src/main/qianchuan-browser-discovery";
import { readChromeTargets } from "../src/main/local-cdp-transport";
import { chromium } from "playwright-core";
import * as persistence from "../src/main/douyin-upload-store";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-account-browser-")); roots.push(root);
  const running: RunningChromeBrowser[] = [];
  const launch = vi.fn(async (profile: string) => { running.push({ profile, endpoint: `http://127.0.0.1:${9300 + running.length}` }); });
  const browsers = vi.fn(async () => running);
  const ready = vi.fn(async () => true);
  return { root, running, launch, browsers, ready, manager: new QianchuanBrowserManager(root, { launch, browsers, ready, startupMs: 200 }) };
}

it("does nothing at construction, starts one browser per account, coalesces requests and reuses its exact profile", async () => {
  const f = await fixture(); expect(f.launch).not.toHaveBeenCalled();
  const [one, two] = await Promise.all([f.manager.open("123"), f.manager.open("123")]);
  expect(one).toBe(two); expect(f.launch).toHaveBeenCalledTimes(1);
  expect(await f.manager.open("123")).toBe(one); expect(f.launch).toHaveBeenCalledTimes(1);
  expect(await f.manager.open("456")).not.toBe(one);
  expect(f.launch.mock.calls.map(call => call[0])).toEqual([path.join(f.root, "account-browsers", "123"), path.join(f.root, "account-browsers", "456")]);
  const reloaded = new QianchuanBrowserManager(f.root, { launch: f.launch, browsers: f.browsers });
  expect(await reloaded.open("123")).toBe(one); expect(f.launch).toHaveBeenCalledTimes(2);
  await reloaded.open("123", true); expect(f.launch).toHaveBeenCalledTimes(3);
});

it("uses loopback dynamic debugging from process startup, without a shell or user-provided URL", () => {
  const args = accountChromeArguments("/private/account profile", "123");
  expect(args).toContain("--remote-debugging-address=127.0.0.1");
  expect(args).toContain("--remote-debugging-port=0");
  expect(args).toContain("--start-maximized");
  expect(args[0]).toBe("--user-data-dir=/private/account profile");
  expect(args.at(-1)).toBe("https://qianchuan.jinritemai.com/uni-prom?aavid=123");
});

it("rejects injected account paths and profile aliases before browser launch", async () => {
  const f = await fixture();
  for (const id of ["../123", "123 --flag", "0", "", "https://example.com"]) expect(() => f.manager.open(id)).toThrow();
  const profiles = path.join(f.root, "account-browsers"); await mkdir(profiles, { mode: 0o700 });
  const elsewhere = path.join(f.root, "elsewhere"); await mkdir(elsewhere, { mode: 0o700 });
  await symlink(elsewhere, path.join(profiles, "123"));
  await expect(f.manager.open("123")).rejects.toThrow(); expect(f.launch).not.toHaveBeenCalled();
});

it("rejects ambiguous or permission-prompt browser bindings rather than falling back", async () => {
  const f = await fixture(), profile = path.join(f.root, "account-browsers", "123");
  f.running.push({ profile, endpoint: "ws://127.0.0.1:9222/devtools/browser/permission" });
  await expect(f.manager.open("123")).rejects.toThrow("不是简辑启动");
  f.running.splice(0, 1, { profile, endpoint: "http://127.0.0.1:9222" }, { profile, endpoint: "http://127.0.0.1:9223" });
  await expect(f.manager.open("123")).rejects.toThrow("不唯一"); expect(f.launch).not.toHaveBeenCalled();
});

it("bounds unsuccessful startup and does not kill or erase profiles", async () => {
  const f = await fixture(); f.launch.mockImplementation(async () => undefined);
  await expect(f.manager.open("123")).rejects.toThrow("未能启动");
  expect(f.launch).toHaveBeenCalledTimes(1);
  f.launch.mockImplementation(async profile => { f.running.push({ profile, endpoint: "http://127.0.0.1:9321" }); });
  expect(await f.manager.open("123")).toBe("http://127.0.0.1:9321");
});

it("waits for reachable startup CDP rather than treating a leftover port file as ready", async () => {
  const f = await fixture(); f.ready.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await f.manager.open("123")).toBe("http://127.0.0.1:9300"); expect(f.ready).toHaveBeenCalledTimes(2);
  expect(f.launch).toHaveBeenCalledTimes(1);
});

it("requires the selected account page and never probes another browser during preparation", async () => {
  const f = await fixture();
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/uni-prom?aavid=999" }])));
  await expect(f.manager.prepare("123")).rejects.toThrow("登录千川");
  request.mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/uni-prom?aavid=123" }])));
  expect(await f.manager.prepare("123")).toBe("http://127.0.0.1:9300");
  expect(request.mock.calls.every(call => call[0] === "http://127.0.0.1:9300/json/list")).toBe(true);
});

async function originalFixture() {
  const f = await fixture(), original = path.join(f.root, "original");
  await mkdir(path.join(original, "Profile 9"), { recursive: true, mode: 0o700 });
  // The app directory is separate from the pre-existing original profile.
  const root = path.join(f.root, "app");
  const manager = new QianchuanBrowserManager(root, { launch: f.launch, browsers: f.browsers, ready: f.ready, startupMs: 200 });
  const browser = { profile: original, profileDirectory: "Profile 9", windowClass: "cp-original", endpoint: "http://127.0.0.1:9421" };
  f.running.push(browser);
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async input => new Response(JSON.stringify([{ type: "page", url: `https://qianchuan.jinritemai.com/home?aavid=${String(input).includes(":9421/") ? "123" : "456"}` }])));
  return { ...f, root, manager, original, browser, request, binding: path.join(root, "account-browser-bindings", "bindings.json") };
}

it("prefers a verified original account over an app profile, persists only metadata and follows its new port after reload", async () => {
  const f = await originalFixture();
  f.running.push({ profile: path.join(f.root, "account-browsers", "123"), endpoint: "http://127.0.0.1:9422" });
  expect(await f.manager.prepare("123")).toBe(f.browser.endpoint);
  expect(f.launch).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(f.binding, "utf8"))).toEqual({ version: 1, bindings: [{ advertiserId: "123", profile: f.original, profileDirectory: "Profile 9", windowClass: "cp-original" }] });
  f.browser.endpoint = "http://127.0.0.1:9423";
  const reloaded = new QianchuanBrowserManager(f.root, { launch: f.launch, browsers: f.browsers });
  expect(await reloaded.open("123")).toBe(f.browser.endpoint);
  expect(f.launch).not.toHaveBeenCalled();
});

it.each([0o755, 0o775])("reuses an owned original profile-directory with mode %s inside a private user-data root", async mode => {
  const f = await originalFixture(), directory = path.join(f.original, "Profile 9");
  await chmod(directory, mode);
  expect(await f.manager.prepare("123")).toBe(f.browser.endpoint);
  expect((await lstat(directory)).mode & 0o777).toBe(mode);
  expect(f.launch).not.toHaveBeenCalled();
});

it("rejects a non-private original user-data root even when its profile-directory is private", async () => {
  const f = await originalFixture(); await chmod(f.original, 0o775);
  await expect(f.manager.open("123")).rejects.toThrow("绑定");
  await expect(lstat(f.binding)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.launch).not.toHaveBeenCalled();
});

it("reopens a closed bound original profile with its exact profile-directory and desktop identity", async () => {
  const f = await originalFixture(); await f.manager.prepare("123"); f.running.splice(0);
  f.launch.mockImplementation(async profile => { f.running.push({ ...f.browser, profile, endpoint: "http://127.0.0.1:9300" }); });
  const reloaded = new QianchuanBrowserManager(f.root, { launch: f.launch, browsers: f.browsers, ready: f.ready, startupMs: 200 });
  expect(await reloaded.open("123")).toBe("http://127.0.0.1:9300");
  expect(f.launch).toHaveBeenCalledWith(f.original, "123", { profileDirectory: "Profile 9", windowClass: "cp-original" });
});

it("does not launch a replacement when a bound original requires permission or has a different profile-directory", async () => {
  const f = await originalFixture(); await f.manager.prepare("123");
  f.browser.endpoint = "ws://127.0.0.1:9421/devtools/browser/permission";
  await expect(f.manager.open("123")).rejects.toThrow("正常关闭");
  f.browser.endpoint = "http://127.0.0.1:9421"; f.browser.profileDirectory = "Profile 10";
  await expect(f.manager.open("123")).rejects.toThrow("目录");
  expect(f.launch).not.toHaveBeenCalled();
});

it("blocks unconfigured original windows without opening another login profile", async () => {
  const f = await originalFixture(); f.browser.endpoint = "ws://127.0.0.1:9421/devtools/browser/permission";
  await expect(f.manager.open("123")).rejects.toThrow("原账号");
  expect(f.request).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
});

it("does not forward a launch to an already running bound original with debugging disabled", async () => {
  const f = await originalFixture(); await f.manager.prepare("123");
  f.running.splice(0, 1, { profile: f.original, profileDirectory: "Profile 9", windowClass: "cp-original" });
  await expect(f.manager.open("123")).rejects.toThrow("没有常规 CDP"); expect(f.launch).not.toHaveBeenCalled();
});

it("rejects ambiguous original accounts and never uses their order or a cached app port", async () => {
  const f = await originalFixture(), other = path.join(path.dirname(f.root), "other");
  await mkdir(path.join(other, "Profile 9"), { recursive: true, mode: 0o700 });
  f.running.push({ ...f.browser, profile: other, endpoint: "http://127.0.0.1:9424" });
  f.request.mockImplementation(async () => new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/home?aavid=123" }])));
  await expect(f.manager.open("123")).rejects.toThrow("多个"); expect(f.launch).not.toHaveBeenCalled();
});

it.each(["missing", "invalid", "alias"])("fails closed when a durable original binding is %s", async mode => {
  const f = await originalFixture(); await f.manager.prepare("123");
  if (mode === "missing") await rm(f.binding);
  if (mode === "invalid") await writeFile(f.binding, "{}");
  if (mode === "alias") { const bytes = await readFile(f.binding); await rm(f.binding); await writeFile(path.join(f.root, "elsewhere"), bytes, { mode: 0o600 }); await symlink(path.join(f.root, "elsewhere"), f.binding); }
  const reloaded = new QianchuanBrowserManager(f.root, { launch: f.launch, browsers: f.browsers });
  await expect(reloaded.open("123")).rejects.toThrow("绑定"); expect(f.launch).not.toHaveBeenCalled();
});

it("refuses to bind a second advertiser to an original profile already assigned to another", async () => {
  const f = await originalFixture(); await f.manager.prepare("123");
  f.request.mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/home?aavid=456" }])));
  await expect(f.manager.open("456")).rejects.toThrow("其他账号"); expect(f.launch).not.toHaveBeenCalled();
});

it("serializes concurrent original account binding writes without dropping any advertiser", async () => {
  const f = await originalFixture(), second = path.join(path.dirname(f.root), "second");
  await mkdir(path.join(second, "Profile 9"), { recursive: true, mode: 0o700 });
  f.running.push({ ...f.browser, profile: second, endpoint: "http://127.0.0.1:9422" });
  expect(await Promise.all([f.manager.prepare("123"), f.manager.prepare("456")])).toEqual(["http://127.0.0.1:9421", "http://127.0.0.1:9422"]);
  const state = JSON.parse(await readFile(f.binding, "utf8"));
  expect(state.bindings.map((binding: { advertiserId: string }) => binding.advertiserId).sort()).toEqual(["123", "456"]);
  expect(f.launch).not.toHaveBeenCalled();
});

it("blocks further startup after binding publication durability becomes unknown", async () => {
  const f = await originalFixture();
  vi.spyOn(persistence, "strictSyncDirectory").mockRejectedValueOnce(new Error("sync failed"));
  await expect(f.manager.open("123")).rejects.toThrow("sync failed");
  await expect(f.manager.open("123")).rejects.toThrow("绑定");
  expect(f.launch).not.toHaveBeenCalled();
});

it("rejects an original profile-directory alias before persisting or starting a browser", async () => {
  const f = await originalFixture();
  await rm(path.join(f.original, "Profile 9"), { recursive: true });
  const elsewhere = path.join(path.dirname(f.root), "elsewhere"); await mkdir(elsewhere, { mode: 0o700 });
  await symlink(elsewhere, path.join(f.original, "Profile 9"));
  await expect(f.manager.open("123")).rejects.toThrow("绑定"); expect(f.launch).not.toHaveBeenCalled();
});

it("attaches repeatedly to real isolated Chrome without remote-debugging permission or closing its tabs", async () => {
  const f = await fixture(), executable = await resolveChromeExecutable(); let child: ChildProcess | undefined;
  const browsers = async () => (await runningChromeBrowsers()).filter(browser => browser.profile?.startsWith(f.root + path.sep));
  const manager = new QianchuanBrowserManager(f.root, { browsers, launch: async (profile, id) => {
    const args = accountChromeArguments(profile, id); args[args.length - 1] = "about:blank";
    child = spawn(executable, [...args, "--headless=new", "--no-sandbox", "--disable-gpu"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child!.once("spawn", resolve); child!.once("error", reject); });
  } });
  try {
    const endpoint = await manager.open("123");
    const response = await fetch(`${endpoint}/json/version`); expect(response.status).toBe(200);
    const info = await response.json();
    const first = await readChromeTargets(info.webSocketDebuggerUrl);
    const second = await readChromeTargets(info.webSocketDebuggerUrl);
    expect((second as Array<{ targetId: string }>).map(x => x.targetId)).toEqual((first as Array<{ targetId: string }>).map(x => x.targetId));
    expect(await new QianchuanBrowserManager(f.root, { browsers }).open("123")).toBe(endpoint);
  } finally {
    if (child && child.exitCode === null) { const closed = new Promise(resolve => child!.once("close", resolve)); child.kill("SIGTERM"); await closed; }
  }
}, 30_000);

it("binds and restarts a real isolated original profile, preserving its directory, class and local data", async () => {
  const f = await fixture(), executable = await resolveChromeExecutable();
  const original = path.join(f.root, "original"), root = path.join(f.root, "app");
  const options = { profileDirectory: "Profile 9", windowClass: "cp-isolated" };
  await mkdir(path.join(original, options.profileDirectory), { recursive: true, mode: 0o700 });
  const marker = path.join(original, options.profileDirectory, "test-only-marker"); await writeFile(marker, "preserved");
  let child: ChildProcess | undefined;
  const stop = async () => { if (child && child.exitCode === null) { const closed = new Promise(resolve => child!.once("close", resolve)); child.kill("SIGTERM"); await closed; } };
  const launch = vi.fn(async (profile: string, id: string, settings?: { profileDirectory: string; windowClass?: string }) => {
    const args = accountChromeArguments(profile, id, settings); args[args.length - 1] = "about:blank";
    child = spawn(executable, [...args, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child!.once("spawn", resolve); child!.once("error", reject); });
  });
  const browsers = async () => (await runningChromeBrowsers()).filter(browser => browser.profile === original);
  try {
    await launch(original, "123", options);
    const deadline = Date.now() + 15_000; let endpoint: string | undefined;
    while (Date.now() < deadline) { endpoint = (await browsers())[0]?.endpoint; if (endpoint && await fetch(`${endpoint}/json/version`).then(response => response.ok).catch(() => false)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    expect(endpoint).toBeDefined();
    const browser = await chromium.connectOverCDP(endpoint!, { noDefaults: true });
    try {
      const page = browser.contexts()[0].pages()[0];
      await page.route("**/*", route => route.fulfill({ body: "isolated metadata fixture", contentType: "text/html" }));
      await page.goto("https://qianchuan.jinritemai.com/uni-prom?aavid=123");
    } finally { await browser.close(); }
    const manager = new QianchuanBrowserManager(root, { launch, browsers });
    expect(await manager.prepare("123")).toBe(endpoint); expect(launch).toHaveBeenCalledTimes(1);
    const before = (await fetch(`${endpoint}/json/list`).then(response => response.json())).map((tab: { id: string }) => tab.id);
    expect(await manager.prepare("123")).toBe(endpoint);
    expect((await fetch(`${endpoint}/json/list`).then(response => response.json())).map((tab: { id: string }) => tab.id)).toEqual(before);
    await stop();
    const reopened = await new QianchuanBrowserManager(root, { launch, browsers }).open("123");
    expect((await fetch(`${reopened}/json/version`)).ok).toBe(true);
    expect(launch).toHaveBeenLastCalledWith(original, "123", options);
    expect(await readFile(marker, "utf8")).toBe("preserved");
  } finally { await stop(); }
}, 30_000);
