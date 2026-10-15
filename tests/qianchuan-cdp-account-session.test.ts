import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type BrowserContext } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/main/qianchuan-extension-install", () => ({
  qianchuanExtensionResources: () => `${process.cwd()}/resources/qianchuan-extension`,
}));
import { QianchuanAccountCatalog, signQianchuanRequest } from "../src/main/qianchuan-account-catalog";
import {
  CdpSnapshotSchema,
  QianchuanCdpAccountSession,
  sameCdpSnapshot,
  switchedCdpSnapshot,
} from "../src/main/qianchuan-cdp-account-session";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { withQianchuanQueryPage } from "../src/main/qianchuan-query-page";
import { QianchuanBrowserAccounts } from "../src/main/qianchuan-browser-accounts";
import { QianchuanBrowserBindings } from "../src/main/qianchuan-browser-bindings";
import { findExtensionProcess } from "../src/main/qianchuan-extension-process";
import { readQianchuanCdpProfile } from "../src/main/qianchuan-cdp-profile";
import { FIXTURE_ACCOUNTS, FIXTURE_HOST, FIXTURE_PLANS, createQianchuanFixture, type QianchuanFixture } from "./helpers/qianchuan-extension-fixture";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

const roots: string[] = [];
const contexts: BrowserContext[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.close().catch(() => undefined)));
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture(hidden = false, route = "/uni-prom", socketProcess = false): Promise<{ context: BrowserContext; profile: string; service: QianchuanFixture; target: FrozenQianchuanAccount }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-qianchuan-cdp-account-"));
  roots.push(root);
  const profile = path.join(root, "profile");
  const service = await createQianchuanFixture(path.join(root, "fixture"));
  const args = [
      "--no-sandbox", "--disable-extensions", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
      `--proxy-server=http://127.0.0.1:${service.proxyPort}`,
      `--host-resolver-rules=MAP ${FIXTURE_HOST} 127.0.0.1,MAP * ~NOTFOUND,EXCLUDE 127.0.0.1,EXCLUDE localhost`,
      `--ignore-certificate-errors-spki-list=${service.certificateSpki}`,
      "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
    ];
  let context: BrowserContext;
  if (socketProcess) {
    await mkdir(profile, { mode: 0o700 });
    const child = spawn(await resolveChromeExecutable(), ["--headless=new", `--user-data-dir=${profile}`, ...args, "about:blank"], { stdio: "ignore" });
    children.push(child);
    let port: string | undefined;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (child.exitCode !== null) throw Error("Fixture Chrome exited before publishing metadata");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!port) throw Error("Fixture Chrome did not publish process-owned metadata");
    context = (await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { isLocal: true })).contexts()[0]!;
  } else context = await chromium.launchPersistentContext(profile, { executablePath: await resolveChromeExecutable(), headless: true, args });
  contexts.push(context);
  await context.addInitScript(() => { (window as typeof window & { gfdatav1?: { ver: string } }).gfdatav1 = { ver: "fixture-gf-1" }; });
  if (hidden) await context.addInitScript(host => {
    if (location.hostname === host) Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
  }, FIXTURE_HOST);
  const untouched = context.pages()[0]!;
  await untouched.goto("about:blank");
  const page = await context.newPage();
  await page.goto(`https://${FIXTURE_HOST}${route}?aavid=${FIXTURE_ACCOUNTS[0].advertiserId}`, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  const port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  if (!port) throw new Error("Fixture Chrome did not publish a DevTools port");
  const target = {
    product: "蝴蝶贴", advertiserId: FIXTURE_ACCOUNTS[0].advertiserId, adId: FIXTURE_PLANS[0].adId,
    cdpEndpoint: `http://127.0.0.1:${port}`, configDigest: "d".repeat(64),
  } as FrozenQianchuanAccount;
  return { context, profile, service, target };
}

it("keeps the same document identity during automatic hash refresh-time updates", async () => {
  const f = await fixture();
  try {
    const page = f.context.pages()[1]!;
    await page.evaluate(() => {
      let minute = 0;
      setInterval(() => {
        const url = new URL(location.href), hash = new URLSearchParams(url.hash.slice(1));
        hash.set("dut", `2026-10-15 21:${String(minute++ % 60).padStart(2, "0")}`);
        url.hash = hash.toString(); history.replaceState(null, "", url);
      }, 1);
    });
    const session = new QianchuanCdpAccountSession(f.target, async () => undefined);
    const current = await session.current(new AbortController().signal);
    expect(current.account).toEqual(FIXTURE_ACCOUNTS[0]);
    expect(sameCdpSnapshot(current, await session.current(new AbortController().signal))).toBe(true);
    expect(f.service.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[0].advertiserId)).toBe(1);
    expect(f.service.state.apiRequests).toHaveLength(0);
    expect(f.context.pages()).toHaveLength(2);
  } finally { await f.service.close(); }
});

