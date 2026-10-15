import type { JSHandle, Page, Response as BrowserResponse } from "playwright-core";
import { withQianchuanQueryPage } from "./qianchuan-query-page.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanPlanOptionSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

export type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

const QIANCHUAN_ORIGIN = "https://qianchuan.jinritemai.com";
const PLAN_PICKER_MARKER = "jianjiPlanPicker";
const MAX_PAGES = 100;
const MAX_PLANS = 1000;
const PAGE_WAIT_MS = 15_000;
const INITIAL_PAGE_WAIT_MS = 45_000;
const SAMPLE_INTERVAL_MS = 100;
const STABLE_SAMPLES = 3;
const changed = () => new Error("千川计划列表或账号身份无法完整核对，请检查账号浏览器中的计划列表后重试。");

class CatalogDocumentChanged extends Error {
  constructor() { super("千川计划列表在核对期间重新加载，请重新读取计划。"); }
}

interface PlanRowSnapshot {
  cellCount: number;
  names: string[];
  ids: string[];
  deletedTags: string[];
  rowText: string;
}

interface PageSnapshot {
  total: number;
  pageNumber: number;
  nextDisabled: boolean;
  rows: PlanRowSnapshot[];
  rowSignature: string;
}

interface DomSnapshot {
  accountContainers: number;
  accountIds: string[];
  paginationGroups: number;
  emptyStates: number;
  paginationReady: boolean;
  totalText?: string;
  activePageText?: string;
  nextDisabled?: boolean;
  rows: PlanRowSnapshot[];
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function pageUrl(advertiserId: string): string {
  const url = new URL("/uni-prom", QIANCHUAN_ORIGIN);
  url.searchParams.set("aavid", advertiserId);
  url.searchParams.set(PLAN_PICKER_MARKER, "1");
  return url.href;
}

function checkPage(page: Page, advertiserId: string): void {
  let url: URL;
  try { url = new URL(page.url()); } catch { throw changed(); }
  if (url.origin !== QIANCHUAN_ORIGIN || url.pathname !== "/uni-prom" ||
    url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== advertiserId ||
    url.searchParams.getAll(PLAN_PICKER_MARKER).length > 1 ||
    url.searchParams.has(PLAN_PICKER_MARKER) && url.searchParams.get(PLAN_PICKER_MARKER) !== "1" ||
    url.searchParams.getAll("adId").some(value => value !== "")) throw changed();
}

async function observe(page: Page, advertiserId: string, documentHandle: JSHandle<Document>, signal: AbortSignal): Promise<DomSnapshot> {
  signal.throwIfAborted();
  checkPage(page, advertiserId);
  const sameDocument = await abortable(page.evaluate(value => value === window.document, documentHandle).catch(() => false), signal);
  if (!sameDocument) throw new CatalogDocumentChanged();
  const snapshot = await abortable(page.evaluate(value => {
    if (value !== window.document) return undefined;
    const doc = window.document;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return !!element.getClientRects().length && style.display !== "none" && style.visibility !== "hidden";
    };
    const text = (element: Element) => (element as HTMLElement).innerText?.trim() ?? element.textContent?.trim() ?? "";
    const accounts = Array.from(doc.querySelectorAll(".account-info-container")).filter(visible);
    const accountIds = accounts.flatMap(account => Array.from(text(account).matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g), match => match[1]!));
    const groups = Array.from(doc.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"]')).filter(visible);
    const emptyStates = Array.from(doc.querySelectorAll('.ovui-table__empty-wrapper .oc-empty[data-e2e="oc_emptyKey_uni-prom__ocTable"]'))
      .filter(element => visible(element) && text(element) === "你还没有创建控成本投放");
    const group = groups.length === 1 ? groups[0]! : undefined;
    const totals = group ? Array.from(group.querySelectorAll(".ovui-page-total")).filter(visible) : [];
    const activePages = group ? Array.from(group.querySelectorAll(".ovui-page-turner__item--active")).filter(visible) : [];
    const nextItems = group ? Array.from(group.querySelectorAll("li.ovui-page-turner__item:has(.ovui-page-turner__next-icon)")).filter(visible) : [];
    const rows = Array.from(doc.querySelectorAll("tr.ovui-tr")).filter(visible).flatMap(row => {
      const cells = Array.from(row.querySelectorAll(".p-c-ad-name-col")).filter(visible);
      if (!cells.length) return [];
      const cell = cells.length === 1 ? cells[0]! : row;
      const names = Array.from(cell.querySelectorAll(".oc-promotion-product-adinfo-name .oc-typography-value-int")).filter(visible).map(text);
      const ids = Array.from(cell.querySelectorAll(".oc-promotion-product-adinfo-id-fade")).filter(visible).map(text);
      const deletedTags = Array.from(row.querySelectorAll(".oc-tag-text")).filter(tag => {
        if (text(tag) !== "已删除") return false;
        for (let ancestor: Element | null = tag; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility !== "visible") return false;
          if (ancestor === row) break;
        }
        const range = doc.createRange();
        range.selectNodeContents(tag);
        return Array.from(range.getClientRects()).some(box => box.width > 0 && box.height > 0);
      }).map(text);
      return [{ cellCount: cells.length, names, ids, deletedTags, rowText: text(row) }];
    });
    return {
      accountContainers: accounts.length,
      accountIds,
      paginationGroups: groups.length,
      emptyStates: emptyStates.length,
      paginationReady: groups.length === 1 && totals.length === 1 && activePages.length === 1 && nextItems.length === 1,
      ...(totals.length === 1 ? { totalText: text(totals[0]!) } : {}),
      ...(activePages.length === 1 ? { activePageText: text(activePages[0]!) } : {}),
      ...(nextItems.length === 1 ? { nextDisabled: nextItems[0]!.classList.contains("ovui-page-turner__item--disabled") } : {}),
      rows,
    };
  }, documentHandle), signal);
  checkPage(page, advertiserId);
  if (!snapshot) throw new CatalogDocumentChanged();
  if (snapshot.accountContainers > 1 || snapshot.accountIds.length > 1 ||
    snapshot.accountIds.length === 1 && snapshot.accountIds[0] !== advertiserId) throw changed();
  return snapshot;
}

