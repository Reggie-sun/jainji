import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanBackendAdapter } from "../src/main/qianchuan-backend-adapter";
import { QianchuanOpenApiVideos } from "../src/main/qianchuan-open-api-videos";
import { QianguanjiaReadonlyAdapter } from "../src/main/qianchuan-qianguanjia-adapter";
import { QianchuanBackendQuerySchema, QIANCHUAN_QUERY_METRICS } from "../src/shared/qianchuan-backend";

const aid = "1876414814643802", adId = "1878754135410692", origin = "https://qianchuan.jinritemai.com";
const identity = { product: "蝴蝶贴" as const, expectedAdvertiserId: aid, requestId: "fe442924-ed0e-4acf-b882-a64f5c007529" };
const signal = new AbortController().signal;
const query = () => QianchuanBackendQuerySchema.parse({ ...identity, kind: "report", startDate: "2026-10-12", endDate: "2026-10-13" });
const clock = () => new Date("2026-10-13T10:00:00Z");
const metrics = (capital = true) => Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(name => [capital ? name : name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), capital ? { Value: 123, ValueStr: "123.00" } : { value: 123, valueStr: "123.00" }]));
let browser: Browser;
const contexts: BrowserContext[] = [];
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });
vi.setConfig({ testTimeout: 15000, hookTimeout: 30000 });

async function fixture(options: { account?: string; response?: unknown; status?: number; delay?: number; raw?: string } = {}) {
  const context = await browser.newContext(); contexts.push(context);
  await context.addCookies([{ name: "fixture-session", value: "private", url: origin }]);
  const requests: { path: string; method: string; body: unknown; cookie?: string }[] = [];
  await context.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/uni-prom") return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><div class="account-info-container">ID：${options.account ?? aid}</div>` });
    requests.push({ path: url.pathname, method: route.request().method(), body: route.request().postDataJSON(), cookie: (await route.request().allHeaders()).cookie });
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    await route.fulfill({ status: options.status ?? 200, contentType: "application/json", body: options.raw ?? JSON.stringify(options.response ?? { status_code: 0, data: { StatsData: { Rows: [{ Dimensions: { marketing_goal: { Value: "1" } }, Metrics: metrics() }], Totals: metrics(), TotalCount: "1" } } }) }).catch(() => undefined);
  });
  const page = await context.newPage(); await page.goto(`${origin}/uni-prom?aavid=${aid}`);
  return { page, requests };
}
async function adapter(page: Page) { return QianchuanBackendAdapter.create(page, aid, clock); }

