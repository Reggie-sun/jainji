import { randomUUID } from "node:crypto";
import { access, constants, link, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cloneTemplate,
  deriveBatchStatus,
  ExportBatchSchema,
  ExportPresetSchema,
  ExportTaskSchema,
  now,
  QueueStateSchema,
  type EditTemplate,
  type ExportBatch,
  type ExportPreset,
  type ExportTask,
  type MediaItem,
  type QueueState,
} from "./domain.js";
import { ArtifactVerifier } from "./artifact.js";
import { classifyError, JianjiError } from "./errors.js";
import { type FfmpegAdapter, type RunningCommand } from "./ffmpeg.js";
import { allocateOutputPath, assertOutputDirectorySafe, fingerprintFile, isPathWithinDirectory, validateTemplateResources, type FontResolver } from "./paths.js";
import { JobStore, StoreError } from "./store.js";
import { TemplateCompiler } from "./compiler.js";
import { executionLimits } from "./execution-limits.js";

export interface QueueSnapshot {
  revision: number;
  batches: QueueState[];
}

export interface CreateBatchInput {
  template: EditTemplate;
  projectId?: string;
  mediaIds: string[];
  mediaItems: readonly MediaItem[];
  outputDirectory: string;
  preset: ExportPreset;
}

export interface ExportQueueDependencies {
  jobStore: JobStore;
  ffmpeg: FfmpegAdapter;
  compiler?: TemplateCompiler;
  artifactVerifier?: ArtifactVerifier;
  fontResolver: FontResolver;
  onSnapshot?: (snapshot: QueueSnapshot) => void;
}

const EXECUTION = new Set(["validating", "running", "verifying", "cancelling"]);

function transitionAllowed(from: ExportTask["status"], to: ExportTask["status"]): boolean {
  const transitions: Record<ExportTask["status"], ExportTask["status"][]> = {
    queued: ["validating", "failed", "cancelled"],
    validating: ["running", "failed", "cancelled", "interrupted"],
    running: ["verifying", "failed", "cancelling", "interrupted"],
    verifying: ["completed", "failed", "cancelling", "interrupted"],
    cancelling: ["cancelled", "interrupted"],
    completed: [], failed: ["queued"], cancelled: ["queued"], interrupted: ["queued"],
  };
  return transitions[from].includes(to);
}

export function assertTaskTransition(from: ExportTask["status"], to: ExportTask["status"]): void {
  if (!transitionAllowed(from, to)) throw new Error(`invalid export task transition: ${from} -> ${to}`);
}

function immutableSnapshot(template: EditTemplate): EditTemplate {
  return cloneTemplate(template);
}