it("reads the foreground upload document identity without authorizing account commands on its drawer", async () => {
  const f = await fixture();
  try {
    const page = f.context.pages()[1]!;
    await page.evaluate(adId => {
      const url = new URL(location.href); url.searchParams.set("adId", adId); history.replaceState(null, "", url);
      const drawer = document.createElement("div"); drawer.className = "ovui-drawer";
      drawer.innerHTML = '<span class="oc-create-material-submit-bar-count">已选择 0/100</span>';
      document.body.append(drawer);
    }, FIXTURE_PLANS[0].adId);
    const session = new QianchuanCdpAccountSession(f.target, async () => undefined);
    const current = await session.current(new AbortController().signal);
    expect(current.account).toEqual(FIXTURE_ACCOUNTS[0]);
    expect(sameCdpSnapshot(current, await session.current(new AbortController().signal))).toBe(true);
    const catalog = new QianchuanAccountCatalog(session.call.bind(session), {
      parse: value => CdpSnapshotSchema.parse(value), same: sameCdpSnapshot, switched: switchedCdpSnapshot,
    });
    await expect(catalog.accounts(current, new AbortController().signal)).rejects.toThrow();
    expect(f.service.state.apiRequests).toHaveLength(0);
    await page.locator(".account-info-box").evaluate(element => { element.textContent = "错误账户 ID：1876294500004865"; });
    await expect(session.current(new AbortController().signal)).rejects.toThrow();
  } finally { await f.service.close(); }
});