it("directly queries the account report with browser session and fixed account filters", async () => {
  const { page, requests } = await fixture(); const port = await adapter(page);
  try {
    const result = await port.query(query(), signal);
    expect(result).toMatchObject({ kind: "report", advertiserId: aid, startTime: "2026-10-12 00:00:00", endTime: "2026-10-13 18:00:00", metrics: { stat_cost_for_roi2: { value: "123", display: "123.00" } } });
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ path: "/ad/api/data/v1/common/statQuery", method: "POST", cookie: "fixture-session=private" });
    expect(requests[0]!.body).toMatchObject({ DataSetKey: "product_roi2_promotion", Filters: { Conditions: expect.arrayContaining([{ Field: "advertiser_id", Operator: 7, Values: [aid] }]) } });
    expect(JSON.stringify(result)).not.toMatch(/private|token|https:/);
  } finally { await port.dispose(); }
});
it("rejects malformed dates, unknown methods and incomplete page offsets before I/O", () => {
  for (const patch of [{ startDate: "2026-02-30" }, { startDate: "2026-10-14" }, { startDate: "2026-08-01" }, { url: "https://evil.invalid" }]) expect(() => QianchuanBackendQuerySchema.parse({ ...query(), ...patch })).toThrow();
  expect(() => QianchuanBackendQuerySchema.parse({ ...identity, kind: "materials", adId, startDate: "2026-10-12", endDate: "2026-10-13", offset: 1, limit: 100 })).toThrow();
});
it("checks the actual page account and duplicate account URL parameters", async () => {
  const { page, requests } = await fixture({ account: "999" });
  await expect(adapter(page)).rejects.toThrow(/账号/); expect(requests).toHaveLength(0);
  await page.goto(`${origin}/uni-prom?aavid=${aid}&aavid=${aid}`);
  await expect(adapter(page)).rejects.toThrow(/账号/);
});
it("rejects another account input before issuing a request", async () => {
  const { page, requests } = await fixture(); const port = await adapter(page);
  try { await expect(port.query({ ...query(), expectedAdvertiserId: "999" }, signal)).rejects.toThrow(/账号/); expect(requests).toHaveLength(0); }
  finally { await port.dispose(); }
});
it("rejects document replacement and account changes before a request", async () => {
  const { page, requests } = await fixture(); const port = await adapter(page);
  try { await page.reload(); await expect(port.query(query(), signal)).rejects.toThrow(); expect(requests).toHaveLength(0); }
  finally { await port.dispose(); }
});
it.each([
  ["http", { status: 401 }], ["business", { response: { status_code: 7, message: "token=secret" } }],
  ["json", { raw: "not json" }], ["size", { raw: "x".repeat(2 * 1024 * 1024 + 1) }],
] as const)("returns bounded errors without platform secrets: %s", async (_, options) => {
  const { page } = await fixture(options); const port = await adapter(page);
  try { await expect(port.query(query(), signal)).rejects.toThrow(/千川/); }
  finally { await port.dispose(); }
});
it("aborts a delayed backend call and does not retry", async () => {
  const { page, requests } = await fixture({ delay: 4000 }); const port = await adapter(page); const cancel = new AbortController();
  try { const work = port.query(query(), cancel.signal); setTimeout(() => cancel.abort(), 50); await expect(work).rejects.toThrow(); expect(requests).toHaveLength(1); }
  finally { await port.dispose(); }
});
it("rejects account drift while a response is in flight", async () => {
  const { page } = await fixture({ delay: 200 }); const port = await adapter(page);
  try { const work = port.query(query(), signal); await page.waitForTimeout(50); await page.locator(".account-info-container").evaluate(node => { node.textContent = "ID：999"; }); await expect(work).rejects.toThrow(/账号/); }
  finally { await port.dispose(); }
});
it("projects only plan fields and enforces the returned plan ID", async () => {
  const { page } = await fixture({ response: { status_code: 0, data: { adDetailInfo: { id: adId, name: "计划一", budget: "50000", ecpRoi2Goal: 3 }, goodsInfos: [{ id: "88", name: "商品", url: "https://secret.invalid?token=x" }] } } });
  const port = await adapter(page);
  try { expect(await port.query({ ...identity, kind: "plan", adId }, signal)).toMatchObject({ kind: "plan", adId, products: [{ id: "88", name: "商品" }], budget: "50000" }); await expect(port.query({ ...identity, kind: "plan", adId: "555" }, signal)).rejects.toThrow(/计划/); }
  finally { await port.dispose(); }
});
it("reads a precise material page with IDs kept as strings", async () => {
  const { page, requests } = await fixture({ response: { status_code: 0, data: { statsData: { totalCount: "101", rows: [{ dimensions: { materialId: { value: "1879999999999999999" }, roi2MaterialVideoName: { value: "样片" } }, metrics: metrics(false) }] } } } });
  const port = await adapter(page);
  try {
    const result = await port.query({ ...identity, kind: "materials", adId, startDate: "2026-10-12", endDate: "2026-10-13", offset: 100, limit: 100 }, signal);
    expect(result).toMatchObject({ kind: "materials", total: 101, offset: 100, rows: [{ materialId: "1879999999999999999" }] });
    expect(requests[0]!.body).toMatchObject({ PageParams: { Limit: 100, Offset: 100 } });
  } finally { await port.dispose(); }
});
it("does not turn missing report metrics into zero", async () => {
  const { page } = await fixture({ response: { status_code: 0, data: { StatsData: {} } } }); const port = await adapter(page);
  try { await expect(port.query(query(), signal)).rejects.toThrow(/数据/); } finally { await port.dispose(); }
});

