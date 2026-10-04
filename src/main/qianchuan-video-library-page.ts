import type { Page, Request } from "playwright-core";
import { VIDEO_LIBRARY_ROUTE, videoLibraryUrl } from "../shared/qianchuan-video-library.js";

export interface LibrarySnapshot { total: number; ids: string[]; }
const changed = () => new Error("视频库页面、账号或选择范围无法核对，已停止删除。");
export const LIBRARY_DELETE_WARNING = "删除后不影响已使用该视频的在投创意和计划，素材库中不再展示该视频";

/** The library dialog is separate from upload confirmation and plan controls. */
export class QianchuanVideoLibraryPage {
  private responseTotal?: number;
  constructor(private readonly page: Page, private readonly advertiserId: string, private readonly signal: AbortSignal) {}
  private check(): void {
    this.signal.throwIfAborted();
    const url = new URL(this.page.url());
    if (url.origin !== "https://qianchuan.jinritemai.com" || url.pathname !== VIDEO_LIBRARY_ROUTE ||
      url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== this.advertiserId) throw changed();
  }
  async open(): Promise<void> {
    this.signal.throwIfAborted();
    await this.load(() => this.page.goto(videoLibraryUrl(this.advertiserId), { waitUntil: "domcontentloaded", timeout: 30000 }));
    await this.page.bringToFront();
    await this.preparePage();
  }
  /** Observe only the normal UI request issued by this navigation, including its unfiltered account binding. */
  private async load(navigate: () => Promise<unknown>): Promise<void> {
    this.signal.throwIfAborted();
    this.responseTotal = undefined;
    const requests = new Set<Request>();
    const capture = (request: Request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.origin === "https://qianchuan.jinritemai.com" &&
        url.pathname === "/ad/api/creation/material/video-list" &&
        url.searchParams.getAll("aavid").length === 1 && url.searchParams.get("aavid") === this.advertiserId &&
        url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === "1" &&
        ["queryString", "source", "tags", "imageModes", "analysisType", "auditStatuses", "materialDeliveryStatus"].every(key =>
          url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === "")) requests.add(request);
    };
    this.page.on("request", capture);
    try {
      const response = this.page.waitForResponse(response => requests.has(response.request()), { timeout: 30000 });
      const [loaded] = await Promise.all([response, navigate()]);
      this.check();
      if (loaded.status() !== 200) throw changed();
      const body = await loaded.json();
      if (body?.status_code !== 0 || typeof body.data?.total !== "string" || !/^(0|[1-9]\d*)$/.test(body.data.total)) throw changed();
      const total = Number(body.data.total);
      if (!Number.isSafeInteger(total)) throw changed();
      this.signal.throwIfAborted();
      this.responseTotal = total;
    } finally { this.page.off("request", capture); }
  }
  private async preparePage(): Promise<LibrarySnapshot> {
    const before = await this.read();
    const size = this.page.locator(".ovui-page-select .ovui-select__input:visible");
    if (await size.count() === 1) {
      const value = await size.evaluate(node => node instanceof HTMLInputElement ? node.value : node.querySelector("input")?.value);
      if (value !== "50条/页") {
        await size.click({ timeout: 30000 });
        const fifty = this.page.locator(".ovui-option:visible").filter({ hasText: /^50条\/页$/ });
        await fifty.waitFor({ state: "visible", timeout: 10000 });
        if (await fifty.count() !== 1) throw changed();
        await fifty.click({ timeout: 30000 });
      }
      await this.page.waitForFunction(expected => {
        const tables = Array.from(document.querySelectorAll("table.ovui-table")).filter(node => !!node.getClientRects().length);
        return tables.length === 1 && tables[0].querySelectorAll('tbody input[type="checkbox"]').length === expected;
      }, Math.min(before.total, 50), { timeout: 30000 });
      this.check();
    }
    return this.read();
  }
  async read(expectedPage = 1): Promise<LibrarySnapshot> {
    this.check();
    if (this.responseTotal === undefined) throw changed();
    const deadline = Date.now() + 30000;
    do {
      this.check();
      const value = await this.page.evaluate(({ advertiserId, expectedPage, responseTotal }) => {
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
        if (responseTotal === 0 && !totals.length && !current.length && !rows.length && empty.length === 1 && empty[0].textContent?.trim() === "暂无数据") return { total: 0, ids: [] };
        if (!match || current.length !== 1 || current[0].textContent?.trim() !== String(expectedPage)) return null;
        const total = Number(match[1]);
        if (total !== responseTotal) return null;
        const ids = rows.map(row => {
          const matches = Array.from(row.textContent?.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g) ?? [], match => match[1]);
          return matches.length === 1 ? matches[0] : "";
        });
        if (!Number.isSafeInteger(total) || total < 0 || ids.some(id => !id) || new Set(ids).size !== ids.length ||
          ids.length > 100 || ids.length > total || total > 0 && !ids.length) return null;
        return { total, ids };
      }, { advertiserId: this.advertiserId, expectedPage, responseTotal: this.responseTotal }).catch(async error => {
        if (!(error instanceof Error) || !error.message.includes("Execution context was destroyed")) throw error;
        // Read-only recovery for a normal router navigation, never a delete retry.
        this.check();
        await this.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
        return null;
      });
      this.check();
      if (value && "unsafe" in value) throw changed();
      if (value) return value;
      await this.page.waitForTimeout(200);
    } while (Date.now() < deadline);
    throw changed();
  }
  async deleteBatch(before: LibrarySnapshot, beforeConfirm: () => Promise<void>): Promise<void> {
    this.check();
    if (!before.ids.length || JSON.stringify(await this.read()) !== JSON.stringify(before)) throw changed();
    const table = this.page.locator("table.ovui-table:visible");
    if (await table.count() !== 1) throw changed();
    const header = table.locator('thead input[type="checkbox"]');
    const headerLabel = table.locator("thead label.ovui-checkbox");
    if (await header.count() !== 1 || await header.isChecked() || !await header.isEnabled() ||
      await headerLabel.count() !== 1 || await headerLabel.locator('input[type="checkbox"]').count() !== 1) throw changed();
    await headerLabel.click({ timeout: 10000 });
    this.check();
    if (!await header.isChecked()) throw changed();
    const selected = await table.locator('tbody input[type="checkbox"]').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked));
    if (selected.length !== before.ids.length || selected.some(checked => !checked) ||
      await this.page.getByText(`已选${before.ids.length}个`, { exact: true }).count() !== 1) throw changed();
    const remove = this.page.getByRole("button", { name: "删除", exact: true });
    if (await remove.count() !== 1 || !await remove.isEnabled()) throw changed();
    await remove.click({ timeout: 10000 });
    this.check();
    const modal = this.page.locator(".ovui-modal:visible");
    if (await modal.count() !== 1 || (await modal.innerText()).replace(/\s+/g, "") !==
      `确认要删除该素材吗？已选择${before.ids.length}个视频，${LIBRARY_DELETE_WARNING}取消确认`) throw changed();
    // Durable intent and account/config guard must succeed before the irreversible click.
    await beforeConfirm();
    this.check();
    if (JSON.stringify(await this.read()) !== JSON.stringify(before) || await modal.count() !== 1 ||
      (await modal.innerText()).replace(/\s+/g, "") !== `确认要删除该素材吗？已选择${before.ids.length}个视频，${LIBRARY_DELETE_WARNING}取消确认`) throw changed();
    const confirm = modal.getByRole("button", { name: "确认", exact: true });
    if (await confirm.count() !== 1 || !await confirm.isEnabled()) throw changed();
    this.check();
    await confirm.click({ timeout: 10000 });
    await modal.waitFor({ state: "hidden", timeout: 30000 });
    this.check();
  }
  async refresh(): Promise<LibrarySnapshot> {
    this.check();
    await this.load(() => this.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }));
    return this.preparePage();
  }
  /** Complete, unfiltered, stable inventory for read-only reconciliation; never selects videos. */
  async inventory(): Promise<LibrarySnapshot> {
    const first = await this.refresh(), ids = [...first.ids];
    if (first.total > 20000 || first.total && !first.ids.length) throw changed();
    const pageSize = first.ids.length;
    let previous = first;
    for (let number = 2; ids.length < first.total; number++) {
      this.check();
      if (number > 1000) throw changed();
      const next = this.page.locator(".ovui-page-turner__next-icon:visible").locator("..");
      if (await next.count() !== 1 || (await next.getAttribute("class"))?.includes("--disabled")) throw changed();
      await next.click({ timeout: 30000 });
      await this.page.waitForFunction(({ number, oldId, count }) => {
        const active = Array.from(document.querySelectorAll(".ovui-page-turner__item--active")).filter(n => !!n.getClientRects().length);
        const tables = Array.from(document.querySelectorAll("table.ovui-table")).filter(n => !!n.getClientRects().length);
        const rows = tables.length === 1 ? Array.from(tables[0].querySelectorAll("tbody tr")).filter(n => n.querySelector('input[type="checkbox"]')) : [];
        return active.length === 1 && active[0].textContent?.trim() === String(number) && rows.length === count && /ID[：:]\s*([1-9][0-9]{0,19})/.exec(rows[0]?.textContent ?? "")?.[1] !== oldId;
      }, { number, oldId: previous.ids[0], count: Math.min(pageSize, first.total - ids.length) }, { timeout: 30000 });
      const current = await this.read(number);
      if (current.total !== first.total || current.ids.length !== Math.min(pageSize, first.total - ids.length) || current.ids.some(id => ids.includes(id))) throw changed();
      ids.push(...current.ids); previous = current;
    }
    await this.open();
    if (ids.length !== first.total || JSON.stringify(await this.read()) !== JSON.stringify(first)) throw changed();
    return { total: first.total, ids };
  }
}
