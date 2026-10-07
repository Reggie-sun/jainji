import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AgentStartSchema, calculateExactProductionQuantity, MAX_AGENT_OUTPUTS, type AgentRun, type AgentStartInput } from "../shared/agent.js";
import { DecorationSchema } from "../shared/decorations.js";
import { CoverStickerSchema, DEFAULT_COVER_STICKER } from "../shared/cover-sticker.js";
import { BatchProductionStartSchema, BatchProductionRunSchema, BatchProductionDetailRequestSchema, batchLocalCoverError, type BatchProductionDetail, type BatchProductionEntry, type BatchProductionJob, type BatchProductionRun } from "../shared/batch-production.js";
import { DEFAULT_EXPORT_SETTINGS } from "../shared/export-settings.js";
import type { ExportTask, Project } from "./domain.js";
import type { QueueSnapshot } from "./queue.js";
import { ProjectStore, atomicWriteJson } from "./store.js";
import type { QianchuanUploadSelection, UploadAuthorization } from "../shared/douyin-upload.js";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import { resolveBatchUploadAccount, type TemplateAccountBinding } from "../shared/batch-upload.js";

const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

export interface BatchProductionSession {
  readonly busy: boolean;
  start(input: AgentStartInput): Promise<void>;
  snapshot(): AgentRun | undefined;
  cancel(): Promise<void>;
  persist(snapshot: QueueSnapshot): Promise<void>;
}

interface Dependencies {
  name(recentProjectId: string): string;
  loadProject(recentProjectId: string): Promise<Project>;
  outputDirectory(project: Project, mediaIds: string[], requested?: string): Promise<string>;
  session(projectPath: string, authorization?: UploadAuthorization): Promise<BatchProductionSession>;
  preflightUpload?(selection: QianchuanUploadSelection, count: number): Promise<UploadAuthorization | undefined>;
  uploadAccounts?(projectId: string): QianchuanAccountSummary[];
  uploadBinding?(recentProjectId: string, projectId: string): Promise<TemplateAccountBinding | undefined>;
  uploadStatus?(projectId: string, taskIds: string[]): BatchProductionDetail["upload"];
  cancelUploads?(projectId: string, taskIds: string[]): Promise<void>;
  queue(projectId?: string): QueueSnapshot;
  taskStatuses(): ReadonlyMap<string, ExportTask["status"]>;
  cancelExport(taskId: string): Promise<void>;
  changed(): void;
}

interface FrozenJob { job: BatchProductionJob; projectPath: string; input: Omit<AgentStartInput, "outputDirectory">; project: Project; requestedOutput?: string; authorization?: UploadAuthorization; }

/** Cross-project sequencing only; all export state and verification stay in ExportQueue. */
export class BatchProductionController {
  private run?: BatchProductionRun;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private activeSession?: BatchProductionSession;
  private activeJobId?: string;
  private activeJobController?: AbortController;
  private activeCancellation?: Promise<void>;
  private executing = false;
  private restorationError?: string;
  private readonly waiters = new Set<() => void>();
  constructor(private readonly root: string, private readonly dependencies: Dependencies) {}

  get busy(): boolean { return this.executing || this.run?.status === "running" || this.run?.status === "cancelling"; }
  get warning(): string | undefined { return this.restorationError; }
  assertIdle(): void { if (this.busy) throw new Error("批量制作正在进行，请先停止整批任务。"); }
  wake(): void { for (const resolve of this.waiters) resolve(); }

  snapshot(): BatchProductionRun | undefined {
    if (!this.run) return undefined;
    const run = structuredClone(this.run);
    const tasks = this.dependencies.taskStatuses();
    for (const job of run.jobs) {
      job.completedTaskIds = job.taskIds.filter(id => tasks.get(id) === "completed");
      job.completedCount = job.completedTaskIds.length;
      job.failedCount = job.taskIds.filter(id => ["failed", "cancelled", "interrupted"].includes(tasks.get(id) ?? "")).length;
      if (job.status === "completed" && job.failedCount) {
        job.status = "failed";
        job.error = "部分已完成成片的文件已失效，请检查原导出记录。";
      } else if (job.status === "completed" && job.taskIds.some(id => !tasks.has(id))) {
        job.status = "interrupted";
        job.error = "部分导出记录不可用，无法确认成片状态。";
      }
    }
    return run;
  }

