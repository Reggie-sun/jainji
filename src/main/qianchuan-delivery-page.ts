import { createHash, randomUUID } from "node:crypto";
import type { JSHandle, Locator, Page } from "playwright-core";
import { QianchuanBackendAdapter } from "./qianchuan-backend-adapter.js";
import { withQianchuanQueryPage } from "./qianchuan-query-page.js";
import { verifyBrowserEgress } from "./qianchuan-egress-browser.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanDeliveryAdapter, QianchuanDeliverySubmission, QianchuanDeliverySubmissionContext } from "./qianchuan-delivery.js";
import { minorUnitsMoney, moneyMinorUnits, QianchuanDeliveryDraftSchema, type QianchuanDeliveryDraft } from "../shared/qianchuan-delivery.js";
import { QianchuanDeliveryPrepareSchema, QianchuanDeliveryPreparedSchema, type QianchuanDeliveryPrepare } from "../shared/qianchuan-integration.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failure = () => new Error("独立调价表单、账户或前值无法核对，未继续提交。请重新预检。");
function money(value: string): string {
  if (!/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(value)) throw failure();
  const [whole, fraction = ""] = value.split("."); return `${whole}.${fraction.padEnd(2, "0")}`;
}
function roi(value: string): string {
  if (!/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/.test(value) || /^0(?:\.0+)?$/.test(value)) throw failure();
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
function budget(raw: string): string {
  if (!/^[0-9]+$/.test(raw) || BigInt(raw) % 1000n !== 0n) throw failure();
  return minorUnitsMoney(BigInt(raw) / 1000n);
}
type Settings = Awaited<ReturnType<QianchuanBackendAdapter["readDeliverySettings"]>>;
function version(settings: Settings): string { return hash(settings); }
function proof(draft: QianchuanDeliveryDraft) {
  const recipeDigest = hash({ version: "qianchuan-independent-popover/v3", action: draft.action,
    page: "/uni-prom", row: "tr + exact ad ID", mode: "控成本投放", budgetMode: 0,
    submit: "original document and 确定 element, calibrated monotonic expiry and target guard", readback: "/ad/api/creation/v1/ad/ad-detail-basic" });
  return { recipeDigest, evidenceId: `form-${hash({ advertiserId: draft.advertiserId, adId: "adId" in draft ? draft.adId : null, action: draft.action, beforeVersion: draft.beforeVersion, recipeDigest })}` };
}

/** Fixed UI recipe: independent budget/ROI popovers only. Full-page save is never used. */
export class QianchuanDeliveryPageSession implements QianchuanDeliveryAdapter {
  private prepared?: QianchuanDeliveryDraft;
  private editor?: Locator;
  private invoked = false;
  private closed = false;
  private productIds?: string[];
  private constructor(private readonly page: Page, private readonly advertiserId: string, private readonly reader: QianchuanBackendAdapter, private readonly document: JSHandle<Document>) {}
  static async create(page: Page, advertiserId: string) {
    const reader = await QianchuanBackendAdapter.create(page, advertiserId);
    try { return new QianchuanDeliveryPageSession(page, advertiserId, reader, await page.evaluateHandle(() => document)); }
    catch (error) { await reader.dispose(); throw error; }
  }
  capabilities(advertiserId: string) {
    const draft = this.prepared;
    return !this.closed && draft && advertiserId === this.advertiserId
      ? [{ action: draft.action, advertiserId, mode: "product-cost-control", status: "live-read-verified", ...proof(draft), observedAt: new Date().toISOString() }] : [];
  }
  private async settings(adId: string, signal: AbortSignal) {
    if (this.closed) throw failure(); signal.throwIfAborted();
    return this.reader.readDeliverySettings(adId, signal);
  }
  private async row(adId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    let row = this.page.locator("tr").filter({ hasText: new RegExp(`ID：${adId}(?![0-9])`) });
    if (await row.count() !== 1) {
      const search = this.page.getByPlaceholder("输入计划名称/ID后回车搜索", { exact: true });
      if (await search.count() !== 1) throw failure();
      await search.fill(adId); await search.press("Enter");
      await row.waitFor({ state: "visible", timeout: 10000 });
    }
    if (await row.count() !== 1 || !(await row.innerText()).includes("控成本投放")) throw failure();
    return row;
  }
  private async open(draft: QianchuanDeliveryDraft, signal: AbortSignal) {
    if (draft.action !== "set-budget" && draft.action !== "set-roi" || draft.advertiserId !== this.advertiserId || this.invoked) throw failure();
    // Chrome pauses animation frames in background tabs; native pointer actions require a visible owned page.
    await this.page.bringToFront(); signal.throwIfAborted();
    if (this.editor && await this.editor.isVisible()) {
      const cancel = this.editor.getByRole("button", { name: "取消", exact: true });
      if (await cancel.count() !== 1) throw failure(); await cancel.click();
    }
    const row = await this.row(draft.adId, signal);
    const item = row.locator(".setting-item").filter({ has: this.page.locator(".hint-text", { hasText: draft.action === "set-budget" ? "每日预算" : "ROI目标" }) });
    if (await item.count() !== 1) throw failure();
    await item.hover(); const icon = item.locator(".edit-icon");
    if (await icon.count() !== 1) throw failure(); await icon.click(); signal.throwIfAborted();
    const input = this.page.getByPlaceholder(draft.action === "set-budget" ? "请输入预算金额" : "请输入净成交ROI目标", { exact: true });
    await input.waitFor({ state: "visible", timeout: 5000 });
    if (await input.count() !== 1) throw failure();
    const current = await input.inputValue();
    const expected = draft.action === "set-budget" ? draft.beforeValues.budget : draft.beforeValues.roi;
    if ((draft.action === "set-budget" ? money(current) : roi(current)) !== expected) throw failure();
    const editor = input.locator("xpath=ancestor::*[.//button[normalize-space(.)='确定'] and .//button[normalize-space(.)='取消']][1]");
    if (await editor.count() !== 1 || !await editor.isVisible() || await editor.getByRole("button", { name: "确定", exact: true }).count() !== 1) throw failure();
    await input.fill(draft.action === "set-budget" ? draft.target.budget : draft.target.roi);
    this.editor = editor; this.prepared = draft;
  }
  async prepare(input: QianchuanDeliveryPrepare, signal: AbortSignal) {
    const request = QianchuanDeliveryPrepareSchema.parse(input);
    if (request.expectedAdvertiserId !== this.advertiserId) throw failure();
    const settings = await this.settings(request.adId, signal);
    this.productIds = settings.productIds;
    const target = request.action === "set-budget" ? money(request.targetValue) : roi(request.targetValue);
    if (request.action === "set-budget" && (moneyMinorUnits(target) < 30000n || moneyMinorUnits(target) > 99999999999n)) throw failure();
    const base = { schemaVersion: 1, draftId: randomUUID(), provider: "qianchuan-browser", accountSlot: request.product, advertiserId: this.advertiserId,
      mode: "product-cost-control", adId: request.adId, beforeVersion: version(settings) };
    const draft = QianchuanDeliveryDraftSchema.parse(request.action === "set-budget"
      ? { ...base, action: request.action, beforeValues: { budget: budget(settings.budget), budgetType: "daily" }, target: { budget: target, budgetType: "daily" } }
      : { ...base, action: request.action, beforeValues: { roi: roi(settings.roi) }, target: { roi: target } });
    await this.open(draft, signal);
    return QianchuanDeliveryPreparedSchema.parse({ preflightId: randomUUID(), draft, expiresAt: new Date(Date.now() + 300000).toISOString(),
      capabilityStatus: "live-read-verified", recipeEvidenceId: proof(draft).evidenceId, recipeDigest: proof(draft).recipeDigest, productIds: settings.productIds });
  }
  async readFresh(draft: QianchuanDeliveryDraft, signal: AbortSignal) {
    if (draft.action !== "set-budget" && draft.action !== "set-roi" || draft.advertiserId !== this.advertiserId) throw failure();
    const settings = await this.settings(draft.adId, signal);
    if (version(settings) !== draft.beforeVersion) throw failure();
    this.productIds = settings.productIds;
    await this.open(draft, signal);
    return { advertiserId: this.advertiserId, adId: draft.adId, version: version(settings), values: draft.beforeValues };
  }
  async submitOnce(draft: QianchuanDeliveryDraft, signal: AbortSignal, context: QianchuanDeliverySubmissionContext) {
    const expiresAt = Date.parse(context.expiresAt);
    if (!Number.isFinite(expiresAt)) throw failure();
    if (expiresAt <= Date.now()) return { kind: "not-sent" as const, reason: "AUTHORIZATION_EXPIRED" as const };
    if (!this.prepared || this.prepared.draftId !== draft.draftId || !this.editor || this.invoked || !("adId" in draft)) throw failure();
    const current = await this.settings(draft.adId, signal);
    if (expiresAt <= Date.now()) return { kind: "not-sent" as const, reason: "AUTHORIZATION_EXPIRED" as const };
    if (version(current) !== draft.beforeVersion || !await this.editor.isVisible()) throw failure();
    const input = this.editor.locator("input");
    if (await input.count() !== 1 || draft.action !== "set-budget" && draft.action !== "set-roi") throw failure();
    const entered = await input.inputValue();
    if ((draft.action === "set-budget" ? money(entered) : roi(entered)) !== (draft.action === "set-budget" ? draft.target.budget : draft.target.roi)) throw failure();
    signal.throwIfAborted();
    const button = await this.editor.getByRole("button", { name: "确定", exact: true }).elementHandle();
    const control = await input.elementHandle();
    if (!button || !control) { await button?.dispose(); await control?.dispose(); throw failure(); }
    try {
      const sample = await button.evaluate((node, document) => {
        if (!node.isConnected || node.ownerDocument !== document || document !== window.document) throw new Error("Document changed");
        return performance.now();
      }, this.document);
      if (!Number.isFinite(sample) || sample < 0) throw failure();
      // The sample precedes this main-clock read: exclude the full return delay and a 10ms resolution allowance.
      const deadline = sample + expiresAt - Date.now() - 10;
      if (deadline <= sample) return { kind: "not-sent" as const, reason: "AUTHORIZATION_EXPIRED" as const };
      const gate = await button.evaluateHandle((node, { deadline, control, target, document, advertiserId }) => {
        const state = { clicked: false }, now = performance.now.bind(performance);
        const normalized = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
        const guard = (event: Event) => {
          const url = new URL(location.href);
          const accounts = Array.from(document.querySelectorAll(".account-info-container"))
            .filter(value => value.getClientRects().length && getComputedStyle(value).visibility === "visible")
            .flatMap(value => Array.from((value as HTMLElement).innerText.matchAll(/ID[：:]\s*([1-9][0-9]{0,19})/g), match => match[1]));
          if (!state.clicked && now() < deadline && node.isConnected && control.isConnected && node.ownerDocument === document && control.ownerDocument === document &&
            url.origin === "https://qianchuan.jinritemai.com" && url.pathname === "/uni-prom" && url.searchParams.getAll("aavid").length === 1 &&
            url.searchParams.get("aavid") === advertiserId && accounts.length === 1 && accounts[0] === advertiserId &&
            normalized((control as HTMLInputElement).value) === normalized(target) && document === window.document && event.composedPath().includes(node)) {
            state.clicked = true; return;
          }
          event.preventDefault(); event.stopImmediatePropagation();
        };
        window.addEventListener("click", guard, true);
        return { view: window, guard, state };
      }, { deadline, control, target: draft.action === "set-budget" ? draft.target.budget : draft.target.roi, document: this.document, advertiserId: this.advertiserId });
      try {
        signal.throwIfAborted(); const remaining = expiresAt - Date.now();
        if (remaining <= 0) return { kind: "not-sent" as const, reason: "AUTHORIZATION_EXPIRED" as const };
        this.invoked = true;
        // Bind the original element/document; a locator must not resolve a replacement page after navigation.
        await button.click({ timeout: Math.min(10000, remaining) });
        if (!await gate.evaluate(value => value.state.clicked)) throw failure();
        return { kind: "submitted" as const, adId: draft.adId };
      } finally {
        // Dispatched input can outlive its caller. Keep its guard until this owned document is destroyed.
        if (!this.invoked) await gate.evaluate(value => value.view.removeEventListener("click", value.guard, true)).catch(() => undefined);
        await gate.dispose().catch(() => undefined);
      }
    } finally {
      await button.dispose().catch(() => undefined); await control.dispose().catch(() => undefined);
    }
  }
  async readback(draft: QianchuanDeliveryDraft, _submission: QianchuanDeliverySubmission, signal: AbortSignal) {
    if (draft.action !== "set-budget" && draft.action !== "set-roi") throw failure();
    const deadline = Date.now() + 5000;
    while (true) {
      const settings = await this.settings(draft.adId, signal);
      if (!this.productIds || JSON.stringify(settings.productIds) !== JSON.stringify(this.productIds)) throw failure();
      const values = draft.action === "set-budget" ? { budget: budget(settings.budget), budgetType: "daily" } : { roi: roi(settings.roi) };
      const matched = draft.action === "set-budget" ? values.budget === draft.target.budget : values.roi === draft.target.roi;
      if (matched || Date.now() >= deadline) return { advertiserId: this.advertiserId, adId: draft.adId, version: version(settings), values };
      await new Promise(resolve => setTimeout(resolve, 250)); signal.throwIfAborted();
    }
  }
  async close() { this.closed = true; await this.reader.dispose(); await this.document.dispose().catch(() => undefined); }
}

export type DeliverySessionRunner = <T>(target: FrozenQianchuanAccount, signal: AbortSignal, work: (session: QianchuanDeliveryPageSession) => Promise<T>) => Promise<T>;
async function liveSession<T>(target: FrozenQianchuanAccount, signal: AbortSignal, work: (session: QianchuanDeliveryPageSession) => Promise<T>): Promise<T> {
  const lease = await verifyBrowserEgress(target.cdpEndpoint, target.egress), active = lease ? AbortSignal.any([signal, lease.signal]) : signal;
  return withQianchuanQueryPage(target, active, async page => {
    await page.goto(`https://qianchuan.jinritemai.com/uni-prom?aavid=${target.advertiserId}&jianjiPlanPicker=1`, { waitUntil: "commit", timeout: 45000 });
    await page.waitForFunction(id => Array.from(document.querySelectorAll(".account-info-container")).some(node => node.getClientRects().length && node.textContent?.includes(id)), target.advertiserId, { polling: 250, timeout: 60000 });
    const session = await QianchuanDeliveryPageSession.create(page, target.advertiserId);
    try { return await work(session); } finally { await session.close(); }
  });
}

/** Bound only inside the original account lease; it never creates another account owner. */
export class QianchuanLiveDelivery implements QianchuanDeliveryAdapter {
  private active?: QianchuanDeliveryPageSession;
  constructor(private readonly runner: DeliverySessionRunner = liveSession) {}
  async withTarget<T>(target: FrozenQianchuanAccount, signal: AbortSignal, work: (session: QianchuanDeliveryPageSession) => Promise<T>) {
    if (this.active) throw failure();
    return this.runner(target, signal, async session => {
      this.active = session;
      try { return await work(session); } finally { this.active = undefined; }
    });
  }
  capabilities(advertiserId: string) { return this.active?.capabilities(advertiserId) ?? []; }
  readFresh(draft: QianchuanDeliveryDraft, signal: AbortSignal) { if (!this.active) throw failure(); return this.active.readFresh(draft, signal); }
  submitOnce(draft: QianchuanDeliveryDraft, signal: AbortSignal, context: QianchuanDeliverySubmissionContext) { if (!this.active) throw failure(); return this.active.submitOnce(draft, signal, context); }
  readback(draft: QianchuanDeliveryDraft, submission: QianchuanDeliverySubmission, signal: AbortSignal) { if (!this.active) throw failure(); return this.active.readback(draft, submission, signal); }
}
