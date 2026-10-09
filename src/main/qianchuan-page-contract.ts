import { randomUUID } from "node:crypto";
import type { ElementHandle, FileChooser, Frame, Locator, Page } from "playwright-core";
import { accountPageUrl } from "../shared/qianchuan-account.js";
import { UploadError, uploadFailure, type PageOwnership, type ReadyEvidence } from "../shared/douyin-upload.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";
import { MAX_UPLOAD_GROUP_SIZE, type BatchSelectedFile } from "./douyin-upload-service.js";

/** Finite source-owned selectors; no browser scripts or selectors are supplied by IPC. */
interface PageContract {
  version: string; origin: string; route: string; fixtureUrl?: string;
  drawer: string; modal: string; count: string; row: string;
  login: string; challenge: string; failure: string; fileSelectionDoesNotConfirm: true;
}
export type QianchuanPageContract = PageContract & (
  { kind: "fixture"; fileNameAttribute: string; stateAttribute: string } | { kind: "qianchuan" }
);
export const PRODUCTION_QIANCHUAN_CONTRACT: QianchuanPageContract = {
  kind: "qianchuan", version: "qianchuan-upload-only/2026-10-07",
  origin: "https://qianchuan.jinritemai.com", route: "/uni-prom",
  drawer: ".ovui-drawer--no-maskable .ad-drawer-body",
  modal: ".ovui-drawer:not(.ovui-drawer--no-maskable):has(.oc-create-material-submit-bar-count)",
  count: ".oc-create-material-submit-bar-count", row: ".oc-create-upload-table-wrapper tbody > tr.ovui-tr",
  login: 'input[type="password"]', challenge: 'iframe[src*="captcha"]',
  failure: '.oc-create-upload-table-wrapper :text-matches("上传失败|处理失败|上传被拒绝", "")',
  fileSelectionDoesNotConfirm: true,
};
export function qianchuanReadiness(): string | undefined { return undefined; }
const uploadSelector = '[data-e2e="oc_emptyKey_uni-prom__createMaterialUploadVideo"]';
const changed = () => uploadFailure("PAGE_CONTRACT_CHANGED", "page", "千川页面结构或批次归属无法唯一确认。", "在 Chrome 核查原页面；程序不会猜测计划或控件。", true);
const lostModal = (reason = "已丢失、无法唯一确认或归属已改变") => uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", `原上传弹窗${reason}。`, "请人工核查原批次；不能新开弹窗重传，已有文件屏障继续保留。", true);
export function parseSelectedCount(text: string): { selected: number; capacity: number } {
  const match = /^已选择\s*(\d+)\s*\/\s*(\d+)\s*[：:]?$/.exec(text.trim());
  if (!match) throw changed();
  const selected = Number(match[1]), capacity = Number(match[2]);
  if (!Number.isSafeInteger(selected) || !Number.isSafeInteger(capacity) || capacity < 1 || selected > capacity) throw changed();
  return { selected, capacity };
}