function completeSnapshot(snapshot: DomSnapshot, expectedPage: number): PageSnapshot | undefined {
  if (snapshot.accountContainers !== 1 || snapshot.accountIds.length !== 1) return undefined;
  if (snapshot.emptyStates) {
    if (snapshot.emptyStates !== 1 || snapshot.paginationGroups || snapshot.rows.length || expectedPage !== 1) throw changed();
    return { total: 0, pageNumber: 1, nextDisabled: true, rows: [], rowSignature: "[]" };
  }
  if (!snapshot.paginationReady ||
    snapshot.totalText === undefined || snapshot.activePageText === undefined || snapshot.nextDisabled === undefined) return undefined;
  const totalMatch = /^共\s*(0|[1-9][0-9]*)\s*条记录$/.exec(snapshot.totalText);
  const pageMatch = /^([1-9][0-9]*)$/.exec(snapshot.activePageText);
  if (!totalMatch || !pageMatch) throw changed();
  const total = Number(totalMatch[1]);
  const pageNumber = Number(pageMatch[1]);
  if (!Number.isSafeInteger(total) || pageNumber !== expectedPage) return undefined;
  if (total > MAX_PLANS) throw new Error("千川计划数量超过安全读取上限，请在计划列表中缩小范围后重试。");
  const rowSignature = JSON.stringify(snapshot.rows.map(row => [row.rowText, row.cellCount, row.names, row.ids, row.deletedTags]));
  return { total, pageNumber, nextDisabled: snapshot.nextDisabled, rows: snapshot.rows, rowSignature };
}

