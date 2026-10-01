import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanBrowserManager, accountChromeArguments } from "../src/main/qianchuan-browser-manager";
import type { RunningChromeBrowser } from "../src/main/qianchuan-browser-discovery";
import { readChromeTargets } from "../src/main/local-cdp-transport";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-account-browser-")); roots.push(root);
  const running: RunningChromeBrowser[] = [];
  const launch = vi.fn(async (profile: string) => { running.push({ profile, endpoint: `http://127.0.0.1:${9300 + running.length}` }); });
  const browsers = vi.fn(async () => running);
  return { root, running, launch, browsers, manager: new QianchuanBrowserManager(root, { launch, browsers, startupMs: 200 }) };
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

it("requires the selected account page and never probes another browser during preparation", async () => {
  const f = await fixture();
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/uni-prom?aavid=999" }])));
  await expect(f.manager.prepare("123")).rejects.toThrow("登录千川");
  request.mockResolvedValue(new Response(JSON.stringify([{ type: "page", url: "https://qianchuan.jinritemai.com/uni-prom?aavid=123" }])));
  expect(await f.manager.prepare("123")).toBe("http://127.0.0.1:9300");
  expect(request.mock.calls.every(call => call[0] === "http://127.0.0.1:9300/json/list")).toBe(true);
});

it("attaches repeatedly to real isolated Chrome without remote-debugging permission or closing its tabs", async () => {
  const f = await fixture(), executable = await resolveChromeExecutable(); let child: ChildProcess | undefined;
  const manager = new QianchuanBrowserManager(f.root, { launch: async (profile, id) => {
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
    expect(await new QianchuanBrowserManager(f.root).open("123")).toBe(endpoint);
  } finally {
    if (child && child.exitCode === null) { const closed = new Promise(resolve => child!.once("close", resolve)); child.kill("SIGTERM"); await closed; }
  }
}, 30_000);