it("reads the directory from a hidden root main-account document, switches once to the explicit child, and reads that child's plans without an extension", async () => {
  const f = await fixture(true, "/");
  try {
    const foreground = f.context.pages()[0]!;
    await foreground.bringToFront();
    expect(await f.context.pages()[1]!.evaluate(() => document.visibilityState)).toBe("hidden");
    const verify = vi.fn(async () => undefined);
    const session = new QianchuanCdpAccountSession(f.target, verify);
    const initial = await session.current(new AbortController().signal);
    const repeat = await session.current(new AbortController().signal);
    expect(CdpSnapshotSchema.parse(initial)).toEqual(initial);
    expect(initial.targetId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(sameCdpSnapshot(initial, repeat)).toBe(true);
    expect(contexts).toHaveLength(1);

    const catalog = new QianchuanAccountCatalog(session.call.bind(session), {
      parse: value => CdpSnapshotSchema.parse(value),
      same: sameCdpSnapshot,
      switched: switchedCdpSnapshot,
    });
    const directory = await catalog.accounts(initial, new AbortController().signal);
    expect(directory).toEqual({ current: FIXTURE_ACCOUNTS[0], accounts: [...FIXTURE_ACCOUNTS] });
    expect(f.service.state.apiRequests.length).toBeGreaterThan(0);
    expect(f.service.state.apiRequests.every(request => request.csrf === "fixture-only-csrf" && request.signed)).toBe(true);

    const child = await catalog.switch(initial, FIXTURE_ACCOUNTS[1].advertiserId, new AbortController().signal, async () => {});
    expect(child.targetId).toBe(initial.targetId);
    expect(child.documentId).not.toBe(initial.documentId);
    expect(child.account).toEqual(FIXTURE_ACCOUNTS[1]);
    expect(f.service.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[1].advertiserId)).toBe(1);

    const plans = await catalog.plans(child, new AbortController().signal);
    expect(plans).toEqual([FIXTURE_PLANS[1]]);

    await expect(session.call({ kind: "switch", snapshot: initial, chosen: FIXTURE_ACCOUNTS[1] }, new AbortController().signal)).rejects.toThrow();
    expect(f.service.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[1].advertiserId)).toBe(1);
    expect(f.context.pages()).toHaveLength(2);
    expect(await f.context.pages()[0]!.url()).toBe("about:blank");
    expect(await f.context.pages()[1]!.url()).toContain(`aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
    expect(await foreground.evaluate(() => document.visibilityState)).toBe("visible");
    expect(verify.mock.calls.length).toBeGreaterThan(0);
  } finally { await f.service.close(); }
}, 180_000);

it("refuses a stale document before sending a signed GET even when the same account and target remain", async () => {
  const f = await fixture();
  try {
    const session = new QianchuanCdpAccountSession(f.target, async () => {}), signal = AbortSignal.timeout(15_000);
    const before = await session.current(signal);
    const page = f.context.pages()[1]!;
    await page.reload({ waitUntil: "domcontentloaded" });
    const after = await session.current(signal);
    expect(after.targetId).toBe(before.targetId);
    expect(after.account).toEqual(before.account);
    expect(after.documentId).not.toBe(before.documentId);
    const path = "/ad/api/v1/account/user/info", params = { aavid: before.account.advertiserId, gfversion: before.gfversion };
    await expect(session.call({ kind: "request", snapshot: before, path, params, headers: signQianchuanRequest(path, params) }, signal)).rejects.toThrow();
    expect(f.service.state.apiRequests).toHaveLength(0);
    expect(page.isClosed()).toBe(false);
  } finally { await f.service.close(); }
}, 30_000);

it("does not use a protected upload page as the account document", async () => {
  const f = await fixture(true);
  try {
    const protectedPage = await f.context.newPage();
    await protectedPage.goto(`https://${FIXTURE_HOST}/uni-prom?aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
    const cdp = await protectedPage.context().newCDPSession(protectedPage);
    const target = await cdp.send("Target.getTargetInfo");
    await cdp.detach();
    const exclusions = new Set([target.targetInfo.targetId]);
    const session = new QianchuanCdpAccountSession(f.target, async () => {}, exclusions);
    exclusions.clear();
    const snapshot = await session.current(AbortSignal.timeout(15_000));
    expect(snapshot.account).toEqual(FIXTURE_ACCOUNTS[0]);
    expect(snapshot.targetId).not.toBe(target.targetInfo.targetId);
    expect(protectedPage.url()).toContain(`aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
    expect(protectedPage.isClosed()).toBe(false);
  } finally { await f.service.close(); }
}, 30_000);

it.each([false, true])("proves the bound default profile despite another stored profile and isolated context (%s)", async isolated => {
  const f = await fixture(true, "/uni-prom", true);
  let other: BrowserContext | undefined;
  try {
    await chmod(f.profile, 0o700);
    await mkdir(path.join(f.profile, "Profile 1"), { mode: 0o700 });
    await writeFile(path.join(f.profile, "Profile 1", "Preferences"), "fixture private data must not be read");
    const root = path.dirname(f.profile);
    await new QianchuanBrowserBindings(root).save({ advertiserId: f.target.advertiserId, profile: f.profile, profileDirectory: "Default" });
    if (isolated) {
      other = await f.context.browser()!.newContext({ ignoreHTTPSErrors: true });
      const page = await other.newPage();
      await page.goto(`https://${FIXTURE_HOST}/uni-prom?aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
      await page.evaluate(() => {
        const original = document.querySelectorAll.bind(document);
        (window as any).foreignAccountReads = 0;
        document.querySelectorAll = ((selector: string) => {
          if (selector === ".account-info-container") (window as any).foreignAccountReads++;
          return original(selector);
        }) as typeof document.querySelectorAll;
      });
    }
    const owner = new QianchuanBrowserAccounts(root), signal = AbortSignal.timeout(30_000);
    const before = f.context.pages().map(page => page.url());
    const session = await owner.current(f.target, signal);
    expect(session.account).toEqual(FIXTURE_ACCOUNTS[0]);
    expect((await owner.accounts(session, signal, async () => {})).accounts).toEqual([...FIXTURE_ACCOUNTS]);
    expect(f.context.pages().map(page => page.url())).toEqual(before);
    if (other) {
      const page = other.pages()[0]!;
      expect(page.isClosed()).toBe(false); expect(page.url()).toContain(`aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
      expect(await page.evaluate(() => (window as any).foreignAccountReads)).toBe(0);
    }
    // Native messaging still cannot attribute a profile within a shared process.
    await expect(findExtensionProcess(f.profile, "Default")).rejects.toThrow();
  } finally { await other?.close(); await f.service.close(); }
}, 60_000);

it("rejects a different actual default profile path and removes only its internal proof page", async () => {
  const f = await fixture();
  try {
    const before = f.context.pages().map(page => page.url());
    await expect(readQianchuanCdpProfile(f.target, { advertiserId: f.target.advertiserId, profile: f.profile, profileDirectory: "Profile 1" }, AbortSignal.timeout(15_000))).rejects.toThrow("实际资料目录");
    expect(f.context.pages().map(page => page.url())).toEqual(before);
    expect(f.service.state.apiRequests).toHaveLength(0);
  } finally { await f.service.close(); }
}, 30_000);

it("rejects a default context change during the internal profile proof without an account request", async () => {
  const f = await fixture();
  try {
    const before = f.context.pages().map(page => page.url()), connect = chromium.connectOverCDP.bind(chromium);
    vi.spyOn(chromium, "connectOverCDP").mockImplementation(async (...args) => {
      const browser = await connect(...args), createSession = browser.newBrowserCDPSession.bind(browser);
      vi.spyOn(browser, "newBrowserCDPSession").mockImplementation(async () => {
        const session = await createSession(), send = session.send.bind(session); let observations = 0;
        vi.spyOn(session, "send").mockImplementation(async (method, params) => {
          const result = await send(method, params);
          if (method === "Target.getBrowserContexts" && ++observations > 1) Reflect.set(result, "defaultBrowserContextId", "changed-default-context");
          return result;
        });
        return session;
      });
      return browser;
    });
    await expect(readQianchuanCdpProfile(f.target, { advertiserId: f.target.advertiserId, profile: f.profile, profileDirectory: "Default" }, AbortSignal.timeout(15_000))).rejects.toThrow("实际资料目录");
    expect(f.context.pages().map(page => page.url())).toEqual(before);
    expect(f.service.state.apiRequests).toHaveLength(0);
  } finally { await f.service.close(); }
}, 30_000);

it("rejects an additional browser context before any signed request or navigation", async () => {
  const f = await fixture(true);
  let other: BrowserContext | undefined;
  try {
    const session = new QianchuanCdpAccountSession(f.target, async () => {});
    const before = await session.current(AbortSignal.timeout(15_000));
    other = await f.context.browser()!.newContext({ ignoreHTTPSErrors: true });
    await other.addInitScript(() => { (window as typeof window & { gfdatav1?: { ver: string } }).gfdatav1 = { ver: "fixture-gf-1" }; });
    const page = await other.newPage();
    await page.goto(`https://${FIXTURE_HOST}/uni-prom?aavid=${FIXTURE_ACCOUNTS[1].advertiserId}`);
    await expect(session.current(AbortSignal.timeout(15_000))).rejects.toThrow();
    const path = "/ad/api/v1/account/user/info", params = { aavid: before.account.advertiserId, gfversion: before.gfversion };
    await expect(session.call({ kind: "request", snapshot: before, path, params, headers: signQianchuanRequest(path, params) }, AbortSignal.timeout(15_000))).rejects.toThrow();
    expect(f.service.state.apiRequests).toHaveLength(0);
    expect(page.isClosed()).toBe(false);
    expect(f.context.pages()).toHaveLength(2);
  } finally { await other?.close(); await f.service.close(); }
}, 30_000);

it("rejects a non-default target even when the protocol does not enumerate its context", async () => {
  const f = await fixture(true);
  let other: BrowserContext | undefined;
  try {
    other = await f.context.browser()!.newContext({ ignoreHTTPSErrors: true });
    await other.addInitScript(() => { (window as typeof window & { gfdatav1?: { ver: string } }).gfdatav1 = { ver: "fixture-gf-1" }; });
    const page = await other.newPage();
    await page.goto(`https://${FIXTURE_HOST}/uni-prom?aavid=${FIXTURE_ACCOUNTS[0].advertiserId}`);
    const connect = chromium.connectOverCDP.bind(chromium);
    vi.spyOn(chromium, "connectOverCDP").mockImplementation(async (...args) => {
      const browser = await connect(...args);
      const newSession = browser.newBrowserCDPSession.bind(browser);
      vi.spyOn(browser, "newBrowserCDPSession").mockImplementation(async () => {
        const session = await newSession(), send = session.send.bind(session);
        vi.spyOn(session, "send").mockImplementation(async (method, params) => {
          const result = await send(method, params);
          return method === "Target.getBrowserContexts" ? { ...result, browserContextIds: [] } : result;
        });
        return session;
      });
      return browser;
    });
    const session = new QianchuanCdpAccountSession(f.target, async () => {});
    await expect(session.current(AbortSignal.timeout(15_000))).rejects.toThrow();
    expect(f.service.state.apiRequests).toHaveLength(0);
    expect(page.isClosed()).toBe(false);
    expect(f.context.pages()).toHaveLength(2);
  } finally { await other?.close(); await f.service.close(); }
}, 30_000);

it("closes only its blank picker when its actual context differs from the account document", async () => {
  const f = await fixture();
  try {
    const read = vi.fn(async () => "must not navigate or read");
    await expect(withQianchuanQueryPage(f.target, AbortSignal.timeout(15_000), read, "different-original-context")).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(f.service.state.apiRequests).toHaveLength(0);
    expect(f.context.pages()).toHaveLength(2);
    expect(f.context.pages()[1]!.url()).toContain(`aavid=${FIXTURE_ACCOUNTS[0].advertiserId}`);
  } finally { await f.service.close(); }
}, 30_000);