async function prepareProductView(page: Page, advertiserId: string, document: JSHandle<Document>, requested: boolean, signal: AbortSignal): Promise<{ ready: boolean; requested: boolean }> {
  signal.throwIfAborted();
  checkPage(page, advertiserId);
  const view = await abortable(page.evaluate(({ document, advertiserId, requested }) => {
    if (document !== window.document) return undefined;
    const visible = (element: Element) => !!element.getClientRects().length && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
    const ids = Array.from(document.querySelectorAll(".account-info-container")).filter(visible)
      .flatMap(element => Array.from((element as HTMLElement).innerText.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g), match => match[1]!));
    if (ids.length > 1 || ids.length === 1 && ids[0] !== advertiserId) return { invalid: true, ready: false, requested };
    const productTabs = Array.from(document.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_1"]')).filter(element =>
      visible(element) && element.textContent?.trim() === "商品自选" && element.closest(".ovui-tabs__tab"));
    const managedTabs = Array.from(document.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_2"]')).filter(element =>
      visible(element) && element.textContent?.trim() === "全店托管" && element.closest(".ovui-tabs__tab"));
    if (productTabs.length > 1 || managedTabs.length > 1) return { invalid: true, ready: false, requested };
    if (!productTabs.length && !managedTabs.length) return { ready: true, requested };
    if (productTabs.length !== 1 || managedTabs.length !== 1 || ids.length !== 1) return { ready: false, requested };
    const product = productTabs[0]!;
    if (product.closest(".ovui-tabs__tab")!.classList.contains("ovui-tabs__tab--active")) return { ready: true, requested };
    if (!requested && managedTabs[0]!.closest(".ovui-tabs__tab")!.classList.contains("ovui-tabs__tab--active")) {
      // This only selects a read-only view on our picker, without waiting for background animation frames.
      (product as HTMLElement).click();
      return { ready: false, requested: true };
    }
    return { ready: false, requested };
  }, { document, advertiserId, requested }).catch(async cause => {
    const sameDocument = await page.evaluate(value => value === window.document, document).catch(() => false);
    if (!sameDocument) throw new CatalogDocumentChanged();
    throw cause;
  }), signal);
  checkPage(page, advertiserId);
  if (!view) throw new CatalogDocumentChanged();
  if (view.invalid) throw changed();
  return view;
}

async function waitForInitialDocument(page: Page, advertiserId: string, signal: AbortSignal, deadline: number): Promise<JSHandle<Document>> {
  let document = await abortable(page.evaluateHandle(() => window.document), signal);
  let bound = false;
  let productViewRequested = false;
  let costViewRequested = false;
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      try {
        const view = await prepareProductView(page, advertiserId, document, productViewRequested, signal);
        productViewRequested = view.requested;
        if (view.ready) {
          const costView = await prepareCostControlView(page, advertiserId, document, costViewRequested, signal);
          costViewRequested = costView.requested;
          if (!costView.ready) { await abortable(new Promise<void>(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS)), signal); continue; }
          const snapshot = completeSnapshot(await observe(page, advertiserId, document, signal), 1);
          if (snapshot && !(snapshot.total > 0 && snapshot.rows.length === 0)) { bound = true; return document; }
        }
      } catch (cause) {
        if (!(cause instanceof CatalogDocumentChanged)) throw cause;
        await document.dispose().catch(() => undefined);
        await abortable(page.waitForLoadState("domcontentloaded", { timeout: Math.max(1, deadline - Date.now()) }), signal);
        checkPage(page, advertiserId);
        document = await abortable(page.evaluateHandle(() => window.document), signal);
      }
      await abortable(new Promise<void>(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS)), signal);
    }
    throw new Error("千川计划列表初始化超时，请检查账号浏览器中的计划列表后重试。");
  } finally { if (!bound) await document.dispose().catch(() => undefined); }
}