  /** Observe one frozen job without switching the editor or starting a production session. */
  async details(input: unknown): Promise<BatchProductionDetail> {
    const { runId, jobId } = BatchProductionDetailRequestSchema.parse(input);
    const job = this.snapshot()?.jobs.find(job => this.run?.id === runId && job.id === jobId);
    if (!job) throw new Error("该批量制作记录已更新，请返回批量列表重新选择。");
    const live = this.activeJobId === jobId ? this.activeSession?.snapshot() : undefined;
    const saved = !live && job.projectId && !["queued", "preparing"].includes(job.status)
      ? (await new ProjectStore(path.join(this.root, runId, `${jobId}.json`)).readSnapshot()).latestProduction : undefined;
    if (this.run?.id !== runId) throw new Error("该批量制作记录已更新，请返回批量列表重新选择。");
    const production = live && live.projectId === job.projectId ? live : saved;
    const ids = new Set([...job.taskIds, ...(live && live.projectId === job.projectId ? live.items.flatMap(item => item.taskId ? [item.taskId] : []) : [])]);
    const tasks = job.projectId ? this.dependencies.queue(job.projectId).batches
      .filter(({ batch }) => batch.projectId === job.projectId).flatMap(({ batch }) => batch.tasks).filter(task => ids.has(task.id)) : [];
    const items = structuredClone(production?.items ?? []).map(item =>
      !live && !item.taskId && !["failed", "cancelled"].includes(item.status) ? { ...item, status: "cancelled" as const } : item);
    return { runId, job, usesModel: production?.usesModel, items, tasks,
      upload: job.projectId ? this.dependencies.uploadStatus?.(job.projectId, [...ids]) : undefined };
  }

  async restore(): Promise<void> {
    try {
      this.run = BatchProductionRunSchema.parse(JSON.parse(await readFile(path.join(this.root, "latest.json"), "utf8")));
      if (!this.busy) return;
      this.run.status = "interrupted";
      for (const job of this.run.jobs) if (!["completed", "failed", "cancelled"].includes(job.status)) {
        job.status = "interrupted";
        job.error = "上次运行已中断，未自动重新制作。";
      }
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.restorationError = "批量制作记录无法恢复，已暂停批量入口。请检查应用数据目录中的批量记录。";
    }
  }

  async start(input: unknown): Promise<BatchProductionRun> {
    this.assertIdle();
    if (this.restorationError) throw new Error(this.restorationError);
    const { entries } = BatchProductionStartSchema.parse(input);
    if ([...this.dependencies.taskStatuses().values()].some(status => !terminal.has(status))) throw new Error("请等待当前导出完成，或先停止已有任务。");
    this.controller = new AbortController();
    const at = new Date().toISOString();
    this.run = {
      id: randomUUID(), status: "running", createdAt: at, updatedAt: at,
      jobs: entries.map(entry => ({ id: randomUUID(), recentProjectId: entry.recentProjectId, name: this.dependencies.name(entry.recentProjectId),
        requestedCount: entry.requestedCount, actualCount: 0, productPrice: entry.productPrice, coverEnabled: entry.coverEnabled, coverMethod: entry.coverMethod, displayMode: entry.displayMode, mode: entry.mode,
        ...(entry.douyinUpload ? { accountProduct: entry.douyinUpload.accountProduct } : {}),
        status: "queued", taskIds: [], completedCount: 0, failedCount: 0 })),
    };
    this.executing = true;
    const initialSave = this.persist();
    this.pending = this.execute(entries, this.controller.signal, initialSave);
    await initialSave;
    return this.snapshot()!;
  }