const officialInput = () => ({ advertiserId: aid, page: 1, pageSize: 20 });
const officialGrant = () => ({ accessToken: "fixture-token", advertiserIds: [aid] });
const officialBody = () => ({ code: 0, data: { page_info: { page: 1, page_size: 20, total_number: 1, total_page: 1 },
  list: [{ id: "v01000000000000000001", material_id: "1879999999999999999", filename: "样片.mp4", signature: "a".repeat(32), duration: 12.5,
    url: "https://secret.invalid?token=x", poster_url: "secret" }] } });
const officialResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const rawMaterialResponse = (literal: string) => new Response(JSON.stringify(officialBody()).replace('"1879999999999999999"', literal), { headers: { "content-type": "application/json" } });

it("queries only the fixed official video GET and projects exact material metadata without credentials", async () => {
  const transport = vi.fn<typeof fetch>(async () => officialResponse(officialBody()));
  const port = new QianchuanOpenApiVideos(officialGrant, transport);
  const result = await port.list(officialInput(), signal);
  expect(result).toMatchObject({ advertiserId: aid, total: 1, videos: [{ videoId: "v01000000000000000001", materialId: "1879999999999999999", durationSeconds: 12.5 }] });
  const [input, options] = transport.mock.calls[0]!;
  const url = new URL(String(input));
  expect(url.origin).toBe("https://api.oceanengine.com"); expect(url.pathname).toBe("/open_api/v1.0/qianchuan/video/get/");
  expect(url.searchParams.get("advertiser_id")).toBe(aid);
  expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { "Access-Token": "fixture-token" } });
  expect(JSON.stringify(result)).not.toMatch(/token|secret|https:|material_id/);
});
it("preserves unsafe numeric official material IDs from raw JSON source digits", async () => {
  for (const literal of ["1", "1879999999999999999", "1880000000000000000", "12345678901234567890"]) {
    const port = new QianchuanOpenApiVideos(officialGrant, async () => rawMaterialResponse(literal));
    const result = await port.list(officialInput(), signal);
    expect(result.videos[0]).toMatchObject({ materialId: literal, durationSeconds: 12.5 });
    expect(typeof result.videos[0]!.materialId).toBe("string");
  }
});
it("omits absent or null official material IDs without manufacturing an association", async () => {
  for (const material_id of [undefined, null]) {
    const body = officialBody();
    const response = { ...body, data: { ...body.data, list: [{ ...body.data.list[0], material_id }] } };
    const result = await new QianchuanOpenApiVideos(officialGrant, async () => officialResponse(response)).list(officialInput(), signal);
    expect(result.videos[0]).not.toHaveProperty("materialId");
    expect(result.videos[0]!.videoId).toBe("v01000000000000000001");
  }
});
it.each(["1.0", "1e3", "9007199254740991.4", "1879999999999999999.1", "-1", "0", "-0", "1e309", "123456789012345678901", '"01"', '"1e3"', '""', "true", "{}", "[]"])("rejects ambiguous or invalid official material ID literal %s without retry", async literal => {
  const transport = vi.fn<typeof fetch>(async () => rawMaterialResponse(literal));
  await expect(new QianchuanOpenApiVideos(officialGrant, transport).list(officialInput(), signal)).rejects.toThrow("千川官方素材查询未完成，请检查授权、权限或返回数据。");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("fails closed on numeric official material IDs when the runtime omits source context", async () => {
  const original = JSON.parse;
  const parse = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => original(text, reviver ? function (key, value) { return reviver.call(this, key, value); } : undefined));
  try {
    for (const literal of ["1", "1879999999999999999", "1e3"]) {
      await expect(new QianchuanOpenApiVideos(officialGrant, async () => rawMaterialResponse(literal)).list(officialInput(), signal)).rejects.toThrow(/千川官方/);
    }
    const result = await new QianchuanOpenApiVideos(officialGrant, async () => officialResponse(officialBody())).list(officialInput(), signal);
    expect(result.videos[0]).toMatchObject({ materialId: "1879999999999999999" });
  } finally { parse.mockRestore(); }
});
it("denies unauthorized accounts, invalid pages and tokens before official transport", async () => {
  const transport = vi.fn<typeof fetch>(async () => officialResponse(officialBody()));
  const port = new QianchuanOpenApiVideos(officialGrant, transport);
  for (const input of [{ ...officialInput(), advertiserId: "999" }, { ...officialInput(), page: 0 },
    { ...officialInput(), pageSize: 101 }, { ...officialInput(), page: 501 }]) await expect(port.list(input, signal)).rejects.toThrow(/千川官方/);
  const invalid = new QianchuanOpenApiVideos(() => ({ ...officialGrant(), accessToken: "secret\r\ninjected" }), transport);
  await expect(invalid.list(officialInput(), signal)).rejects.toThrow(/千川官方/);
  const cancelled = new AbortController(); cancelled.abort("secret reason");
  await expect(port.list(officialInput(), cancelled.signal)).rejects.toThrow("千川官方素材查询未完成，请检查授权、权限或返回数据。");
  expect(transport).not.toHaveBeenCalled();
});
it("captures the official target before the authorization owner runs", async () => {
  const input = officialInput();
  const transport = vi.fn<typeof fetch>(async () => officialResponse(officialBody()));
  const port = new QianchuanOpenApiVideos(() => { input.advertiserId = "999"; return officialGrant(); }, transport);
  expect((await port.list(input, signal)).advertiserId).toBe(aid);
  expect(new URL(String(transport.mock.calls[0]![0])).searchParams.get("advertiser_id")).toBe(aid);
});
it("rejects malformed official data and business failures without retry or platform error leakage", async () => {
  const examples: unknown[] = [
    { code: 401, message: "token=secret" },
    { code: 0, data: { ...officialBody().data, page_info: { ...officialBody().data.page_info, page: 2 } } },
    { code: 0, data: { ...officialBody().data, list: [{ ...officialBody().data.list[0], id: 1879999999999999999 }] } },
    { code: 0, data: { ...officialBody().data, list: [{ ...officialBody().data.list[0], signature: null }] } },
    { code: 0, data: { ...officialBody().data, list: [{ ...officialBody().data.list[0], filename: "bad\u0000name" }] } },
    { code: 0, data: { ...officialBody().data, page_info: { ...officialBody().data.page_info, total_number: 2 }, list: [officialBody().data.list[0], officialBody().data.list[0]] } },
  ];
  for (const body of examples) {
    const transport = vi.fn<typeof fetch>(async () => officialResponse(body));
    await expect(new QianchuanOpenApiVideos(officialGrant, transport).list(officialInput(), signal)).rejects.toThrow("千川官方素材查询未完成，请检查授权、权限或返回数据。");
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
it("accepts an explicit empty official first page and rejects missing data", async () => {
  const body = { code: 0, data: { list: [], page_info: { page: 1, page_size: 20, total_number: 0, total_page: 0 } } };
  const port = new QianchuanOpenApiVideos(officialGrant, async () => officialResponse(body));
  expect(await port.list(officialInput(), signal)).toMatchObject({ total: 0, videos: [] });
  await expect(new QianchuanOpenApiVideos(officialGrant, async () => officialResponse({ code: 0 })).list(officialInput(), signal)).rejects.toThrow(/千川官方/);
});
it("limits official streamed response bytes and closes the stream", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const port = new QianchuanOpenApiVideos(officialGrant, async () => new Response(body, { headers: { "content-type": "application/json" } }));
  await expect(port.list(officialInput(), signal)).rejects.toThrow(/千川官方/); expect(cancelled).toBe(true);
});
it("rejects official redirects and network errors and propagates cancellation to transport", async () => {
  for (const transport of [async () => new Response(null, { status: 302 }), async () => { throw new Error("token=secret"); }]) {
    await expect(new QianchuanOpenApiVideos(officialGrant, transport).list(officialInput(), signal)).rejects.toThrow("千川官方素材查询未完成，请检查授权、权限或返回数据。");
  }
  const cancel = new AbortController();
  const transport = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error("secret abort reason")), { once: true });
  }));
  const work = new QianchuanOpenApiVideos(officialGrant, transport).list(officialInput(), cancel.signal);
  cancel.abort(); await expect(work).rejects.toThrow("千川官方素材查询未完成，请检查授权、权限或返回数据。");
  expect(transport).toHaveBeenCalledTimes(1);
});

