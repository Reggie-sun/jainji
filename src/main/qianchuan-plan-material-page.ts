import type { JSHandle, Locator, Page, Request, Response } from "playwright-core";
import { accountPageUrl } from "../shared/qianchuan-account.js";
import { PLAN_MATERIAL_STATUSES, matchesPlanMaterialStatus, type PlanMaterialStatus } from "../shared/qianchuan-video-library.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { parseZeroImpressionsRow, type ZeroImpressionsRow, type ZeroImpressionsWindow } from "./qianchuan-zero-impressions.js";

export interface PlanMaterialSnapshot { total: number; ids: string[]; zeroImpressions?: { offset: number; limit: number; rows: ZeroImpressionsRow[] }; }
export const PLAN_CLEANUP_MARKER = "jianjiCleanup=plan-materials";
const drawerSelector = ".ovui-drawer--no-maskable .ad-drawer-body:visible";
const listPath = "/ad/api/pmc/v1/uni-promotion/material/list-required";
const changed = () => new Error("计划素材页面、筛选或删除范围无法核对，已停止删除。");

/** Own cleanup tab, one combined filter, verified current-page selection only. */
export class QianchuanPlanMaterialPage {
  private document?: JSHandle<Document>;
  private response?: PlanMaterialSnapshot;
  private fault = false;
  private hundredRows = false;
  private responseLimit?: number;
  private statuses: PlanMaterialStatus[] = [];
  private auditStatusFilter = false;
  private revision = 0;
  private readonly requests = new WeakMap<Request, number>();
  private readonly requested = (request: Request) => {
    if (new URL(request.url()).pathname === listPath) {
      this.response = undefined;
      if (!this.matchesRequest(request)) { this.fault = true; return; }
    }
    if (this.matchesRequest(request)) {
      this.requests.set(request, ++this.revision); this.response = undefined;
    }
  };
  private readonly received = (response: Response) => { void this.capture(response).catch(() => { this.fault = true; }); };
  constructor(private readonly page: Page, private readonly target: FrozenQianchuanAccount, private readonly signal: AbortSignal, private readonly zeroWindow?: ZeroImpressionsWindow) {}
  private drawer(): Locator { return this.page.locator(drawerSelector); }
  private check(): void {
    this.signal.throwIfAborted();
    const url = new URL(this.page.url());
    if (url.origin !== "https://qianchuan.jinritemai.com" || url.pathname !== "/uni-prom" ||
      url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== this.target.advertiserId ||
      url.searchParams.getAll("adId").length !== 1 || url.searchParams.get("adId") !== this.target.adId) throw changed();
  }
  private async guard(): Promise<void> {
    this.check();
    if (!this.document || !await this.page.evaluate(document => document === window.document, this.document).catch(() => false)) throw changed();
    const identity = await this.page.evaluate(({ advertiserId, adId, drawerSelector }) => {
      const visible = (node: Element) => !!node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
      const headers = Array.from(document.querySelectorAll(".account-info-container")).filter(visible);
      const ids = headers.flatMap(node => Array.from(node.textContent?.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g) ?? [], match => match[1]));
      const drawers = Array.from(document.querySelectorAll(drawerSelector.replace(":visible", ""))).filter(visible);
      const plan = drawers.length === 1 ? /ID[：:]\s*([1-9][0-9]{0,19})/.exec((drawers[0] as HTMLElement).innerText) : null;
      return ids.length === 1 && ids[0] === advertiserId && plan?.[1] === adId && !document.querySelector('input[type="password"],iframe[src*="captcha"]');
    }, { advertiserId: this.target.advertiserId, adId: this.target.adId, drawerSelector });
    this.check(); if (!identity || this.fault) throw changed();
    if (this.hundredRows && this.response?.total) {
      const size = this.drawer().locator(".ovui-page-select input:visible");
      if (await size.count() !== 1 || await size.inputValue() !== "100条/页") throw changed();
    }
    if (this.zeroWindow) {
      const start = this.drawer().getByPlaceholder("请选择开始日期"), end = this.drawer().getByPlaceholder("请选择结束日期");
      if (await start.count() !== 1 || await end.count() !== 1 || await start.inputValue() !== this.zeroWindow.startTime.slice(0, 10) || await end.inputValue() !== this.zeroWindow.endTime.slice(0, 10)) throw changed();
    }
  }
  private matchesRequest(request: Request): boolean {
    try {
      const url = new URL(request.url()), body = request.postDataJSON();
      if (request.frame() !== this.page.mainFrame() || request.method() !== "POST" || url.origin !== "https://qianchuan.jinritemai.com" ||
        url.pathname !== listPath || url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== this.target.advertiserId ||
        body.DataSetKey !== "site_promotion_product_post_data_video" || !Number.isInteger(body.PageParams?.Limit) || body.PageParams.Limit < 1 || body.PageParams.Limit > 100 || this.hundredRows && body.PageParams.Limit !== 100 ||
        !Number.isInteger(body.PageParams.Offset) || body.PageParams.Offset < 0 || body.PageParams.Offset > 20000 || body.PageParams.Offset % body.PageParams.Limit !== 0 || !this.zeroWindow && body.PageParams.Offset !== 0 ||
        body.Filters?.ConditionRelationshipType !== 1) return false;
      const expected: Record<string, string[]> = { query_type: ["all"], roi2_material_type_v3: ["1001"], marketing_goal: ["1"],
        ad_id: [this.target.adId], roi2_material_video_type: ["11"], roi2_material_status: ["1"], material_audit_status: ["2", "4"] };
      if (!this.statuses.includes("生态审核不通过") && !this.auditStatusFilter) expected.material_audit_reject_type = ["1"];
      if (this.zeroWindow) {
        delete expected.material_audit_status; delete expected.material_audit_reject_type;
        if (body.StartTime !== this.zeroWindow.startTime || body.EndTime !== this.zeroWindow.endTime ||
          !Array.isArray(body.Metrics) || !body.Metrics.includes("product_show_count_for_roi2") ||
          !Array.isArray(body.Dimensions) || !body.Dimensions.includes("material_id")) return false;
      }
      const conditions = body.Filters.Conditions;
      return Array.isArray(conditions) && conditions.length === Object.keys(expected).length &&
        new Set(conditions.map(condition => condition.Field)).size === conditions.length && conditions.every(condition =>
          condition.Operator === 7 && Array.isArray(condition.Values) && expected[condition.Field] &&
          JSON.stringify([...condition.Values].sort()) === JSON.stringify([...expected[condition.Field]].sort()));
    } catch { return false; }
  }
  private async capture(response: Response): Promise<void> {
    const revision = this.requests.get(response.request());
    if (revision === undefined || revision !== this.revision) return;
    await this.guard();
    const body = await response.json(), stats = body?.data?.statsData;
    if (response.status() !== 200 || body?.status_code !== 0 || !stats || typeof stats !== "object" || Array.isArray(stats)) throw changed();
    let value: PlanMaterialSnapshot;
    // The real platform emits an empty statsData object for a successful zero-result filter.
    if (!Object.keys(stats).length) value = { total: 0, ids: [] };
    else {
      if (typeof stats.totalCount !== "string" || !/^(0|[1-9]\d*)$/.test(stats.totalCount) || !Array.isArray(stats.rows)) throw changed();
      const ids = stats.rows.map((row: { dimensions?: { materialId?: { value?: unknown } } }) => row.dimensions?.materialId?.value);
      const total = Number(stats.totalCount);
      if (stats.rows.some((row: { dimensions?: { roi2MaterialStatus?: { value?: unknown } } }) => row.dimensions?.roi2MaterialStatus?.value !== "1")) throw changed();
      if (!Number.isSafeInteger(total) || total > 20000 || ids.length > 100 || ids.length > total ||
        ids.some((id: unknown) => typeof id !== "string" || !/^[1-9][0-9]{0,19}$/.test(id)) || new Set(ids).size !== ids.length || total > 0 && !ids.length) throw changed();
      value = { total, ids };
    }
    if (this.zeroWindow) {
      const rows = (stats.rows ?? []).map((row: unknown) => parseZeroImpressionsRow(row));
      const { Offset: offset, Limit: limit } = response.request().postDataJSON().PageParams;
      if (rows.length !== Math.min(limit, Math.max(0, value.total - offset)) || value.total > 0 && offset >= value.total) throw changed();
      value = { total: value.total, ids: rows.filter((row: ZeroImpressionsRow) => row.eligible).map((row: ZeroImpressionsRow) => row.id), zeroImpressions: { offset, limit, rows } };
    }
    await this.guard();
    if (revision === this.revision) { this.response = value; this.responseLimit = response.request().postDataJSON().PageParams.Limit; }
  }
  async open(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.page.url() === "about:blank" || this.zeroWindow) {
      const { product, advertiserId, adId, cdpEndpoint } = this.target;
      const url = new URL(accountPageUrl({ product, advertiserId, adId, cdpEndpoint }));
      url.hash = `adr=${encodeURIComponent(JSON.stringify({ adDetailTab: "creative", dateRange: this.zeroWindow ? [this.zeroWindow.startTime.slice(0, 10), this.zeroWindow.endTime.slice(0, 10)] : [] }))}&umg=1&uniVideoTab=1&${PLAN_CLEANUP_MARKER}`;
      await this.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45000 });
    } else { this.check(); await this.page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }); }
    await this.drawer().getByPlaceholder("输入视频名称/ID后回车搜索").waitFor({ timeout: 30000 });
    await this.page.locator(".account-info-container").filter({ hasText: /ID[：:]\s*[1-9][0-9]{0,19}/ }).waitFor({ timeout: 30000 });
    this.document = await this.page.evaluateHandle(() => window.document);
    await this.guard(); await this.page.bringToFront();
  }
  async filter(): Promise<{ skippedEcological: boolean }> {
    await this.guard();
    if (await this.page.locator(".ovui-modal:visible").count()) throw changed();
    await this.drawer().getByText("更多筛选", { exact: true }).click();
    if (this.zeroWindow) {
      const panel = this.page.locator(".ovui-popover:visible").filter({ has: this.page.getByRole("button", { name: "确定", exact: true }) });
      if (await panel.count() !== 1) throw changed();
      await panel.getByText("清空", { exact: true }).evaluate(node => (node as HTMLElement).click());
      await this.selectDelivering(panel);
      await this.guard();
      this.page.on("request", this.requested); this.page.on("response", this.received);
      await panel.getByRole("button", { name: "确定", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
      await panel.waitFor({ state: "hidden" }); await this.prepareHundredRows();
      return { skippedEcological: false };
    }
    const statusTitle = this.page.locator(".oc-title").filter({ hasText: /^(素材状态|审核状态)$/ });
    const panel = this.page.locator(".ovui-popover:visible").filter({ has: statusTitle });
    await panel.waitFor(); if (await panel.count() !== 1) throw changed();
    const area = panel.locator(".config-area").filter({ has: statusTitle });
    if (await area.count() !== 1) throw changed();
    this.auditStatusFilter = (await area.locator(".oc-title").innerText()).trim() === "审核状态";
    await panel.getByText("清空", { exact: true }).evaluate(node => (node as HTMLElement).click());
    await this.selectDelivering(panel);
    const input = area.locator('input[placeholder="请选择"]');
    if (await input.count() === 1) await input.click();
    this.statuses = [];
    for (const status of PLAN_MATERIAL_STATUSES) {
      const item = area.locator(".ovui-cascader-panel__selection-item:visible").filter({ hasText: new RegExp(`^${status}$`) });
      const count = await item.count();
      if (status === "生态审核不通过" && count === 0) continue;
      if (count !== 1 || await item.locator('input[type="checkbox"]').count() !== 1) throw changed();
      if (!await item.locator('input[type="checkbox"]').isChecked()) await item.locator(".ovui-cascader-panel__item-label").click();
      if (!await item.locator('input[type="checkbox"]').isChecked()) throw changed();
      this.statuses.push(status);
    }
    const chosen = await area.locator(".ovui-cascader-panel__selection-item").evaluateAll(items => items.filter(item => item.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).map(item => item.textContent?.trim()));
    if (JSON.stringify(chosen.sort()) !== JSON.stringify([...this.statuses].sort())) throw changed();
    await this.guard();
    this.page.on("request", this.requested); this.page.on("response", this.received);
    await panel.getByRole("button", { name: "确定", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    await panel.waitFor({ state: "hidden" }); await this.prepareHundredRows();
    return { skippedEcological: !this.statuses.includes("生态审核不通过") };
  }
  private async prepareHundredRows(): Promise<void> {
    const before = await this.read();
    // Empty filtered tables have no pagination control and authorize no deletion.
    if (!before.total) return;
    const size = this.drawer().locator(".ovui-page-select input:visible");
    if (await size.count() !== 1) throw changed();
    this.hundredRows = true;
    if (await size.inputValue() !== "100条/页") {
      await size.click();
      const option = this.page.locator(".ovui-option:visible").filter({ hasText: /^100条\/页$/ });
      if (await option.count() !== 1) throw changed();
      const revision = this.revision; this.response = undefined;
      await option.click();
      const after = await this.read();
      if (this.revision <= revision || after.total !== before.total) throw changed();
    }
    if (this.responseLimit !== 100 || await size.inputValue() !== "100条/页") throw changed();
  }
  private async selectDelivering(panel: Locator): Promise<void> {
    const area = panel.locator(".config-area").filter({ has: this.page.locator(".oc-title").filter({ hasText: /^投放状态$/ }) });
    const input = area.getByPlaceholder("请选择", { exact: true });
    if (await area.count() !== 1 || await input.count() !== 1) throw changed();
    await input.click();
    const item = area.locator(".ovui-cascader-panel__selection-item:visible").filter({ hasText: /^投放中$/ });
    if (await item.count() !== 1) throw changed();
    await item.locator(".ovui-cascader-panel__item-label").click();
    if (await input.inputValue() !== "投放中") throw changed();
  }
  async read(): Promise<PlanMaterialSnapshot> {
    const deadline = Date.now() + 30000;
    do {
      await this.guard();
      const response = this.response;
      if (response) {
        if (response.zeroImpressions) {
          if (await this.zeroRowsMatch(response)) return structuredClone(response);
          await this.page.waitForTimeout(100); continue;
        }
        const rows = this.drawer().locator(".ovui-table__body-wrapper tbody tr").filter({ has: this.page.locator('input[type="checkbox"]') });
        const items = await rows.evaluateAll(rows => rows.map(row => ({
          id: /素材ID[：:]\s*([1-9][0-9]{0,19})/.exec((row as HTMLElement).innerText)?.[1],
          status: (row.querySelector(".oc-promotion-status-card") as HTMLElement | null)?.innerText ?? "",
        })));
        if (items.some(item => item.status && !this.statuses.some(status => matchesPlanMaterialStatus(item.status, status)))) throw changed();
        const totals = await this.drawer().locator(".ovui-page-total:visible").allTextContents();
        const total = totals.length === 1 ? /^共\s*(\d+)\s*条记录$/.exec(totals[0].trim()) : null;
        if (response.total === 0 && !items.length && !totals.length && await this.drawer().locator(".oc-empty:visible").filter({ hasText: "暂无数据" }).count() === 1) return structuredClone(response);
        if (total && Number(total[1]) === response.total && JSON.stringify(items.map(item => item.id)) === JSON.stringify(response.ids) &&
          items.every(item => this.statuses.some(status => matchesPlanMaterialStatus(item.status, status)))) return structuredClone(response);
      }
      await this.page.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw changed();
  }
  private async zeroRowsMatch(snapshot: PlanMaterialSnapshot): Promise<boolean> {
    const data = snapshot.zeroImpressions!;
    const table = this.drawer();
    const items = await table.locator('.ovui-table__body-wrapper tbody tr').filter({ has: this.page.locator('input[type="checkbox"]') }).evaluateAll(rows => rows.map(row => ({
      id: /素材ID[：:]\s*([1-9][0-9]{0,19})/.exec((row as HTMLElement).innerText)?.[1],
      cells: Array.from(row.querySelectorAll("td"), cell => (cell as HTMLElement).innerText.trim()),
    })));
    if (!snapshot.total && !items.length && await table.locator(".oc-empty:visible").filter({ hasText: "暂无数据" }).count() === 1) return true;
    const heads = await table.locator(".ovui-table__head-wrapper thead th").allTextContents();
    const index = (name: string) => heads.filter(head => head.trim() === name).length === 1 ? heads.findIndex(head => head.trim() === name) : -1;
    const countIndex = index("整体展示次数");
    if (countIndex < 0) throw changed();
    const totals = await table.locator(".ovui-page-total:visible").allTextContents();
    const total = totals.length === 1 ? /^共\s*(\d+)\s*条记录$/.exec(totals[0].trim()) : null;
    const current = await table.locator(".ovui-page-turner__item--active:visible").allTextContents();
    return !!total && Number(total[1]) === snapshot.total && current.length === 1 && Number(current[0]) === data.offset / data.limit + 1 &&
      items.length === data.rows.length && items.every((item, i) => item.id === data.rows[i].id &&
        /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(item.cells[countIndex] ?? "") && Number(item.cells[countIndex].replaceAll(",", "")) === data.rows[i].impressions);
  }
  async movePage(first = false): Promise<boolean> {
    const before = await this.read(), data = before.zeroImpressions;
    if (!data) throw changed();
    if (first && !data.offset || !first && data.offset + data.rows.length >= before.total) return false;
    if (await this.drawer().locator('tbody input[type="checkbox"]:checked').count() || await this.page.locator(".ovui-modal:visible").count()) throw changed();
    const button = first ? this.drawer().locator(".ovui-page-turner__item").filter({ hasText: /^1$/ }) :
      this.drawer().locator(".ovui-page-turner__item").filter({ has: this.page.locator(".ovui-page-turner__next-icon") });
    if (await button.count() !== 1 || (await button.getAttribute("class"))?.includes("--disabled")) throw changed();
    const revision = this.revision; this.response = undefined;
    await button.click();
    const after = await this.read();
    if (this.revision <= revision || after.total !== before.total || after.zeroImpressions?.offset !== (first ? 0 : data.offset + data.limit) || after.zeroImpressions.limit !== data.limit) throw changed();
    return true;
  }
  async deleteBatch(before: PlanMaterialSnapshot, beforeConfirm: () => Promise<void>): Promise<void> {
    await this.guard();
    if (!before.ids.length || JSON.stringify(await this.read()) !== JSON.stringify(before) || await this.page.locator(".ovui-modal:visible").count()) throw changed();
    const selected = this.drawer().locator('.ovui-table__body-wrapper tbody input[type="checkbox"]:checked');
    if (await selected.count()) throw changed();
    const header = this.drawer().locator('.ovui-table__head-wrapper thead input[type="checkbox"]');
    if (await header.count() !== 1 || !await header.isEnabled()) throw changed();
    if (before.zeroImpressions) {
      const rows = this.drawer().locator('.ovui-table__body-wrapper tbody tr').filter({ has: this.page.locator('input[type="checkbox"]') });
      for (const [index, row] of before.zeroImpressions.rows.entries()) if (before.ids.includes(row.id)) {
        await rows.nth(index).locator('input[type="checkbox"]').evaluate(node => (node as HTMLInputElement).click());
      }
    } else await header.evaluate(node => (node as HTMLInputElement).click());
    if (await selected.count() !== before.ids.length || !await this.drawer().getByText(new RegExp(`^已选${before.ids.length}个\\s*视频$`)).count()) throw changed();
    const remove = this.drawer().getByRole("button", { name: "删除", exact: true });
    if (await remove.count() !== 1 || !await remove.isEnabled()) throw changed();
    await remove.evaluate(node => (node as HTMLButtonElement).click());
    const modal = this.page.locator(".ovui-modal:visible"); await modal.waitFor();
    const checkModal = async () => {
      await this.guard();
      if (await modal.count() !== 1 || (await modal.innerText()).replace(/\s+/g, "") !== "确定要删除视频吗？取消确定" ||
        await selected.count() !== before.ids.length || JSON.stringify(await this.read()) !== JSON.stringify(before)) throw changed();
      const selectedIds = await this.drawer().locator('.ovui-table__body-wrapper tbody tr').filter({ has: this.page.locator('input[type="checkbox"]:checked') }).evaluateAll(rows => rows.map(row => /素材ID[：:]\s*([1-9][0-9]{0,19})/.exec((row as HTMLElement).innerText)?.[1]));
      if (JSON.stringify(selectedIds) !== JSON.stringify(before.ids)) throw changed();
    };
    await checkModal(); await beforeConfirm(); await checkModal();
    const revision = this.revision;
    await modal.getByRole("button", { name: "确定", exact: true }).click();
    const deadline = Date.now() + 30000;
    do {
      await this.guard();
      const dialogTexts = await this.page.locator(".ovui-modal:visible").evaluateAll(dialogs => dialogs.map(dialog => (dialog as HTMLElement).innerText));
      const dialogCount = dialogTexts.length;
      if (dialogCount) {
        if (dialogCount !== 1) throw changed();
        const text = dialogTexts[0].replace(/\s+/g, "");
        if (text.startsWith("确定要删除自选视频吗？") && /需要同步删除以下\d+个自选标题/.test(text)) {
          throw new Error("平台要求同步删除自选标题，已停止；删除结果未知，不会自动再次确认。");
        }
        if (text !== "确定要删除视频吗？取消确定") {
          throw new Error("平台出现额外确认或异常弹窗，已停止；删除结果未知，不会自动再次确认。");
        }
      }
      if (before.zeroImpressions && !dialogCount && this.revision > revision && this.response &&
        (before.total - this.response.total !== before.ids.length || !this.response.zeroImpressions || this.response.zeroImpressions.rows.some(row => before.ids.includes(row.id)))) {
        throw new Error("删除数量或素材身份无法核对，结果未知，已停止；不会自动再次确认。");
      }
      if (!dialogCount && this.revision > revision && this.response && this.response.total < before.total &&
        (!before.zeroImpressions || before.total - this.response.total === before.ids.length) &&
        !(this.response.zeroImpressions?.rows.map(row => row.id) ?? this.response.ids).some(id => before.ids.includes(id))) {
        await this.read(); return;
      }
      await this.page.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw new Error("删除结果未知，已停止；不会自动再次确认。");
  }
  async dispose(): Promise<void> { this.page.off("request", this.requested); this.page.off("response", this.received); await this.document?.dispose().catch(() => undefined); }
}