export class QianchuanPageSession {
  private frame?: Frame;
  private modal?: Locator;
  private modalNode?: ElementHandle<HTMLElement | SVGElement>;
  private ownership?: PageOwnership;
  private selected: BatchSelectedFile[] = [];
  private pending = new Set<string>();
  private identityEstablished = false;
  private upgradeTipDismissed = false;
  private prepared?: { taskIds: string[]; index: number };
  private chooser?: FileChooser;
  private chooserEvents: FileChooser[] = [];
  private releaseChooser?: () => void;
  clearChooser(): void {
    this.releaseChooser?.(); this.releaseChooser = undefined;
    this.chooser = undefined; this.chooserEvents = [];
  }
  constructor(private readonly page: Page, private readonly contract: QianchuanPageContract, private readonly check: (signal: AbortSignal) => void,
    private readonly remoteSelect?: (element: ElementHandle, tasks: UploadTaskRecord[], signal: AbortSignal) => Promise<void>) {}
  url(task: UploadTaskRecord): string {
    if (!this.contract.fixtureUrl) {
      const { product, cdpEndpoint, advertiserId, adId } = task.authorization.target;
      return accountPageUrl({ product, cdpEndpoint, advertiserId, adId });
    }
    const url = new URL(this.contract.fixtureUrl);
    url.searchParams.set("aavid", task.authorization.target.advertiserId); url.searchParams.set("adId", task.authorization.target.adId);
    return url.href;
  }
  /** Only the uploader's new, unselected tab may enter a plan from the list. */
  async openInitialPlan(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    this.check(signal);
    if (this.modal || this.ownership || this.selected.length || this.prepared || this.identityEstablished) throw changed();
    const target = task.authorization.target;
    const assertList = async () => {
      this.check(signal);
      const url = new URL(this.page.url());
      if (url.origin !== this.contract.origin || url.pathname !== this.contract.route || url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== target.advertiserId || url.searchParams.getAll("adId").length > 1 || url.searchParams.get("adId")) throw changed();
      if (await this.page.locator(`${this.contract.drawer}:visible,${this.contract.modal}:visible`).count()) throw changed();
      await this.shown(this.page.locator(".account-info-container").getByText(new RegExp(`^\\s*ID[：:]\\s*${target.advertiserId}\\s*$`)).filter({ visible: true }), task, signal);
    };
    if (this.contract.kind !== "qianchuan" || new URL(this.page.url()).searchParams.get("adId") === target.adId) return this.guard(task, signal);
    const deadline = Date.now() + task.config.timeouts.navigation;
    const rows = this.page.locator(".oc-promotion-product-adinfo:visible").filter({
      has: this.page.locator(".oc-promotion-product-adinfo-id-fade").filter({ hasText: new RegExp(`^\\s*ID[：:]\\s*${target.adId}\\s*$`) }),
    });
    while (!await rows.count()) {
      await assertList();
      if (Date.now() >= deadline) throw changed();
      await this.page.waitForTimeout(50);
    }
    await assertList();
    const row = await this.unique(rows, signal);
    const material = await this.unique(row.locator(".oc-promotion-product-adinfo-material:visible").filter({ hasText: /^素材$/ }), signal);
    this.check(signal);
    try { await material.click({ timeout: task.config.timeouts.action }); }
    catch { this.check(signal); throw changed(); }
    while (!new URL(this.page.url()).searchParams.get("adId")) {
      this.check(signal);
      if (Date.now() >= deadline) throw changed();
      await this.page.waitForTimeout(50);
    }
    await this.guard(task, signal);
  }
  private async unique(locator: Locator, signal: AbortSignal): Promise<Locator> {
    this.check(signal); if (await locator.count() !== 1) throw changed(); this.check(signal); return locator;
  }
  private async shown(locator: Locator, task: UploadTaskRecord, signal: AbortSignal): Promise<Locator> {
    this.check(signal);
    try { await locator.waitFor({ state: "visible", timeout: task.config.timeouts.action }); }
    catch { this.check(signal); throw changed(); }
    return this.unique(locator.filter({ visible: true }), signal);
  }
  private async visible(selector: string): Promise<boolean> { return (await this.frame!.locator(`${selector}:visible`).count()) > 0; }
  private async ownedModal(signal: AbortSignal, deadline: number): Promise<boolean> {
    let waited = false;
    while (true) {
      this.check(signal);
      if (!this.modalNode || !this.frame || this.frame.isDetached()) throw lostModal("的原节点或页面已丢失");
      let state: "lost" | "hidden" | "visible";
      try {
        state = await this.frame.locator(this.contract.modal).evaluateAll((elements, { node, session }) => {
          if (!node.isConnected || elements.length !== 1 || elements[0] !== node || node.getAttribute("data-jianji-upload-session") !== session) return "lost";
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility === "visible" ? "visible" : "hidden";
        }, { node: this.modalNode, session: this.ownership!.modalSessionId });
      } catch { this.check(signal); throw lostModal("的原节点或页面已丢失"); }
      this.check(signal);
      if (state === "lost") throw lostModal("的原节点已移除、替换或归属已改变");
      if (state === "visible") return waited;
      if (Date.now() >= deadline) throw lostModal("持续不可见，稳定等待已超时");
      waited = true;
      await this.page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
  async guard(task: UploadTaskRecord, signal: AbortSignal, modalDeadline = Date.now() + Math.min(task.config.timeouts.action, 1000)): Promise<void> {
    this.check(signal);
    if (this.page.isClosed()) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "原批次标签页已关闭。", "人工核查；不能新开页面重传。", true);
    if (this.modal) await this.ownedModal(signal, modalDeadline);
    const url = new URL(this.page.url()), target = task.authorization.target;
    if (url.origin !== this.contract.origin || url.pathname !== this.contract.route || url.searchParams.get("aavid") !== target.advertiserId || url.searchParams.get("adId") !== target.adId) throw changed();
    if (!this.frame || this.frame.isDetached()) {
      this.frame = undefined;
      const deadline = Date.now() + task.config.timeouts.navigation;
      while (!this.frame && Date.now() < deadline) {
        const frames: Frame[] = [];
        for (const frame of this.page.frames()) {
          let origin: string; try { origin = new URL(frame.url()).origin; } catch { continue; }
          if (origin !== this.contract.origin) continue;
          const count = await frame.locator(`${this.contract.drawer}:visible`).count();
          if (count > 1) throw changed(); if (count === 1) frames.push(frame);
        }
        if (frames.length > 1) throw changed();
        this.frame = frames[0];
        if (!this.frame) { this.check(signal); await this.page.waitForTimeout(50); this.check(signal); }
      }
      if (!this.frame) throw changed();
    }
    if (new URL(this.frame.url()).origin !== this.contract.origin) throw changed();
    const drawer = await this.unique(this.frame.locator(`${this.contract.drawer}:visible`), signal);
    if (await this.visible(this.contract.login)) throw uploadFailure("LOGIN_REQUIRED", "account", "千川需要人工登录。", "在 Chrome 登录后明确继续。", true);
    if (await this.visible(this.contract.challenge)) throw uploadFailure("CHALLENGE_REQUIRED", "account", "千川需要人工验证。", "在 Chrome 处理验证；程序不自动重试。", true);
    const accountScope = this.contract.kind === "qianchuan"
      ? await this.shown(this.frame.locator(".account-info-container"), task, signal) : this.frame;
    const accountIdentity = accountScope.getByText(new RegExp(`^\\s*ID[：:]\\s*${target.advertiserId}\\s*$`)).filter({ visible: true });
    const planScope = this.contract.kind === "qianchuan" ? drawer : this.frame;
    const planIdentity = planScope.getByText(new RegExp(`^\\s*ID[：:]\\s*${target.adId}\\s*$`)).filter({ visible: true });
    if (!this.identityEstablished) {
      await this.shown(accountIdentity, task, signal); await this.shown(planIdentity, task, signal);
      this.identityEstablished = true; return this.guard(task, signal, modalDeadline);
    }
    await this.unique(accountIdentity, signal); await this.unique(planIdentity, signal);
    if (this.contract.kind === "qianchuan") {
      const deleted = await planIdentity.evaluate(element => {
        const header = element.closest(".oc-promotion-key-info-bar-info-con");
        if (!header) return null;
        return Array.from(header.querySelectorAll(".oc-tag-text")).some(tag => {
        const text = document.createRange(); text.selectNodeContents(tag);
        return tag.textContent?.trim() === "已删除" && Array.from(text.getClientRects()).some(box => box.width > 0 && box.height > 0) && getComputedStyle(tag).visibility === "visible";
        });
      });
      if (deleted === null) throw changed();
      if (deleted) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", `千川计划 ${target.adId} 已删除，已停止自动操作。`, "保存当前有效计划链接；仅整批从未选过文件的任务可明确“改传当前计划”。已有文件屏障保留，只能人工核查原计划，禁止重传。", true);
    }
    if (!this.modal && this.contract.kind === "qianchuan" && await this.dismissUpgradeTip(task, signal)) return this.guard(task, signal, modalDeadline);
    if (this.modal) {
      if (await this.ownedModal(signal, modalDeadline)) return this.guard(task, signal, modalDeadline);
      await this.unique(this.modal.getByRole("button", { name: "确定", exact: true }), signal);
      if (await this.modal.locator(`${this.contract.failure}:visible`).count()) throw uploadFailure("CONTENT_REJECTED", "page", "上传列表显示失败或拒绝。", "在 Chrome 核查；不会重传或自动确认。", true);
    }
    this.check(signal);
  }
  private async dismissUpgradeTip(task: UploadTaskRecord, signal: AbortSignal): Promise<boolean> {
    const tip = this.frame!.locator(".all-shop-upgrade-modal-wrap:visible");
    if (!await tip.count()) return false;
    if (this.upgradeTipDismissed) throw changed();
    await this.unique(tip, signal);
    const dialog = tip.locator('.all-shop-upgrade-modal[role="dialog"][aria-labelledby="all-shop-upgrade-title"]:visible');
    await this.unique(dialog, signal);
    await this.unique(dialog.locator(".upgrade-tag").filter({ hasText: /^全店托管重磅升级$/ }), signal);
    const close = await this.unique(tip.locator(".tools-vmok-plugin-modal > .tools-vmok-plugin-modal__close-icon:visible"), signal);
    this.upgradeTipDismissed = true;
    this.check(signal);
    try {
      await close.click({ timeout: task.config.timeouts.action });
      await tip.waitFor({ state: "hidden", timeout: task.config.timeouts.action });
    } catch { this.check(signal); throw changed(); }
    this.check(signal);
    return true;
  }
  private async click(control: Locator, task: UploadTaskRecord, signal: AbortSignal, label = "目标控件"): Promise<void> {
    await this.guard(task, signal); const locator = await this.shown(control, task, signal);
    if (!await locator.isEnabled()) {
      if (label === "添加视频" && this.contract.kind === "qianchuan" && await this.shopPermissionBlocked(locator, task, signal)) {
        throw uploadFailure("ACCOUNT_UNCONFIRMED", "account", "店铺权限问题（非简辑程序故障）：千川提示“当前账户无该抖音号的全域投放权限，不支持添加素材”，已在选文件前停止。", "请店铺管理员核查该抖音号的全域投放授权。权限恢复后，仅对尚未选文件的任务明确安全继续；程序不会修改广告设置或自动重传。", true);
      }
      throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", `千川“${label}”按钮已禁用，平台业务原因尚未确认。`, "请在 Chrome 人工核查计划状态、操作权限及平台提示；程序不会修改计划或广告设置。处理后仅对尚未选文件的任务安全继续。", true);
    }
    this.check(signal); await locator.click({ timeout: task.config.timeouts.action }); this.check(signal);
  }
  private async shopPermissionBlocked(button: Locator, task: UploadTaskRecord, signal: AbortSignal): Promise<boolean> {
    const tips = this.frame!.locator('[role="tooltip"]:visible,.ovui-tooltip:visible,.ovui-popover:visible')
      .filter({ hasText: /^\s*当前账户无该抖音号的全域投放权限，不支持添加素材\s*$/ });
    const before = await tips.elementHandles();
    try {
      this.check(signal);
      try { await button.hover({ timeout: Math.min(task.config.timeouts.action, 1000) }); }
      catch { await this.guard(task, signal); return false; }
      const deadline = Date.now() + Math.min(task.config.timeouts.action, 500);
      do {
        await this.guard(task, signal);
        if (await tips.count() === 1 && !await tips.evaluate((tip, existing) => existing.includes(tip), before)) {
          const tip = await tips.boundingBox(), control = await button.boundingBox();
          if (tip && control && tip.x < control.x + control.width + 40 && tip.x + tip.width > control.x - 40 && tip.y < control.y + control.height + 40 && tip.y + tip.height > control.y - 40) return true;
        }
        await this.page.waitForTimeout(50); this.check(signal);
      } while (Date.now() < deadline);
      return false;
    } finally { await Promise.all(before.map(handle => handle.dispose())); }
  }
  private group(tasks: UploadTaskRecord[], limit = MAX_UPLOAD_GROUP_SIZE): UploadTaskRecord {
    const task = tasks[0];
    if (!task || tasks.length > limit || new Set(tasks.map(value => value.result.upload_task_id)).size !== tasks.length || new Set(tasks.map(value => value.result.file_name)).size !== tasks.length || tasks.some(value => JSON.stringify(value.authorization) !== JSON.stringify(task.authorization) || JSON.stringify(value.config) !== JSON.stringify(task.config) || value.input.project_id !== task.input.project_id)) throw changed();
    return task;
  }
  async prepare(tasks: UploadTaskRecord[], selected: BatchSelectedFile[], targetId: string, signal: AbortSignal): Promise<{ pageOwnership: PageOwnership; selectedIndex: number }> {
    this.clearChooser(); this.prepared = undefined;
    const task = this.group(tasks);
    if (this.pending.size) throw changed();
    await this.guard(task, signal);
    if (!this.modal) {
      if (selected.length || await this.frame!.locator(`${this.contract.modal}:visible`).count()) throw changed();
      const drawer = await this.unique(this.frame!.locator(`${this.contract.drawer}:visible`), signal);
      const material = this.contract.kind === "qianchuan" ? drawer.locator(".ovui-tabs__tab").filter({ hasText: /^素材$/ }) : drawer.getByRole("button", { name: "素材", exact: true });
      await this.click(material, task, signal);
      const addScope = this.contract.kind === "qianchuan" ? drawer : this.frame!;
      await this.click(addScope.getByRole("button", { name: "添加视频", exact: true }), task, signal, "添加视频");
      if (this.contract.kind === "fixture") await this.click(this.frame!.getByRole("button", { name: "上传视频", exact: true }), task, signal);
      this.modal = await this.shown(this.frame!.locator(this.contract.modal), task, signal);
      this.modalNode = await this.modal.elementHandle() ?? undefined;
      this.ownership = { targetId, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
      await this.modal.evaluate((element, session) => element.setAttribute("data-jianji-upload-session", session), this.ownership.modalSessionId);
      if (this.contract.kind === "qianchuan") await this.click(this.modal.locator(".ovui-tabs__tab").filter({ hasText: /^上传视频$/ }), task, signal);
    }
    if (this.ownership!.pageBatchId !== task.authorization.pageBatchId || this.ownership!.targetId !== targetId) throw changed();
    this.selected = selected; this.pending.clear();
    const observation = await this.observe(task, signal);
    if (observation.missing) throw changed();
    if (!selected.length && observation.capacity < task.authorization.expectedCount) throw uploadFailure("CAPACITY_INSUFFICIENT", "page", "千川计划可添加数量不足以容纳本次整批成片。", "人工处理容量后重新选择；程序不截断条数或自动确认腾位置。", true);
    if (selected.length + tasks.length > observation.capacity || selected.length + tasks.length > task.authorization.expectedCount || tasks.some(value => selected.some(file => file.fileName === value.result.file_name))) throw changed();
    if (this.contract.kind === "qianchuan") this.chooser = await this.prepareChooser(task, signal);
    else await this.unique(this.modal!.locator('input[type="file"]'), signal);
    this.prepared = { taskIds: tasks.map(value => value.result.upload_task_id), index: selected.length + 1 };
    return { pageOwnership: this.ownership!, selectedIndex: this.prepared.index };
  }
  private async observe(task: UploadTaskRecord, signal: AbortSignal): Promise<{ selected: number; capacity: number; ready: boolean; missing: number }> {
    await this.guard(task, signal);
    // The list can insert/reorder rows during processing. Read one finite DOM snapshot
    // so a filename and its success markers always belong to the same row.
    const snapshot = await this.modal!.evaluate((element, contract) => {
      const visible = (node: Element) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility === "visible";
      };
      const counts = element.querySelectorAll(contract.count);
      return { countElements: counts.length, countText: counts[0]?.textContent ?? "", rows: Array.from(element.querySelectorAll(contract.row), row => {
        if (contract.kind === "fixture") return { name: row.getAttribute(contract.fileNameAttribute), state: row.getAttribute(contract.stateAttribute), valid: true, ready: row.getAttribute(contract.stateAttribute) === "ready" };
        const names = row.querySelectorAll(".oc-upload-table-name-text .oc-typography-value-int");
        return { name: names[0]?.textContent?.trim() ?? null, state: null, valid: names.length === 1,
          ready: Array.from(row.querySelectorAll(".oc-upload-table-name-progress-success")).filter(visible).length === 1 && Array.from(row.querySelectorAll(".ovui-progress--success")).filter(visible).length === 1 };
      }) };
    }, this.contract);
    this.check(signal);
    if (snapshot.countElements !== 1) throw changed();
    const parsed = parseSelectedCount(snapshot.countText), size = snapshot.rows.length;
    const previous = this.selected.filter(file => !this.pending.has(file.fileName)), minimum = previous.length;
    const confirmed = previous.filter(file => file.ready === true).length;
    if (size < minimum || size > this.selected.length || this.selected.length > parsed.capacity || parsed.selected < confirmed || parsed.selected > size) throw changed();
    const observed = new Map<string, boolean>();
    for (const row of snapshot.rows) {
      if (!row.valid || ["failed", "cancelled", "rejected"].includes(row.state ?? "") || !row.name || observed.has(row.name) || !this.selected.some(file => file.fileName === row.name)) throw changed();
      observed.set(row.name, row.ready);
    }
    for (const file of previous) if (!observed.has(file.fileName) || (file.ready === true && !observed.get(file.fileName))) throw changed();
    const confirm = await this.unique(this.modal!.getByRole("button", { name: "确定", exact: true }), signal);
    const complete = size === this.selected.length && parsed.selected === this.selected.length && [...observed.values()].every(Boolean);
    return { ...parsed, missing: this.selected.length - observed.size, ready: complete && await confirm.isEnabled() && !await this.modal!.getByText("取消上传", { exact: true }).filter({ visible: true }).count() };
  }
  private async uploadEntrance(task: UploadTaskRecord, signal: AbortSignal): Promise<Locator> {
    const deadline = Date.now() + Math.min(task.config.timeouts.action, task.config.timeouts.fileInput);
    while (true) {
      await this.guard(task, signal);
      const zone = await this.unique(this.modal!.locator(`${uploadSelector}:visible`), signal);
      const disabled = await zone.evaluate(element => element.classList.contains("oc-create-upload-select-wrapper-disabled") || element.getAttribute("aria-disabled") === "true");
      this.check(signal);
      if (disabled) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "千川上传入口已禁用，当前不能继续添加视频；这不表示计划容量已满。", "在 Chrome 核查原上传窗口及平台提示；未选文件保留，不自动确认、腾位置或重传。", true);
      if (!await zone.locator(".oc-create-upload-select-loading:visible").count()) {
        await this.unique(zone.getByText("点击上传", { exact: true }).filter({ visible: true }), signal);
        return zone;
      }
      if (Date.now() >= deadline) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "千川上传入口持续忙碌，已停止添加视频。", "保留原上传窗口并核查平台提示；不会重选文件或自动确认。", true);
      await this.page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now()))); this.check(signal);
    }
  }
  private async validChooser(chooser: FileChooser): Promise<boolean> {
    if (this.chooserEvents.length !== 1 || chooser.page() !== this.page || !chooser.isMultiple() || await chooser.element().ownerFrame() !== this.frame) return false;
    return chooser.element().evaluate(element => {
      if (!(element instanceof HTMLInputElement)) return false;
      const accept = element.accept.split(",").map(value => value.trim());
      return element.type === "file" && element.multiple && !element.webkitdirectory && !element.isConnected && element.files?.length === 0 &&
        accept.includes("video/mp4") && accept.includes("video/quicktime") && accept.every(value => ["video/mp4", "video/quicktime"].includes(value));
    });
  }
  private async prepareChooser(task: UploadTaskRecord, signal: AbortSignal): Promise<FileChooser> {
    if (this.frame !== this.page.mainFrame()) throw changed();
    await this.guard(task, signal);
    await this.page.bringToFront(); this.check(signal);
    const zone = await this.uploadEntrance(task, signal);
    const control = await this.unique(zone.getByText("点击上传", { exact: true }).filter({ visible: true }), signal);
    const record = (chooser: FileChooser) => { this.chooserEvents.push(chooser); };
    const waiting = new AbortController(), actionSignal = AbortSignal.any([signal, waiting.signal]);
    const timeout = Math.min(task.config.timeouts.action, task.config.timeouts.fileInput);
    this.page.on("filechooser", record);
    this.releaseChooser = () => this.page.off("filechooser", record);
    const event = this.page.waitForEvent("filechooser", { timeout, signal: actionSignal });
    void event.catch(() => undefined);
    try {
      // Arm before the sole click: the platform creates a detached native input.
      await control.click({ timeout, signal: actionSignal });
      const chooser = await event;
      await this.guard(task, signal); await this.uploadEntrance(task, signal);
      if (!await this.validChooser(chooser)) throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "上传文件选择器身份或格式不符，尚未发送文件。", "核查原页面控件后安全继续。", true);
      await this.observe(task, signal); this.check(signal);
      if (this.chooserEvents.length !== 1) throw changed();
      return chooser;
    } catch (error) {
      this.clearChooser(); this.check(signal); if (error instanceof UploadError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") throw uploadFailure("TIMEOUT", "browser", "上传文件选择器准备超时，尚未发送文件。", "自动重连后重新准备；可停止上传。", false, true);
      throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "上传文件选择器预检失败，尚未发送文件。", "核查原页面控件后安全继续。", true);
    } finally { waiting.abort(); }
  }
  async upload(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void> {
    try { await this.uploadPrepared(tasks, signal); }
    finally { this.clearChooser(); }
  }
  private async uploadPrepared(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void> {
    const task = this.group(tasks);
    if (tasks.some(value => value.result.upload_outcome !== "MAY_HAVE_UPLOADED") || JSON.stringify(this.prepared?.taskIds) !== JSON.stringify(tasks.map(value => value.result.upload_task_id))) throw changed();
    await this.observe(task, signal); this.check(signal);
    if (this.contract.kind === "qianchuan") await this.uploadEntrance(task, signal);
    const firstIndex = this.prepared!.index;
    this.selected = [...this.selected, ...tasks.map((value, index) => ({ fileName: value.result.file_name, index: firstIndex + index }))];
    this.pending = new Set(tasks.map(value => value.result.file_name)); this.prepared = undefined;
    // Every member's permanent selection fence is durable before this sole group file action.
    if (this.contract.kind === "qianchuan") {
      await this.page.bringToFront(); this.check(signal);
      const chooser = this.chooser;
      if (!chooser || !await this.validChooser(chooser)) throw lostModal("的文件选择器已变化，未重选文件");
      await this.guard(task, signal); this.check(signal);
      if (this.chooserEvents.length !== 1) throw changed();
      this.chooser = undefined;
      try {
        if (this.remoteSelect) await this.remoteSelect(chooser.element(), tasks, signal);
        else await chooser.setFiles(tasks.map(value => value.snapshotPath), { timeout: task.config.timeouts.fileInput, signal });
      }
      catch { this.check(signal); throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "browser", "文件发送调用未能确认结果。", "只读核查原上传页，禁止重传。", true); }
    }
    else {
      const input = await this.unique(this.modal!.locator('input[type="file"]'), signal);
      if (this.remoteSelect) { const element = await input.elementHandle(); if (!element) throw changed(); await this.remoteSelect(element, tasks, signal); }
      else await input.setInputFiles(tasks.map(value => value.snapshotPath), { timeout: task.config.timeouts.fileInput });
    }
    this.check(signal);
    const deadline = Date.now() + task.config.timeouts.fileInput;
    while (Date.now() < deadline) {
      if (!(await this.observe(task, signal)).missing) { this.pending.clear(); return; }
      await this.page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now()))); this.check(signal);
    }
    throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "已选择的文件未出现在原上传列表，无法确认平台是否收到。", "保留原页面并只读核查；禁止重新选文件，后续成片保持暂停。", true);
  }
  private evidence(task: UploadTaskRecord, selectedCount: number): ReadyEvidence {
    return { advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, fileName: task.result.file_name,
      selectedCount, observedAt: new Date().toISOString(), pageOwnership: this.ownership! };
  }
  async pollReady(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[] | undefined> {
    const task = this.group(tasks, 250);
    if (tasks.some(value => !this.selected.some(file => file.fileName === value.result.file_name)) || this.ownership?.pageBatchId !== task.authorization.pageBatchId) throw changed();
    const observed = await this.observe(task, signal);
    if (observed.ready) { this.pending.clear(); return tasks.map(value => this.evidence(value, observed.selected)); }
    return undefined;
  }
  async ready(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[]> {
    const task = this.group(tasks, 250);
    if (tasks.some(value => !this.selected.some(file => file.fileName === value.result.file_name)) || this.ownership?.pageBatchId !== task.authorization.pageBatchId) throw changed();
    const deadline = Date.now() + task.config.timeouts.processing;
    const rowDeadline = Date.now() + task.config.timeouts.fileInput;
    while (Date.now() < deadline) {
      const observed = await this.observe(task, signal);
      if (observed.ready) { this.pending.clear(); return tasks.map(value => this.evidence(value, observed.selected)); }
      if (observed.missing && Date.now() >= rowDeadline) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "已选择的文件未出现在原上传列表，无法确认平台是否收到。", "保留原页面并只读核查；禁止重新选文件，后续成片保持暂停。", true);
      this.check(signal); await this.page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now()))); this.check(signal);
    }
    throw uploadFailure("TIMEOUT", "browser", "千川处理未在期限内完成。", "只读核查原页面；禁止重传。", true);
  }
  async restore(task: UploadTaskRecord, ownership: PageOwnership, selected: BatchSelectedFile[], targetId: string, signal: AbortSignal): Promise<ReadyEvidence> {
    if (ownership.targetId !== targetId || ownership.pageBatchId !== task.authorization.pageBatchId) throw changed();
    this.ownership = ownership; await this.guard(task, signal);
    const modal = this.frame!.locator(`${this.contract.modal}:visible`);
    if (await modal.count() !== 1) throw lostModal();
    this.modal = modal;
    if (!this.modalNode) this.modalNode = await modal.elementHandle() ?? undefined;
    this.selected = selected;
    const item = selected.find(file => file.fileName === task.result.file_name);
    if (!item || selected.filter(file => file.fileName === task.result.file_name).length !== 1) throw changed();
    this.pending = new Set(selected.filter(file => file.ready === false).map(file => file.fileName));
    if (task.result.upload_outcome !== "READY") this.pending.add(task.result.file_name);
    return (await this.ready([task], signal))[0]!;
  }
}
