import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AgentStartSchema, calculateExactProductionQuantity, MAX_AGENT_OUTPUTS, type AgentRun, type AgentStartInput } from "../shared/agent.js";
import { DecorationSchema } from "../shared/decorations.js";
import { CoverStickerSchema, DEFAULT_COVER_STICKER } from "../shared/cover-sticker.js";
import { BatchProductionStartSchema, BatchProductionRunSchema, type BatchProductionEntry, type BatchProductionJob, type BatchProductionRun } from "../shared/batch-production.js";
import { DEFAULT_EXPORT_SETTINGS } from "../shared/export-settings.js";
import type { ExportTask, Project } from "./domain.js";
import type { QueueSnapshot } from "./queue.js";
import { ProjectStore, atomicWriteJson } from "./store.js";

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
  session(projectPath: string): Promise<BatchProductionSession>;
  queue(projectId?: string): QueueSnapshot;
  taskStatuses(): ReadonlyMap<string, ExportTask["status"]>;
  cancelExport(taskId: string): Promise<void>;
  changed(): void;
}

interface FrozenJob { job: BatchProductionJob; projectPath: string; input: Omit<AgentStartInput, "outputDirectory">; project: Project; requestedOutput?: string; }

/** Cross-project sequencing only; all export state and verification stay in ExportQueue. */
export class BatchProductionController {
  private run?: BatchProductionRun;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private activeSession?: BatchProductionSession;
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
        requestedCount: entry.requestedCount, actualCount: 0, productPrice: entry.productPrice, coverEnabled: entry.coverEnabled, displayMode: entry.displayMode,
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
    try { await this.activeSession?.cancel(); }
    finally { await this.pending; }
  }

  private async freeze(entry: BatchProductionEntry, job: BatchProductionJob): Promise<FrozenJob> {
    const project = structuredClone(await this.dependencies.loadProject(entry.recentProjectId));
    const workspace = project.workspaceDraft;
    const selectedIds = workspace?.selectedMediaIds ?? project.mediaItems.filter(item => item.probeStatus === "ready").map(item => item.id);
    const mediaIds = [...new Set(selectedIds)].slice(0, entry.requestedCount);
    const quantity = calculateExactProductionQuantity(mediaIds.length, entry.requestedCount);
    if (!quantity) throw new Error(`当前模板的素材和条数无效，最多 ${MAX_AGENT_OUTPUTS} 条。`);
    if (mediaIds.some(id => !project.mediaItems.some(item => item.id === id && item.probeStatus === "ready"))) throw new Error("模板所选素材已失效，请先重新打开模板检查。");
    project.coverSticker = CoverStickerSchema.parse({ ...(project.coverSticker ?? DEFAULT_COVER_STICKER), enabled: entry.coverEnabled });
    if (entry.coverEnabled && project.coverSticker.trackingMode === "assisted") throw new Error("半自动覆盖需要单独预览和人工批准；请在制作页面完成审阅，或关闭该项覆盖。");
    const template = project.templates.find(item => item.id === project.activeTemplateId) ?? project.templates[0];
    template.productPriceDraft = entry.productPrice;
    const decorations = DecorationSchema.parse({ ...workspace?.decorations, productPrice: entry.productPrice, displayMode: entry.displayMode });
    const input = { mediaIds, ruleId: workspace?.ruleId ?? "black-gold" as const, brief: workspace?.brief ?? "", decorations,
      exportFormat: workspace?.exportFormat ?? "mp4" as const, exportSettings: workspace?.exportSettings ?? DEFAULT_EXPORT_SETTINGS, requestedCount: quantity.total };
    AgentStartSchema.parse({ ...input, outputDirectory: "/pending" });
    const projectPath = path.join(this.root, this.run!.id, `${job.id}.json`);
    await new ProjectStore(projectPath).save(project);
    job.projectId = project.id; job.name = project.name; job.actualCount = quantity.total;
    return { job, projectPath, project, input, requestedOutput: entry.outputDirectory };
  }

  private async execute(entries: BatchProductionEntry[], signal: AbortSignal, initialSave: Promise<void>): Promise<void> {
    try {
      await initialSave;
      const frozen: FrozenJob[] = [];
      // Read and seal all selected templates before the first model or export request.
      for (const [index, entry] of entries.entries()) {
        if (signal.aborted) break;
        const job = this.run!.jobs[index];
        try { frozen.push(await this.freeze(entry, job)); }
        catch (error) { job.status = "failed"; job.error = message(error); }
        await this.persist();
      }
      for (const item of frozen) {
        if (signal.aborted) break;
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
      try { await this.activeSession?.cancel(); } catch { /* Preserve the original persistence or custody failure. */ }
      try { await this.persist(); } catch { this.dependencies.changed(); }
    } finally { this.activeSession = undefined; this.executing = false; this.wake(); this.dependencies.changed(); }
  }

  private capture(job: BatchProductionJob, session: BatchProductionSession): boolean {
    const ids = [...new Set(session.snapshot()?.items.flatMap(item => item.taskId ? [item.taskId] : []) ?? [])];
    const changed = JSON.stringify(ids) !== JSON.stringify(job.taskIds);
    job.taskIds = ids;
    return changed;
  }

  private async executeJob(item: FrozenJob, signal: AbortSignal): Promise<void> {
    const { job } = item;
    let session: BatchProductionSession | undefined;
    let failure: string | undefined;
    job.status = "preparing";
    await this.persist();
    try {
      job.outputDirectory = await this.dependencies.outputDirectory(item.project, item.input.mediaIds, item.requestedOutput);
      if (signal.aborted) return;
      session = await this.dependencies.session(item.projectPath);
      this.activeSession = session;
      if (signal.aborted) return;
      job.status = "producing";
      await this.persist();
      await session.start(AgentStartSchema.parse({ ...item.input, outputDirectory: job.outputDirectory }));
      while (session.busy && !signal.aborted) {
        if (this.capture(job, session)) await this.persist();
        this.dependencies.changed();
        await this.wait(signal);
      }
    } catch (error) { failure = message(error); }
    finally {
      if (session) {
        if (signal.aborted || failure) await session.cancel();
        this.capture(job, session);
      }
      job.status = "exporting";
      await this.persist();
      if (signal.aborted) await Promise.all(job.taskIds.map(id => this.dependencies.cancelExport(id)));
      // Agent completion is not export completion. Drain exactly this item's original queue tasks.
      while (true) {
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
      if (session) { await session.persist(this.dependencies.queue(item.project.id)); await session.cancel(); }
      this.activeSession = undefined;
      await this.persist();
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
