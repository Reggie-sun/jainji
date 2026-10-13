import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import { QianchuanBackendAdapter } from "../src/main/qianchuan-backend-adapter";
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