const supplierOrigin = "https://qc.uliangtech.com", supplierApi = "https://qc-api.uliangtech.com";
const supplierToken = "fixture-customer-session-private";
const supplierAccount = { outAdvertiserId: "1879999999999999999", name: "fixture shop", authStatus: 1, authStatusDesc: "授权正常", serverSecret: "not-projected" };
const supplierMetrics = { statCost: 12.5, totalPayOrderGmvIncludeCouponForRoi2: 50,
  totalPayOrderCountForRoi2: "4", totalPrepayAndPayOrderRoi2: 4 };
const supplierHome = () => Object.fromEntries(["ALL", "LIVE_PROM_GOODS", "VIDEO_PROM_GOODS"].map(key => [key,
  { nowTotalData: { ...supplierMetrics }, oldTotalData: { ...supplierMetrics }, secret: "not-projected" }]));
async function supplierFixture(options: { token?: string; response?: unknown; status?: number; raw?: string; delay?: number; type?: string; redirect?: boolean } = {}) {
  const context = await browser.newContext(); contexts.push(context);
  const requests: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  await context.addCookies([{ name: "unused-cookie", value: "cookie-private", url: supplierApi }]);
  await context.route(`${supplierOrigin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><div id="app"></div>' }));
  await context.route(`${supplierApi}/**`, async route => {
    const request = route.request();
    const headers = { "access-control-allow-origin": supplierOrigin, "access-control-allow-headers": "token,Channel,appType,content-type", "access-control-allow-methods": "POST" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON(), headers: await request.allHeaders() });
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (options.redirect) return route.fulfill({ status: 302, headers: { ...headers, location: `${supplierOrigin}/dist/login` } });
    const data = request.url().endsWith("uniHomeTop") ? supplierHome() : [supplierAccount];
    await route.fulfill({ status: options.status ?? 200, headers, contentType: options.type ?? "application/json",
      body: options.raw ?? JSON.stringify(options.response ?? { code: 0, data }) }).catch(() => undefined);
  });
  const page = await context.newPage(); await page.goto(`${supplierOrigin}/dist/dashboard/index`);
  await page.evaluate(token => {
    Object.assign(document.querySelector("#app")!, { __vue__: { $store: { getters: { token }, state: { user: { userInfo: { id: "101", merchantId: "202" } } } } } });
  }, options.token ?? supplierToken);
  return { page, requests };
}
async function changeSupplier(page: Page, field: "token" | "id" | "merchantId") {
  await page.evaluate(field => {
    const store = (document.querySelector("#app") as unknown as { __vue__: { $store: { getters: { token: string }; state: { user: { userInfo: Record<string, string> } } } } }).__vue__.$store;
    if (field === "token") store.getters.token = "changed-private-session";
    else store.state.user.userInfo[field] = "303";
  }, field);
}

it("supplier: replays the fixed directory POST and exports only exact string metadata", async () => {
  const { page, requests } = await supplierFixture(); const port = await QianguanjiaReadonlyAdapter.create(page, clock);
  try {
    const result = await port.listAdvertisers(signal);
    expect(result).toEqual({ source: "qianguanjia", observedAt: clock().toISOString(), accounts: [{ advertiserId: supplierAccount.outAdvertiserId, name: "fixture shop", authStatus: 1, authStatusDesc: "授权正常" }] });
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ method: "POST", path: "/mms/qianchuanAdvertiser/listAdvertisers", body: {}, headers: { token: supplierToken, channel: "PC", apptype: "qianchuan" } });
    expect(requests[0]!.headers.cookie).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/private|secret|https:/);
  } finally { await port.dispose(); }
});
it("supplier: labels the home aggregate separately and preserves complete four-metric groups", async () => {
  const { page, requests } = await supplierFixture(); const port = await QianguanjiaReadonlyAdapter.create(page, clock);
  try {
    const result = await port.todayHomeSummary(signal);
    expect(result).toMatchObject({ scope: "supplier-home-aggregate", date: "2026-10-13", groups: { ALL: { current: { statCost: "12.5", totalPayOrderCountForRoi2: "4" }, comparison: { statCost: "12.5" } } } });
    expect(requests[0]).toMatchObject({ path: "/qianchuan/homereport/uniHomeTop", body: { startDate: "2026-10-13 00:00:00", endDate: "2026-10-13 23:59:59", selectFields: Object.keys(supplierMetrics) } });
    expect(JSON.stringify(result)).not.toMatch(/not-projected|private|advertiserId/);
  } finally { await port.dispose(); }
});
it("supplier: requires an existing normal login without invoking authorization", async () => {
  const { page, requests } = await supplierFixture({ token: "" });
  await expect(QianguanjiaReadonlyAdapter.create(page)).rejects.toThrow(/登录/); expect(requests).toHaveLength(0);
  await page.goto("https://other.invalid/").catch(() => undefined);
  await expect(QianguanjiaReadonlyAdapter.create(page)).rejects.toThrow();
});
it("supplier: prevents reads from login or visible password/captcha pages and never exports the session canary", async () => {
  const { page, requests } = await supplierFixture();
  const returned: unknown[] = [];
  const evaluate = page.evaluate.bind(page);
  vi.spyOn(page, "evaluate").mockImplementation(async (fn, arg) => {
    const value = await evaluate(fn, arg); returned.push(value); return value;
  });
  const port = await QianguanjiaReadonlyAdapter.create(page);
  try {
    await port.listAdvertisers(signal);
    expect(JSON.stringify(returned)).not.toContain(supplierToken);
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<input type="password">'));
    await expect(port.listAdvertisers(signal)).rejects.toThrow(/会话/);
    await expect(QianguanjiaReadonlyAdapter.create(page)).rejects.toThrow(/登录/); expect(requests).toHaveLength(1);
    await page.evaluate(() => document.querySelector("input")?.remove());
    await page.evaluate(() => history.pushState({}, "", "/dist/login"));
    await expect(QianguanjiaReadonlyAdapter.create(page)).rejects.toThrow(/登录/);
  } finally { await port.dispose(); }
});
it("supplier: detects token reflection before projection even with JSON escaping", async () => {
  const token = 'fixture-customer-"escaped-session';
  const { page } = await supplierFixture({ token, response: { code: 0, data: [{ ...supplierAccount, name: token }] } });
  const port = await QianguanjiaReadonlyAdapter.create(page);
  try { await expect(port.listAdvertisers(signal)).rejects.toThrow(/^千管家/); } finally { await port.dispose(); }
});
it.each(["token", "id", "merchantId"] as const)("supplier: blocks changed %s before sending and rejects stale results", async field => {
  const { page, requests } = await supplierFixture(); const port = await QianguanjiaReadonlyAdapter.create(page);
  try { await changeSupplier(page, field); await expect(port.listAdvertisers(signal)).rejects.toThrow(/会话/); expect(requests).toHaveLength(0); }
  finally { await port.dispose(); }
  const late = await supplierFixture({ delay: 150 }); const latePort = await QianguanjiaReadonlyAdapter.create(late.page);
  try {
    const request = latePort.listAdvertisers(signal); const rejected = expect(request).rejects.toThrow(/会话/);
    await expect.poll(() => late.requests.length).toBe(1); await changeSupplier(late.page, field); await rejected;
  } finally { await latePort.dispose(); }
});
it("supplier: rejects a replaced Document and a disposed instance without closing the user's page", async () => {
  const { page, requests } = await supplierFixture(); const port = await QianguanjiaReadonlyAdapter.create(page);
  await page.reload(); await expect(port.listAdvertisers(signal)).rejects.toThrow(); await port.dispose();
  await expect(port.listAdvertisers(signal)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(page.isClosed()).toBe(false);
});
it.each([
  ["http", { status: 401 }], ["membership", { response: { code: 1001, message: supplierToken } }],
  ["json", { raw: "private-broken-json" }], ["type", { type: "text/html" }],
  ["size", { raw: "x".repeat(2 * 1024 * 1024 + 1) }], ["redirect", { redirect: true }],
] as const)("supplier: fails closed and suppresses raw errors without retry: %s", async (_, options) => {
  const { page, requests } = await supplierFixture(options); const port = await QianguanjiaReadonlyAdapter.create(page);
  try { await expect(port.listAdvertisers(signal)).rejects.toThrow(/^千管家/); expect(requests).toHaveLength(1); }
  finally { await port.dispose(); }
});
it.each([
  { data: [{ ...supplierAccount, outAdvertiserId: 1879999999999999999 }] }, { data: [{ ...supplierAccount, outAdvertiserId: "01" }] },
  { data: [{ ...supplierAccount, name: supplierToken }] }, { data: [supplierAccount, supplierAccount] },
])("supplier: rejects invalid IDs, duplicate accounts and reflected credentials", async ({ data }) => {
  const { page } = await supplierFixture({ response: { code: 0, data } }); const port = await QianguanjiaReadonlyAdapter.create(page);
  try { await expect(port.listAdvertisers(signal)).rejects.toThrow(/^千管家/); }
  finally { await port.dispose(); }
});
it("supplier: preserves empty directories and rejects missing report metrics instead of inventing zero", async () => {
  const empty = await supplierFixture({ response: { code: 0, data: [] } }); const port = await QianguanjiaReadonlyAdapter.create(empty.page);
  try { expect(await port.listAdvertisers(signal)).toMatchObject({ accounts: [] }); } finally { await port.dispose(); }
  const data = supplierHome(); delete (data.ALL!.nowTotalData as Partial<typeof supplierMetrics>).statCost;
  const missing = await supplierFixture({ response: { code: 0, data } }); const missingPort = await QianguanjiaReadonlyAdapter.create(missing.page);
  try { await expect(missingPort.todayHomeSummary(signal)).rejects.toThrow(); } finally { await missingPort.dispose(); }
});
it("supplier: cancellation and disposal abort in-flight reads with safe errors and no replay", async () => {
  for (const dispose of [false, true]) {
    const { page, requests } = await supplierFixture({ delay: 2000 }); const port = await QianguanjiaReadonlyAdapter.create(page);
    const controller = new AbortController(); const work = port.listAdvertisers(controller.signal);
    const rejected = expect(work).rejects.toThrow(/^千管家/);
    await expect.poll(() => requests.length).toBe(1);
    if (dispose) await port.dispose(); else controller.abort(new Error(supplierToken));
    await rejected; expect(requests).toHaveLength(1); await port.dispose(); expect(page.isClosed()).toBe(false);
  }
});
