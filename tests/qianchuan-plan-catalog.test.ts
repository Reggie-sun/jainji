import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";
import * as transport from "../src/main/local-cdp-transport";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { readQianchuanPlans, readVisibleQianchuanPlans } from "../src/main/qianchuan-plan-catalog";

const advertiserId = "1876294500004864";
const origin = "https://qianchuan.jinritemai.com";
const signal = new AbortController().signal;
const target = { product: "蝴蝶贴", advertiserId, adId: "123", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) } as FrozenQianchuanAccount;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

interface FixtureRow { name: string; id: string; deleted?: boolean; zeroHeightDeleted?: boolean; idText?: string; }
interface FixturePage { rows: FixtureRow[]; total: number; nextDisabled: boolean; }

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] }); });
afterAll(async () => { await browser?.close(); });
afterEach(() => { vi.restoreAllMocks(); });

function rowHtml(row: FixtureRow): string {
  return `<tr class="ovui-tr"><td class="p-c-ad-name-col"><div class="oc-promotion-product-adinfo">
    <div class="oc-promotion-product-adinfo-name"><span class="oc-typography-value-int">${row.name}</span></div>
    <span class="oc-promotion-product-adinfo-id-fade">${row.idText ?? `ID：${row.id}`}</span>
  </div>${row.deleted ? `<div class="oc-tag-text"${row.zeroHeightDeleted ? ' style="line-height:0"' : ""}>已删除</div>` : ""}</td></tr>`;
}

function pageHtml(page: FixturePage, pageNumber: number): string {
  return `<div data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group">
    <span class="ovui-page-total">共 ${page.total} 条记录</span>
    <ul><li class="ovui-page-turner__item ovui-page-turner__item--active">${pageNumber}</li>
      <li class="ovui-page-turner__item ${page.nextDisabled ? "ovui-page-turner__item--disabled" : ""}"><span class="ovui-page-turner__next-icon"></span></li></ul>
  </div><table><tbody>${page.rows.map(rowHtml).join("")}</tbody></table>`;
}

async function fixture(options: { pages?: FixturePage[]; accountId?: string; updateDelay?: number; holdNext?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pages = options.pages ?? [{ rows: [], total: 0, nextDisabled: true }];
  const html = `<!doctype html><meta charset="utf-8"><div class="account-info-container">ID：${options.accountId ?? advertiserId}</div>
    <div id="catalog">${pageHtml(pages[0]!, 1)}</div><script>
      const values=${JSON.stringify(pages.map((entry, index) => pageHtml(entry, index + 1)))}; let index=0;
      const next=()=>document.querySelector('[data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"] li.ovui-page-turner__item:has(.ovui-page-turner__next-icon)');
      next().addEventListener('click',()=>{${options.holdNext ? "" : `setTimeout(()=>{index++;if(index<values.length)document.querySelector('#catalog').innerHTML=values[index];},${options.updateDelay ?? 50});`}});
    </script>`;
  await page.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.goto(`${origin}/uni-prom?aavid=${advertiserId}&jianjiPlanPicker=1`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

it("returns visible active plans, excludes exact deleted tags, and ignores summary rows", async () => {
  const f = await fixture({ pages: [{ total: 4, nextDisabled: true, rows: [
    { name: "全域投放一", id: "1877947268854202" },
    { name: "已删除计划", id: "1877947268854203", deleted: true, zeroHeightDeleted: true },
    { name: "全域投放二", id: "1877947268854204" },
    { name: "名称包含已删除字样", id: "1877947268854205" },
  ] }] });
  try {
    await f.page.locator("tbody").evaluate(node => node.insertAdjacentHTML("beforeend", '<tr class="ovui-tr"><td>汇总行</td></tr>'));
    const badge = await f.page.locator(".oc-tag-text").evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return { boxHeight: element.getBoundingClientRect().height, textHeight: Math.max(...Array.from(range.getClientRects(), rect => rect.height)) };
    });
    expect(badge).toEqual({ boxHeight: 0, textHeight: expect.any(Number) }); expect(badge.textHeight).toBeGreaterThan(0);
    await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).resolves.toEqual([
      { advertiserId, adId: "1877947268854202", name: "全域投放一" },
      { advertiserId, adId: "1877947268854204", name: "全域投放二" },
      { advertiserId, adId: "1877947268854205", name: "名称包含已删除字样" },
    ]);
  } finally { await f.context.close(); }
});

it("reads all pages only after page number and row signature change", async () => {
  const f = await fixture({ updateDelay: 150, pages: [
    { total: 3, nextDisabled: false, rows: [{ name: "计划一", id: "7001" }, { name: "计划二", id: "7002" }] },
    { total: 3, nextDisabled: true, rows: [{ name: "计划三", id: "7003" }] },
  ] });
  try {
    await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).resolves.toEqual([
      { advertiserId, adId: "7001", name: "计划一" },
      { advertiserId, adId: "7002", name: "计划二" },
      { advertiserId, adId: "7003", name: "计划三" },
    ]);
  } finally { await f.context.close(); }
});

it("rejects an account identity that does not match the requested advertiser", async () => {
  const f = await fixture({ accountId: "999999" });
  try { await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).rejects.toThrow(); }
  finally { await f.context.close(); }
});