async function prepareCostControlView(page: Page, advertiserId: string, document: JSHandle<Document>, requested: boolean, signal: AbortSignal): Promise<{ ready: boolean; requested: boolean }> {
  signal.throwIfAborted();
  checkPage(page, advertiserId);
  const view = await abortable(page.evaluate(({ document, advertiserId, requested }) => {
    if (document !== window.document) return undefined;
    const visible = (element: Element) => !!element.getClientRects().length && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
    const controls = Array.from(document.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_0"]')).filter(element => visible(element) && element.textContent?.trim() === "控成本投放" && element.classList.contains("ovui-radio-item"));
    const broad = Array.from(document.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_7"]')).filter(element => visible(element) && element.textContent?.includes("放量投放") && element.classList.contains("ovui-radio-item"));
    if (!controls.length && !broad.length) return { ready: true, requested };
    const ids = Array.from(document.querySelectorAll(".account-info-container")).filter(visible)
      .flatMap(element => Array.from((element as HTMLElement).innerText.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g), match => match[1]!));
    if (controls.length > 1 || broad.length > 1 || ids.length > 1 || ids.length === 1 && ids[0] !== advertiserId) return { invalid: true, ready: false, requested };
    if (controls.length !== 1 || broad.length !== 1 || ids.length !== 1) return { ready: false, requested };
    if (controls[0]!.classList.contains("ovui-radio-item--checked")) return { ready: true, requested };
    if (!requested && broad[0]!.classList.contains("ovui-radio-item--checked")) {
      (controls[0] as HTMLElement).click();
      return { ready: false, requested: true };
    }
    return { ready: false, requested };
  }, { document, advertiserId, requested }), signal);
  checkPage(page, advertiserId);
  if (!view) throw new CatalogDocumentChanged();
  if (view.invalid) throw changed();
  return view;
}

async function waitForStablePage(page: Page, advertiserId: string, document: JSHandle<Document>, signal: AbortSignal,
  expectedPage: number, previousRowSignature?: string, deadline = Date.now() + PAGE_WAIT_MS): Promise<PageSnapshot> {
  let previousSample = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const dom = await observe(page, advertiserId, document, signal);
    const snapshot = completeSnapshot(dom, expectedPage);
    if (snapshot && (previousRowSignature === undefined || snapshot.rowSignature !== previousRowSignature) &&
      !(snapshot.total > 0 && snapshot.rows.length === 0)) {
      const sample = JSON.stringify(snapshot);
      if (sample === previousSample) stableCount++;
      else { previousSample = sample; stableCount = 1; }
      if (stableCount >= STABLE_SAMPLES) return snapshot;
    } else { previousSample = ""; stableCount = 0; }
    await abortable(new Promise<void>(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS)), signal);
  }
  throw changed();
}

function parseRows(snapshot: PageSnapshot, advertiserId: string, idsSeen: Set<string>): QianchuanPlanOption[] {
  const plans: QianchuanPlanOption[] = [];
  for (const row of snapshot.rows) {
    if (row.cellCount !== 1 || row.names.length !== 1 || row.ids.length !== 1) throw changed();
    const name = row.names[0]!.trim();
    const idMatch = /^ID[：:]\s*([1-9][0-9]{0,19})$/.exec(row.ids[0]!.trim());
    if (!name || !idMatch || row.deletedTags.length > 1) throw changed();
    const adId = idMatch[1]!;
    if (idsSeen.has(adId)) throw changed();
    idsSeen.add(adId);
    if (!row.deletedTags.includes("已删除")) plans.push({ advertiserId, adId, name });
  }
  return plans;
}

/** Reads all visible plans on the owned picker page and fails closed if pagination is incomplete. */
export async function readVisibleQianchuanPlans(page: Page, advertiserId: string, signal: AbortSignal): Promise<QianchuanPlanOption[]> {
  if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw changed();
  signal.throwIfAborted();
  checkPage(page, advertiserId);
  const firstPageDeadline = Date.now() + INITIAL_PAGE_WAIT_MS;
  const documentHandle = await waitForInitialDocument(page, advertiserId, signal, firstPageDeadline);
  try {
    const idsSeen = new Set<string>();
    const plans: QianchuanPlanOption[] = [];
    let expectedTotal: number | undefined;
    let rawRowsSeen = 0;
    let pageNumber = 1;
    let previousRowSignature: string | undefined;
    while (pageNumber <= MAX_PAGES) {
      const snapshot = await waitForStablePage(page, advertiserId, documentHandle, signal, pageNumber, previousRowSignature,
        pageNumber === 1 ? firstPageDeadline : undefined);
      if (expectedTotal === undefined) expectedTotal = snapshot.total;
      else if (snapshot.total !== expectedTotal) throw changed();
      rawRowsSeen += snapshot.rows.length;
      if (rawRowsSeen > snapshot.total || rawRowsSeen > MAX_PLANS) throw changed();
      plans.push(...parseRows(snapshot, advertiserId, idsSeen));
      previousRowSignature = snapshot.rowSignature;
      if (snapshot.nextDisabled) {
        if (rawRowsSeen !== snapshot.total) throw changed();
        return plans;
      }
      if (rawRowsSeen >= snapshot.total || pageNumber === MAX_PAGES) throw changed();
      signal.throwIfAborted();
      checkPage(page, advertiserId);
      const next = page.locator('[data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"] li.ovui-page-turner__item:has(.ovui-page-turner__next-icon)');
      if (await abortable(next.count(), signal) !== 1 || await abortable(next.evaluate(element => element.classList.contains("ovui-page-turner__item--disabled")), signal)) throw changed();
      await abortable(next.click({ timeout: 10_000 }), signal);
      pageNumber++;
    }
    throw changed();
  } finally { await documentHandle.dispose().catch(() => undefined); }
}

