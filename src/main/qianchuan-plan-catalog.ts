import { chromium, type Browser, type CDPSession, type JSHandle, type Page, type Response as BrowserResponse } from "playwright-core";
import { guardedTransport } from "./local-cdp-transport.js";
import { QianchuanPickerTransport } from "./qianchuan-picker-transport.js";
import { isLoopbackUrl } from "../shared/douyin-upload.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanPlanOptionSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

export type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

const QIANCHUAN_ORIGIN = "https://qianchuan.jinritemai.com";
const PLAN_PICKER_MARKER = "jianjiPlanPicker";
const MAX_PAGES = 100;
const MAX_PLANS = 1000;
const PAGE_WAIT_MS = 15_000;
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
  if (snapshot.accountContainers !== 1 || snapshot.accountIds.length !== 1 || !snapshot.paginationReady ||
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

async function waitForInitialDocument(page: Page, advertiserId: string, signal: AbortSignal, deadline: number): Promise<JSHandle<Document>> {
  let document = await abortable(page.evaluateHandle(() => window.document), signal);
  let bound = false;
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      try {
        const snapshot = completeSnapshot(await observe(page, advertiserId, document, signal), 1);
        if (snapshot && !(snapshot.total > 0 && snapshot.rows.length === 0)) { bound = true; return document; }
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
  const firstPageDeadline = Date.now() + PAGE_WAIT_MS;
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

/** Connects through the guarded loopback relay and touches only a new, marked picker tab. */
export async function readQianchuanPlans(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<QianchuanPlanOption[]> {
  signal.throwIfAborted();
  if (!/^[1-9][0-9]{0,19}$/.test(target.advertiserId) || !isLoopbackUrl(target.cdpEndpoint) || new URL(target.cdpEndpoint).pathname !== "/") throw changed();
  let relay: Awaited<ReturnType<typeof guardedTransport>> | undefined;
  let pickerTransport: QianchuanPickerTransport | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let pickerSession: CDPSession | undefined;
  let pickerTargetId: string | undefined;
  const transportController = new AbortController();
  let productResponse: ((response: BrowserResponse) => void) | undefined;
  try {
    const endpoint = new URL(target.cdpEndpoint);
    const response = await fetch(new URL("/json/version", endpoint), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw changed();
    const info = await response.json() as { webSocketDebuggerUrl?: unknown };
    if (typeof info.webSocketDebuggerUrl !== "string" || !isLoopbackUrl(info.webSocketDebuggerUrl, true) ||
      new URL(info.webSocketDebuggerUrl).host !== endpoint.host) throw changed();
    // Keep the relay alive until cancellation has closed this invocation's target.
    relay = await guardedTransport(info.webSocketDebuggerUrl, transportController.signal, 10_000);
    signal.throwIfAborted();
    pickerTransport = await QianchuanPickerTransport.connect(relay.url, transportController.signal);
    signal.throwIfAborted();
    const connection = chromium.connectOverCDP(pickerTransport, { timeout: 10_000, noDefaults: true }).then(async connected => {
      if (signal.aborted) { await connected.close().catch(() => undefined); signal.throwIfAborted(); }
      return connected;
    });
    browser = await abortable(connection, signal);
    if (browser.contexts().length !== 1) throw changed();
    const context = browser.contexts()[0]!;
    pickerSession = await browser.newBrowserCDPSession();
    signal.throwIfAborted();
    let creating: Promise<{ targetId: string }>;
    const opening = context.waitForEvent("page", { timeout: 10_000, predicate: async candidate => {
      const owned = await creating;
      const candidateSession = await context.newCDPSession(candidate);
      try { return (await candidateSession.send("Target.getTargetInfo")).targetInfo.targetId === owned.targetId; }
      finally { await candidateSession.detach().catch(() => undefined); }
    } });
    void opening.catch(() => undefined);
    const creationTimer = setTimeout(() => transportController.abort(), 10_000);
    try {
      creating = pickerSession.send("Target.createTarget", { url: "about:blank", background: true });
      pickerTargetId = (await creating).targetId;
      signal.throwIfAborted();
      await abortable(pickerTransport.attach(pickerTargetId), signal);
    } finally { clearTimeout(creationTimer); }
    signal.throwIfAborted();
    page = await abortable(opening, signal);
    page.setDefaultTimeout(10_000);
    await abortable(page.setViewportSize({ width: 1600, height: 1000 }), signal);
    const products = new Map<string, QianchuanPlanOption>();
    productResponse = response => {
      const url = new URL(response.url());
      if (url.origin !== QIANCHUAN_ORIGIN || url.pathname !== "/ad/api/pmc/v1/uni-promotion/ad/list-optional" || !response.ok()) return;
      void response.body().then(body => {
        if (signal.aborted || body.length > 2 * 1024 * 1024) return;
        for (const [id, plan] of readPlanProductNames(JSON.parse(body.toString("utf8")), target.advertiserId)) products.set(id, plan);
      }).catch(() => undefined);
    };
    page.on("response", productResponse);
    await abortable(page.goto(pageUrl(target.advertiserId), { waitUntil: "domcontentloaded", timeout: 45_000 }), signal);
    const plans = await readVisibleQianchuanPlans(page, target.advertiserId, signal);
    const deadline = Date.now() + 2000;
    while (plans.some(plan => !products.has(plan.adId)) && Date.now() < deadline) {
      await abortable(new Promise<void>(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS)), signal);
    }
    return plans.map(plan => products.get(plan.adId)?.name === plan.name ? { ...plan, productNames: products.get(plan.adId)!.productNames } : plan);
  } finally {
    const cleanupTimer = setTimeout(() => transportController.abort(), 2000);
    cleanupTimer.unref();
    if (page && productResponse) page.off("response", productResponse);
    await page?.close({ runBeforeUnload: false }).catch(() => undefined);
    if (pickerTargetId) await pickerSession?.send("Target.closeTarget", { targetId: pickerTargetId }).catch(() => undefined);
    await pickerSession?.detach().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    transportController.abort();
    pickerTransport?.close();
    await relay?.close().catch(() => undefined);
    clearTimeout(cleanupTimer);
  }
}