  async cancel(): Promise<void> {
    if (!this.busy) return;
    if (this.run?.status !== "running" && this.run?.status !== "cancelling") { await this.pending; return; }
    this.run!.status = "cancelling";
    this.controller?.abort();
    this.dependencies.changed(); this.wake();
    try { await this.cancelActiveSession(); }
    finally { await this.pending; }
  }

  async cancelJob(input: unknown): Promise<void> {
    const { runId, jobId } = BatchProductionDetailRequestSchema.parse(input);
    const job = this.run?.id === runId ? this.run.jobs.find(value => value.id === jobId) : undefined;
    if (!job) throw new Error("该批量制作记录已更新，请返回批量列表重新选择。");
    if (terminal.has(job.status)) return;
    if (this.run!.status === "cancelling") { await this.pending; return; }
    if (this.activeJobId === jobId) {
      this.activeJobController?.abort();
      this.dependencies.changed(); this.wake();
      await this.cancelActiveSession();
      while (this.activeJobId === jobId && this.executing) await this.wait();
    } else {
      job.status = "cancelled";
      await this.persist();
    }
  }

  private cancelActiveSession(): Promise<void> | undefined {
    if (this.activeSession) this.activeCancellation ??= this.activeSession.cancel();
    return this.activeCancellation;
  }

  private async freeze(entry: BatchProductionEntry, job: BatchProductionJob): Promise<FrozenJob> {
    const project = structuredClone(await this.dependencies.loadProject(entry.recentProjectId));
    delete project.latestProduction;
    const workspace = project.workspaceDraft;
    const selectedIds = workspace?.selectedMediaIds ?? project.mediaItems.filter(item => item.probeStatus === "ready").map(item => item.id);
    const mediaIds = [...new Set(selectedIds)].slice(0, entry.requestedCount);
    const quantity = calculateExactProductionQuantity(mediaIds.length, entry.requestedCount);
    if (!quantity) throw new Error(`当前模板的素材和条数无效，最多 ${MAX_AGENT_OUTPUTS} 条。`);
    if (mediaIds.some(id => !project.mediaItems.some(item => item.id === id && item.probeStatus === "ready"))) throw new Error("模板所选素材已失效，请先重新打开模板检查。");
    project.coverSticker = CoverStickerSchema.parse({ ...(project.coverSticker ?? DEFAULT_COVER_STICKER), enabled: entry.coverEnabled,
      ...(entry.coverMethod === "real-artwork" ? { trackingMode: "assisted", assistedArtwork: "human-region-v1", manualRegionInput: true, coverStrategy: undefined } : {}) });
    if (entry.coverEnabled && project.coverSticker.trackingMode === "assisted" && !project.coverSticker.manualRegionInput) throw new Error("半自动覆盖需要单独预览和人工批准；请在制作页面完成审阅，或关闭该项覆盖。");
    const template = project.templates.find(item => item.id === project.activeTemplateId) ?? project.templates[0];
    template.productPriceDraft = entry.productPrice;
    const decorations = DecorationSchema.parse({ ...workspace?.decorations, ...(entry.mode ? { mode: entry.mode } : {}), productPrice: entry.productPrice, displayMode: entry.displayMode });
    const coverError = batchLocalCoverError({ mode: decorations.mode ?? "manual", coverEnabled: entry.coverEnabled, coverMode: project.coverSticker.trackingMode });
    if (coverError) throw new Error(coverError);
    const input = { mediaIds, ruleId: workspace?.ruleId ?? "black-gold" as const, brief: workspace?.brief ?? "", decorations,
      exportFormat: workspace?.exportFormat ?? "mp4" as const, exportSettings: workspace?.exportSettings ?? DEFAULT_EXPORT_SETTINGS, requestedCount: quantity.total,
      ...(entry.douyinUpload ? { douyinUpload: entry.douyinUpload } : {}) };
    const validatedInput = AgentStartSchema.parse({ ...input, outputDirectory: "/pending" });
    if (entry.douyinUpload && input.exportFormat !== "mp4") throw new Error("千川上传仅支持 MP4，请先修改该模板的导出格式。");
    const uploadAccounts = entry.douyinUpload ? this.dependencies.uploadAccounts?.(project.id) ?? [] : [];
    const binding = entry.douyinUpload ? await this.dependencies.uploadBinding?.(entry.recentProjectId, project.id) : undefined;
    if (entry.douyinUpload) {
      const account = resolveBatchUploadAccount(project.name, uploadAccounts, binding);
      if (account.error) throw new Error(account.error);
      if (entry.douyinUpload.accountProduct !== account.accountProduct) throw new Error("模板与已保存的千川账号关联不一致，请刷新模板后重新开始。");
    }
    const authorization = entry.douyinUpload ? await this.dependencies.preflightUpload?.(entry.douyinUpload, quantity.total) : undefined;
    if (entry.douyinUpload && !authorization) throw new Error("千川账号预检不可用，请检查上传设置。");
    if (entry.douyinUpload && authorization) {
      const selectedAccount = uploadAccounts.find(account => account.product === entry.douyinUpload!.accountProduct)!;
      const currentAccounts = this.dependencies.uploadAccounts?.(project.id) ?? [];
      const currentBinding = await this.dependencies.uploadBinding?.(entry.recentProjectId, project.id);
      const currentAccount = resolveBatchUploadAccount(project.name, currentAccounts, currentBinding);
      const currentTarget = currentAccounts.find(account => account.product === selectedAccount.product);
      if (currentAccount.accountProduct !== selectedAccount.product || authorization.target.product !== selectedAccount.product
        || JSON.stringify(binding) !== JSON.stringify(currentBinding)
        || currentTarget?.advertiserId !== selectedAccount.advertiserId || currentTarget?.adId !== selectedAccount.adId
        || authorization.target.advertiserId !== selectedAccount.advertiserId || authorization.target.adId !== (entry.douyinUpload.plan?.adId ?? selectedAccount.adId)) {
        throw new Error("千川账号关联或计划在预检期间已变化，请刷新模板后重新开始。");
      }
    }
    const projectPath = path.join(this.root, this.run!.id, `${job.id}.json`);
    await new ProjectStore(projectPath).save(project);
    job.projectId = project.id; job.name = project.name; job.actualCount = quantity.total; job.mode = decorations.mode ?? "manual";
    return { job, projectPath, project, input: validatedInput, requestedOutput: entry.outputDirectory, authorization };
  }