/** Optional display metadata, bound to the same advertiser, plan ID and source plan name. */
export function readPlanProductNames(input: unknown, advertiserId: string): Map<string, QianchuanPlanOption> {
  const result = new Map<string, QianchuanPlanOption>();
  const data = (input as { data?: { adInfos?: unknown; adGoodsMap?: Record<string, unknown> } } | null)?.data;
  if (!Array.isArray(data?.adInfos) || data.adInfos.length > MAX_PLANS || !data.adGoodsMap || typeof data.adGoodsMap !== "object") return result;
  const seen = new Set<string>();
  for (const info of data.adInfos as { id?: unknown; advId?: unknown; name?: unknown }[]) {
    if (!info || typeof info.id !== "string" || seen.has(info.id)) return new Map();
    seen.add(info.id);
    if (info.advId !== advertiserId) continue;
    const goods = data.adGoodsMap[info.id];
    if (!Array.isArray(goods) || !goods.length || goods.length > 50 || goods.some(good => !good || typeof good.id !== "string" || !/^[1-9][0-9]{0,19}$/.test(good.id))) continue;
    const parsed = QianchuanPlanOptionSchema.safeParse({ advertiserId, adId: info.id, name: info.name, productNames: [...new Set(goods.map(good => good.name))] });
    if (parsed.success) result.set(info.id, parsed.data);
  }
  return result;
}

/** Existing DOM catalog behavior, using the shared owned picker connection. */
export async function readQianchuanPlans(target: FrozenQianchuanAccount, signal: AbortSignal, expectedBrowserContextId?: string): Promise<QianchuanPlanOption[]> {
  return withQianchuanQueryPage(target, signal, async page => {
    const products = new Map<string, QianchuanPlanOption>();
    const productResponse = (response: BrowserResponse) => {
      const url = new URL(response.url());
      if (url.origin !== QIANCHUAN_ORIGIN || url.pathname !== "/ad/api/pmc/v1/uni-promotion/ad/list-optional" || !response.ok()) return;
      void response.body().then(body => {
        if (signal.aborted || body.length > 2 * 1024 * 1024) return;
        for (const [id, plan] of readPlanProductNames(JSON.parse(body.toString("utf8")), target.advertiserId)) products.set(id, plan);
      }).catch(() => undefined);
    };
    page.on("response", productResponse);
    try {
      await abortable(page.goto(pageUrl(target.advertiserId), { waitUntil: "domcontentloaded", timeout: 45_000 }), signal);
      const plans = await readVisibleQianchuanPlans(page, target.advertiserId, signal);
      const deadline = Date.now() + 2000;
      while (plans.some(plan => !products.has(plan.adId)) && Date.now() < deadline) {
        await abortable(new Promise<void>(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS)), signal);
      }
      return plans.map(plan => products.get(plan.adId)?.name === plan.name ? { ...plan, productNames: products.get(plan.adId)!.productNames } : plan);
    } finally { page.off("response", productResponse); }
  }, expectedBrowserContextId);
}
