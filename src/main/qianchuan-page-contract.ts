import { randomUUID } from "node:crypto";
import type { Frame, Locator, Page } from "playwright-core";
import { accountPageUrl } from "../shared/qianchuan-account.js";
import { uploadFailure, type PageOwnership, type ReadyEvidence } from "../shared/douyin-upload.js";
import type { UploadTaskRecord } from "./douyin-upload-store.js";
import type { BatchSelectedFile } from "./douyin-upload-service.js";

/** Finite source-owned selectors; no browser scripts or selectors are supplied by IPC. */
export interface QianchuanPageContract {
  version: string; origin: string; route: string; fixtureUrl?: string;
  drawer: string; modal: string; count: string; row: string; fileNameAttribute: string; stateAttribute: string;
  login: string; challenge: string; failure: string; fileSelectionDoesNotConfirm: true;
}
// Authenticating/manual CDP history did not establish a production Playwright contract.
export const PRODUCTION_QIANCHUAN_CONTRACT: QianchuanPageContract | undefined = undefined;
export function qianchuanReadiness(): string | undefined {
  return PRODUCTION_QIANCHUAN_CONTRACT ? undefined : "千川生产页面合同尚未核实，上传保持阻断；不会连接 Chrome 或选文件。";
}
const changed = () => uploadFailure("PAGE_CONTRACT_CHANGED", "page", "千川页面结构或批次归属无法唯一确认。", "在 Chrome 核查原页面；程序不会猜测计划或控件。", true);
export function parseSelectedCount(text: string): { selected: number; capacity: number } {
  const match = /^已选择\s*(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (!match) throw changed();
  const selected = Number(match[1]), capacity = Number(match[2]);
  if (!Number.isSafeInteger(selected) || !Number.isSafeInteger(capacity) || capacity < 1 || selected > capacity) throw changed();
  return { selected, capacity };
}

export class QianchuanPageSession {
  private frame?: Frame;
  private modal?: Locator;
  private ownership?: PageOwnership;
  private selected: BatchSelectedFile[] = [];
  private prepared?: { taskId: string; index: number };
  constructor(private readonly page: Page, private readonly contract: QianchuanPageContract, private readonly check: (signal: AbortSignal) => void) {}
  url(task: UploadTaskRecord): string {
    if (!this.contract.fixtureUrl) return accountPageUrl(task.authorization.target);
    const url = new URL(this.contract.fixtureUrl);
    url.searchParams.set("aavid", task.authorization.target.advertiserId); url.searchParams.set("adId", task.authorization.target.adId);
    return url.href;
  }
  private async unique(locator: Locator, signal: AbortSignal): Promise<Locator> {
    this.check(signal); if (await locator.count() !== 1) throw changed(); this.check(signal); return locator;
  }
  private async visible(selector: string): Promise<boolean> { return (await this.frame!.locator(`${selector}:visible`).count()) > 0; }
  async guard(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    this.check(signal);
    const url = new URL(this.page.url()), target = task.authorization.target;
    if (url.origin !== this.contract.origin || url.pathname !== this.contract.route || url.searchParams.get("aavid") !== target.advertiserId || url.searchParams.get("adId") !== target.adId) throw changed();
    if (!this.frame || this.frame.isDetached()) {
      const frames: Frame[] = [];
      for (const frame of this.page.frames()) {
        if (new URL(frame.url()).origin === this.contract.origin && await frame.locator(`${this.contract.drawer}:visible`).count() === 1) frames.push(frame);
      }
      if (frames.length !== 1) throw changed(); this.frame = frames[0];
    }
    if (new URL(this.frame.url()).origin !== this.contract.origin) throw changed();
    if (await this.visible(this.contract.login)) throw uploadFailure("LOGIN_REQUIRED", "account", "千川需要人工登录。", "在 Chrome 登录后明确继续。", true);
    if (await this.visible(this.contract.challenge)) throw uploadFailure("CHALLENGE_REQUIRED", "account", "千川需要人工验证。", "在 Chrome 处理验证；程序不自动重试。", true);
    for (const id of [target.advertiserId, target.adId]) {
      await this.unique(this.frame.getByText(new RegExp(`^ID[：:]\\s*${id}$`)).filter({ visible: true }), signal);
    }
    if (this.modal) {
      await this.unique(this.frame.locator(`${this.contract.modal}:visible`), signal);
      if (await this.modal.getAttribute("data-jianji-upload-session") !== this.ownership?.modalSessionId) throw changed();
      await this.unique(this.modal.getByRole("button", { name: "确定", exact: true }), signal);
      if (await this.modal.locator(`${this.contract.failure}:visible`).count()) throw uploadFailure("CONTENT_REJECTED", "page", "上传列表显示失败或拒绝。", "在 Chrome 核查；不会重传或自动确认。", true);
    }
    this.check(signal);
  }
  async prepare(task: UploadTaskRecord, selected: BatchSelectedFile[], targetId: string, signal: AbortSignal): Promise<{ pageOwnership: PageOwnership; selectedIndex: number }> {
    await this.guard(task, signal);
    if (!this.modal) {
      if (selected.length) throw changed();
      const drawer = await this.unique(this.frame!.locator(`${this.contract.drawer}:visible`), signal);
      for (const label of ["素材", "添加视频", "上传视频"]) {
        const scope = label === "素材" ? drawer : this.frame!;
        const control = await this.unique(scope.getByRole("button", { name: label, exact: true }).filter({ visible: true }), signal);
        this.check(signal); await control.click({ timeout: task.config.timeouts.action }); this.check(signal);
      }
      this.modal = await this.unique(this.frame!.locator(`${this.contract.modal}:visible`), signal);
      this.ownership = { targetId, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
      await this.modal.evaluate((element, session) => element.setAttribute("data-jianji-upload-session", session), this.ownership.modalSessionId);
    }
    if (this.ownership!.pageBatchId !== task.authorization.pageBatchId || this.ownership!.targetId !== targetId) throw changed();
    this.selected = selected;
    const observation = await this.observe(task, signal);
    if (selected.length && !observation.ready) throw changed();
    if (!selected.length && observation.capacity < task.authorization.expectedCount) throw uploadFailure("CAPACITY_INSUFFICIENT", "page", "千川计划可添加数量不足以容纳本次整批成片。", "人工处理容量后重新选择；程序不截断条数或自动确认腾位置。", true);
    if (observation.selected >= observation.capacity || selected.some(file => file.fileName === task.result.file_name)) throw changed();
    await this.unique(this.modal!.locator('input[type="file"]'), signal);
    this.prepared = { taskId: task.result.upload_task_id, index: selected.length + 1 };
    return { pageOwnership: this.ownership!, selectedIndex: this.prepared.index };
  }
  private async observe(task: UploadTaskRecord, signal: AbortSignal): Promise<{ selected: number; capacity: number; ready: boolean }> {
    await this.guard(task, signal);
    const count = await this.unique(this.modal!.locator(this.contract.count), signal);
    const parsed = parseSelectedCount((await count.textContent()) ?? "");
    const rows = this.modal!.locator(this.contract.row);
    if (await rows.count() !== this.selected.length || parsed.selected !== this.selected.length) throw changed();
    let ready = true;
    for (const file of this.selected) {
      const row = rows.nth(file.index - 1);
      if (await row.getAttribute(this.contract.fileNameAttribute) !== file.fileName) throw changed();
      const state = await row.getAttribute(this.contract.stateAttribute);
      if (state === "failed" || state === "cancelled" || state === "rejected") throw changed();
      if (state !== "ready") ready = false;
    }
    const confirm = await this.unique(this.modal!.getByRole("button", { name: "确定", exact: true }), signal);
    return { ...parsed, ready: ready && await confirm.isEnabled() && !await this.modal!.getByText("取消上传", { exact: true }).count() };
  }
  async upload(task: UploadTaskRecord, signal: AbortSignal): Promise<void> {
    if (task.result.upload_outcome !== "MAY_HAVE_UPLOADED" || this.prepared?.taskId !== task.result.upload_task_id) throw changed();
    await this.observe(task, signal); const file = await this.unique(this.modal!.locator('input[type="file"]'), signal);
    this.check(signal);
    // The service has persisted the selection fence before this sole external file action.
    await file.setInputFiles(task.snapshotPath, { timeout: task.config.timeouts.fileInput }); this.check(signal);
    this.selected = [...this.selected, { fileName: task.result.file_name, index: this.prepared.index }]; this.prepared = undefined;
  }
  private evidence(task: UploadTaskRecord, selectedCount: number): ReadyEvidence {
    return { advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId, fileName: task.result.file_name,
      selectedCount, observedAt: new Date().toISOString(), pageOwnership: this.ownership! };
  }
  async ready(task: UploadTaskRecord, signal: AbortSignal): Promise<ReadyEvidence> {
    const deadline = Date.now() + task.config.timeouts.processing;
    while (Date.now() < deadline) {
      const observed = await this.observe(task, signal);
      if (observed.ready) return this.evidence(task, observed.selected);
      this.check(signal); await this.page.waitForTimeout(Math.min(100, deadline - Date.now())); this.check(signal);
    }
    throw uploadFailure("TIMEOUT", "browser", "千川处理未在期限内完成。", "只读核查原页面；禁止重传。", true);
  }
  async restore(task: UploadTaskRecord, ownership: PageOwnership, selected: BatchSelectedFile[], targetId: string, signal: AbortSignal): Promise<ReadyEvidence> {
    if (ownership.targetId !== targetId || ownership.pageBatchId !== task.authorization.pageBatchId) throw changed();
    this.ownership = ownership; await this.guard(task, signal);
    this.modal = await this.unique(this.frame!.locator(`${this.contract.modal}:visible`), signal); this.selected = selected;
    const item = selected.find(file => file.fileName === task.result.file_name);
    if (!item || selected.filter(file => file.fileName === task.result.file_name).length !== 1) throw changed();
    return this.ready(task, signal);
  }
}