export class ExportQueue {
  private readonly limits = executionLimits();
  private readonly states = new Map<string, QueueState>();
  private readonly controllers = new Map<string, RunningCommand>();
  private readonly cancelRequested = new Set<string>();
  private readonly pendingStarts = new Set<string>();
  private running = false;
  private activeStart?: Promise<void>;
  private readonly activeTasks = new Map<string, { work: Promise<void>; threads: number }>();
  private finishStart?: (error?: unknown) => void;
  private executionError?: unknown;
  private shuttingDown = false;
  private shutdownRequested = false;
  private globalRevision = 0;
  private readonly compiler: TemplateCompiler;
  private readonly verifier: ArtifactVerifier;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: ExportQueueDependencies) {
    this.compiler = dependencies.compiler ?? new TemplateCompiler();
    this.verifier = dependencies.artifactVerifier ?? new ArtifactVerifier(dependencies.ffmpeg);
  }

  async recover(): Promise<QueueSnapshot> {
    const loaded = await this.dependencies.jobStore.loadAll();
    for (const state of loaded) {
      const recovered = structuredClone(state);
      let changed = false;
      for (const task of recovered.batch.tasks) {
        if (!EXECUTION.has(task.status)) continue;
        task.status = "interrupted";
        task.progress = Math.min(task.progress, 0.99);
        task.errorCode = "interrupted";
        task.errorMessage = "应用上次退出时任务尚未完成。";
        task.finishedAt = now();
        changed = true;
      }
      if (changed) {
        recovered.batch.status = deriveBatchStatus(recovered.batch.tasks);
        recovered.revision += 1;
        recovered.updatedAt = now();
        QueueStateSchema.parse(recovered);
        await this.dependencies.jobStore.save(recovered);
      }
      this.states.set(recovered.batch.id, recovered);
      this.globalRevision = Math.max(this.globalRevision, recovered.revision);
    }
    this.emit();
    return this.snapshot();
  }

  snapshot(): QueueSnapshot {
    return { revision: this.globalRevision, batches: [...this.states.values()].map((state) => structuredClone(state)) };
  }

  async createBatch(input: CreateBatchInput): Promise<ExportBatch> {
    if (this.shuttingDown) throw new Error("queue is shutting down");
    const template = immutableSnapshot(input.template);
    const parsedPreset = ExportPresetSchema.parse(input.preset);
    const selected = input.mediaIds.map((id) => input.mediaItems.find((item) => item.id === id));
    if (selected.some((item): item is undefined => !item)) throw new JianjiError("存在未找到的素材。", "input_invalid", "input", false);
    const media = selected as MediaItem[];
    if (media.some((item) => item.probeStatus !== "ready")) throw new JianjiError("只能导出探测成功的素材。", "input_invalid", "input", false);
    await assertOutputDirectorySafe(input.outputDirectory, media);
    const missing = await validateTemplateResources(template, this.dependencies.fontResolver);
    if (missing.length > 0) throw new JianjiError(`模板资源缺失：${missing.join("、")}`, "resource_missing", "resource", false);

    const batchId = randomUUID();
    const reserved: string[] = [];
    const tasks: ExportTask[] = [];
    for (const item of media) {
      const outputPath = await allocateOutputPath(input.outputDirectory, item.sourcePath, "_edited", reserved, parsedPreset.container);
      reserved.push(outputPath);
      tasks.push(ExportTaskSchema.parse({
        id: randomUUID(), batchId, mediaId: item.id, status: "queued", progress: 0,
        attempt: 0, outputPath, createdAt: now(), attempts: [],
      }));
    }
    const batch = ExportBatchSchema.parse({
      schemaVersion: 1, id: batchId, projectId: input.projectId ?? randomUUID(), templateSnapshot: template,
      mediaIds: media.map((item) => item.id), outputDirectory: path.resolve(input.outputDirectory),
      mediaSnapshots: structuredClone(media),
      preset: parsedPreset, status: "active", estimatedBytes: media.reduce((sum, item) => sum + item.sizeBytes, 0),
      createdAt: now(), tasks,
    });
    const state: QueueState = { schemaVersion: 1, revision: 1, batch, updatedAt: now() };
    await this.dependencies.jobStore.save(state);
    this.states.set(batch.id, state);
    this.globalRevision = Math.max(this.globalRevision, state.revision);
    this.emit();
    return structuredClone(batch);
  }

  async start(batchId: string): Promise<void> {
    if (this.shuttingDown) throw new Error("queue is shutting down");
    if (!this.states.has(batchId)) {
      const loaded = await this.dependencies.jobStore.load(batchId);
      this.states.set(batchId, loaded.state);
    }
    if (this.shuttingDown) return;
    const alreadyRunning = this.running;
    this.pendingStarts.add(batchId);
    if (!this.running) {
      this.running = true;
      this.executionError = undefined;
      this.activeStart = new Promise<void>((resolve, reject) => {
        this.finishStart = (error) => error === undefined ? resolve() : reject(error);
      });
    }
    const active = this.activeStart;
    this.pump();
    if (!alreadyRunning) await active;
  }

  private pump(): void {
    if (this.shuttingDown) this.pendingStarts.clear();
    for (const batchId of this.pendingStarts) {
      const state = this.states.get(batchId)!;
      for (const task of state.batch.tasks) {
        if (this.activeTasks.size >= this.limits.exports) return;
        if (task.status !== "queued" || this.activeTasks.has(task.id)) continue;
        const freeThreads = this.limits.threads - [...this.activeTasks.values()].reduce((sum, active) => sum + active.threads, 0);
        if (freeThreads <= 0) return;
        const waiting = [...this.pendingStarts].reduce((sum, id) => sum + this.states.get(id)!.batch.tasks.filter((candidate) => candidate.status === "queued" && !this.activeTasks.has(candidate.id)).length, 0);
        const maxThreads = Math.max(1, Math.min(8, Math.floor(this.limits.threads / 2)));
        const threads = Math.max(1, Math.min(maxThreads, Math.floor(freeThreads / Math.min(waiting, this.limits.exports - this.activeTasks.size))));
        const work = this.execute(state, task, threads).catch((error: unknown) => {
          this.executionError ??= error;
        }).finally(() => {
          this.activeTasks.delete(task.id);
          this.pump();
        });
        this.activeTasks.set(task.id, { work, threads });
      }
      this.pendingStarts.delete(batchId);
    }
    if (this.activeTasks.size === 0) {
      this.running = false;
      this.activeStart = undefined;
      const finish = this.finishStart;
      this.finishStart = undefined;
      finish?.(this.executionError);
    }
  }

  async cancel(taskId: string): Promise<void> {
    const located = this.findTask(taskId);
    if (!located) throw new Error("task not found");
    const { state, task } = located;
    if (task.status === "queued") {
      await this.transition(state, task, "cancelled", { errorCode: "cancelled", errorMessage: "用户取消了待处理任务。" });
      return;
    }
    if (task.status === "running" || task.status === "validating" || task.status === "verifying") {
      this.cancelRequested.add(taskId);
      if (task.status === "running" || task.status === "verifying") await this.transition(state, task, "cancelling");
      const controller = this.controllers.get(taskId);
      if (controller) await controller.cancel();
    }
  }

  async retry(taskIds?: readonly string[]): Promise<void> {
    const requested = taskIds ? new Set(taskIds) : undefined;
    const changedBatchIds: string[] = [];
    for (const state of this.states.values()) {
      let changed = false;
      for (const task of state.batch.tasks) {
        if (requested && !requested.has(task.id)) continue;
        if (!requested && !["failed", "interrupted"].includes(task.status)) continue;
        if (!["failed", "interrupted"].includes(task.status)) continue;
        task.attempts.push({ attempt: Math.max(1, task.attempt), status: task.status, startedAt: task.startedAt, finishedAt: task.finishedAt, outputPath: task.outputPath, errorCode: task.errorCode, errorMessage: task.errorMessage });
        task.attempt += 1;
        task.progress = 0;
        task.outputArtifact = undefined;
        task.outputPath = await allocateOutputPath(state.batch.outputDirectory, this.mediaFor(state, task)?.sourcePath ?? "video.mp4", "_edited", state.batch.tasks.filter((other) => other.id !== task.id).map((other) => other.outputPath).filter((entry): entry is string => Boolean(entry)), state.batch.preset.container);
        task.errorCode = undefined;
        task.errorMessage = undefined;
        task.startedAt = undefined;
        task.finishedAt = undefined;
        task.status = "queued";
        changed = true;
      }
      if (changed) { state.batch.status = "active"; await this.persist(state); changedBatchIds.push(state.batch.id); }
    }
    if (this.states.size > 0) this.emit();
    await Promise.all(changedBatchIds.map((batchId) => this.start(batchId)));
  }

  async hydrate(batches: readonly ExportBatch[]): Promise<void> {
    for (const batch of batches) {
      let state = this.states.get(batch.id);
      if (!state) {
        try { state = (await this.dependencies.jobStore.load(batch.id)).state; }
        catch (error) {
          if (error instanceof StoreError && error.code === "future_schema") throw error;
          state = { schemaVersion: 1, revision: 1, batch: structuredClone(batch), updatedAt: now() };
          await this.dependencies.jobStore.save(state);
        }
      }
      let recovered = false;
      for (const task of state.batch.tasks) {
        if (!EXECUTION.has(task.status)) continue;
        task.status = "interrupted";
        task.progress = Math.min(task.progress, 0.99);
        task.errorCode = "interrupted";
        task.errorMessage = "应用上次退出时任务尚未完成。";
        task.finishedAt = now();
        recovered = true;
      }
      for (const task of state.batch.tasks) {
        if (task.status !== "completed") continue;
        const outputIsSafe = Boolean(task.outputPath && isPathWithinDirectory(state.batch.outputDirectory, task.outputPath));
        try {
          if (!outputIsSafe) throw new Error("artifact path is outside output directory");
          await this.verifier.verify(task.outputPath!, task.id);
        } catch {
          task.status = "failed";
          task.errorCode = "artifact_missing";
          task.errorMessage = "已完成记录的输出文件不存在或已失效，可安全重试。";
          task.outputArtifact = undefined;
          task.finishedAt = now();
          recovered = true;
        }
      }
      if (recovered) {
        state.batch.status = deriveBatchStatus(state.batch.tasks);
        state.revision += 1;
        state.updatedAt = now();
        await this.dependencies.jobStore.save(state);
      }
      this.states.set(state.batch.id, state);
      this.globalRevision = Math.max(this.globalRevision, state.revision);
    }
    this.emit();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.shutdownRequested = true;
    const active = this.activeStart;
    for (const state of this.states.values()) {
      for (const task of state.batch.tasks) {
        if (EXECUTION.has(task.status)) this.cancelRequested.add(task.id);
      }
    }
    await Promise.all([...this.controllers].map(async ([taskId, controller]) => {
      this.cancelRequested.add(taskId);
      await controller.cancel();
    }));
    await active?.catch(() => undefined);
    for (const state of this.states.values()) {
      for (const task of state.batch.tasks) {
        if (EXECUTION.has(task.status)) {
          await this.transition(state, task, "interrupted", {
            errorCode: "interrupted",
            errorMessage: "应用安全停止，任务可在下次启动后重试。",
            finishedAt: now(),
          });
        }
      }
      if (state.batch.tasks.every((task) => !EXECUTION.has(task.status))) {
        state.batch.status = deriveBatchStatus(state.batch.tasks);
        await this.persist(state);
      }
    }
  }

  private mediaFor(state: QueueState, task: ExportTask): MediaItem | undefined {
    return state.batch.mediaSnapshots?.find((item) => item.id === task.mediaId) ?? this.mediaLookup?.(task.mediaId);
  }

  private mediaLookup?: (mediaId: string) => MediaItem | undefined;

  setMediaLookup(lookup: (mediaId: string) => MediaItem | undefined): void { this.mediaLookup = lookup; }

  private async execute(state: QueueState, task: ExportTask, threads: number): Promise<void> {
    const media = this.mediaFor(state, task);
    if (!media) { await this.fail(state, task, new JianjiError("找不到导出素材。", "input_invalid", "input", false)); return; }
    if (!task.outputPath || !isPathWithinDirectory(state.batch.outputDirectory, task.outputPath)) {
      await this.fail(state, task, new JianjiError("输出路径不在选定输出目录内。", "input_invalid", "input", false));
      return;
    }
    let partialPath: string | undefined;
    let temporaryTextFiles: string[] = [];
    await this.transition(state, task, "validating");
    try {
      await access(media.sourcePath, constants.R_OK);
      if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new JianjiError("原始素材在导出前已发生变化。", "input_invalid", "input", false);
      const missing = await validateTemplateResources(state.batch.templateSnapshot, this.dependencies.fontResolver);
      if (missing.length > 0) throw new JianjiError(`模板资源缺失：${missing.join("、")}`, "resource_missing", "resource", false);
      if (await this.stopRequested(state, task)) return;
      await this.transition(state, task, "running", { attempt: Math.max(1, task.attempt), startedAt: now() });
      if (await this.stopRequested(state, task)) return;
      partialPath = path.join(state.batch.outputDirectory, `.${path.basename(task.outputPath!)}.${state.batch.id}.${task.id}.${Math.max(1, task.attempt)}.partial.${state.batch.preset.container}`);
      const textPath = (layerId: string) => path.join(state.batch.outputDirectory, `.jianji-${task.id}-${Math.max(1, task.attempt)}-${layerId}.txt`);
      const compiled = await this.compiler.compile(state.batch.templateSnapshot, media, state.batch.preset, {
        ffmpegPath: this.dependencies.ffmpeg.ffmpegPath,
        fontResolver: this.dependencies.fontResolver,
        textFilePath: textPath,
        threads,
      });
      temporaryTextFiles = compiled.textFiles.map((file) => file.path);
      await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content, { encoding: "utf8", mode: 0o600 })));
      if (await this.stopRequested(state, task)) {
        await Promise.all(temporaryTextFiles.map((filePath) => unlink(filePath).catch(() => undefined)));
        return;
      }
      const running = this.dependencies.ffmpeg.run([...compiled.args, partialPath], (event) => {
        const value = event.progress === 1 ? 1 : event.outTimeMs === undefined ? task.progress : Math.min(0.99, event.outTimeMs / (compiled.durationSeconds * 1_000_000));
        if (value - task.progress >= 0.01 || value === 1) {
          task.progress = Math.max(task.progress, value);
          void this.persist(state);
        }
        this.emit();
      });
      this.controllers.set(task.id, running);
      if (this.cancelRequested.has(task.id)) await running.cancel();
      const result = await running.promise.catch((error) => { throw error; });
      this.controllers.delete(task.id);
      await Promise.all(compiled.textFiles.map((file) => unlink(file.path).catch(() => undefined)));
      if (this.cancelRequested.delete(task.id)) {
        await unlink(partialPath).catch(() => undefined);
        if (task.status !== "cancelling") await this.transition(state, task, "cancelling");
        if (this.shutdownRequested) {
          await this.transition(state, task, "interrupted", { errorCode: "interrupted", errorMessage: "应用安全停止，任务可在下次启动后重试。", finishedAt: now() });
          return;
        }
        await this.transition(state, task, "cancelled", { errorCode: "cancelled", errorMessage: "用户取消了当前任务。", finishedAt: now() });
        return;
      }
      if (result.code !== 0) throw new JianjiError(redactResult(result.stderr), "ffmpeg_failed", "process", true);
      await this.transition(state, task, "verifying", { progress: 0.99 });
      if (this.cancelRequested.delete(task.id)) {
        await unlink(partialPath).catch(() => undefined);
        if (task.status !== "cancelling") await this.transition(state, task, "cancelling");
        if (this.shutdownRequested) {
          await this.transition(state, task, "interrupted", { errorCode: "interrupted", errorMessage: "应用安全停止，任务可在下次启动后重试。", finishedAt: now() });
        } else {
          await this.transition(state, task, "cancelled", { errorCode: "cancelled", errorMessage: "用户取消了当前任务。", finishedAt: now() });
        }
        return;
      }
      await syncFile(partialPath);
      const artifact = await this.verifier.verify(partialPath, task.id);
      if (this.cancelRequested.delete(task.id)) {
        await unlink(partialPath).catch(() => undefined);
        if (task.status !== "cancelling") await this.transition(state, task, "cancelling");
        if (this.shutdownRequested) {
          await this.transition(state, task, "interrupted", { errorCode: "interrupted", errorMessage: "应用安全停止，任务可在下次启动后重试。", finishedAt: now() });
        } else {
          await this.transition(state, task, "cancelled", { errorCode: "cancelled", errorMessage: "用户取消了当前任务。", finishedAt: now() });
        }
        return;
      }
      let finalPath = await publishWithoutReplacement(partialPath, task.outputPath as string, state.batch.outputDirectory, media.sourcePath, state.batch.tasks.filter((other) => other.id !== task.id).map((other) => other.outputPath).filter((entry): entry is string => Boolean(entry)), state.batch.preset.container);
      artifact.path = finalPath;
      task.outputPath = finalPath;
      task.outputArtifact = artifact;
      await this.transition(state, task, "completed", { progress: 1, finishedAt: now(), errorCode: undefined, errorMessage: undefined });
    } catch (error) {
      this.controllers.delete(task.id);
      await Promise.all(temporaryTextFiles.map((filePath) => unlink(filePath).catch(() => undefined)));
      if (partialPath) await unlink(partialPath).catch(() => undefined);
      if (this.shutdownRequested && EXECUTION.has(task.status)) {
        await this.transition(state, task, "interrupted", { errorCode: "interrupted", errorMessage: "应用安全停止，任务可在下次启动后重试。", finishedAt: now() });
        return;
      }
      await this.fail(state, task, classifyError(error));
    }
  }

  private async fail(state: QueueState, task: ExportTask, error: JianjiError): Promise<void> {
    const target = task.status === "cancelling" ? "cancelled" : "failed";
    if (task.status !== target) await this.transition(state, task, target, { errorCode: error.code, errorMessage: error.message, finishedAt: now() });
  }

  private async stopRequested(state: QueueState, task: ExportTask): Promise<boolean> {
    const cancelled = this.cancelRequested.delete(task.id);
    if (!this.shutdownRequested && !cancelled) return false;
    const interrupted = this.shutdownRequested;
    await this.transition(state, task, interrupted ? "interrupted" : "cancelled", {
      errorCode: interrupted ? "interrupted" : "cancelled",
      errorMessage: interrupted ? "应用安全停止，任务可在下次启动后重试。" : "用户取消了待处理任务。",
      finishedAt: now(),
    });
    return true;
  }

  private async transition(state: QueueState, task: ExportTask, to: ExportTask["status"], patch: Partial<ExportTask> = {}): Promise<void> {
    assertTaskTransition(task.status, to);
    Object.assign(task, patch);
    task.status = to;
    state.batch.status = deriveBatchStatus(state.batch.tasks);
    await this.persist(state);
  }

  private async persist(state: QueueState): Promise<void> {
    const work = this.persistChain.then(async () => {
      state.revision = Math.max(this.globalRevision, state.revision) + 1;
      state.updatedAt = now();
      QueueStateSchema.parse(state);
      await this.dependencies.jobStore.save(state);
      this.states.set(state.batch.id, state);
      this.globalRevision = state.revision;
      this.emit();
    });
    this.persistChain = work.catch(() => undefined);
    return work;
  }

  private findTask(taskId: string): { state: QueueState; task: ExportTask } | undefined {
    for (const state of this.states.values()) {
      const task = state.batch.tasks.find((item) => item.id === taskId);
      if (task) return { state, task };
    }
    return undefined;
  }

  private emit(): void { this.dependencies.onSnapshot?.(this.snapshot()); }
}

function redactResult(stderr: string): string {
  return stderr.replace(/(?:\/[^\s:'"]+)+/g, "<path>").trim().slice(-2_000) || "FFmpeg 未返回错误详情。";
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Directory fsync is unsupported by some filesystems; the file sync remains useful.
  }
}

async function publishWithoutReplacement(partialPath: string, requestedPath: string, outputDirectory: string, sourcePath: string, reserved: readonly string[], container: ExportPreset["container"]): Promise<string> {
  let finalPath = requestedPath;
  while (true) {
    try {
      await link(partialPath, finalPath);
      await unlink(partialPath);
      await syncDirectory(outputDirectory);
      return finalPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      finalPath = await allocateOutputPath(outputDirectory, sourcePath, "_edited", [...reserved, finalPath], container);
    }
  }
}