it("rejects duplicate visible account identity containers", async () => {
  const f = await fixture();
  try {
    await f.page.locator(".account-info-container").evaluate(node => node.insertAdjacentHTML("afterend", '<div class="account-info-container">ID：' + "1876294500004864" + "</div>"));
    await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).rejects.toThrow();
  } finally { await f.context.close(); }
});

it("rejects duplicate plan IDs across pages", async () => {
  const f = await fixture({ pages: [
    { total: 2, nextDisabled: false, rows: [{ name: "计划一", id: "7001" }] },
    { total: 2, nextDisabled: true, rows: [{ name: "计划重复", id: "7001" }] },
  ] });
  try { await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).rejects.toThrow(); }
  finally { await f.context.close(); }
});

it("rejects ambiguous IDs in a plan row", async () => {
  const f = await fixture({ pages: [{ total: 1, nextDisabled: true, rows: [{ name: "计划一", id: "7001", idText: "ID：7001 ID：7002" }] }] });
  try { await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).rejects.toThrow(); }
  finally { await f.context.close(); }
});

it("returns an empty list only when the visible total and terminal page are both empty", async () => {
  const f = await fixture({ pages: [{ total: 0, nextDisabled: true, rows: [] }] });
  try { await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).resolves.toEqual([]); }
  finally { await f.context.close(); }
});

it("accepts the platform removing the picker URL marker on its owned list page", async () => {
  const f = await fixture({ pages: [{ total: 1, nextDisabled: true, rows: [{ name: "平台重写 URL", id: "7001" }] }] });
  try {
    await f.page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete("jianjiPlanPicker"); history.replaceState(null, "", url); });
    expect(await readVisibleQianchuanPlans(f.page, advertiserId, signal)).toEqual([{ advertiserId, adId: "7001", name: "平台重写 URL" }]);
    await f.page.evaluate(() => { const url = new URL(location.href); url.searchParams.set("adId", "7001"); history.replaceState(null, "", url); });
    await expect(readVisibleQianchuanPlans(f.page, advertiserId, signal)).rejects.toThrow();
  } finally { await f.context.close(); }
});

it("rejects a truncated final page and cancels a stalled page transition", async () => {
  const incomplete = await fixture({ pages: [{ total: 2, nextDisabled: true, rows: [{ name: "计划一", id: "7001" }] }] });
  try { await expect(readVisibleQianchuanPlans(incomplete.page, advertiserId, signal)).rejects.toThrow(); }
  finally { await incomplete.context.close(); }

  const stalled = await fixture({ holdNext: true, pages: [
    { total: 2, nextDisabled: false, rows: [{ name: "计划一", id: "7001" }] },
    { total: 2, nextDisabled: true, rows: [{ name: "计划二", id: "7002" }] },
  ] });
  const controller = new AbortController();
  const pending = readVisibleQianchuanPlans(stalled.page, advertiserId, controller.signal);
  const timer = setTimeout(() => controller.abort(), 600);
  try { await expect(pending).rejects.toMatchObject({ name: "AbortError" }); }
  finally { clearTimeout(timer); await stalled.context.close(); }
});

it("uses a new marked picker tab and detaches without touching existing user tabs", async () => {
  const userTab = { url: vi.fn(() => `${origin}/uni-prom?aavid=${advertiserId}`), close: vi.fn(), goto: vi.fn() };
  const uploadTab = { url: vi.fn(() => `${origin}/uni-prom?aavid=${advertiserId}&upload=1`), close: vi.fn(), goto: vi.fn() };
  const ownedTab = { setDefaultTimeout: vi.fn(), close: vi.fn(async () => {}), goto: vi.fn(async () => { throw new Error("fixture stops after navigation"); }) };
  const context = { pages: vi.fn(() => [userTab, uploadTab]), newPage: vi.fn(async () => ownedTab) };
  const attachedBrowser = { contexts: vi.fn(() => [context]), close: vi.fn(async () => {}) };
  const relay = { url: "ws://127.0.0.1:42002/relay", close: vi.fn(async () => {}) };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:42001/devtools/browser/test" })));
  vi.spyOn(transport, "guardedTransport").mockResolvedValue(relay);
  const connect = vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(attachedBrowser as unknown as Browser);
  await expect(readQianchuanPlans(target, signal)).rejects.toThrow("fixture stops after navigation");
  expect(connect).toHaveBeenCalledWith(relay.url, { timeout: 10_000, noDefaults: true });
  expect(context.newPage).toHaveBeenCalledTimes(1); expect(context.pages).not.toHaveBeenCalled();
  expect(ownedTab.goto).toHaveBeenCalledWith(`${origin}/uni-prom?aavid=${advertiserId}&jianjiPlanPicker=1`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(ownedTab.close).toHaveBeenCalledTimes(1); expect(attachedBrowser.close).toHaveBeenCalledTimes(1); expect(relay.close).toHaveBeenCalledTimes(1);
  expect(userTab.close).not.toHaveBeenCalled(); expect(userTab.goto).not.toHaveBeenCalled();
  expect(uploadTab.close).not.toHaveBeenCalled(); expect(uploadTab.goto).not.toHaveBeenCalled();
});
