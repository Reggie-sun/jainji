import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanBackendAdapter } from "../src/main/qianchuan-backend-adapter";
import { readQianchuanBackendQuery } from "../src/main/qianchuan-backend-query";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
const mocks = vi.hoisted(() => ({ egress: vi.fn(async () => undefined), page: vi.fn() }));
vi.mock("../src/main/qianchuan-egress-browser.js", () => ({ verifyBrowserEgress: mocks.egress }));
vi.mock("../src/main/qianchuan-query-page.js", () => ({ withQianchuanQueryPage: mocks.page }));
const target: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "12345", adId: "67890", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const query = () => ({ kind: "plan" as const, product: target.product, expectedAdvertiserId: target.advertiserId, adId: target.adId, requestId: randomUUID() });
it.each(["connection", "navigation"])("never returns private %s errors through the bridge", async stage => {
  const privateError = new Error("ws://127.0.0.1:42001/private-token?cookie=secret");
  if (stage === "connection") mocks.page.mockRejectedValueOnce(privateError);
  else mocks.page.mockImplementationOnce(async (_target, _signal, read) => read({ goto: async () => { throw privateError; } }));
  await expect(readQianchuanBackendQuery(target, query(), new AbortController().signal)).rejects.toThrow("千川查询失败，请检查账号网页、登录状态和网络连接。");
});
it("rejects a mismatched account before opening a browser", async () => {
  mocks.egress.mockClear();
  await expect(readQianchuanBackendQuery(target, { ...query(), expectedAdvertiserId: "99999" }, new AbortController().signal)).rejects.toThrow("广告账户已变化");
  expect(mocks.egress).not.toHaveBeenCalled();
});
it("preserves cancellation instead of turning it into a retryable connection error", async () => {
  const controller = new AbortController();
  mocks.page.mockImplementationOnce(async () => { controller.abort(); throw new Error("private-token"); });
  await expect(readQianchuanBackendQuery(target, query(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("waits for an account ID rendered after the old ten-second window before issuing one query", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let ready = false;
  const readyHandle = { jsonValue: vi.fn(async () => "ready"), dispose: vi.fn(async () => undefined) };
  const page = { goto: vi.fn(async () => undefined),
    locator: () => ({ first: () => ({ waitFor: async () => undefined }) }),
    waitForFunction: vi.fn(() => new Promise(resolve => setTimeout(() => { ready = true; resolve(readyHandle); }, 12000))) };
  const read = vi.fn(async () => ({ kind: "plan", advertiserId: target.advertiserId, adId: target.adId }));
  const create = vi.spyOn(QianchuanBackendAdapter, "create").mockImplementation(async () => {
    if (!ready) throw new Error("Account ID is not rendered yet");
    return { query: read, dispose: vi.fn() } as unknown as QianchuanBackendAdapter;
  });
  mocks.page.mockImplementationOnce(async (_target, _signal, read) => read(page));
  const pending = readQianchuanBackendQuery(target, query(), controller.signal);
  void pending.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(11000);
  expect(create).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toMatchObject({ kind: "plan", advertiserId: target.advertiserId });
  expect(create).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  expect(readyHandle.dispose).toHaveBeenCalledTimes(1);
  expect(page.goto).toHaveBeenCalledWith(expect.any(String), { waitUntil: "commit", timeout: 45000 });
});
it.each([
  { name: "matching visible account", ids: ["12345"], ready: true },
  { name: "empty account shell", ids: [""], ready: false },
  { name: "wrong advertiser", ids: ["99999"], ready: false },
  { name: "ambiguous accounts", ids: ["12345", "12345"], ready: false },
  { name: "hidden account", ids: ["12345"], hidden: true, ready: false },
  { name: "login or captcha", ids: ["12345"], challenge: true, ready: false },
  { name: "changed URL account", ids: ["12345"], url: "https://qianchuan.jinritemai.com/uni-prom?aavid=99999", ready: false },
])("does not issue requests until page readiness: $name", async state => {
  const node = (id: string, hidden = false) => ({ innerText: id ? `账户 ID：${id}` : "正在加载…",
    getClientRects: () => hidden ? [] : [{}] });
  vi.stubGlobal("location", new URL(state.url ?? "https://qianchuan.jinritemai.com/uni-prom?aavid=12345"));
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  vi.stubGlobal("document", { querySelectorAll: (selector: string) => selector === ".account-info-container"
    ? state.ids.map(id => node(id, state.hidden)) : state.challenge ? [node("")] : [] });
  const handle = { jsonValue: vi.fn(), dispose: vi.fn(async () => undefined) };
  const read = vi.fn(async () => ({ kind: "plan", advertiserId: target.advertiserId, adId: target.adId }));
  const create = vi.spyOn(QianchuanBackendAdapter, "create").mockResolvedValue({ query: read, dispose: vi.fn() } as unknown as QianchuanBackendAdapter);
  mocks.page.mockImplementationOnce(async (_target, _signal, read) => read({ goto: async () => undefined,
    waitForFunction: async (predicate: (id: string) => unknown, advertiserId: string, options: { timeout: number }) => {
      expect(options.timeout).toBeGreaterThan(10000); expect(options.timeout).toBeLessThanOrEqual(90000);
      const status = predicate(advertiserId);
      if (!status) throw new Error("Account still loading at bounded deadline");
      handle.jsonValue.mockResolvedValue(status); return handle;
    } }));
  const pending = readQianchuanBackendQuery(target, query(), new AbortController().signal);
  if (state.ready) await expect(pending).resolves.toMatchObject({ kind: "plan" });
  else await expect(pending).rejects.toThrow("千川查询失败");
  expect(create).toHaveBeenCalledTimes(state.ready ? 1 : 0); expect(read).toHaveBeenCalledTimes(state.ready ? 1 : 0);
});
it("preserves cancellation after account readiness and does not issue a backend request", async () => {
  const controller = new AbortController();
  const create = vi.spyOn(QianchuanBackendAdapter, "create");
  const handle = { jsonValue: async () => { controller.abort(); return "ready"; }, dispose: vi.fn(async () => undefined) };
  mocks.page.mockImplementationOnce(async (_target, _signal, read) => read({ goto: async () => undefined, waitForFunction: async () => handle }));
  await expect(readQianchuanBackendQuery(target, query(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(create).not.toHaveBeenCalled(); expect(handle.dispose).toHaveBeenCalledTimes(1);
});
it("waits through delayed SPA identity in an isolated real browser before requesting plan details", async () => {
  const browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] });
  const requests: string[] = [];
  try {
    const context = await browser.newContext();
    await context.route("https://qianchuan.jinritemai.com/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/uni-prom") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<div class="account-info-container">正在加载</div><script>setTimeout(()=>document.querySelector(".account-info-container").textContent="ID：12345",12000)</script>' });
      requests.push(path);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status_code: 0, data: {
        adDetailInfo: { id: target.adId, name: "延迟加载计划", budget: "100000000", ecpRoi2Goal: "2" }, goodsInfos: [],
      } }) });
    });
    const page = await context.newPage();
    mocks.page.mockImplementationOnce(async (_target, _signal, read) => read(page));
    const started = Date.now();
    await expect(readQianchuanBackendQuery(target, query(), new AbortController().signal)).resolves.toMatchObject({ kind: "plan", adId: target.adId });
    expect(Date.now() - started).toBeGreaterThanOrEqual(12000);
    expect(requests).toEqual(["/ad/api/creation/v1/ad/ad-detail-basic"]);
  } finally { await browser.close(); }
}, 60000);