  private async execute(entries: BatchProductionEntry[], signal: AbortSignal, initialSave: Promise<void>): Promise<void> {
    try {
      await initialSave;
      const frozen: FrozenJob[] = [];
      // Read and seal all selected templates before the first model or export request.
      for (const [index, entry] of entries.entries()) {
        if (signal.aborted) break;
        const job = this.run!.jobs[index];
        if (job.status === "cancelled") continue;
        try { frozen.push(await this.freeze(entry, job)); }
        catch (error) { if (this.run!.jobs[index].status !== "cancelled") { job.status = "failed"; job.error = message(error); } }
        await this.persist();
      }
      for (const item of frozen) {
        if (signal.aborted) break;
        if (item.job.status === "cancelled") continue;
        await this.executeJob(item, signal);
      }
      if (signal.aborted) {
        for (const job of this.run!.jobs) if (!["completed", "failed"].includes(job.status)) job.status = "cancelled";
        this.run!.status = "cancelled";
      } else this.run!.status = "finished";
      await this.persist();
    } catch (error) {
      this.run!.status = "interrupted"; this.run!.error = message(error);
      for (const job of this.run!.jobs) if (!["completed", "failed", "cancelled"].includes(job.status)) job.status = "interrupted";
      try { await this.cancelActiveSession(); } catch { /* Preserve the original persistence or custody failure. */ }
      try { await this.persist(); } catch { this.dependencies.changed(); }
    } finally { this.activeSession = undefined; this.activeJobId = undefined; this.activeJobController = undefined; this.activeCancellation = undefined; this.executing = false; this.wake(); this.dependencies.changed(); }
  }

