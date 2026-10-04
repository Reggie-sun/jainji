import type { Frame, JSHandle, Page, Request } from "playwright-core";
import { VIDEO_LIBRARY_ROUTE, videoLibraryUrl } from "../shared/qianchuan-video-library.js";

export interface LibrarySnapshot { total: number; ids: string[]; }
const changed = () => new Error("视频库页面、账号或选择范围无法核对，已停止删除。");
export const LIBRARY_DELETE_WARNING = "删除后不影响已使用该视频的在投创意和计划，素材库中不再展示该视频";

/** The library dialog is separate from upload confirmation and plan controls. */
export class QianchuanVideoLibraryPage {
  private responseTotal?: number;
  private responseDocument?: JSHandle<Document>;
  private mutationObserved = false;
  constructor(private readonly page: Page, private readonly advertiserId: string, private readonly signal: AbortSignal) {}
  private check(): void {
    this.signal.throwIfAborted();
    const url = new URL(this.page.url());
    if (url.origin !== "https://qianchuan.jinritemai.com" || url.pathname !== VIDEO_LIBRARY_ROUTE ||
      url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== this.advertiserId) throw changed();
  }
  private listRequest(request: Request): boolean {
    try {
      const url = new URL(request.url());
      return request.frame() === this.page.mainFrame() && request.method() === "GET" &&
        url.origin === "https://qianchuan.jinritemai.com" && url.pathname === "/ad/api/creation/material/video-list" &&
        url.searchParams.getAll("aavid").length === 1 && url.searchParams.get("aavid") === this.advertiserId &&
        url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === "1" &&
        ["queryString", "source", "tags", "imageModes", "analysisType", "auditStatuses", "materialDeliveryStatus"].every(key =>
          url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === "");
    } catch { return false; }
  }
  async open(): Promise<void> {
    this.signal.throwIfAborted();
    const existing = this.page.url() !== "about:blank";
    if (existing) this.check();
    await this.load(() => {
      if (existing) this.check();
      else if (this.page.url() !== "about:blank") throw changed();
      return existing ? this.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }) :
        this.page.goto(videoLibraryUrl(this.advertiserId), { waitUntil: "domcontentloaded", timeout: 30000 });
    });
    await this.page.bringToFront();
    await this.preparePage();
  }
  /** Observe only the normal UI request issued by this navigation, including its unfiltered account binding. */
  private async load(navigate: () => Promise<unknown>): Promise<void> {
    this.signal.throwIfAborted();
    this.mutationObserved = false;
    this.responseTotal = undefined;
    await this.responseDocument?.dispose().catch(() => undefined);
    this.responseDocument = undefined;
    let documentEpoch = 0;
    const requests = new Map<Request, number>();
    const committed = (frame: Frame) => { if (frame === this.page.mainFrame()) documentEpoch++; };
    const capture = (request: Request) => {
      if (!documentEpoch) return;
      if (this.listRequest(request)) requests.set(request, documentEpoch);
    };
    this.page.on("framenavigated", committed);
    this.page.on("request", capture);
    try {
      const response = this.page.waitForResponse(response => requests.get(response.request()) === documentEpoch, { timeout: 30000 });
      const [loaded] = await Promise.all([response, navigate()]);
      this.check();
      if (loaded.status() !== 200) throw changed();
      const body = await loaded.json();
      if (body?.status_code !== 0 || typeof body.data?.total !== "string" || !/^(0|[1-9]\d*)$/.test(body.data.total)) throw changed();
      const total = Number(body.data.total);
      if (!Number.isSafeInteger(total) || requests.get(loaded.request()) !== documentEpoch) throw changed();
      this.signal.throwIfAborted();
      const document = await this.page.evaluateHandle(() => window.document);
      if (requests.get(loaded.request()) !== documentEpoch) { await document.dispose(); throw changed(); }
      this.responseDocument = document;
      this.responseTotal = total;
    } finally { this.page.off("request", capture); this.page.off("framenavigated", committed); }
  }
  private async preparePage(): Promise<LibrarySnapshot> {
    await this.read();
    const size = this.page.locator(".ovui-page-select .ovui-select__input:visible");
    if (await size.count() === 1) {
      const value = await size.evaluate(node => node instanceof HTMLInputElement ? node.value : node.querySelector("input")?.value);
      if (value !== "50条/页") {
        await size.click({ timeout: 30000 });
        const fifty = this.page.locator(".ovui-option:visible").filter({ hasText: /^50条\/页$/ });
        await fifty.waitFor({ state: "visible", timeout: 10000 });
        if (await fifty.count() !== 1) throw changed();
        await fifty.click({ timeout: 30000 });
        await this.page.waitForFunction(() => {
          const visible = (node: Element) => !!node.getClientRects().length;
          const tables = Array.from(document.querySelectorAll("table.ovui-table")).filter(visible);
          const totals = Array.from(document.querySelectorAll(".ovui-page-total")).filter(visible);
          const match = totals.length === 1 ? /^共\s*(\d+)\s*条记录$/.exec(totals[0].textContent?.trim() ?? "") : null;
          return tables.length === 1 && !!match &&
            tables[0].querySelectorAll('tbody input[type="checkbox"]').length === Math.min(Number(match[1]), 50);
        }, null, { timeout: 30000 });
        this.check();
      }
    }
    return this.read();
  }
  async read(expectedPage = 1): Promise<LibrarySnapshot> {
    this.check();
    if (this.responseTotal === undefined) throw changed();
    const deadline = Date.now() + 30000;
    do {
      this.check();
      await this.checkDocument();
      const value = await this.page.evaluate(({ advertiserId, expectedPage, responseTotal, mutationObserved }) => {
        const visible = (node: Element) => !!node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
        const headers = Array.from(document.querySelectorAll("header, [role=banner]")).filter(visible);
        const accounts = headers.flatMap(node => Array.from(node.textContent?.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g) ?? [], match => match[1]));
        const totals = Array.from(document.querySelectorAll(".ovui-page-total")).filter(visible);
        const match = totals.length === 1 ? /^共\s*(\d+)\s*条记录$/.exec(totals[0].textContent?.trim() ?? "") : null;
        const tables = Array.from(document.querySelectorAll("table.ovui-table")).filter(visible);
        const search = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="请输入视频名称/ID搜索"]')).filter(visible);
        const filters = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="请选择"]')).filter(visible);
        const current = Array.from(document.querySelectorAll(".ovui-page-turner__item--active")).filter(visible);
        if (accounts.length && (accounts.length !== 1 || accounts[0] !== advertiserId) || search.some(input => input.value) || filters.some(input => input.value)) return { unsafe: true as const };
        if (accounts.length !== 1 || accounts[0] !== advertiserId || search.length !== 1 || search[0].value ||
          filters.length !== 6 || filters.some(input => input.value) || tables.length !== 1) return null;
        const rows = Array.from(tables[0].querySelectorAll("tbody tr")).filter(row => row.querySelector('input[type="checkbox"]'));
        // The live library removes pagination entirely for an explicitly empty list.
        const empty = Array.from(document.querySelectorAll('.oc-empty[data-e2e="oc_emptyKey_tools/creative-management/video-library__ocSelect_rolling_load__rollingLoad"], .oc-empty[data-e2e="oc_emptyKey_tools/creative-management/video-library__ocTable"]')).filter(visible);
        if ((mutationObserved || responseTotal === 0) && !totals.length && !current.length && !rows.length && empty.length === 1 && empty[0].textContent?.trim() === "暂无数据") return { total: 0, ids: [] };
        if (!match || current.length !== 1 || current[0].textContent?.trim() !== String(expectedPage)) return null;
        const total = Number(match[1]);
        if (!mutationObserved && total !== responseTotal) return null;
        const ids = rows.map(row => {
          const matches = Array.from(row.textContent?.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g) ?? [], match => match[1]);
          return matches.length === 1 ? matches[0] : "";
        });
        if (!Number.isSafeInteger(total) || total < 0 || ids.some(id => !id) || new Set(ids).size !== ids.length ||
          ids.length > 100 || ids.length > total || total > 0 && !ids.length) return null;
        return { total, ids };
      }, { advertiserId: this.advertiserId, expectedPage, responseTotal: this.responseTotal, mutationObserved: this.mutationObserved }).catch(async error => {
        if (!(error instanceof Error) || !error.message.includes("Execution context was destroyed")) throw error;
        // Read-only recovery for a normal router navigation, never a delete retry.
        this.check();
        await this.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
        return null;
      });
      this.check();
      await this.checkDocument();
      if (value && "unsafe" in value) throw changed();
      if (value) return value;
      await this.page.waitForTimeout(200);
    } while (Date.now() < deadline);
    throw changed();
  }
  private async checkDocument(): Promise<void> {
    if (!this.responseDocument || !await this.page.evaluate(document => document === window.document, this.responseDocument).catch(() => false)) throw changed();
  }
  async deleteBatch(before: LibrarySnapshot, beforeConfirm: () => Promise<void>): Promise<void> {
    this.check();
    if (!before.ids.length) throw changed();
    const table = this.page.locator("table.ovui-table:visible");
    if (await table.count() !== 1) throw changed();
    const header = table.locator('thead input[type="checkbox"]');
    const headerLabel = table.locator("thead label.ovui-checkbox");
    if (await header.count() !== 1 || !await header.isEnabled() ||
      await headerLabel.count() !== 1 || await headerLabel.locator('input[type="checkbox"]').count() !== 1) throw changed();
    if (await header.isChecked()) await header.evaluate(node => (node as HTMLInputElement).click());
    await header.evaluate(node => (node as HTMLInputElement).click());
    this.check();
    await this.page.getByText(/^已选\s*[1-9]\d*\s*个\s*$/, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    const remove = this.page.getByRole("button", { name: "删除", exact: true });
    if (await remove.count() !== 1 || !await remove.isEnabled()) throw changed();
    await remove.evaluate(node => (node as HTMLButtonElement).click());
    this.check();
    const modal = this.page.locator(".ovui-modal:visible");
    await this.page.waitForFunction(() => Array.from(document.querySelectorAll(".ovui-modal")).filter(node => !!node.getClientRects().length && getComputedStyle(node).visibility !== "hidden").length === 1, null, { timeout: 10000 });
    const checkModal = async () => {
      if (await modal.count() !== 1) throw changed();
      const text = (await modal.innerText()).replace(/\s+/g, "");
      const match = /^确认要删除该素材吗？已选择([1-9]\d*)个视频，/.exec(text);
      if (!match || Number(match[1]) > 100 || text !== `确认要删除该素材吗？已选择${match[1]}个视频，${LIBRARY_DELETE_WARNING}取消确认`) throw changed();
    };
    await checkModal();
    // Pending marker and account/config guard precede the irreversible click.
    await beforeConfirm();
    this.check();
    await checkModal();
    if (!await this.page.evaluate(advertiserId => {
      const headers = Array.from(document.querySelectorAll("header, [role=banner]")).filter(node => !!node.getClientRects().length);
      const ids = headers.flatMap(node => Array.from(node.textContent?.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g) ?? [], match => match[1]));
      return ids.length === 1 && ids[0] === advertiserId;
    }, this.advertiserId)) throw changed();
    const confirm = modal.getByRole("button", { name: "确认", exact: true });
    if (await confirm.count() !== 1 || !await confirm.isEnabled()) throw changed();
    this.check();
    await confirm.click({ timeout: 10000 });
    this.mutationObserved = true;
    await modal.waitFor({ state: "hidden", timeout: 30000 });
    await this.page.getByText(/^已选\s*[1-9]\d*\s*个\s*$/, { exact: true }).waitFor({ state: "hidden", timeout: 30000 });
    await this.page.waitForTimeout(1000);
    await this.page.waitForFunction(({ total, ids }) => {
      const visible = (node: Element) => !!node.getClientRects().length;
      const totals = Array.from(document.querySelectorAll(".ovui-page-total")).filter(visible);
      const current = totals.length === 1 ? /^共\s*(\d+)\s*条记录$/.exec(totals[0].textContent?.trim() ?? "") : null;
      const rows = Array.from(document.querySelectorAll('table.ovui-table tbody tr')).filter(row => row.querySelector('input[type="checkbox"]'));
      const first = /ID[：:]\s*([1-9][0-9]{0,19})/.exec(rows[0]?.textContent ?? "")?.[1];
      const empty = Array.from(document.querySelectorAll('.oc-empty')).filter(visible);
      return current ? Number(current[1]) !== total || !!first && !ids.includes(first) :
        !rows.length && empty.some(node => node.textContent?.trim() === "暂无数据");
    }, { total: before.total, ids: before.ids }, { timeout: 30000 });
    this.check(); await this.checkDocument();
  }
  async refresh(): Promise<LibrarySnapshot> {
    this.check();
    if (this.mutationObserved) {
      return this.preparePage();
    }
    await this.load(() => { this.check(); return this.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }); });
    return this.preparePage();
  }
}
