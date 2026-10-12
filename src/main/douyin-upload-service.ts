import { constants } from "node:fs";
import { appendFile, chmod, copyFile, lstat, open, realpath, readdir, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import type { QueueState } from "./domain.js";
import type { ExportBatchIdentity } from "./queue.js";
import { fingerprintFile, isPathWithinDirectory, pathsEqual } from "./paths.js";
import { DouyinUploadStore, frozenInputDigest, intentKey, secureUploadDirectory, strictSyncDirectory, uploadTaskId, sameTargetBytes, type UploadTaskRecord } from "./douyin-upload-store.js";
import { uploadBatchSettled } from "./douyin-upload-group.js";
import { QianchuanAccountConfigReader } from "./qianchuan-account-config.js";
import { QianchuanAccountSettings } from "./qianchuan-account-settings.js";
import { AutomationBrowserAccounts, assertAutomationBrowserSafe } from "./qianchuan-automation-browsers.js";
import { egressIdentity } from "../shared/qianchuan-egress.js";
import type { TemplateAccountBinding } from "../shared/batch-upload.js";
import { QianchuanBrowserControlSchema, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account.js";
import { QianchuanLibraryClearSchema, QianchuanPlanRecoverySchema, type QianchuanLibraryClear, type QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { QianchuanVideoLibrary } from "./qianchuan-video-library.js";
import { QianchuanPlanMaterials } from "./qianchuan-plan-materials.js";
import { QianchuanPlanMaterialRecovery } from "./qianchuan-plan-material-recovery.js";
import { clearQianchuanAccountPlans } from "./qianchuan-cleanup-plans.js";
import { readQianchuanPlans } from "./qianchuan-plan-catalog.js";
import { QianchuanPlanReads } from "./qianchuan-plan-reads.js";
import { QianchuanSelectedAccountTargets } from "./qianchuan-selected-account-targets.js";
import { QianchuanPlanListRequestSchema, QianchuanPlanCancelSchema, QianchuanPlanCatalogSchema, type QianchuanPlanOption, type QianchuanCurrentAccount, type QianchuanPlanListResult } from "../shared/qianchuan-plan-selection.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { automationConfirmationRecoveryLock, hasAutomationConfirmationIntent } from "./automation-upload.js";
import { confirmReadyUpload } from "./qianchuan-upload-completion.js";
import { FrozenAccountSchema, QianchuanUploadConfigSchema, QianchuanUploadSelectionSchema, UploadError, UploadIdentitySchema, QianchuanUploadResultSchema, ReadyEvidenceSchema, UploadAuthorizationSchema, uploadFailure, type QianchuanUploadConfig, type QianchuanUploadSelection, type DouyinUploadStatus, type UploadIdentity, type UploadAuthorization, type PageOwnership, type ReadyEvidence, type AcceptedEvidence, type QianchuanUploadResult, type QianchuanUploadTaskStatus } from "../shared/douyin-upload.js";

export interface BatchSelectedFile { fileName: string; index: number; ready?: boolean; }
export const MAX_UPLOAD_GROUP_SIZE = 9;
export type UploadReadyProgress = (fileNames: string[]) => Promise<void>;
export interface UploadBrowserPort {
  connect(task: UploadTaskRecord, signal: AbortSignal): Promise<void>;
  prepareFiles?(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void>;
  open(tasks: UploadTaskRecord[], selected: BatchSelectedFile[], signal: AbortSignal): Promise<{ pageOwnership: PageOwnership; selectedIndex: number }>;
  upload(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<void>;
  ready(tasks: UploadTaskRecord[], signal: AbortSignal): Promise<ReadyEvidence[]>;
  pollReady(tasks: UploadTaskRecord[], signal: AbortSignal, onReady?: UploadReadyProgress): Promise<ReadyEvidence[] | undefined>;
  readOnlyCheck(task: UploadTaskRecord, ownership: PageOwnership, selected: BatchSelectedFile[], signal: AbortSignal): Promise<ReadyEvidence>;
  confirmAutomation?(tasks: UploadTaskRecord[], ownership: PageOwnership, signal: AbortSignal): Promise<AcceptedEvidence[] | void>;
  closeAcceptedAutomationPage?(tasks: UploadTaskRecord[], ownership: PageOwnership, signal: AbortSignal, guard: () => void): Promise<void>;
  stop(): Promise<void>;
}
interface Dependencies {
  loadBatch(id: string): Promise<QueueState>; browser(): UploadBrowserPort;
  accounts?: QianchuanAccountConfigReader; changed?(): void;
  readiness?(config: QianchuanUploadConfig): string | undefined;
  readPlans?(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<QianchuanPlanOption[]>;
}
const timestamp = () => new Date().toISOString();
const unknown = (cause?: UploadError) => uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", cause ? `上传结果未知：${cause.failure.message}`.slice(0, 500) : "上传结果未知，禁止重新选文件。", cause?.failure.next_action ?? "在 Chrome 核查原批次页面；页面丢失时需人工处理。", true);

export class DouyinUploadService {
  private admission: Promise<unknown> = Promise.resolve();
  private pendingAdmissions = 0;
  private control: Promise<unknown> = Promise.resolve();
  private active?: { ids: string[]; controller: AbortController; port: UploadBrowserPort };
  private runner?: Promise<void>;
  private paused = false;
  private readonly pausedAccounts = new Set<string>();
  private continuationBatch?: string;
  private preparingContinuation = false;
  private retargeting = false;
  private discarding = false;
  private closing = false;
  private stopped = false;
  private stopping = false;
  private cancelling = 0;
  private initializationFailure?: string;
  private summaries: QianchuanAccountSummary[] = [];
  private refreshingProfileNames?: Promise<void>;
  private readonly eligible = new Set<string>();
  private readonly currentIntents = new Set<string>();
  private readonly cancelledIntents = new Set<string>();
  private readonly sessions = new Map<string, UploadBrowserPort>();
  private controlGeneration = 0;
  private productionBatches?: Set<string>;
  private beginningProduction = false;
  private automationUploadActive = false;
  private preparingAutomationUpload = false;
  private managingBrowser = false;
  private libraryOperation?: { controller: AbortController; done: Promise<void> };
  private browserPreparations = 0;
  private stopFailed = false;
  private readonly accounts: QianchuanAccountConfigReader;
  private readonly automationBrowsers: AutomationBrowserAccounts;
  private automationBrowserGeneration?: number;
  private readonly automaticConfirmationBatches = new Set<string>();
  private ordinaryRemoteAccount?: FrozenQianchuanAccount;
  private ordinaryBrowserController?: AbortController;
  private ordinaryBrowserControl = false;
  private readonly planReads: QianchuanPlanReads;
  private readonly selectedAccountTargets = new QianchuanSelectedAccountTargets();
  private readonly planRequests = new Map<string, AbortController>();
  private planPreloadController?: AbortController;
  private planPreload: Promise<void> = Promise.resolve();
  private hasNonAutomationWork(): boolean {
    return Boolean(this.pendingAdmissions || this.active || this.runner || this.preparingContinuation || this.retargeting || this.discarding ||
      this.closing || this.stopping || this.cancelling || this.beginningProduction || this.managingBrowser || this.browserPreparations);
  }
  get busy(): boolean {
    return this.hasNonAutomationWork() || this.automationUploadActive || this.automationBrowsers.busy;
  }
  constructor(readonly store: DouyinUploadStore, private readonly dependencies: Dependencies) {
    this.accounts = dependencies.accounts ?? new QianchuanAccountSettings(store.root);
    this.automationBrowsers = new AutomationBrowserAccounts({
      accounts: async () => {
        const summaries = await this.accounts.refresh();
        return Promise.all(summaries.filter(account => account.available).map(account => this.automationAccount(account.product)));
      },
      guard: advertiserId => {
        if (this.automationBrowserGeneration !== this.controlGeneration || this.stopFailed || this.store.unavailable || this.active ||
          !this.ordinaryBrowserControl && (this.runner || this.pendingAdmissions) || this.stopping || this.beginningProduction) throw new Error("上传控制仍在运行或不可用，未切换 VPS 浏览器。");
        const deferred = (pageBatchId: string) => this.ordinaryBrowserControl && this.automaticConfirmationBatches.has(pageBatchId) && this.productionBatches?.has(pageBatchId);
        const eligible = new Set([...this.eligible].filter(id => !deferred(this.store.task(id)!.authorization.pageBatchId)));
        const intents = new Set([...this.currentIntents].filter(key => !this.store.intents().some(intent => intentKey(intent) === key && deferred(intent.authorization.pageBatchId))));
        // Only current, never-selected production work may defer browser preparation.
        // Every historical or selected task is still protected by the original guard.
        assertAutomationBrowserSafe(this.store, advertiserId, eligible, intents, this.cancelledIntents);
      },
      close: async (target, guard) => {
        if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号设置不支持 VPS 浏览器管理。");
        guard();
        const batches = new Set(this.store.tasks().filter(task => task.authorization.target.advertiserId === target.advertiserId).map(task => task.authorization.pageBatchId));
        for (const [id, port] of this.sessions) if (batches.has(id)) {
          await this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(error => { this.stopFailed = true; throw error; });
          this.sessions.delete(id);
        }
        guard();
        await this.accounts.controlBrowser({ product: target.product, expectedAdvertiserId: target.advertiserId, action: "close" }, guard, target);
        this.planReads.invalidate(target.product);
      },
    });
    this.planReads = new QianchuanPlanReads(dependencies.readPlans ?? readQianchuanPlans);
    this.refreshAccountPauses();
  }
  async templateAccount(recentProjectId: string, projectId: string): Promise<TemplateAccountBinding | undefined> {
    return this.accounts instanceof QianchuanAccountSettings ? this.accounts.templateAccount(recentProjectId, projectId) : undefined;
  }
  /** Scheduled recipes freeze the configured account without opening or changing Chrome. */
  async automationAccount(product: QianchuanProduct): Promise<FrozenQianchuanAccount> {
    return this.accounts instanceof QianchuanAccountSettings
      ? this.accounts.configuredAccount(product)
      : this.accounts.preflight(product);
  }
  async saveTemplateAccount(binding: TemplateAccountBinding): Promise<TemplateAccountBinding> {
    if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号设置不支持保存模板关联。");
    return this.accounts.saveTemplateAccount(binding);
  }
  private inProduction(pageBatchId: string): boolean { return !this.productionBatches || this.productionBatches.has(pageBatchId); }
  private openTasks(records = this.store.tasks()): UploadTaskRecord[] { return records.filter(task => this.inProduction(task.authorization.pageBatchId) && !this.store.isClosed(task.authorization.pageBatchId)); }
  /** Trusted production boundaries revoke old runtime permission without changing history. */
  async beginProduction(): Promise<void> {
    if (this.managingBrowser || (this.automationUploadActive || this.automationBrowsers.busy) && !this.preparingAutomationUpload) throw new Error("账号浏览器操作正在进行，请稍后开始制作。");
    if (this.beginningProduction || this.stopping || this.closing || this.discarding || this.retargeting || this.preparingContinuation) throw new Error("上传控制仍在运行，请等待停止后开始本次制作。");
    this.beginningProduction = true;
    try {
      if (this.stopFailed || !await this.stop()) throw new Error("旧上传操作未能安全停止，本次制作未接收。");
      const generation = this.controlGeneration;
      await this.bounded(async () => { await this.control.catch(() => undefined); }, 15000, new AbortController().signal);
      if (generation !== this.controlGeneration || this.stopping || this.active) throw new Error("上传控制已变化，本次制作未接收。");
      this.productionBatches = new Set(); this.paused = false; this.pausedAccounts.clear(); this.stopped = false;
      this.selectedAccountTargets.clear();
      this.automaticConfirmationBatches.clear();
      if (this.summaries.some(account => account.available)) this.initializationFailure = undefined;
      if (this.accounts instanceof QianchuanAccountSettings && !this.preparingAutomationUpload) this.preloadPlans();
    } finally { this.beginningProduction = false; this.changed(); }
  }
  status(projectId: string): DouyinUploadStatus {
    const { accountConfigPath, ...config } = this.store.config;
    const readiness = this.dependencies.readiness?.(this.store.config);
    const records = this.store.tasks(), open = this.openTasks(records);
    const paused = this.paused || open.some(task => task.input.project_id === projectId && this.pausedAccounts.has(task.authorization.target.advertiserId));
    const progress = "成片就绪即上传，每次最多 9 条；所有制作入口整批就绪后自动确认，VPS 账号完成后自动关闭并切换。";
    const message = this.store.unavailable ? "上传存储不可用，已阻断浏览器操作。" : (this.stopFailed ? "旧上传操作未能安全停止，请先关闭应用并核查 Chrome。" : this.initializationFailure) ?? (!config.enabled ? "自动上传已关闭。" : readiness ?? (!this.summaries.some(account => account.available) ? "请授权可用的千川账号配置。" : paused ? this.pausedMessage(projectId, open) : this.stopped || this.stopping ? "自动上传已停止，待上传成片保留在队列中。检查对应 Chrome 后，对本批未选文件的任务点击“安全继续”；结果未知的文件只能只读核查原页面。" : progress));
    const tasks = open.filter(task => task.input.project_id === projectId && task.result.state !== "DISCARDED").map(task => this.taskResult(task));
    const all = records.filter(task => task.input.project_id === projectId);
    const summary = (pageBatchId: string) => this.batchSummary(projectId, all.filter(task => task.authorization.pageBatchId === pageBatchId));
    const canClose = (pageBatchId: string) => !this.active && !this.runner && !this.preparingContinuation && !this.retargeting && !this.discarding && !this.closing && !this.stopping && this.store.canCloseBatch(pageBatchId);
    const batches = [...new Set(open.filter(task => task.input.project_id === projectId && task.result.state !== "DISCARDED").map(task => task.authorization.pageBatchId))].map(pageBatchId => ({ ...summary(pageBatchId), canClose: canClose(pageBatchId) }));
    const historicalBatches = [...new Set(records.filter(task => task.input.project_id === projectId && !this.inProduction(task.authorization.pageBatchId) && task.result.state !== "DISCARDED" && !this.store.isClosed(task.authorization.pageBatchId)).map(task => task.authorization.pageBatchId))].map(pageBatchId => ({ ...summary(pageBatchId), canClose: canClose(pageBatchId) }));
    const closedBatches = this.store.closedBatches().filter(batch => batch.projectId === projectId).map(batch => ({ ...summary(batch.pageBatchId), closedAt: batch.closedAt, tasks: all.filter(task => task.authorization.pageBatchId === batch.pageBatchId).map(task => task.result) }));
    return { config, configSelected: Boolean(accountConfigPath), accounts: structuredClone(this.summaries), ready: config.enabled && !this.stopFailed && !this.store.unavailable && !this.initializationFailure && !paused && !this.stopped && !this.stopping && this.summaries.some(account => account.available) && !readiness, message, tasks, batches, historicalBatches, closedBatches, legacyTasks: this.productionBatches ? [] : this.store.legacyTasks().filter(task => task.project_id === projectId) };
  }
  /** Captured job details are read-only; they never restore historical upload permission. */
  capturedStatus(projectId: string, exportTaskIds: string[]): Pick<DouyinUploadStatus, "accounts" | "message" | "tasks" | "closedBatches"> & { historical: boolean } {
    const ids = new Set(exportTaskIds);
    const records = this.store.tasks().filter(task => task.input.project_id === projectId && ids.has(task.input.export_task_id));
    const historical = records.some(task => !this.inProduction(task.authorization.pageBatchId));
    const status = this.status(projectId);
    const closedBatches = this.store.closedBatches().filter(batch => batch.projectId === projectId && batch.taskIds.every(id => records.some(task => task.result.upload_task_id === id)))
      .map(batch => {
        const tasks = records.filter(task => task.authorization.pageBatchId === batch.pageBatchId);
        return { ...this.batchSummary(projectId, tasks), closedAt: batch.closedAt, tasks: tasks.map(task => task.result) };
      });
    return { accounts: status.accounts, historical,
      message: historical ? "这是此前制作的上传记录；自动上传只处理当前制作，旧记录不会自动续传。" : status.message,
      tasks: records.filter(task => !this.store.isClosed(task.authorization.pageBatchId) && task.result.state !== "DISCARDED").map(task => this.taskResult(task)), closedBatches };
  }
  private taskResult(task: UploadTaskRecord): QianchuanUploadTaskStatus {
    let result = task.result;
    if (this.store.unavailable && this.store.hasMarker(result.upload_task_id) && result.state !== "WAITING_FOR_CONFIRMATION") result = { ...result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", readyEvidence: undefined, acceptedEvidence: undefined, retryable: false, failure: unknown().failure };
    const parsed = QianchuanUploadResultSchema.parse(result);
    return parsed.state === "WAITING_UPLOAD_COMPLETE" && this.rowReady.has(parsed.upload_task_id) ? { ...parsed, rowReady: true } : parsed;
  }
  private batchSummary(projectId: string, batch: UploadTaskRecord[]) {
    const first = batch[0]!;
    return { projectId, pageBatchId: first.authorization.pageBatchId, advertiserId: first.authorization.target.advertiserId, adId: first.authorization.target.adId, expectedCount: first.authorization.expectedCount,
      taskIds: batch.map(task => task.result.upload_task_id).sort(), readyCount: batch.filter(task => task.result.upload_outcome === "READY").length, acceptedCount: batch.filter(task => task.result.upload_outcome === "ACCEPTED").length,
      unknownCount: batch.filter(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED").length, notSelectedCount: batch.filter(task => task.result.upload_outcome === "NOT_SELECTED").length };
  }
  private unresolvedAccountTasks(task: UploadTaskRecord, open = this.openTasks()): UploadTaskRecord[] {
    return open.filter(other => other.result.upload_task_id !== task.result.upload_task_id && other.authorization.target.advertiserId === task.authorization.target.advertiserId && other.result.state === "NEEDS_HUMAN" && !other.result.duplicate_of && (other.authorization.pageBatchId !== task.authorization.pageBatchId || this.store.hasMarker(other.result.upload_task_id)));
  }
  private refreshAccountPauses(): void {
    this.pausedAccounts.clear();
    for (const task of this.openTasks()) if (task.result.state === "NEEDS_HUMAN") this.pausedAccounts.add(task.authorization.target.advertiserId);
    this.paused = this.stopFailed || !this.productionBatches && this.pausedAccounts.size > 0;
  }
  private pauseAccount(task: UploadTaskRecord): void {
    const advertiserId = task.authorization.target.advertiserId;
    // Before a trusted production boundary, restored work still needs explicit continuation.
    if (!this.productionBatches) this.paused = true;
    this.pausedAccounts.add(advertiserId);
    for (const id of this.eligible) if (this.store.task(id)?.authorization.target.advertiserId === advertiserId) this.eligible.delete(id);
  }
  private blockedAccountMessage(task: UploadTaskRecord, count: number, blockers = this.unresolvedAccountTasks(task)): string {
    const target = task.authorization.target, name = this.summaries.find(account => account.advertiserId === target.advertiserId)?.productName ?? target.productName ?? target.product;
    const batches = [...new Map(blockers.map(other => [other.authorization.pageBatchId, other.input.project_id])).entries()].map(([batchId, projectId]) => `项目 ${projectId} / 批次 ${batchId}`).join("；");
    return `${name}（账户 ${target.advertiserId}）有 ${count} 条未解决的任务，待上传成片保留在队列中。阻塞来自：${batches}。请核查该账号原上传页面并处理旧任务；重开浏览器不会解除阻塞，结果未知的文件禁止重传。`;
  }
  private pausedMessage(projectId: string, open: UploadTaskRecord[]): string {
    for (const task of open.filter(task => task.input.project_id === projectId && task.result.state === "PENDING" && !task.result.duplicate_of)) {
      const blockers = this.unresolvedAccountTasks(task, open);
      if (blockers.length) return `自动上传已暂停：${this.blockedAccountMessage(task, blockers.length, blockers)}`;
    }
    const advertisers = new Set(open.filter(task => task.input.project_id === projectId).map(task => task.authorization.target.advertiserId));
    const affected = open.filter(task => ["NEEDS_HUMAN", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"].includes(task.result.state) && !task.result.duplicate_of && (this.paused || advertisers.has(task.authorization.target.advertiserId)));
    const count = (state: QianchuanUploadResult["state"]) => affected.filter(task => task.result.state === state).length;
    const summary = affected.length ? `存在 ${affected.length} 条需处理的任务（需人工核查 ${count("NEEDS_HUMAN")} 条、可明确继续 ${count("FAILED_RETRYABLE")} 条、终止失败 ${count("FAILED_TERMINAL")} 条、已停止 ${count("CANCELLED")} 条）。` : "待上传成片保留在队列中。";
    const latest = affected.filter(task => task.result.failure).sort((left, right) => right.result.timestamp.localeCompare(left.result.timestamp))[0]?.result.failure;
    return `本账号自动上传已暂停：${summary}${latest ? `最近失败原因：${latest.message} 下一步：${latest.next_action} ` : ""}${this.paused ? "" : "其他未暂停账号可继续处理本轮成片。"}请核查对应 Chrome；仅提供“安全继续”的未选文件任务可明确继续，终止失败任务不能继续；结果未知的文件禁止重传。`;
  }
  private changed(): void { this.dependencies.changed?.(); }
  async restoreConfig(): Promise<void> {
    const savedPath = this.store.config.accountConfigPath;
    try {
      const summaries = this.accounts instanceof QianchuanAccountSettings ? await this.accounts.restore(savedPath, this.guardEgressChange) : savedPath ? await this.accounts.authorizeFile(savedPath) : [];
      if (summaries.length && this.accounts instanceof QianchuanAccountSettings && savedPath !== this.accounts.file) await this.store.setConfig({ ...this.store.config, accountConfigPath: this.accounts.file });
      this.summaries = summaries; this.initializationFailure = undefined;
    } catch { this.summaries = []; this.initializationFailure = "账号设置不可用，请检查已保存的配置。"; }
    this.preloadPlans();
  }
  /** Only the trusted main-process file dialog may call this with a path. */
  private guardEgressChange = (advertiserIds: string[]): void => {
    if (this.stopFailed || this.store.unavailable || this.active || this.runner || this.stopping || this.pendingAdmissions || this.beginningProduction || this.browserPreparations || this.preparingContinuation) throw new Error("制作或上传控制尚未空闲，不能更改固定出口。");
    const protectedTasks = this.store.tasks().some(task => advertiserIds.includes(task.authorization.target.advertiserId) && !this.store.isClosed(task.authorization.pageBatchId) && task.result.state !== "DISCARDED");
    const preparing = this.store.intents().some(intent => advertiserIds.includes(intent.authorization.target.advertiserId) && this.currentIntents.has(intentKey(intent)) && !this.cancelledIntents.has(intentKey(intent)));
    if (protectedTasks || preparing) throw new Error("该账号有待处理、待确认或结果未知的批次，不能更改固定出口。请先核查并明确结束原批次。");
  };
  async chooseConfig(file: string): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后设置账号。");
    if (this.retargeting) throw new Error("正在改传本批计划，请等待记录保存。");
    this.managingBrowser = true;
    try {
      await this.stopPlanPreload();
      const summary = this.accounts instanceof QianchuanAccountSettings ? await this.accounts.authorizeFile(file, this.guardEgressChange) : await this.accounts.authorizeFile(file);
      await this.store.setConfig({ ...this.store.config, accountConfigPath: this.accounts instanceof QianchuanAccountSettings ? this.accounts.file : file });
      this.summaries = summary; this.initializationFailure = undefined;
    } finally { this.managingBrowser = false; this.changed(); }
    if (this.accounts instanceof QianchuanAccountSettings) this.preloadPlans();
  }
  async saveAccount(input: unknown): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后设置账号。");
    if (this.retargeting) throw new Error("正在改传本批计划，请等待记录保存。");
    if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号来源不支持软件内设置。");
    this.managingBrowser = true;
    try {
      await this.stopPlanPreload();
      const summaries = await this.accounts.savePlan(input, this.guardEgressChange);
      await this.store.setConfig({ ...this.store.config, accountConfigPath: this.accounts.file });
      this.summaries = summaries; this.initializationFailure = undefined;
    } finally { this.managingBrowser = false; this.changed(); }
    this.preloadPlans();
  }
  private preloadPlans(): void {
    this.planPreloadController?.abort();
    const controller = new AbortController(), accounts = this.summaries.filter(account => account.available);
    this.planPreloadController = controller;
    this.planPreload = this.planPreload.then(async () => {
      if (controller.signal.aborted || this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy || this.store.unavailable || this.stopFailed) return;
      await Promise.all(accounts.map(account => this.catalogPlans(account.product, account.advertiserId, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])).catch(() => undefined)));
    });
  }
  private async stopPlanPreload(signal?: AbortSignal): Promise<void> {
    this.planPreloadController?.abort();
    await this.bounded(() => this.planPreload, 15000, signal ?? new AbortController().signal);
  }
  private excludedPlanTargets(): ReadonlySet<string> {
    return new Set(this.store.tasks().flatMap(task => {
      const targetId = this.store.fence(task.result.upload_task_id)?.pageOwnership.targetId;
      return targetId ? [targetId] : [];
    }));
  }
  private async catalogPlans(product: QianchuanProduct, advertiserId: string, signal: AbortSignal, refresh = false, currentBrowser = false, onAccount?: (account: QianchuanCurrentAccount) => void): Promise<QianchuanPlanOption[]> {
    this.browserPreparations++;
    try {
      signal.throwIfAborted();
      const configured = await this.accounts.preflight(product);
      signal.throwIfAborted();
      if (configured.advertiserId !== advertiserId) throw new Error("广告账户已变化，请重新选择账号。");
      if (currentBrowser) {
        if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号来源不支持读取网页子账户，请在简辑中保存账号设置。");
        const before = await this.accounts.prepareCurrentCatalog(product, signal, this.excludedPlanTargets());
        if (before.configured.advertiserId !== advertiserId) throw new Error("广告账户已变化，请重新选择账号。");
        const plans = await this.planReads.catalog(before.target, signal, refresh);
        const after = await this.accounts.prepareCurrentCatalog(product, signal, this.excludedPlanTargets());
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("网页子账户或账号连接已变化，请重新读取计划。");
        signal.throwIfAborted();
        onAccount?.(after.account);
        return plans.map(plan => ({ ...plan, accountSource: "current-browser" }));
      }
      const cached = !refresh ? this.planReads.cached(configured) : undefined;
      if (cached) return cached;
      const target = await this.accounts.prepareCatalog(product);
      signal.throwIfAborted();
      if (target.advertiserId !== advertiserId) throw new Error("广告账户已变化，请重新选择账号。");
      const plans = await this.planReads.catalog(target, signal, refresh);
      signal.throwIfAborted();
      const current = await this.accounts.freeze(target.product, target.configDigest);
      signal.throwIfAborted();
      if (current.advertiserId !== target.advertiserId || current.cdpEndpoint !== target.cdpEndpoint) throw new Error("账号连接已变化，请重新读取计划。");
      return plans;
    } finally { this.browserPreparations--; }
  }
  async listPlans(input: unknown, senderId = 0): Promise<QianchuanPlanListResult> {
    const parsed = QianchuanPlanListRequestSchema.parse(input);
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后读取计划。");
    const key = parsed.requestId ? `${senderId}:${parsed.requestId}` : undefined;
    if (key && this.planRequests.has(key)) throw new Error("计划读取请求已存在。");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    if (key) this.planRequests.set(key, controller);
    try {
      if (parsed.accountSource === "current-browser") await this.stopPlanPreload(signal);
      let account: QianchuanCurrentAccount | undefined;
      const plans = await this.catalogPlans(parsed.product, parsed.expectedAdvertiserId, signal, parsed.refresh, parsed.accountSource === "current-browser", value => { account = value; });
      return parsed.includeAccount ? QianchuanPlanCatalogSchema.parse({ account, plans }) : plans;
    } finally { if (key) this.planRequests.delete(key); }
  }
  cancelPlanRead(input: unknown, senderId = 0): void {
    const { requestId } = QianchuanPlanCancelSchema.parse(input);
    this.planRequests.get(`${senderId}:${requestId}`)?.abort();
  }
  private readPlans(target: FrozenQianchuanAccount, signal?: AbortSignal): Promise<QianchuanPlanOption[]> { return this.planReads.request(target, signal); }
  private selectedTarget(target: FrozenQianchuanAccount, selection: QianchuanUploadSelection): FrozenQianchuanAccount {
    if (!selection.plan) return target;
    if (selection.plan.advertiserId !== target.advertiserId) throw new Error("所选计划不属于当前广告账户，请重新选择。");
    return Object.freeze({ ...target, adId: selection.plan.adId });
  }
  /** Focus refresh reads local display metadata only, without loading plans or touching tasks. */
  refreshAccountNames(): Promise<void> {
    if (this.refreshingProfileNames) return this.refreshingProfileNames;
    if (!(this.accounts instanceof QianchuanAccountSettings) || !this.summaries.length) return Promise.resolve();
    const current = this.summaries;
    const pending = this.accounts.withProfileNames(current).then(next => {
      if (this.summaries !== current || JSON.stringify(next) === JSON.stringify(current)) return;
      this.summaries = next; this.changed();
    }).finally(() => { if (this.refreshingProfileNames === pending) this.refreshingProfileNames = undefined; });
    this.refreshingProfileNames = pending;
    return pending;
  }
  async refreshAccounts(): Promise<void> {
    if (this.managingBrowser || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后刷新账号。");
    try { this.summaries = await this.accounts.refresh(); this.initializationFailure = undefined; }
    catch { this.summaries = []; this.initializationFailure = "账号配置不可用，请检查文件权限和映射。"; }
    this.changed();
    this.preloadPlans();
  }
  async openAccountBrowser(input: unknown): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy || this.stopFailed || this.store.unavailable) throw new Error("账号浏览器操作正在进行或状态不可用，请稍后重试。");
    if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号设置不支持打开浏览器。");
    this.browserPreparations++;
    try { await this.accounts.openBrowser(input); } finally { this.browserPreparations--; }
    this.preloadPlans();
  }
  async controlAccountBrowser(input: unknown): Promise<void> {
    const parsed = QianchuanBrowserControlSchema.parse(input);
    await this.stopPlanPreload();
    if (this.busy || this.stopFailed || this.store.unavailable) throw new Error("制作、上传或账号操作仍在运行或状态不可用，未关闭浏览器。");
    if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号设置不支持管理浏览器。");
    this.managingBrowser = true;
    try {
      await this.control.catch(() => undefined);
      await this.accounts.controlBrowser(parsed, (advertiserId, browser) => {
        if (this.stopFailed || this.store.unavailable || this.active || this.runner || this.stopping || this.pendingAdmissions || this.beginningProduction) throw new Error("上传控制已变化，未关闭浏览器。");
        if (parsed.action === "reconnect-egress") return;
        // A legacy draft may belong to another advertiser in this same process.
        const sharesBrowser = (target: UploadAuthorization["target"]) => target.advertiserId === advertiserId || browser &&
          (!browser.endpoint || new URL(browser.endpoint).host === new URL(target.cdpEndpoint).host);
        const protectedTasks = this.store.tasks().filter(task => sharesBrowser(task.authorization.target) && !this.store.isClosed(task.authorization.pageBatchId) && task.result.state !== "DISCARDED" &&
          (this.store.hasMarker(task.result.upload_task_id) || task.result.upload_outcome !== "NOT_SELECTED" || this.eligible.has(task.result.upload_task_id)));
        const preparing = this.store.intents().some(intent => sharesBrowser(intent.authorization.target) && this.currentIntents.has(intentKey(intent)) && !this.cancelledIntents.has(intentKey(intent)) && !this.store.tasks().some(task => intentKey(task.input) === intentKey(intent)));
        if (protectedTasks.length || preparing) throw new Error("该账号仍有制作中、待上传、待确认或结果未知的任务，未关闭浏览器。请先核查原上传页面并明确结束对应本地批次；上传记录和防重传屏障会保留。");
      });
      this.planReads.invalidate(parsed.product);
      if (parsed.action === "restart") this.preloadPlans();
    } finally { this.managingBrowser = false; this.changed(); }
  }
  async clearVideoLibraries(input: unknown, signal?: AbortSignal): Promise<QianchuanLibraryResult[]> {
    if (this.automationBrowsers.busy) throw new Error("VPS 自动化账号尚未完成，请稍后清理。");
    return this.clearVideoLibrariesOwned(input, signal);
  }
  async clearAutomationVideoLibraries(input: unknown, signal: AbortSignal): Promise<QianchuanLibraryResult[]> {
    const parsed = QianchuanLibraryClearSchema.parse(input), results: QianchuanLibraryResult[] = [];
    await this.stopPlanPreload(signal);
    if (this.busy || this.stopFailed || this.store.unavailable) throw new Error("账号操作仍在运行或状态不可用，未开始定时清理。");
    const targets = await Promise.all(parsed.accounts.map(async account => {
      const target = await this.automationAccount(account.product);
      if (target.advertiserId !== account.expectedAdvertiserId) throw new Error("定时清理账号已变化。");
      return target;
    }));
    const generation = this.controlGeneration;
    this.automationBrowserGeneration = generation;
    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]!;
        await this.automationBrowsers.prepare(target, signal);
        if (generation !== this.controlGeneration) throw new Error("上传控制已变化，定时清理已停止。");
        const result = await this.clearVideoLibrariesOwned({ ...parsed, accounts: [parsed.accounts[index]!] }, signal, true);
        results.push(...result);
        // Failed/unknown deletion keeps the original window and stops later accounts.
        if (result.length !== 1 || result[0].state !== "CLEARED") break;
        await this.automationBrowsers.finish(target, signal);
      }
      return results;
    } finally { this.automationBrowsers.release(); this.changed(); }
  }
  private async clearVideoLibrariesOwned(input: unknown, signal?: AbortSignal, automatic = false): Promise<QianchuanLibraryResult[]> {
    const parsed = QianchuanLibraryClearSchema.parse(input);
    return this.withCleanupOperation(parsed, async (targets, guard, connect, signal) => {
      const library = new QianchuanVideoLibrary(this.store.root);
      const materials = new QianchuanPlanMaterials(this.store.root);
      return Promise.all(targets.map(async (target): Promise<QianchuanLibraryResult> => {
        try {
          await guard(); const connected = await connect(target);
          const selection = parsed.accounts.find(account => account.product === target.product)!;
          return clearQianchuanAccountPlans(connected, selection, parsed.confirmation, {
            guard, signal, readPlans: (account, signal) => this.readPlans(account, signal),
            clearPlan: (account, fresh, signal) => materials.clear(account, fresh, signal, parsed.planMaterialRule),
            clearLibrary: (account, fresh, signal) => library.clear(account, fresh, signal),
          });
        }
        catch (error) { return { product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: error instanceof Error ? error.message : "该账号浏览器或绑定不可用，未开始删除，请核查原账号窗口。" }; }
      }));
    }, signal, automatic);
  }
  async resolvePlanMaterialDeletion(input: unknown): Promise<void> {
    const request = QianchuanPlanRecoverySchema.parse(input);
    const scope: QianchuanLibraryClear = { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: request.product, expectedAdvertiserId: request.advertiserId,
      plans: [{ advertiserId: request.advertiserId, adId: request.adId, name: `计划 ${request.adId}` }] }] };
    await this.withCleanupOperation(scope, async (targets, guard) => {
      await new QianchuanPlanMaterialRecovery(path.join(this.store.root, "plan-material-deletions"), targets[0]).resolve(request, guard);
    });
  }
  private async withCleanupOperation<T>(parsed: QianchuanLibraryClear, action: (targets: FrozenQianchuanAccount[], guard: () => Promise<void>, connect: (target: FrozenQianchuanAccount) => Promise<FrozenQianchuanAccount>, signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal, automatic = false): Promise<T> {
    parentSignal?.throwIfAborted();
    await this.stopPlanPreload();
    if (this.hasNonAutomationWork() || this.automationUploadActive || !automatic && this.automationBrowsers.busy || this.stopFailed || this.store.unavailable) throw new Error("制作、上传或账号操作仍在运行或状态不可用，未删除视频。");
    if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号设置不支持视频库删除。");
    this.managingBrowser = true;
    let completed!: () => void;
    const operation = { controller: new AbortController(), done: new Promise<void>(resolve => { completed = resolve; }) };
    this.libraryOperation = operation;
    const cancel = () => operation.controller.abort();
    parentSignal?.addEventListener("abort", cancel, { once: true });
    if (parentSignal?.aborted) cancel();
    const generation = this.controlGeneration;
    try {
      await this.control.catch(() => undefined);
      return await this.accounts.withVideoLibraryTargets(parsed, async (targets, fresh, connect) => {
        const check = () => {
          operation.controller.signal.throwIfAborted();
          if (generation !== this.controlGeneration || this.stopFailed || this.store.unavailable || this.active || this.runner || this.stopping || this.pendingAdmissions || this.beginningProduction) throw new Error("上传控制已变化，已停止删除视频。");
        };
        const guard = async () => {
          check();
          await fresh();
          check();
        };
        return action(targets, guard, connect, operation.controller.signal);
      });
    } finally { parentSignal?.removeEventListener("abort", cancel); this.libraryOperation = undefined; this.managingBrowser = false; completed(); this.changed(); }
  }
  async configure(input: unknown): Promise<void> {
    if (this.managingBrowser || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后修改上传设置。");
    if (this.retargeting) throw new Error("正在改传本批计划，请等待记录保存。");
    const publicSettings = QianchuanUploadConfigSchema.omit({ accountConfigPath: true }).parse(input);
    if (!publicSettings.enabled) await this.stop();
    const config = QianchuanUploadConfigSchema.parse({ ...publicSettings, accountConfigPath: this.store.config.accountConfigPath });
    if (config.accountConfigPath) this.summaries = await this.accounts.refresh();
    await this.store.setConfig(config); if (config.enabled) this.stopped = false;
    this.changed();
    if (config.enabled && this.accounts instanceof QianchuanAccountSettings) this.preloadPlans();
  }
  /** Hold browser protection through the export handoff, not only its preflight. */
  async withExportAdmission<T>(action: () => Promise<T>): Promise<T> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) throw new Error("账号浏览器操作正在进行，请稍后开始制作。");
    this.browserPreparations++;
    try { return await action(); }
    finally { this.browserPreparations--; }
  }
  async preflight(selection: QianchuanUploadSelection | undefined, expectedCount: number): Promise<UploadAuthorization | undefined> {
    if (!selection) return undefined;
    if ((this.automationUploadActive || this.automationBrowsers.busy) && !this.preparingAutomationUpload) throw new Error("定时上传正在运行，不能并发接收其他上传批次。");
    if (this.managingBrowser) throw new Error("账号浏览器操作正在进行，请稍后开始制作。");
    this.browserPreparations++;
    let ordinaryTarget: FrozenQianchuanAccount | undefined;
    try {
      if (this.stopFailed) throw new Error("旧上传操作未能安全停止，请先关闭应用并核查 Chrome。");
      if (this.beginningProduction) throw new Error("正在切换本次制作范围，请等待上传控制停止。");
      const parsed = QianchuanUploadSelectionSchema.parse(selection);
      if (!this.store.config.enabled || this.store.unavailable) throw new Error("请先启用千川上传并授权账号配置。");
      if (this.dependencies.readiness?.(this.store.config)) throw new Error(this.dependencies.readiness(this.store.config));
      const generation = this.controlGeneration;
      if (!this.automationUploadActive) {
        const configured = await this.automationAccount(parsed.accountProduct);
        if (configured.egress?.mode === "remote-browser") {
          await this.stopPlanPreload();
          this.ordinaryBrowserController = new AbortController();
          this.automationBrowserGeneration = generation;
          await this.withOrdinaryBrowserControl(() => this.automationBrowsers.prepare(configured, this.ordinaryBrowserController!.signal));
          ordinaryTarget = configured;
        }
      }
      const browserSelection = parsed.plan?.accountSource === "current-browser" && !this.automationUploadActive;
      if (browserSelection && !(this.accounts instanceof QianchuanAccountSettings)) throw new Error("当前账号来源不支持网页子账户，请重新设置账号。");
      const browserTarget = browserSelection ? await (this.accounts as QianchuanAccountSettings).prepareCurrentCatalog(parsed.accountProduct, undefined, this.excludedPlanTargets()) : undefined;
      const prepared = browserTarget?.target ?? await this.accounts.prepare(parsed.accountProduct);
      const target = this.selectedTarget(prepared, parsed);
      if (parsed.plan) {
        const plans = await this.readPlans(prepared);
        if (!plans.some(plan => plan.adId === target.adId)) throw new Error("所选计划已失效，请刷新计划列表后重新选择。");
        if (browserTarget) {
          const current = await (this.accounts as QianchuanAccountSettings).prepareCurrentCatalog(prepared.product, undefined, this.excludedPlanTargets());
          if (JSON.stringify(current) !== JSON.stringify(browserTarget)) throw new Error("网页子账户或账号连接已变化，请重新选择计划。");
        } else {
          const current = await this.accounts.freeze(prepared.product, prepared.configDigest);
          if (current.advertiserId !== prepared.advertiserId || current.cdpEndpoint !== prepared.cdpEndpoint) throw new Error("账号连接已变化，请重新选择计划。");
        }
      }
      if (generation !== this.controlGeneration || this.stopping || !this.store.config.enabled) throw new Error("上传控制已变化，请重新开始本次制作。");
      const authorization = UploadAuthorizationSchema.parse({ target, pageBatchId: randomUUID(), expectedCount });
      if (browserTarget) this.selectedAccountTargets.remember(authorization, browserTarget.configured);
      this.productionBatches?.add(authorization.pageBatchId);
      return authorization;
    } finally {
      try {
        if (ordinaryTarget) await this.withOrdinaryBrowserControl(() => this.automationBrowsers.finish(ordinaryTarget!, this.ordinaryBrowserController!.signal));
      } catch (error) { this.automationBrowsers.release(); throw error; }
      finally { if (!this.automationUploadActive) this.ordinaryBrowserController = undefined; this.browserPreparations--; }
    }
  }
  async registerBatch(batch: ExportBatchIdentity, selection?: QianchuanUploadSelection, authorization?: UploadAuthorization): Promise<void> {
    if (!selection || authorization && !this.inProduction(authorization.pageBatchId)) return;
    const generation = this.controlGeneration;
    try { await this.registerBatches([batch], selection, authorization); }
    catch { if (generation === this.controlGeneration) { this.initializationFailure = "上传初始化失败或账号配置已变化；导出继续，未保存授权的任务不会上传。"; this.changed(); } }
  }
  /** Atomically admit all approved versions; callers can keep exports queued on failure. */
  async registerBatches(batches: ExportBatchIdentity[], selection: QianchuanUploadSelection, authorization?: UploadAuthorization): Promise<void> {
    const generation = this.controlGeneration;
    const parsed = QianchuanUploadSelectionSchema.parse(selection);
    if (!batches.length || batches.some(batch => !batch.projectId || batch.projectId !== batches[0].projectId) || !authorization || !this.inProduction(authorization.pageBatchId) || parsed.accountProduct !== authorization.target.product) throw new Error("Missing main-process preflight");
    const configured = await this.accounts.freeze(parsed.accountProduct, authorization.target.configDigest);
    const target = (!this.automationUploadActive ? this.selectedAccountTargets.resolve(authorization, parsed, configured) : undefined) ?? this.selectedTarget(configured, parsed);
    if (JSON.stringify(target) !== JSON.stringify(authorization.target)) throw new Error("Changed account mapping");
    const intents = batches.flatMap(batch => batch.tasks.map(task => ({ ...UploadIdentitySchema.parse({ project_id: batch.projectId, batch_id: batch.id, export_task_id: task.id }), selection: parsed, authorization, config: this.store.config })));
    if (!intents.length || new Set(intents.map(intentKey)).size !== intents.length) throw new Error("Duplicate upload identities");
    const already = this.store.intents().filter(intent => intent.authorization.pageBatchId === authorization.pageBatchId);
    const newIntents = intents.filter(intent => !already.some(old => intentKey(old) === intentKey(intent)));
    if (already.length + newIntents.length > authorization.expectedCount) throw new Error("Batch count changed");
    if (generation !== this.controlGeneration || this.stopping || !this.store.config.enabled) throw new Error("上传控制已变化，请重新确认。");
    await this.store.saveIntents(intents);
    if (generation !== this.controlGeneration || this.stopping || !this.store.config.enabled) throw new Error("上传控制已变化，已登记记录保留，请在作品页核查。");
    if (generation === this.controlGeneration && !this.stopping && this.store.config.enabled) {
      this.stopped = false;
      for (const intent of intents) this.currentIntents.add(intentKey(intent));
      if (!this.automationUploadActive && newIntents.length && this.productionBatches?.has(authorization.pageBatchId)) this.automaticConfirmationBatches.add(authorization.pageBatchId);
    }
  }
  async committed(identity: UploadIdentity): Promise<void> {
    const generation = this.controlGeneration;
    try { await this.enqueueFinalArtifact(identity); if (!this.stopping && !this.stopped) void this.runPending().catch(() => this.changed()); }
    catch (error) { if (generation === this.controlGeneration) { this.initializationFailure = error instanceof UploadError ? error.failure.message : "成片上传准入失败；导出结果保持完成。"; this.changed(); } }
  }
  async finishAutomationAccount(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<void> {
    await this.stopPlanPreload(signal);
    await this.automationBrowsers.finish(target, signal);
    this.changed();
  }
  releaseAutomationBrowsers(): void { this.automationBrowsers.release(); this.changed(); }
  private async withOrdinaryBrowserControl<T>(operation: () => Promise<T>): Promise<T> {
    this.ordinaryBrowserControl = true;
    try { return await operation(); } finally { this.ordinaryBrowserControl = false; }
  }
  private async completeUploadBatch(authorization: UploadAuthorization, generation: number, signal: AbortSignal): Promise<void> {
    const tasks = this.store.tasks().filter(task => task.authorization.pageBatchId === authorization.pageBatchId)
      .sort((left, right) => (this.store.fence(left.result.upload_task_id)?.selectedIndex ?? Number.MAX_SAFE_INTEGER) - (this.store.fence(right.result.upload_task_id)?.selectedIndex ?? Number.MAX_SAFE_INTEGER));
    if (tasks.length === authorization.expectedCount && tasks.every(task => task.result.duplicate_of && task.result.state === "ACCEPTED" && task.result.acceptedEvidence)) return;
    if (tasks.length !== authorization.expectedCount || tasks.some(task => task.result.state !== "WAITING_FOR_CONFIRMATION" || task.result.upload_outcome !== "READY" || !task.result.readyEvidence)) {
      const failure = tasks.find(task => task.result.failure)?.result.failure;
      throw failure ? new UploadError(failure) : new Error("上传批次未全部达到 READY，未自动确认。");
    }
    const first = tasks[0]!, port = this.sessions.get(authorization.pageBatchId), ownership = this.store.fence(first.result.upload_task_id)?.pageOwnership;
    if (!port?.confirmAutomation || !ownership || authorization.target.egress?.mode === "remote-browser" && !port.closeAcceptedAutomationPage) throw new Error("原上传页面或自动确认能力不可用，未自动确认。");
    const controller = new AbortController(), ids = tasks.map(task => task.result.upload_task_id);
    const guard = () => {
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      if (generation !== this.controlGeneration || this.stopFailed || this.stopping || this.stopped || this.store.unavailable || !this.store.config.enabled) throw new Error("上传控制已变化，自动确认已停止。");
    };
    guard(); this.active = { ids, controller, port };
    try {
      await this.bounded(inner => confirmReadyUpload(tasks, inner, {
        store: this.store, port,
        saveReady: (records, evidence, actionSignal) => this.saveReady(records, evidence, actionSignal),
        saveUnknown: async records => { guard(); await this.save(records); this.pausedAccounts.add(first.authorization.target.advertiserId); guard(); },
        accepted: () => {
          if (!this.openTasks().some(task => task.authorization.target.advertiserId === first.authorization.target.advertiserId &&
            ["NEEDS_HUMAN", "FAILED_RETRYABLE"].includes(task.result.state))) this.pausedAccounts.delete(first.authorization.target.advertiserId);
          this.changed();
        },
      }), Math.max(first.config.timeouts.processing, first.config.timeouts.confirmation), AbortSignal.any([signal, controller.signal]));
      guard();
    } catch (error) { throw tasks.some(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED") ? unknown(error instanceof UploadError ? error : undefined) : error; }
    finally { if (this.active?.controller === controller) this.active = undefined; }
    if (authorization.target.egress?.mode === "remote-browser") {
      const closeGuard = () => {
        guard();
        if (ids.some(id => {
          const result = this.store.task(id)?.result;
          return result?.state !== "ACCEPTED" || result.upload_outcome !== "ACCEPTED" || !result.acceptedEvidence ||
            JSON.stringify(result.acceptedEvidence.pageOwnership) !== JSON.stringify(ownership);
        })) throw new Error("已接收上传页的关闭资格已变化，未继续自动化。");
      };
      closeGuard();
      await this.bounded(inner => port.closeAcceptedAutomationPage!(ids.map(id => this.store.task(id)!), ownership, inner, closeGuard), 15000, signal);
      closeGuard(); await this.bounded(() => port.stop(), 5000, signal);
      this.sessions.delete(authorization.pageBatchId);
    }
  }
  private async prepareOrdinaryUpload(task: UploadTaskRecord): Promise<void> {
    if (this.automationUploadActive || !this.automaticConfirmationBatches.has(task.authorization.pageBatchId) || task.authorization.target.egress?.mode !== "remote-browser") return;
    if (this.ordinaryRemoteAccount) {
      if (!this.sameAutomationBinding(this.ordinaryRemoteAccount, task.authorization.target)) throw new Error("当前账号尚未完成，未切换上传账号。");
      return;
    }
    this.ordinaryBrowserController = new AbortController();
    const signal = this.ordinaryBrowserController.signal, generation = this.controlGeneration;
    await this.stopPlanPreload(signal);
    const target = await this.automationAccount(task.authorization.target.product);
    if (!this.sameAutomationBinding(target, task.authorization.target)) throw new Error("本轮冻结账号或出口已变化，未打开上传浏览器。");
    this.automationBrowserGeneration = generation;
    await this.withOrdinaryBrowserControl(() => this.automationBrowsers.prepare(target, signal));
    const prepared = await this.accounts.prepare(target.product);
    signal.throwIfAborted();
    if (generation !== this.controlGeneration || !this.sameAutomationBinding(prepared, task.authorization.target) || prepared.cdpEndpoint !== task.authorization.target.cdpEndpoint) throw new Error("账号连接已变化，未继续原上传批次。");
    this.ordinaryRemoteAccount = target;
  }
  private async completeOrdinaryUpload(pageBatchId: string): Promise<void> {
    if (this.automationUploadActive || this.continuationBatch || !this.productionBatches?.has(pageBatchId) || !this.automaticConfirmationBatches.has(pageBatchId)) return;
    const tasks = this.store.tasks().filter(task => task.authorization.pageBatchId === pageBatchId), first = tasks[0];
    if (!first || tasks.length !== first.authorization.expectedCount || tasks.some(task => task.result.state !== "WAITING_FOR_CONFIRMATION" && task.result.state !== "ACCEPTED")) return;
    this.automaticConfirmationBatches.delete(pageBatchId);
    await this.completeUploadBatch(first.authorization, this.controlGeneration, this.ordinaryBrowserController?.signal ?? new AbortController().signal);
    if (this.ordinaryRemoteAccount) {
      const target = this.ordinaryRemoteAccount;
      if (this.openTasks().some(task => task.authorization.target.advertiserId === target.advertiserId && this.store.hasMarker(task.result.upload_task_id) && task.result.state !== "ACCEPTED")) return;
      await this.withOrdinaryBrowserControl(() => this.automationBrowsers.finish(target, this.ordinaryBrowserController!.signal));
      this.ordinaryRemoteAccount = undefined; this.ordinaryBrowserController = undefined;
    }
  }
  async uploadAutomation(groups: { selection: QianchuanUploadSelection; target: FrozenQianchuanAccount; exports: UploadIdentity[] }[], signal: AbortSignal, retainBrowser = false): Promise<void> {
    signal.throwIfAborted();
    if (!groups.length || this.store.unavailable || !this.store.config.enabled || this.automationUploadActive) throw new Error("上传服务忙碌或不可用，定时成片未登记。");
    this.automationUploadActive = true;
    let abortStop: Promise<boolean> | undefined;
    const cancel = () => { abortStop ??= this.stop(); };
    signal.addEventListener("abort", cancel, { once: true });
    let admitted = false;
    const failures: Error[] = [];
    try {
      // Account restore starts a cancellable plan-directory preload. Drain that
      // owned work before deciding whether unrelated browser work is still busy.
      await this.stopPlanPreload(signal);
      signal.throwIfAborted();
      if (this.hasNonAutomationWork() || this.store.unavailable || !this.store.config.enabled) throw new Error("上传服务忙碌或不可用，定时成片未登记。");
      const prepared = groups.map(group => ({
        selection: QianchuanUploadSelectionSchema.parse(group.selection),
        target: FrozenAccountSchema.parse(group.target),
        exports: group.exports.map(value => UploadIdentitySchema.parse(value)),
      }));
      const identities = prepared.flatMap(group => group.exports), identityKeys = identities.map(intentKey);
      if (!identities.length || new Set(identityKeys).size !== identityKeys.length ||
        new Set(prepared.map(group => group.exports[0]?.project_id)).size !== prepared.length ||
        prepared.some(group => group.target.product !== group.selection.accountProduct || !group.selection.plan || !group.exports.length || group.exports.length > 250 ||
          new Set(group.exports.map(value => value.project_id)).size !== 1) ||
        identities.some(identity => this.store.intents().some(intent => intentKey(intent) === intentKey(identity)) || this.store.tasks().some(task => intentKey(task.input) === intentKey(identity)))) {
        throw new Error("定时上传来源、账号或计划不唯一，或该成片已处理；不会复用历史上传记录。");
      }
      for (const group of prepared) {
        const current = await this.automationAccount(group.selection.accountProduct);
        if (!this.sameAutomationConfiguration(current, group.target)) throw new Error("定时上传绑定的账户、连接或固定出口已变化，请重新保存任务。");
      }
      signal.throwIfAborted();
      this.preparingAutomationUpload = true;
      await this.beginProduction();
      this.preparingAutomationUpload = false;
      signal.throwIfAborted();
      const generation = this.controlGeneration;
      this.automationBrowserGeneration = generation;
      const accountGroups = [...new Set(prepared.map(group => group.target.advertiserId))].map(id => prepared.filter(group => group.target.advertiserId === id));
      for (const accountPrepared of accountGroups) {
        const authorizations: UploadAuthorization[] = [];
        await this.automationBrowsers.prepare(accountPrepared[0]!.target, signal);
        if (generation !== this.controlGeneration) throw new Error("上传控制已变化，定时上传已停止。");
        for (const group of accountPrepared) {
          signal.throwIfAborted();
          this.preparingAutomationUpload = true;
          let authorization: UploadAuthorization | undefined;
          try { authorization = await this.preflight(group.selection, group.exports.length); }
          finally { this.preparingAutomationUpload = false; }
          if (!authorization || !this.sameAutomationBinding(authorization.target, group.target) ||
            authorization.target.adId !== (group.selection.plan!.adId)) {
            throw new Error("千川账号或计划与定时任务冻结值不一致，未登记成片。");
          }
          const byBatch = new Map<string, UploadIdentity[]>();
          for (const identity of group.exports) {
            const batch = byBatch.get(identity.batch_id) ?? []; batch.push(identity); byBatch.set(identity.batch_id, batch);
          }
          const batches = [...byBatch].map(([id, batchExports]) => ({ id, projectId: batchExports[0]!.project_id, tasks: batchExports.map(value => ({ id: value.export_task_id })) }));
          await this.registerBatches(batches, group.selection, authorization);
          admitted = true; authorizations.push(authorization);
        }
        for (let index = 0; index < accountPrepared.length; index++) {
          const group = accountPrepared[index]!, authorization = authorizations[index]!;
          for (const identity of group.exports) {
            signal.throwIfAborted(); await this.committed(identity);
            if (!this.store.tasks().some(task => intentKey(task.input) === intentKey(identity) && task.authorization.pageBatchId === authorization.pageBatchId)) {
              throw new Error("定时上传成片未通过原队列的正式成片验证。");
            }
          }
        }
        await this.runPending(); signal.throwIfAborted();
        for (let index = 0; index < accountPrepared.length; index++) {
          const authorization = authorizations[index]!;
          try { await this.completeUploadBatch(authorization, generation, signal); }
          catch (error) { failures.push(error instanceof Error ? error : unknown()); }
        }
        if (failures.length) throw failures.find(error => error instanceof UploadError) ?? failures[0]!;
        if (!retainBrowser || accountGroups.length > 1) await this.automationBrowsers.finish(accountPrepared[0]!.target, signal);
      }
    } catch (error) {
      this.automationBrowsers.release();
      if (signal.aborted) cancel();
      if (admitted && !this.stopped) {
        abortStop ??= this.stop(); await abortStop;
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted && abortStop) await abortStop;
      this.automationUploadActive = false; this.preparingAutomationUpload = false; this.changed();
    }
  }
  private sameAutomationConfiguration(left: FrozenQianchuanAccount, right: FrozenQianchuanAccount): boolean {
    return left.product === right.product && left.advertiserId === right.advertiserId && left.configDigest === right.configDigest &&
      left.cdpEndpoint === right.cdpEndpoint && egressIdentity(left.egress) === egressIdentity(right.egress);
  }
  private sameAutomationBinding(left: FrozenQianchuanAccount, right: FrozenQianchuanAccount): boolean {
    return left.product === right.product && left.advertiserId === right.advertiserId && left.configDigest === right.configDigest &&
      egressIdentity(left.egress) === egressIdentity(right.egress);
  }
  enqueueFinalArtifact(identity: UploadIdentity, recovery = false): Promise<UploadTaskRecord | undefined> {
    const generation = this.controlGeneration;
    this.pendingAdmissions++;
    const work = this.admission.catch(() => undefined).then(async () => {
      identity = UploadIdentitySchema.parse(identity);
      const intent = this.store.intents().find(value => intentKey(value) === intentKey(identity)); if (!intent) return undefined;
      if (!this.inProduction(intent.authorization.pageBatchId) || this.store.isClosed(intent.authorization.pageBatchId)) return this.store.tasks().find(task => intentKey(task.input) === intentKey(identity));
      const state = await this.dependencies.loadBatch(identity.batch_id).catch(() => { throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "无法重读正式导出记录。", "检查本机导出记录。", true); });
      const task = state.batch.tasks.find(value => value.id === identity.export_task_id), artifact = task?.outputArtifact;
      if (state.batch.projectId !== identity.project_id || !task || task.status !== "completed" || !artifact || artifact.taskId !== task.id || !task.outputPath || !(await pathsEqual(artifact.path, task.outputPath)) || !isPathWithinDirectory(state.batch.outputDirectory, artifact.path)) throw uploadFailure("EXPORT_NOT_COMMITTED", "input", "仅允许已保存完成的正式成片。", "等待正式导出完成。", false);
      if (path.extname(artifact.path).toLowerCase() !== ".mp4") throw uploadFailure("UNSUPPORTED_FORMAT", "input", "千川上传仅支持 MP4。", "新制作时选择 MP4；不会自动转码。", false);
      const info = await lstat(artifact.path), resolved = await realpath(artifact.path), directory = await realpath(state.batch.outputDirectory);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size !== artifact.sizeBytes || !isPathWithinDirectory(directory, resolved)) throw uploadFailure("ARTIFACT_CHANGED", "input", "成片路径、类型或大小与正式记录不一致。", "核查原文件。", false);
      const hash = (await fingerprintFile(resolved)).replace(/^sha256:/, "");
      const existing = this.store.tasks().find(value => intentKey(value.input) === intentKey(identity));
      if (existing) { if (existing.input.artifact_sha256 !== hash) throw uploadFailure("ARTIFACT_CHANGED", "input", "同一正式任务的视频字节已变化。", "核查原成片，不能重传替换文件。", false); return existing; }
      const input = { ...identity, video_path: resolved, artifact_sha256: hash, size_bytes: info.size }, target = intent.authorization.target;
      const id = uploadTaskId(input, target), snapshots = path.join(this.store.root, "snapshots"); await secureUploadDirectory(snapshots);
      const snapshotDirectory = path.join(snapshots, hash); await secureUploadDirectory(snapshotDirectory);
      const snapshotPath = path.join(snapshotDirectory, path.basename(resolved));
      try { await copyFile(resolved, snapshotPath, constants.COPYFILE_EXCL); await chmod(snapshotPath, 0o400); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const snapshot = await open(snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await snapshot.sync(); } finally { await snapshot.close(); }
      await strictSyncDirectory(snapshotDirectory); await strictSyncDirectory(snapshots);
      const record: UploadTaskRecord = { input, inputDigest: frozenInputDigest(input, intent.authorization), config: intent.config, authorization: intent.authorization, snapshotPath,
        result: { ...identity, upload_task_id: id, artifact_sha256: hash, file_name: path.basename(resolved), accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 0, timestamp: timestamp() } };
      if (this.cancelledIntents.has(intentKey(identity))) record.result.state = "CANCELLED";
      await this.snapshotValid(record); await this.store.saveTask(record);
      if (!recovery && record.result.state === "PENDING" && this.currentIntents.has(intentKey(identity)) && generation === this.controlGeneration && !this.stopping && !this.stopped && (!this.continuationBatch || this.continuationBatch === record.authorization.pageBatchId)) this.eligible.add(id);
      this.changed(); return record;
    });
    const tracked = work.finally(() => { this.pendingAdmissions--; });
    this.admission = tracked; return tracked;
  }
  async reconcile(): Promise<void> {
    for (const intent of this.store.intents()) {
      if (!this.inProduction(intent.authorization.pageBatchId)) continue;
      if (this.store.isClosed(intent.authorization.pageBatchId)) continue;
      if (this.store.tasks().some(value => intentKey(value.input) === intentKey(intent))) continue;
      try { await this.enqueueFinalArtifact(UploadIdentitySchema.parse({ project_id: intent.project_id, batch_id: intent.batch_id, export_task_id: intent.export_task_id }), true); }
      catch (error) { if (!(error instanceof UploadError) || error.failure.code !== "EXPORT_NOT_COMMITTED") this.initializationFailure = "部分已授权任务无法恢复准入，请检查本机记录。"; }
    }
    this.changed();
  }
  private pendingGroup(pageBatchId?: string, held: UploadTaskRecord[] = []): string[] {
    const available = this.openTasks().filter(task => task.result.state === "PENDING" && this.eligible.has(task.result.upload_task_id) && !held.some(other => sameTargetBytes(task, other)) && !this.pausedAccounts.has(task.authorization.target.advertiserId) && (!this.ordinaryRemoteAccount || task.authorization.target.advertiserId === this.ordinaryRemoteAccount.advertiserId) && (!this.continuationBatch || task.authorization.pageBatchId === this.continuationBatch) && (!pageBatchId || task.authorization.pageBatchId === pageBatchId && !this.duplicate(task)));
    const first = available[0]; if (!first) return [];
    const group: UploadTaskRecord[] = [];
    if (this.duplicate(first)) group.push(first);
    else for (const task of available) {
      if (task.authorization.pageBatchId !== first.authorization.pageBatchId || this.duplicate(task) || group.some(other => sameTargetBytes(task, other))) continue;
      group.push(task); if (group.length === MAX_UPLOAD_GROUP_SIZE) break;
    }
    return group.map(task => task.result.upload_task_id);
  }
  private async prepareGroup(ids: string[], start: number, signal: AbortSignal, observe?: () => Promise<void>): Promise<void> {
    const first = this.requireTask(ids[start]!);
    const selectedCount = this.selectedFiles(first).length;
    while (true) {
      signal.throwIfAborted();
      const next = this.pendingGroup(first.authorization.pageBatchId, ids.slice(start).map(id => this.requireTask(id))).slice(0, MAX_UPLOAD_GROUP_SIZE - (ids.length - start));
      ids.push(...next); for (const id of next) this.eligible.delete(id);
      if (selectedCount + ids.length - start !== 10) return;
      // The current platform disables its entrance only at cumulative count 10.
      if (ids.length - start > 1) { this.eligible.add(ids.pop()!); return; }
      if (!this.pendingAdmissions && await uploadBatchSettled(this.store, first, this.cancelledIntents, this.dependencies.loadBatch, signal) && !this.pendingAdmissions) {
        signal.throwIfAborted();
        if (!this.pendingGroup(first.authorization.pageBatchId, ids.slice(start).map(id => this.requireTask(id))).length) return;
        continue;
      }
      await observe?.();
      await delay(500, undefined, { signal });
    }
  }
  runPending(): Promise<void> {
    if (this.stopFailed) return Promise.resolve();
    if (this.runner) return this.runner;
    if (this.managingBrowser || this.active || this.preparingContinuation || this.retargeting || this.discarding || this.closing || this.cancelling || this.stopped || this.stopping || this.paused || !this.store.config.enabled || this.store.unavailable) return Promise.resolve();
    this.runner = (async () => {
      while (!this.stopFailed && !this.cancelling && !this.stopped && !this.stopping && !this.paused && this.store.config.enabled && !this.store.unavailable) {
        const ids = this.pendingGroup(); if (!ids.length) break;
        const first = this.requireTask(ids[0]!);
        await this.prepareOrdinaryUpload(first);
        for (const id of ids) this.eligible.delete(id);
        await this.execute(ids);
        await this.completeOrdinaryUpload(first.authorization.pageBatchId);
        if (!this.automationUploadActive && this.ordinaryRemoteAccount && this.store.tasks().some(task => task.authorization.pageBatchId === first.authorization.pageBatchId && task.result.state === "NEEDS_HUMAN")) {
          throw new Error("当前上传结果需要核查，未继续自动确认或切换账号。");
        }
      }
    })().catch(error => {
      this.paused = true; this.initializationFailure = error instanceof Error ? error.message : "自动上传已停止，请核查原页面。";
      if (!this.automationUploadActive) { this.automationBrowsers.release(); this.ordinaryRemoteAccount = undefined; this.ordinaryBrowserController = undefined; }
      this.changed();
    }).finally(() => { this.runner = undefined; if (this.pendingGroup().length && !this.cancelling && !this.paused && !this.stopped && !this.stopping && !this.store.unavailable) void this.runPending().catch(() => this.changed()); });
    return this.runner;
  }
  requestResume(id: string): Promise<void> {
    return new Promise((resolve, reject) => { void this.resume(id, resolve).then(resolve, error => { reject(error); this.changed(); }); });
  }
  resume(id: string, accepted?: () => void): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) return Promise.reject(new Error("账号浏览器操作正在进行，请稍后继续上传。"));
    if (this.stopFailed) return Promise.reject(new Error("旧上传操作未能安全停止，请先关闭应用并核查 Chrome。"));
    if (this.beginningProduction) return Promise.reject(new Error("正在切换本次制作范围，请等待上传控制停止。"));
    if (this.closing) return Promise.reject(new Error("正在结束本批本地上传，请等待记录保存。"));
    if (this.discarding) return Promise.reject(new Error("正在删除本批上传任务，请等待记录保存。"));
    if (this.retargeting) return Promise.reject(new Error("正在改传本批计划，请等待记录保存。"));
    const generation = this.controlGeneration;
    const requested = this.store.task(id);
    if (requested && this.store.isClosed(requested.authorization.pageBatchId)) return Promise.reject(new Error("本批本地上传已结束，不能恢复。"));
    const work = this.control.catch(() => undefined).then(async () => {
      await this.admission.catch(() => undefined);
      if (this.managingBrowser || this.stopFailed || generation !== this.controlGeneration || this.stopping || this.closing || this.discarding || this.retargeting || this.store.unavailable || !this.store.config.enabled || this.active || this.runner) throw new Error("上传控制已变化、仍在运行或不可用，本次继续未接收。");
      const task = this.requireTask(id);
      if (this.store.isClosed(task.authorization.pageBatchId)) throw new Error("本批本地上传已结束，不能恢复。");
      if (task.result.state === "ACCEPTED") throw new Error("平台已确认接收，本任务不能再次确认或上传。");
      if (task.result.state === "DISCARDED") throw new Error("本批上传任务已删除，不能恢复。");
      if (task.result.duplicate_of || task.result.state === "FAILED_TERMINAL") throw new Error("本任务不能继续；别名及终止记录不授予文件选择权限。");
      const fenced = this.store.hasMarker(id);
      const batch = this.store.tasks().filter(other => other.authorization.pageBatchId === task.authorization.pageBatchId);
      if (fenced) {
        const confirmationLock = automationConfirmationRecoveryLock(task.authorization.pageBatchId);
        if (batch.some(other => other.result.failure?.next_action === confirmationLock) || await hasAutomationConfirmationIntent(this.store.root, task.authorization.pageBatchId)) {
          throw new Error("定时千川确认已进入一次性人工核查屏障；只读恢复也不得重新分类为 READY。请在千川人工核查原批次。");
        }
        const unresolved = batch.filter(other => this.store.hasMarker(other.result.upload_task_id) && other.result.state !== "WAITING_FOR_CONFIRMATION");
        // The UI labels this action as read-only; it never grants file-selection permission.
        accepted?.(); await this.execute(unresolved.length ? unresolved.map(other => other.result.upload_task_id) : [id]); return;
      }
      const blockers = this.unresolvedAccountTasks(task);
      if (blockers.length) throw new Error(this.blockedAccountMessage(task, blockers.length));
      if (accepted) await this.currentTarget(task);
      if (this.stopFailed || this.active || this.runner || generation !== this.controlGeneration || this.stopping || this.closing || this.discarding || this.retargeting) throw new Error("上传控制已变化，本次继续未接收。");
      if (requested?.result.state === "CANCELLED") this.cancelledIntents.delete(intentKey(task.input));
      accepted?.();
      this.preparingContinuation = true;
      try {
        this.eligible.clear(); this.continuationBatch = task.authorization.pageBatchId; this.stopped = false; this.paused = false;
        this.pausedAccounts.delete(task.authorization.target.advertiserId);
        const anchor = batch.find(other => this.store.hasMarker(other.result.upload_task_id));
        if (anchor) {
          await this.execute([anchor.result.upload_task_id]);
          if (this.paused || this.pausedAccounts.has(task.authorization.target.advertiserId)) {
            if (this.cancelledIntents.has(intentKey(task.input))) return;
            const failure = this.requireTask(anchor.result.upload_task_id).result.failure;
            task.result = { ...task.result, state: "NEEDS_HUMAN", readyEvidence: undefined, retryable: false,
              failure: uploadFailure("PAGE_CONTRACT_CHANGED", "page", "原批次页面无法核查，剩余成片尚未选文件。", failure?.next_action ?? "人工核查原页面；不能重传已选文件或创建替代页面继续。", true).failure };
            if (!this.store.unavailable) await this.save(task); return;
          }
        }
        for (const pending of batch) {
          if (generation !== this.controlGeneration || this.stopping || this.stopped || this.store.unavailable || !this.store.config.enabled) return;
          const other = this.requireTask(pending.result.upload_task_id);
          if (this.store.hasMarker(other.result.upload_task_id) || this.cancelledIntents.has(intentKey(other.input)) || other.result.duplicate_of || !(other.result.upload_task_id === id || ["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN"].includes(other.result.state))) continue;
          await this.phase(other, "PENDING");
          if (this.cancelledIntents.has(intentKey(other.input))) { await this.cancel(other.result.upload_task_id); continue; }
          if (generation !== this.controlGeneration || this.stopping || this.stopped || this.store.unavailable || !this.store.config.enabled) return;
          this.eligible.add(other.result.upload_task_id);
        }
        if (generation !== this.controlGeneration || this.stopping || this.stopped || this.store.unavailable || !this.store.config.enabled) return;
        const ids = this.pendingGroup(); for (const pending of ids) this.eligible.delete(pending);
        await this.execute(ids);
      } finally {
        this.preparingContinuation = false;
        if (this.eligible.size) void this.runPending().catch(() => this.changed());
      }
      await this.runPending();
    }); this.control = work; return work;
  }
  retarget(id: string, expectedAdId: string): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) return Promise.reject(new Error("账号浏览器操作正在进行，请稍后改传计划。"));
    if (this.beginningProduction) return Promise.reject(new Error("正在切换本次制作范围，请等待上传控制停止。"));
    if (this.closing) return Promise.reject(new Error("正在结束本批本地上传，请等待记录保存。"));
    if (this.discarding) return Promise.reject(new Error("正在删除本批上传任务，请等待记录保存。"));
    if (this.active || this.runner || this.preparingContinuation || this.retargeting || this.stopping) return Promise.reject(new Error("上传操作仍在运行，请等待停止后再改传计划。"));
    this.retargeting = true;
    const generation = this.controlGeneration;
    const work = this.control.catch(() => undefined).then(async () => {
      await this.admission.catch(() => undefined);
      if (generation !== this.controlGeneration || this.stopping || this.store.unavailable || !this.store.config.enabled) throw new Error("上传已停止或不可用，本批计划未改传。");
      const task = this.requireTask(id), old = task.authorization;
      const target = await this.accounts.preflight(old.target.product);
      if (target.adId !== expectedAdId) throw new Error("当前保存的计划已变化，请刷新账号设置后重新选择。");
      if (target.advertiserId !== old.target.advertiserId || target.cdpEndpoint !== old.target.cdpEndpoint) throw new Error("改传只允许原账户的当前计划；不能更换账号或浏览器连接。");
      const batch = this.store.tasks().filter(other => other.authorization.pageBatchId === old.pageBatchId);
      for (const other of batch) await this.snapshotValid(other);
      const pageBatchId = randomUUID();
      await this.store.retargetBatch(id, { target, expectedCount: old.expectedCount, pageBatchId }, async () => {
        await this.accounts.freeze(target.product, target.configDigest);
        if (generation !== this.controlGeneration || this.stopping || !this.store.config.enabled) throw new Error("上传已停止，本批计划未改传。");
      });
      if (this.productionBatches) { this.productionBatches.delete(old.pageBatchId); this.productionBatches.add(pageBatchId); }
      for (const other of batch) { this.eligible.delete(other.result.upload_task_id); this.currentIntents.delete(intentKey(other.input)); }
      this.eligible.clear(); this.stopped = true;
      if (this.continuationBatch === old.pageBatchId) this.continuationBatch = undefined;
      this.changed();
    }).finally(() => { this.retargeting = false; });
    this.control = work; return work;
  }
  discard(id: string): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) return Promise.reject(new Error("账号浏览器操作正在进行，请稍后处理上传任务。"));
    if (this.beginningProduction) return Promise.reject(new Error("正在切换本次制作范围，请等待上传控制停止。"));
    if (this.active || this.runner || this.preparingContinuation || this.retargeting || this.discarding || this.closing || this.stopping) return Promise.reject(new Error("上传操作仍在运行，请等待停止后再删除本批任务。"));
    this.discarding = true;
    const generation = this.controlGeneration;
    const work = this.control.catch(() => undefined).then(async () => {
      await this.admission.catch(() => undefined);
      if (generation !== this.controlGeneration || this.stopping) throw new Error("上传控制已变化，本批未删除。");
      const task = this.requireTask(id), batchId = task.authorization.pageBatchId;
      const batch = this.store.tasks().filter(other => other.authorization.pageBatchId === batchId);
      await this.store.discardBatch(id, async () => {
        if (generation !== this.controlGeneration || this.stopping) throw new Error("上传控制已变化，本批未删除。");
      });
      for (const other of batch) {
        this.eligible.delete(other.result.upload_task_id); this.currentIntents.delete(intentKey(other.input)); this.cancelledIntents.add(intentKey(other.input));
      }
      if (this.continuationBatch === batchId) this.continuationBatch = undefined;
      this.refreshAccountPauses();
      this.changed();
    }).finally(() => { this.discarding = false; });
    this.control = work; return work;
  }
  async cancel(id: string): Promise<void> {
    if (this.closing) throw new Error("正在结束本批本地上传，请等待记录保存。");
    if (this.discarding) throw new Error("正在删除本批上传任务，请等待记录保存。");
    if (this.retargeting) throw new Error("正在改传本批计划，请等待记录保存后停止任务。");
    const task = this.requireTask(id); if (this.store.isClosed(task.authorization.pageBatchId) || task.result.state === "ACCEPTED") return; this.eligible.delete(id);
    if (this.active?.ids.includes(id) || (task.result.state !== "WAITING_FOR_CONFIRMATION" && !task.result.duplicate_of)) this.cancelledIntents.add(intentKey(task.input));
    if (this.active?.ids.includes(id)) {
      const active = this.active; this.cancelling++; active.controller.abort();
      try {
        await this.bounded(() => active.port.stop(), 5000, new AbortController().signal).catch(() => { this.stopFailed = true; this.paused = true; });
        await this.bounded(async () => { await this.runner; }, 15000, new AbortController().signal).catch(() => { this.stopFailed = true; this.paused = true; });
      } finally { this.cancelling--; }
      if (!this.stopFailed) void this.runPending().catch(() => this.changed());
      return;
    }
    if (["DISCARDED", "ACCEPTED", "WAITING_FOR_CONFIRMATION"].includes(task.result.state) || task.result.duplicate_of) return;
    task.result = { ...task.result, state: this.store.hasMarker(id) ? "NEEDS_HUMAN" : "CANCELLED", upload_outcome: this.store.hasMarker(id) ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED", readyEvidence: undefined, retryable: false, failure: this.store.hasMarker(id) ? unknown().failure : uploadFailure("STOPPED", "cancel", "上传已停止。", "明确继续才会处理。", false).failure };
    await this.save(task);
  }
  /** Called only by the main-process production owner after capturing this job's task IDs. */
  async cancelExports(projectId: string, taskIds: readonly string[]): Promise<void> {
    const ids = new Set(taskIds);
    for (const intent of this.store.intents()) if (intent.project_id === projectId && ids.has(intent.export_task_id)) {
      const key = intentKey(intent); this.cancelledIntents.add(key); this.currentIntents.delete(key);
    }
    const owned = () => this.store.tasks().filter(task => task.input.project_id === projectId && ids.has(task.input.export_task_id));
    for (const task of owned()) this.eligible.delete(task.result.upload_task_id);
    const active = owned().find(task => this.active?.ids.includes(task.result.upload_task_id));
    if (active) await this.cancel(active.result.upload_task_id);
    await this.admission.catch(() => undefined);
    for (const task of owned()) await this.cancel(task.result.upload_task_id);
  }
  async stop(): Promise<boolean> {
    let drained = true;
    if (!this.preparingAutomationUpload) this.automationBrowsers.release();
    this.ordinaryBrowserController?.abort(); this.ordinaryRemoteAccount = undefined;
    const libraryOperation = this.libraryOperation;
    libraryOperation?.controller.abort();
    this.planPreloadController?.abort();
    this.controlGeneration++; this.stopping = true; this.stopped = true; this.eligible.clear(); this.currentIntents.clear(); this.continuationBatch = undefined; this.active?.controller.abort();
    try {
      await Promise.all([...this.sessions.values()].map(port => this.bounded(() => port.stop(), 5000, new AbortController().signal).catch(() => { drained = false; this.paused = true; })));
      this.sessions.clear(); await this.bounded(async () => { await this.runner; await this.admission.catch(() => undefined); await libraryOperation?.done; await this.planPreload; }, 15000, new AbortController().signal).catch(() => { drained = false; this.paused = true; });
    } finally { this.stopping = false; }
    if (!drained || this.active) this.stopFailed = true;
    return !this.stopFailed;
  }
  closeBatch(id: string): Promise<void> {
    if (this.managingBrowser || this.automationUploadActive || this.automationBrowsers.busy) return Promise.reject(new Error("账号浏览器操作正在进行，请稍后结束本批上传。"));
    if (this.beginningProduction) return Promise.reject(new Error("正在切换本次制作范围，请等待上传控制停止。"));
    if (this.active || this.runner || this.preparingContinuation || this.retargeting || this.discarding || this.closing || this.stopping) return Promise.reject(new Error("上传操作仍在运行，请等待停止后再结束本批本地上传。"));
    this.closing = true;
    const generation = this.controlGeneration;
    const work = this.control.catch(() => undefined).then(async () => {
      await this.admission.catch(() => undefined);
      const check = async () => { if (generation !== this.controlGeneration || this.stopping) throw new Error("上传控制已变化，本批未结束。"); };
      await check(); const task = this.store.task(id); if (!task) throw new Error("找不到千川上传任务。"); const batchId = task.authorization.pageBatchId;
      await this.store.closeBatch(id, check);
      for (const other of this.store.tasks().filter(value => value.authorization.pageBatchId === batchId)) {
        this.eligible.delete(other.result.upload_task_id); this.currentIntents.delete(intentKey(other.input));
      }
      this.eligible.clear(); this.currentIntents.clear(); this.continuationBatch = undefined; this.stopped = true;
      this.refreshAccountPauses(); this.changed();
    }).finally(() => { this.closing = false; this.changed(); });
    this.control = work; return work;
  }
  private requireTask(id: string): UploadTaskRecord { const task = this.store.task(id); if (!task) throw new Error("找不到千川上传任务。"); if (!this.inProduction(task.authorization.pageBatchId)) throw new Error("本任务不属于本次制作，历史上传不再处理。"); return task; }
  private readonly rowReady = new Set<string>();
  private async save(task: UploadTaskRecord | UploadTaskRecord[]): Promise<void> {
    if (Array.isArray(task)) await this.store.saveTasks(task); else await this.store.saveTask(task);
    this.changed();
    for (const record of Array.isArray(task) ? task : [task]) if (record.config.captureFailureDiagnostics) await this.log(record).catch(() => undefined);
  }
  private async phase(task: UploadTaskRecord | UploadTaskRecord[], state: QianchuanUploadResult["state"]): Promise<void> {
    for (const record of Array.isArray(task) ? task : [task]) record.result = { ...record.result, state, readyEvidence: undefined, failure: undefined, retryable: false, timestamp: timestamp() };
    await this.save(task);
  }
  private selectedFiles(task: UploadTaskRecord): BatchSelectedFile[] {
    return this.store.tasks().filter(value => value.authorization.pageBatchId === task.authorization.pageBatchId && this.store.hasMarker(value.result.upload_task_id)).map(value => ({ fileName: value.result.file_name, index: this.store.fence(value.result.upload_task_id)!.selectedIndex, ready: value.result.upload_outcome === "READY" })).sort((a, b) => a.index - b.index);
  }
  private duplicate(task: UploadTaskRecord): UploadTaskRecord | undefined {
    return this.store.tasks().find(other => other.result.upload_task_id !== task.result.upload_task_id && sameTargetBytes(task, other) && this.store.hasMarker(other.result.upload_task_id));
  }
  private async currentTarget(task: UploadTaskRecord): Promise<void> {
    if (this.store.tasks().some(other => other.authorization.pageBatchId === task.authorization.pageBatchId && this.store.hasMarker(other.result.upload_task_id))) return;
    const selection = this.store.intents().find(intent => intent.authorization.pageBatchId === task.authorization.pageBatchId)?.selection;
    if (selection?.plan?.accountSource === "current-browser" && !this.automationUploadActive) {
      try {
        if (!(this.accounts instanceof QianchuanAccountSettings)) throw new Error("网页子账户绑定不可用。");
        const current = await this.accounts.prepareCurrentCatalog(task.authorization.target.product, undefined, this.excludedPlanTargets());
        this.selectedAccountTargets.resolve(task.authorization, selection, current.configured);
        if (current.target.advertiserId !== task.authorization.target.advertiserId) throw new Error("网页当前子账户已变化。");
      } catch {
        throw uploadFailure("INPUT_CONFLICT", "account", "网页子账户或本轮上传授权已变化，未选择上传文件。", "刷新计划后重新开始制作；旧冻结目标保持原样。", true);
      }
      return;
    }
    const target = await this.accounts.preflight(task.authorization.target.product), old = task.authorization.target;
    if (egressIdentity(target.egress) !== egressIdentity(old.egress)) throw uploadFailure("INPUT_CONFLICT", "account", "固定出口已变化，不能改用新网络继续原任务。", "核对原批次冻结出口；不会自动重传。", true);
    const plan = this.store.intents().find(intent => intent.authorization.pageBatchId === task.authorization.pageBatchId)?.selection.plan;
    const matchesPlan = plan ? plan.advertiserId === old.advertiserId && plan.adId === old.adId : target.adId === old.adId;
    if (target.advertiserId !== old.advertiserId || !matchesPlan || target.cdpEndpoint !== old.cdpEndpoint) throw uploadFailure("INPUT_CONFLICT", "account", plan ? `本批冻结计划 ${old.adId} 与当前账号或计划不同，请核查上传目标。` : `本批冻结计划 ${old.adId} 与当前保存计划 ${target.adId} 不同，请明确“改传当前计划”。`, "核对账号设置；同账户且整批从未选文件时可改传，已有文件屏障不能迁移或重传。", true);
  }
  private async execute(ids: string[]): Promise<void> {
    const generation = this.controlGeneration;
    let tasks = ids.map(id => this.requireTask(id));
    if (tasks.some(task => this.store.isClosed(task.authorization.pageBatchId))) throw new Error("本批本地上传已结束，不能执行。");
    const first = tasks[0]; if (!first) return;
    const controller = new AbortController(), key = first.authorization.pageBatchId, recovery = this.store.hasMarker(first.result.upload_task_id);
    const savedReady = new Set<string>();
    let port: UploadBrowserPort | undefined;
    try {
      if (!recovery && tasks.some(task => this.store.tasks().some(other => this.store.isClosed(other.authorization.pageBatchId) && sameTargetBytes(task, other) && !this.store.hasMarker(other.result.upload_task_id)))) throw uploadFailure("INPUT_CONFLICT", "input", "同目标视频属于已结束的本地上传批次，禁止重新上传。", "保留原批次历史；结束后的未选成员也不能取得新选择权限。", true);
      if (!recovery) await this.currentTarget(first);
      if (this.stopFailed || generation !== this.controlGeneration || this.stopping) throw new Error("上传控制已变化，本次浏览器操作已阻断。");
      if (!recovery) {
        const duplicate = this.duplicate(first);
        if (duplicate) {
          first.result = { ...first.result, duplicate_of: duplicate.result.upload_task_id, state: duplicate.result.state === "ACCEPTED" ? "ACCEPTED" : duplicate.result.state === "WAITING_FOR_CONFIRMATION" ? "WAITING_FOR_CONFIRMATION" : "NEEDS_HUMAN", upload_outcome: duplicate.result.upload_outcome === "ACCEPTED" ? "ACCEPTED" : duplicate.result.state === "WAITING_FOR_CONFIRMATION" ? "READY" : "MAY_HAVE_UPLOADED", readyEvidence: duplicate.result.readyEvidence, acceptedEvidence: duplicate.result.acceptedEvidence, failure: duplicate.result.readyEvidence || duplicate.result.acceptedEvidence ? undefined : unknown().failure };
          await this.save(first); if (!duplicate.result.readyEvidence && !duplicate.result.acceptedEvidence) this.pauseAccount(first); return;
        }
      }
      port = this.sessions.get(key) ?? this.dependencies.browser(); this.sessions.set(key, port); this.active = { ids, controller, port };
      const t = first.config.timeouts;
      if (!recovery) { await this.bounded(signal => this.prepareGroup(ids, 0, signal), t.processing, controller.signal); tasks = ids.map(id => this.requireTask(id)); }
      if (tasks.length > (recovery ? first.authorization.expectedCount : MAX_UPLOAD_GROUP_SIZE) || tasks.some(task => JSON.stringify(task.authorization) !== JSON.stringify(first.authorization) || JSON.stringify(task.config) !== JSON.stringify(first.config) || this.store.hasMarker(task.result.upload_task_id) !== recovery)) throw unknown();
      if (!recovery) { for (const task of tasks) task.result.attempt_count++; await this.phase(tasks, "CONNECTING_BROWSER"); }
      for (let retry = 0; ; retry++) {
        try {
          await this.bounded(signal => port!.connect(first, signal), t.connect, controller.signal);
          if (!recovery) await this.selectGroup(tasks, port, controller.signal);
          break;
        }
        catch (error) {
          const reconnectable = error instanceof UploadError && error.failure.category === "browser" &&
            (error.failure.code === "CDP_UNAVAILABLE" && error.failure.retryable || error.failure.code === "TIMEOUT");
          if (!reconnectable || recovery || controller.signal.aborted || tasks.some(task => task.result.upload_outcome !== "NOT_SELECTED" || this.store.hasMarker(task.result.upload_task_id)) || this.selectedFiles(first).length) throw error;
          if (retry === 2) throw new UploadError({ ...error.failure, retryable: true, message: `自动连接及上传准备已尝试 3 次：${error.failure.message}`.slice(0, 500), next_action: "文件尚未选择。请检查对应 Chrome 的连接及登录状态，恢复后明确点击“安全继续”；不会自动追加重试。" });
          await this.bounded(() => port!.stop(), 5000, new AbortController().signal).catch(() => { this.stopFailed = true; throw error; });
          this.sessions.delete(key);
          for (const task of tasks) {
            task.result = { ...task.result, failure: { ...error.failure, message: `Chrome 连接或上传准备失败，正在自动重连（${retry + 1}/2）。`, next_action: "尚未选择文件；稍候自动重连，可停止本批上传。" }, timestamp: timestamp() };
          }
          await this.save(tasks);
          await delay(1000 * (retry + 1), undefined, { signal: controller.signal });
          await this.currentTarget(first); controller.signal.throwIfAborted();
          if (this.stopFailed || this.store.unavailable || generation !== this.controlGeneration || this.stopping) throw new Error("上传控制已变化，自动重连已停止。");
          port = this.dependencies.browser(); this.sessions.set(key, port); this.active = { ids, controller, port };
          for (const task of tasks) task.result.retry_count++;
          await this.save(tasks);
        }
      }
      let evidence: ReadyEvidence[];
      if (recovery) {
        evidence = await this.bounded(async signal => {
          const results: ReadyEvidence[] = [];
          for (const task of tasks) results.push(await port!.readOnlyCheck(task, this.store.fence(task.result.upload_task_id)!.pageOwnership, this.selectedFiles(task), signal));
          return results;
        }, t.confirmation, controller.signal);
      } else {
        tasks = ids.map(id => this.requireTask(id));
        evidence = await this.bounded(async signal => {
          const reportReady: UploadReadyProgress = async fileNames => {
            signal.throwIfAborted();
            if (new Set(fileNames).size !== fileNames.length) throw unknown();
            const completed = fileNames.map(fileName => {
              const task = tasks.find(task => task.result.file_name === fileName);
              if (!task) throw unknown();
              return task;
            }).filter(task => !this.rowReady.has(task.result.upload_task_id));
            if (!completed.length) return;
            for (const task of completed) this.rowReady.add(task.result.upload_task_id);
            this.changed();
          };
          while (true) {
            signal.throwIfAborted();
            const ready = await port!.pollReady(tasks, signal, reportReady);
            if (ready) return ready;
            const next = this.pendingGroup(key);
            if (next.length) {
              const start = ids.length;
              ids.push(...next);
              for (const id of next) this.eligible.delete(id);
              await this.prepareGroup(ids, start, signal, async () => {
                const ready = await port!.pollReady(tasks, signal, reportReady);
                if (ready && tasks.some(task => !savedReady.has(task.result.upload_task_id))) {
                  await this.saveReady(tasks, ready, signal);
                  for (const task of tasks) savedReady.add(task.result.upload_task_id);
                }
              });
              const group = ids.slice(start).map(id => this.requireTask(id));
              for (const task of group) {
                this.eligible.delete(task.result.upload_task_id);
                if (JSON.stringify(task.authorization) !== JSON.stringify(first.authorization) || JSON.stringify(task.config) !== JSON.stringify(first.config)) throw unknown();
                task.result.attempt_count++;
              }
              await this.phase(group, "CONNECTING_BROWSER");
              await this.selectGroup(group, port!, signal);
              tasks = ids.map(id => this.requireTask(id));
              continue;
            }
            await delay(500, undefined, { signal });
          }
        }, first.authorization.target.egress?.mode === "remote-browser" ? Math.max(t.processing, 2 * 60 * 60 * 1000) : t.processing, controller.signal);
      }
      await this.saveReady(tasks, evidence, controller.signal);
      for (const task of tasks) savedReady.add(task.result.upload_task_id);
    } catch (error) {
      for (const id of ids) this.rowReady.delete(id);
      this.pauseAccount(first);
      const failed: UploadTaskRecord[] = [];
      for (const id of ids) {
        const task = this.requireTask(id); if (task.result.state === "WAITING_FOR_CONFIRMATION" && (!recovery || savedReady.has(id))) continue;
        const fenced = this.store.hasMarker(id), waitingTimeout = !fenced && task.result.state === "PENDING" && error instanceof UploadError && error.failure.code === "TIMEOUT";
        const failure = fenced ? unknown(error instanceof UploadError ? error : undefined).failure : controller.signal.aborted ? uploadFailure("STOPPED", "cancel", "上传已停止。", "确认后明确继续。", false).failure : waitingTimeout ? uploadFailure("TIMEOUT", "page", "处理期限已到，本文件尚未选择。", "核查原任务页面后点击“安全继续”；已选文件不会重传。", true).failure : error instanceof UploadError ? error.failure : uploadFailure("PAGE_CONTRACT_CHANGED", "page", "页面操作无法确认，自动操作已停止。", "检查页面结构与任务归属。", true).failure;
        task.result = { ...task.result, state: fenced || failure.requires_human ? "NEEDS_HUMAN" : controller.signal.aborted ? "CANCELLED" : failure.retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL", upload_outcome: fenced ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED", readyEvidence: undefined, failure, retryable: !fenced && failure.retryable, timestamp: timestamp() };
        failed.push(task);
      }
      if (!this.store.unavailable && failed.length) await this.save(failed);
      if (this.store.unavailable) { this.initializationFailure = "上传存储失败；保留屏障，上传结果按未知处理。"; this.changed(); }
      if (port) await this.bounded(() => port!.stop(), 5000, new AbortController().signal).catch(() => { this.stopFailed = true; }); this.sessions.delete(key);
    } finally { for (const id of ids) this.rowReady.delete(id); if (port && this.active?.port === port) this.active = undefined; this.changed(); }
  }
  private async saveReady(tasks: UploadTaskRecord[], evidence: ReadyEvidence[], signal: AbortSignal): Promise<void> {
    if (evidence.length !== tasks.length) throw unknown();
    const parsed = evidence.map(item => ReadyEvidenceSchema.parse(item));
    const selectedCount = this.selectedFiles(tasks[0]!).length;
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index]!, item = parsed[index]!;
      if (item.fileName !== task.result.file_name || item.selectedCount !== selectedCount || JSON.stringify(item.pageOwnership) !== JSON.stringify(this.store.fence(task.result.upload_task_id)!.pageOwnership)) throw unknown();
      await this.snapshotValid(task); signal.throwIfAborted();
    }
    for (let index = 0; index < tasks.length; index++) {
      signal.throwIfAborted(); const task = tasks[index]!;
      task.result = { ...task.result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: parsed[index], failure: undefined, retryable: false, timestamp: timestamp() };
    }
    await this.save(tasks);
  }
  private async selectGroup(tasks: UploadTaskRecord[], port: UploadBrowserPort, signal: AbortSignal): Promise<void> {
    const first = tasks[0]!, t = first.config.timeouts;
    if (port.prepareFiles) {
      for (const task of tasks) { await this.snapshotValid(task); signal.throwIfAborted(); }
      await this.bounded(inner => port.prepareFiles!(tasks, inner), 2 * 60 * 60 * 1000, signal);
      await this.currentTarget(first); signal.throwIfAborted();
    }
    await this.phase(tasks, "OPENING_UPLOAD_PAGE");
    const prepared = await this.bounded(inner => port.open(tasks, this.selectedFiles(first), inner), t.navigation, signal);
    for (const task of tasks) { await this.snapshotValid(task); signal.throwIfAborted(); }
    await this.currentTarget(first); signal.throwIfAborted();
    await this.store.markSelecting(tasks.map(task => task.result.upload_task_id), prepared.pageOwnership, prepared.selectedIndex);
    this.changed(); signal.throwIfAborted();
    await this.bounded(inner => port.upload(tasks.map(task => this.requireTask(task.result.upload_task_id)), inner), t.fileInput, signal);
    signal.throwIfAborted(); await this.phase(tasks.map(task => this.requireTask(task.result.upload_task_id)), "WAITING_UPLOAD_COMPLETE");
  }
  private async snapshotValid(task: UploadTaskRecord): Promise<void> {
    const info = await lstat(task.snapshotPath);
    if (!isPathWithinDirectory(path.join(this.store.root, "snapshots"), task.snapshotPath) || !info.isFile() || info.isSymbolicLink() || info.mode & 0o7377 || info.size !== task.input.size_bytes || (await fingerprintFile(task.snapshotPath)).replace(/^sha256:/, "") !== task.input.artifact_sha256) throw uploadFailure("ARTIFACT_CHANGED", "input", "上传快照已变化，禁止上传。", "核查私有快照。", false);
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent: AbortSignal): Promise<T> {
    const controller = new AbortController(), aborted = () => controller.abort(); parent.addEventListener("abort", aborted, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined, listener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      listener = () => reject(uploadFailure(parent.aborted ? "STOPPED" : "TIMEOUT", parent.aborted ? "cancel" : "browser", "操作已停止或阶段超时。", "人工检查后明确继续。", false));
      controller.signal.addEventListener("abort", listener, { once: true }); timer = setTimeout(aborted, milliseconds);
      if (parent.aborted) aborted();
    });
    try { controller.signal.throwIfAborted(); const result = await Promise.race([operation(controller.signal), timeout]); controller.signal.throwIfAborted(); return result; }
    finally { if (timer) clearTimeout(timer); parent.removeEventListener("abort", aborted); if (listener) controller.signal.removeEventListener("abort", listener); }
  }
  private async log(task: UploadTaskRecord): Promise<void> {
    const directory = path.join(this.store.root, "logs"); await secureUploadDirectory(directory); let total = 0;
    for (const name of await readdir(directory)) { const file = path.join(directory, name), info = await stat(file); if (Date.now() - info.mtimeMs > 7 * 86400000) await unlink(file); else total += info.size; }
    const line = JSON.stringify({ task: task.result.upload_task_id, state: task.result.state, outcome: task.result.upload_outcome, reason: task.result.failure?.code, timestamp: task.result.timestamp });
    if (total + Buffer.byteLength(line) < 100 * 1024 * 1024) await appendFile(path.join(directory, `${timestamp().slice(0, 10)}.jsonl`), `${line}\n`, { mode: 0o600 });
  }
}