  private capture(job: BatchProductionJob, session: BatchProductionSession): boolean {
    const ids = [...new Set(session.snapshot()?.items.flatMap(item => item.taskId ? [item.taskId] : []) ?? [])];
    const changed = JSON.stringify(ids) !== JSON.stringify(job.taskIds);
    job.taskIds = ids;
    return changed;
  }

  private async executeJob(item: FrozenJob, batchSignal: AbortSignal): Promise<void> {
    const { job } = item;
    this.activeJobId = job.id;
    this.activeJobController = new AbortController();
    const signal = AbortSignal.any([batchSignal, this.activeJobController.signal]);
    let session: BatchProductionSession | undefined;
    let failure: string | undefined;
    job.status = "preparing";
    await this.persist();
    try {
      job.outputDirectory = await this.dependencies.outputDirectory(item.project, item.input.mediaIds, item.requestedOutput);
      if (signal.aborted) return;
      session = await this.dependencies.session(item.projectPath, item.authorization);
      this.activeSession = session;
      if (signal.aborted) return;
      job.status = "producing";
      await this.persist();
      if (signal.aborted) return;
      await session.start(AgentStartSchema.parse({ ...item.input, outputDirectory: job.outputDirectory }));
      while (session.busy && !signal.aborted) {
        if (this.capture(job, session)) await this.persist();
        this.dependencies.changed();
        await this.wait(signal);
      }
    } catch (error) { failure = message(error); }
    finally {
      if (session) {
        if (signal.aborted || failure) await this.cancelActiveSession();
        this.capture(job, session);
      }
      job.status = "exporting";
      await this.persist();
      let uploadCancellation: Promise<void> | undefined;
      const cancelUploads = () => {
        if (signal.aborted) uploadCancellation ??= this.dependencies.cancelUploads?.(item.project.id, job.taskIds) ?? Promise.resolve();
        return uploadCancellation;
      };
      await cancelUploads();
      if (signal.aborted) await Promise.all(job.taskIds.map(id => this.dependencies.cancelExport(id)));
      // Agent completion is not export completion. Drain exactly this item's original queue tasks.
      while (true) {
        await cancelUploads();
        const tasks = this.dependencies.taskStatuses();
        if (job.taskIds.some(id => !tasks.has(id))) throw new Error("无法确认当前批量项的导出记录，整批已停止。");
        if (job.taskIds.every(id => terminal.has(tasks.get(id)!))) break;
        if (signal.aborted) await Promise.all(job.taskIds.map(id => this.dependencies.cancelExport(id)));
        this.dependencies.changed();
        await this.wait();
      }
      const run = session?.snapshot();
      const current = this.snapshot()!.jobs.find(value => value.id === job.id)!;
      job.completedCount = current.completedCount; job.failedCount = current.failedCount;
      const failed = run?.items.find(value => value.status === "failed");
      const exportFailure = this.dependencies.queue(item.project.id).batches.flatMap(({ batch }) => batch.tasks)
        .find(task => job.taskIds.includes(task.id) && ["failed", "interrupted", "cancelled"].includes(task.status));
      if (signal.aborted) job.status = "cancelled";
      else if (failure || failed || job.completedCount !== job.actualCount) {
        job.status = "failed";
        job.error = failure ?? failed?.error ?? exportFailure?.errorMessage ?? `完成 ${job.completedCount} / ${job.actualCount} 条，部分制作或导出未成功。`;
      } else job.status = "completed";
      if (session) { await session.persist(this.dependencies.queue(item.project.id)); await this.cancelActiveSession(); }
      await this.persist();
      this.activeSession = undefined;
      this.activeJobId = undefined;
      this.activeJobController = undefined;
      this.activeCancellation = undefined;
      this.wake();
    }
  }

  private async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.waiters.delete(done); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 250);
      this.waiters.add(done); signal?.addEventListener("abort", done, { once: true });
    });
  }

  private async persist(): Promise<void> {
    this.run!.updatedAt = new Date().toISOString();
    await atomicWriteJson(path.join(this.root, "latest.json"), BatchProductionRunSchema.parse(this.run));
    this.dependencies.changed();
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : "该模板制作失败，请检查素材和设置。"; }
