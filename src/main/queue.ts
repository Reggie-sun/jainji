import { createHash, randomUUID } from "node:crypto";
import { access, constants, copyFile, unlink, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION,
  assertPriceOnlyTemplate,
  BalancedStickerPicker,
  cloneTemplate,
  cloneTemplateForRandom,
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
  type OutputArtifact,
  type QueueState,
  type RandomStickerPoolEntry,
} from "./domain.js";
import { ArtifactVerifier } from "./artifact.js";
import { classifyError, JianjiError } from "./errors.js";
import { type FfmpegAdapter, type RunningCommand } from "./ffmpeg.js";
import { allocateOutputPath, assertOutputDirectorySafe, fingerprintFile, isPathWithinDirectory, publishWithoutReplacement, syncFile, validateTemplateResources, type FontResolver } from "./paths.js";
import { JobStore, StoreError } from "./store.js";
import { TemplateCompiler } from "./compiler.js";
import { assertShapeCoverExportReady, verifyFrozenShapeSources } from "./shape-cover-render.js";
import { verifyApprovedHybridTemplate, verifyHybridOutput } from "./hybrid-cover-production.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { executionLimits, exportThreads } from "./execution-limits.js";
import type { H264Capability, H264Encoder } from "./video-encoder.js";
import { outputDimensions } from "../shared/export-settings.js";
import { estimateNvencMemoryMiB, GPU_MEMORY_RESERVE_MIB, readGpuFreeMemory } from "./gpu-memory.js";
import { reviewDigest } from "./cover-review-approval.js";
import { measureCoverStage, type CoverDiagnostics } from "./cover-diagnostics.js";
import { MAX_AGENT_OUTPUTS, type AppendProductionPrefill } from "../shared/agent.js";
import { verifyShapeCoverAdmission, type ShapeCoverAdmission } from "./shape-cover-admission.js";
import { templateDigest } from "./supervisor-knowledge.js";
import { ShapeCoverArtifactStore } from "./shape-cover-artifacts.js";
import { NvencAdmission, type NvencPermit } from "./nvenc-admission.js";

const shapePreviewReceipts = new WeakMap<ExportQueue, Map<string, string>>();
const shapePreviewBinding = (template: EditTemplate, media: MediaItem, preset: ExportPreset, fingerprint: string) =>
  JSON.stringify([templateDigest(template), media, preset, fingerprint]);

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
  submission?: ExportBatch["submission"];
}

export type ExportBatchIdentity = Pick<ExportBatch, "id" | "projectId"> & { tasks: Pick<ExportTask, "id">[] };

export interface ExportQueueDependencies {
  onFinalArtifactCommitted?: (fact: { projectId: string; batchId: string; taskId: string; artifact: OutputArtifact }) => void | Promise<void>;
  onFinalArtifactNotificationError?: () => void;
  gpuFreeMemory?: () => Promise<number | undefined>;
  nvencAdmission?: Pick<NvencAdmission, "acquire">;
  videoEncoder?: H264Capability;
  executionLimits?: ReturnType<typeof executionLimits>;
  jobStore: JobStore;
  ffmpeg: FfmpegAdapter;
  compiler?: TemplateCompiler;
  artifactVerifier?: ArtifactVerifier;
  fontResolver: FontResolver;
  sourceKnowledgeStore?: SourceStickerKnowledgeStore;
  onSnapshot?: (snapshot: QueueSnapshot) => void;
  snapshotProjectId?: () => string;
}

interface PendingPreview {
  id: string;
  template: EditTemplate;
  media: MediaItem;
  preset: ExportPreset;
  cacheDirectory: string;
  signal: AbortSignal;
  diagnostics?: CoverDiagnostics;
  queueWait?: Parameters<CoverDiagnostics["finish"]>[0];
  abortListener: () => void;
  resolve: (output: string) => void;
  reject: (error: unknown) => void;
}

function abortErrorOf(signal: AbortSignal): unknown {
  try { signal.throwIfAborted(); } catch (error) { return error; }
  return new Error("预览已停止。");
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
  private readonly limits: ReturnType<typeof executionLimits>;
  private readonly videoEncoder: H264Capability;
  private readonly nvencAdmission: Pick<NvencAdmission, "acquire">;
  private readonly states = new Map<string, QueueState>();
  private readonly controllers = new Map<string, RunningCommand>();
  private readonly cancelRequested = new Set<string>();
  private readonly pendingStarts = new Set<string>();
  private readonly preparingRetries = new Set<string>();
  private readonly pendingPreviews: PendingPreview[] = [];
  private running = false;
  private activeStart?: Promise<void>;
  private readonly activeTasks = new Map<string, { work: Promise<void>; threads: number; gpuMemory: number }>();
  private probingMemory = false;
  private gpuMemoryObserved = false;
  private pumpRequested = false;
  private memoryTimer?: ReturnType<typeof setTimeout>;
  private finishStart?: (error?: unknown) => void;
  private executionError?: unknown;
  private shuttingDown = false;
  private shutdownRequested = false;
  private globalRevision = 0;
  private readonly compiler: TemplateCompiler;
  private readonly verifier: ArtifactVerifier;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly pendingProgressSaves = new Set<string>();
  private submissionChain: Promise<void> = Promise.resolve();

  async renderPreview(input: { template: EditTemplate; media: MediaItem; preset: ExportPreset; cacheDirectory: string; signal: AbortSignal; diagnostics?: CoverDiagnostics }): Promise<string> {
    input.signal.throwIfAborted();
    if (this.shuttingDown) throw new Error("预览已停止。");
    const preset = ExportPresetSchema.parse(input.preset);
    const template = immutableSnapshot(input.template);
    const media = structuredClone(input.media);
    // Previews drive the paid supervisor pipeline: they share the render slots
    // and start ahead of queued exports instead of waiting for a fully idle queue.
    const queueWait = input.diagnostics?.record("queue-wait", "running");
    const id = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const pending: PendingPreview = {
        id, template, media, preset, cacheDirectory: input.cacheDirectory,
        signal: input.signal, diagnostics: input.diagnostics, queueWait,
        abortListener: () => undefined, resolve, reject,
      };
      pending.abortListener = () => {
        const index = this.pendingPreviews.indexOf(pending);
        if (index < 0) return; // Already started; the render's own abort wiring cancels it.
        this.pendingPreviews.splice(index, 1);
        input.diagnostics?.finish(queueWait, input.signal, true);
        reject(abortErrorOf(input.signal));
      };
      input.signal.addEventListener("abort", pending.abortListener, { once: true });
      this.pendingPreviews.push(pending);
      this.pump();
    });
  }

  private async executePreview(preview: PendingPreview, threads: number, permit?: NvencPermit): Promise<string> {
    const { id, template, media, preset, signal } = preview;
    signal.throwIfAborted();
    assertPriceOnlyTemplate(template);
    if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new Error("原素材已变化。");
    await verifyFrozenShapeSources(template, media, this.dependencies.sourceKnowledgeStore, signal);
    const missing = await validateTemplateResources(template, this.dependencies.fontResolver);
    if (missing.length) throw new Error("预览依赖素材不可用。");
    await mkdir(preview.cacheDirectory, { recursive: true });
    const directory = await realpath(preview.cacheDirectory);
    const output = path.join(directory, `${id}.${preset.container}`);
    const compiled = await this.compiler.compile(template, media, preset, {
      ffmpegPath: this.dependencies.ffmpeg.ffmpegPath, fontResolver: this.dependencies.fontResolver,
      textFilePath: (layerId) => path.join(directory, `${id}-${layerId}.txt`),
      threads, videoEncoder: this.resolveEncoder(),
    });
    const files = [...compiled.textFiles, ...compiled.binaryFiles ?? []];
    try {
      if (this.resolveEncoder() === "h264_nvenc") {
        const free = await (this.dependencies.gpuFreeMemory ?? readGpuFreeMemory)();
        const size = outputDimensions(media, preset);
        if (free !== undefined && free - GPU_MEMORY_RESERVE_MIB < estimateNvencMemoryMiB(size.width, size.height)) throw new Error("GPU 显存不足，预览未开始。");
      }
      const written = await Promise.allSettled(files.map((file) => writeFile(file.path, file.content, { mode: 0o600 })));
      for (const item of written) if (item.status === "rejected") throw item.reason;
      signal.throwIfAborted();
      if (this.shuttingDown) throw new Error("预览已停止。");
      let command: RunningCommand | undefined;
      const abort = () => { void command?.cancel(); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        let encoderStarted = false;
        await measureCoverStage(preview.diagnostics, "full-render", signal, async () => {
          permit?.assertValid();
          command = this.dependencies.ffmpeg.run([...compiled.args, output], event => {
            if (permit && !encoderStarted && (event.outTimeMs ?? 0) > 0) {
              encoderStarted = true;
              void permit.started().then(() => this.pump());
            }
          });
          this.controllers.set(id, command);
          const result = await command.promise;
          signal.throwIfAborted();
          if (this.shuttingDown || result.code !== 0) throw new Error("动态预览渲染失败。");
        });
        await measureCoverStage(preview.diagnostics, "artifact-verify", signal, async () => {
          await this.verifier.verify(output, id);
          await verifyFrozenShapeSources(template, media, this.dependencies.sourceKnowledgeStore, signal);
          signal.throwIfAborted();
        });
        if (template.layers.some(layer => layer.type === "sticker" && layer.cover?.shapeMatched)) {
          const receipts = shapePreviewReceipts.get(this) ?? new Map<string, string>();
          receipts.set(output, shapePreviewBinding(template, media, preset, await fingerprintFile(output)));
          if (receipts.size > 32) receipts.delete(receipts.keys().next().value!);
          shapePreviewReceipts.set(this, receipts);
        }
        return output;
      } finally { signal.removeEventListener("abort", abort); this.controllers.delete(id); }
    } catch (error) { await unlink(output).catch(() => undefined); throw error; }
    finally { await Promise.all(files.map(({ path }) => unlink(path).catch(() => undefined))); }
  }

  constructor(private readonly dependencies: ExportQueueDependencies) {
    this.videoEncoder = dependencies.videoEncoder ?? { kind: "software-only" };
    this.limits = { ...(dependencies.executionLimits ?? executionLimits(undefined, this.resolveEncoder())) };
    this.nvencAdmission = dependencies.nvencAdmission ?? new NvencAdmission();
    this.compiler = dependencies.compiler ?? new TemplateCompiler();
    this.verifier = dependencies.artifactVerifier ?? new ArtifactVerifier(dependencies.ffmpeg);
  }

  async verifyShapePreview(path: string, template: EditTemplate, media: MediaItem, preset: ExportPreset): Promise<void> {
    const receipt = shapePreviewReceipts.get(this)?.get(path);
    if (!receipt || receipt !== shapePreviewBinding(template, media, preset, await fingerprintFile(path))) throw new Error("UNSAFE: sample was not rendered by this queue with this binding");
  }

  /**
   * Returns the concrete encoder string that ffmpeg will be invoked with.
   * Hardware-capable states pick the probed hardware; software states fall back
   * to libx264 — `H264Capability` only describes why, not the actual binary.
   */
  private resolveEncoder(): H264Encoder {
    return this.videoEncoder.kind === "hardware" ? this.videoEncoder.encoder : "libx264";
  }

  async recover(): Promise<QueueSnapshot> {
    const loaded = await this.dependencies.jobStore.loadAll();
    let processed = 0;
    for (const state of loaded) {
      const recovered = structuredClone(state);
      let changed = false;
      for (const task of recovered.batch.tasks) {
        if (task.status !== "queued" && !EXECUTION.has(task.status)) continue;
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
      // Keep the event loop responsive over large job archives.
      if (++processed % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.emit();
    return this.snapshot();
  }

  snapshot(projectId?: string): QueueSnapshot {
    const states = [...this.states.values()].filter(state => projectId === undefined || state.batch.projectId === projectId);
    return { revision: this.globalRevision, batches: states.map((state) => structuredClone(state)) };
  }

  taskStatuses(): ReadonlyMap<string, ExportTask["status"]> {
    const statuses = new Map<string, ExportTask["status"]>();
    for (const { batch } of this.states.values()) for (const task of batch.tasks) statuses.set(task.id, task.status);
    return statuses;
  }

  /** Concurrent render slots shared by exports and review previews. */
  get renderSlots(): number { return this.limits.exports; }

  /** Main-process shape custody uses this queue's canonical JobStore, never a caller-selected ledger. */
  async createShapeCoverArtifactStore(projectId: string): Promise<ShapeCoverArtifactStore> {
    const root = path.join(path.dirname(this.dependencies.jobStore.pathFor(projectId)), "shape-cover-artifacts");
    const artifacts = new ShapeCoverArtifactStore({ root, projectId, jobStore: this.dependencies.jobStore });
    await mkdir(root, { recursive: true, mode: 0o700 });
    return artifacts;
  }

  async createBatch(input: CreateBatchInput, signal?: AbortSignal): Promise<ExportBatch> {
    signal?.throwIfAborted();
    assertShapeCoverExportReady(input.template);
    if (!input.submission) return this.createBatchNow(input, signal);
    const frozen = structuredClone(input);
    const work = this.submissionChain.catch(() => undefined).then(async () => {
      signal?.throwIfAborted();
      const submission = frozen.submission!;
      if (frozen.mediaIds.length !== 1 || frozen.mediaIds[0] !== submission.mediaId) throw new Error("批准提交素材不匹配。");
      const digest = reviewDigest({ projectId: frozen.projectId, template: frozen.template, media: frozen.mediaItems.filter(({ id }) => id === submission.mediaId), preset: frozen.preset, outputDirectory: path.resolve(frozen.outputDirectory) });
      if (digest !== submission.bindingDigest) throw new Error("批准提交摘要不匹配。");
      // Also inspect durable jobs: a prior save may have succeeded before its
      // caller received a receipt, including after a process restart.
      const states = [...this.states.values(), ...await this.dependencies.jobStore.loadAll()];
      signal?.throwIfAborted();
      const existing = states.find(({ batch }) => batch.submission?.submissionId === submission.submissionId && batch.submission.mediaId === submission.mediaId && batch.submission.version === submission.version);
      if (existing) {
        if (existing.batch.submission!.bindingDigest !== digest) throw new Error("相同批准提交键的内容发生冲突。");
        return structuredClone(existing.batch);
      }
      return this.createBatchNow(frozen, signal);
    });
    this.submissionChain = work.then(() => undefined, () => undefined);
    return work;
  }

  private async createBatchNow(input: CreateBatchInput, signal?: AbortSignal): Promise<ExportBatch> {
    signal?.throwIfAborted();
    if (this.shuttingDown) throw new Error("queue is shutting down");
    const template = immutableSnapshot(input.template);
    assertPriceOnlyTemplate(template);
    assertShapeCoverExportReady(template);
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
      schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId: input.projectId ?? randomUUID(), templateSnapshot: template,
      mediaIds: media.map((item) => item.id), outputDirectory: path.resolve(input.outputDirectory),
      mediaSnapshots: structuredClone(media),
      submission: input.submission,
      preset: parsedPreset, status: "active", estimatedBytes: media.reduce((sum, item) => sum + item.sizeBytes, 0),
      createdAt: now(), tasks,
    });
    const state: QueueState = { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch, updatedAt: now() };
    signal?.throwIfAborted();
    await this.dependencies.jobStore.save(state, signal);
    this.states.set(batch.id, state);
    this.globalRevision = Math.max(this.globalRevision, state.revision);
    this.emit();
    return structuredClone(batch);
  }

  async appendPrefill(batchId: string, projectId: string): Promise<AppendProductionPrefill | undefined> {
    const source = await this.findAppendSource(batchId);
    if (!source || source.projectId !== projectId) return undefined;
    return { productPrice: source.templateSnapshot.productPrice ?? "", mediaCount: source.mediaIds.length, displayTextEnabled: source.templateSnapshot.displayText?.enabled !== false };
  }

  async appendFromBatch(input: { batchId: string; projectId: string; count: number; productPrice: string; outputDirectory: string }, stickerPool: readonly RandomStickerPoolEntry[], signal?: AbortSignal): Promise<ExportBatch[]> {
    const source = await this.findAppendSource(input.batchId);
    if (!source || source.projectId !== input.projectId) throw new JianjiError("只能追加当前项目中的已完成批次。", "input_invalid", "input", false);
    if (source.status !== "completed" && source.status !== "completed_with_errors") throw new JianjiError("只能追加已完成导出的批次。", "input_invalid", "input", false);
    if (input.count * source.mediaIds.length > MAX_AGENT_OUTPUTS) throw new JianjiError(`追加条数超出单次上限 ${MAX_AGENT_OUTPUTS} 条。`, "input_invalid", "input", false);
    const mediaItems = source.mediaIds.map((id) => source.mediaSnapshots?.find((item) => item.id === id) ?? this.mediaLookup?.(id));
    if (mediaItems.some((item): item is undefined => !item)) throw new JianjiError("源批次素材已变化，无法追加制作。", "input_invalid", "input", false);
    const media = mediaItems as MediaItem[];
    const picker = new BalancedStickerPicker(stickerPool);
    const created: ExportBatch[] = [];
    for (let index = 0; index < input.count; index += 1) {
      const template = cloneTemplateForRandom(source.templateSnapshot, input.productPrice, picker);
      created.push(await this.createBatchNow({ template, projectId: source.projectId, mediaIds: [...source.mediaIds], mediaItems: media, outputDirectory: input.outputDirectory, preset: source.preset }, signal));
    }
    return created;
  }

  private async findAppendSource(batchId: string): Promise<ExportBatch | undefined> {
    const cached = this.states.get(batchId);
    if (cached) return structuredClone(cached.batch);
    try {
      return structuredClone((await this.dependencies.jobStore.load(batchId)).state.batch);
    } catch {
      return undefined;
    }
  }

  /**
   * Publish an already-approved review sample as the final export: verify it,
   * move it into the output directory without overwriting existing files, and
   * record the artifact as a completed task. Skips the render pipeline so a
   * supervised version is in the folder the moment the supervisor passes.
   */
  async publishApprovedSample(input: { template: EditTemplate; media: MediaItem; preset: ExportPreset; samplePath: string; outputDirectory: string; projectId?: string; shapeAdmission?: ShapeCoverAdmission; onTaskCreated?: (batch: ExportBatchIdentity) => Promise<void> }): Promise<{ batchId: string; taskId: string; outputPath: string }> {
    if (this.shuttingDown) throw new Error("queue is shutting down");
    const template = immutableSnapshot(input.template);
    input = { ...input, media: structuredClone(input.media), preset: ExportPresetSchema.parse(input.preset) };
    assertPriceOnlyTemplate(template);
    const shape = template.layers.some(layer => layer.type === "sticker" && layer.cover?.shapeMatched);
    if (shape) await verifyShapeCoverAdmission(input.shapeAdmission, template, input.media, input.preset, input.samplePath);
    if (input.media.probeStatus !== "ready") throw new JianjiError("只能发布已审核通过的素材。", "input_invalid", "input", false);
    await assertOutputDirectorySafe(input.outputDirectory, [input.media]);
    if (await fingerprintFile(input.media.sourcePath) !== input.media.fingerprint) throw new JianjiError("原始素材在导出前已发生变化。", "input_invalid", "input", false);
    const missing = await validateTemplateResources(template, this.dependencies.fontResolver);
    if (missing.length > 0) throw new JianjiError(`模板资源缺失：${missing.join("、")}`, "resource_missing", "resource", false);
    const parsed = ExportPresetSchema.parse(input.preset);
    const outputPath = await allocateOutputPath(input.outputDirectory, input.media.sourcePath, "_edited", [], parsed.container);

    const batchId = randomUUID();
    ExportTaskSchema.parse({
      id: randomUUID(), batchId, mediaId: input.media.id, status: "queued", progress: 0,
      attempt: 0, outputPath, createdAt: now(), attempts: [],
    });
    const batch = ExportBatchSchema.parse({
      schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId: input.projectId ?? randomUUID(), templateSnapshot: template,
      mediaIds: [input.media.id], outputDirectory: path.resolve(input.outputDirectory),
      mediaSnapshots: structuredClone([input.media]),
      submission: undefined, preset: parsed, status: "active", estimatedBytes: input.media.sizeBytes,
      createdAt: now(), tasks: [{ id: randomUUID(), batchId, mediaId: input.media.id, status: "queued", progress: 0,
        attempt: 0, outputPath, createdAt: now(), attempts: [] }],
    });
    const state: QueueState = { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch, updatedAt: now() };
    const task = state.batch.tasks[0];
    this.states.set(batch.id, state);
    const partialPath = path.join(state.batch.outputDirectory, `.${path.basename(outputPath)}.${batchId}.${task.id}.1.partial.${parsed.container}`);

    await this.transition(state, task, "validating");
    try { await input.onTaskCreated?.({ id: state.batch.id, projectId: state.batch.projectId, tasks: state.batch.tasks.map(task => ({ id: task.id })) }); }
    catch { try { this.dependencies.onFinalArtifactNotificationError?.(); } catch { /* Diagnostic only. */ } }
    await this.transition(state, task, "running", { attempt: Math.max(1, task.attempt), startedAt: now() });
    try {
      await copyFile(input.samplePath, partialPath);
      await syncFile(partialPath);
      if (shape) await verifyShapeCoverAdmission(input.shapeAdmission, template, input.media, parsed, partialPath);
      await this.transition(state, task, "verifying", { progress: 0.99 });
      const artifact = await this.verifier.verify(partialPath, task.id);
      if (shape) await verifyShapeCoverAdmission(input.shapeAdmission, template, input.media, parsed, partialPath);
      const finalPath = await publishWithoutReplacement(partialPath, outputPath, state.batch.outputDirectory, input.media.sourcePath, [], parsed.container);
      artifact.path = finalPath;
      task.outputPath = finalPath;
      task.outputArtifact = artifact;
      await this.transition(state, task, "completed", { progress: 1, finishedAt: now(), errorCode: undefined, errorMessage: undefined });
      this.finalArtifactCommitted(state, task);
      return { batchId: batch.id, taskId: task.id, outputPath: finalPath };
    } catch (error) {
      await unlink(partialPath).catch(() => undefined);
      await this.fail(state, task, classifyError(error));
      throw error;
    }
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
    clearTimeout(this.memoryTimer);
    this.memoryTimer = undefined;
    if (this.probingMemory) { this.pumpRequested = true; return; }
    if (this.resolveEncoder() !== "h264_nvenc" || this.shuttingDown) { this.pumpReady(); return; }
    this.probingMemory = true;
    void Promise.resolve().then(this.dependencies.gpuFreeMemory ?? readGpuFreeMemory).catch(() => undefined).then(async (free) => {
      // A transient telemetry failure must not bypass a previously observed
      // memory constraint. Single-slot fallback is only for unsupported hosts.
      if (free !== undefined) this.gpuMemoryObserved = true;
      const hasQueued = this.pendingPreviews.length > 0 || [...this.pendingStarts].some(id => this.states.get(id)?.batch.tasks.some(task => task.status === "queued" && !this.activeTasks.has(task.id) && !this.cancelRequested.has(task.id)));
      let permit: NvencPermit | undefined;
      if (!this.shuttingDown && hasQueued && this.activeTasks.size < this.limits.exports) {
        let coordinationFailed = false;
        permit = await this.nvencAdmission.acquire(this.limits.exports).catch(() => { coordinationFailed = true; return undefined; });
        if (!permit && !this.shuttingDown) {
          let changed = false;
          for (const id of this.pendingStarts) {
            for (const task of this.states.get(id)?.batch.tasks ?? []) {
              const message = coordinationFailed ? "GPU 编码协调不可用，导出未开始。请检查临时目录权限，可停止此任务。" : "等待 GPU 编码会话释放后继续导出，可停止此任务。";
              if (task.status === "queued" && !this.activeTasks.has(task.id) && task.errorMessage !== message) { task.errorMessage = message; changed = true; }
            }
          }
          if (changed) this.emit();
          this.memoryTimer = setTimeout(() => this.pump(), 2000);
          return;
        }
      }
      const started = this.pumpReady(free ?? (this.gpuMemoryObserved ? 0 : undefined), permit);
      if (!started) await permit?.release();
    }).finally(() => {
      this.probingMemory = false;
      if (this.pumpRequested) { this.pumpRequested = false; this.pump(); }
    });
  }

  private pumpReady(freeGpuMiB?: number, permit?: NvencPermit): boolean | void {
    if (this.shuttingDown) {
      this.pendingStarts.clear();
      while (this.pendingPreviews.length) {
        const preview = this.pendingPreviews.shift()!;
        preview.signal.removeEventListener("abort", preview.abortListener);
        preview.diagnostics?.finish(preview.queueWait, preview.signal, true);
        preview.reject(new Error("预览已停止。"));
      }
    }
    // Reserve active tasks again: a just-launched encoder may not yet appear in
    // nvidia-smi. Conservative double accounting prevents startup bursts.
    let gpuBudget = (freeGpuMiB ?? 0) - GPU_MEMORY_RESERVE_MIB - [...this.activeTasks.values()].reduce((sum, task) => sum + task.gpuMemory, 0);
    // Supervisor previews block a paid model pipeline, so they take render slots
    // ahead of queued exports; analysis is bounded, so export starvation is temporary.
    while (this.pendingPreviews.length) {
      const preview = this.pendingPreviews[0];
      if (preview.signal.aborted) {
        this.pendingPreviews.shift();
        preview.signal.removeEventListener("abort", preview.abortListener);
        preview.diagnostics?.finish(preview.queueWait, preview.signal, true);
        preview.reject(abortErrorOf(preview.signal));
        continue;
      }
      if (this.activeTasks.size >= this.limits.exports) return;
      const freeThreads = this.limits.threads - [...this.activeTasks.values()].reduce((sum, active) => sum + active.threads, 0);
      if (freeThreads <= 0) return;
      const dimensions = outputDimensions(preview.media, preview.preset);
      const gpuMemory = this.resolveEncoder() === "h264_nvenc" ? estimateNvencMemoryMiB(dimensions.width, dimensions.height) : 0;
      if (gpuMemory && !permit) return;
      if (gpuMemory && (freeGpuMiB === undefined ? this.activeTasks.size > 0 : gpuBudget < gpuMemory)) {
        this.memoryTimer = setTimeout(() => this.pump(), 2000);
        return;
      }
      gpuBudget -= gpuMemory;
      const maxThreads = exportThreads(this.limits);
      const threads = Math.min(maxThreads, freeThreads);
      this.pendingPreviews.shift();
      preview.signal.removeEventListener("abort", preview.abortListener);
      preview.diagnostics?.finish(preview.queueWait, preview.signal, false);
      const tracked = this.executePreview(preview, threads, permit).then(preview.resolve, preview.reject).then(() => undefined, () => undefined)
        .finally(async () => { await permit?.release(); this.activeTasks.delete(preview.id); this.pump(); });
      this.activeTasks.set(preview.id, { work: tracked, threads, gpuMemory });
      if (permit) { this.pumpRequested = true; return true; }
    }
    for (const batchId of this.pendingStarts) {
      const state = this.states.get(batchId)!;
      for (const task of state.batch.tasks) {
        if (this.activeTasks.size >= this.limits.exports) return;
        if (task.status !== "queued" || this.activeTasks.has(task.id) || this.cancelRequested.has(task.id)) continue;
        const freeThreads = this.limits.threads - [...this.activeTasks.values()].reduce((sum, active) => sum + active.threads, 0);
        if (freeThreads <= 0) return;
        const media = this.mediaFor(state, task);
        const dimensions = media ? outputDimensions(media, state.batch.preset) : { width: 1280, height: 720 };
        const gpuMemory = this.resolveEncoder() === "h264_nvenc" ? estimateNvencMemoryMiB(dimensions.width, dimensions.height) : 0;
        if (gpuMemory && !permit) return;
        if (gpuMemory && (freeGpuMiB === undefined ? this.activeTasks.size > 0 : gpuBudget < gpuMemory)) {
          const message = "等待 GPU 显存释放后继续导出，可停止此任务。";
          if (task.errorMessage !== message) { task.errorMessage = message; this.emit(); }
          this.memoryTimer = setTimeout(() => this.pump(), 2000);
          return;
        }
        task.errorMessage = undefined;
        gpuBudget -= gpuMemory;
        // Reserve a fair CPU share for later jobs, which arrive progressively
        // while the Agent is planning; early exports must not consume all slots' budget.
        const maxThreads = exportThreads(this.limits);
        const threads = Math.min(maxThreads, freeThreads);
        const work = this.execute(state, task, threads, permit).catch((error: unknown) => {
          this.executionError ??= error;
        }).finally(async () => {
          await permit?.release();
          this.activeTasks.delete(task.id);
          this.pump();
        });
        this.activeTasks.set(task.id, { work, threads, gpuMemory });
        if (permit) { this.pumpRequested = true; return true; }
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
      this.pump();
      return;
    }
    if (task.status === "running" || task.status === "validating" || task.status === "verifying") {
      this.cancelRequested.add(taskId);
      if (task.status === "running" || task.status === "verifying") await this.transition(state, task, "cancelling");
      const controller = this.controllers.get(taskId);
      if (controller) await controller.cancel();
    }
  }

  async cancelAll(projectId: string): Promise<void> {
    const tasks = [...this.states.values()]
      .filter((state) => state.batch.projectId === projectId)
      .flatMap((state) => state.batch.tasks);
    const queued = tasks.filter((task) => task.status === "queued");
    for (const task of queued) this.cancelRequested.add(task.id);
    try {
      for (const task of queued) await this.cancel(task.id);
    } finally {
      for (const task of queued) this.cancelRequested.delete(task.id);
    }
    for (const task of tasks) {
      if (task.status === "validating" || task.status === "running" || task.status === "verifying") await this.cancel(task.id);
    }
  }

  async retry(taskIds?: readonly string[]): Promise<void> {
    const requested = taskIds ? new Set(taskIds) : undefined;
    for (const state of this.states.values()) {
      if (state.batch.tasks.some((task) => (!requested || requested.has(task.id)) && ["failed", "interrupted"].includes(task.status))) {
        assertPriceOnlyTemplate(state.batch.templateSnapshot);
      }
    }
    const preparedTaskIds: string[] = [];
    try {
      const changedBatchIds: string[] = [];
      for (const state of this.states.values()) {
        let changed = false;
        for (const task of state.batch.tasks) {
          if (this.preparingRetries.has(task.id)) continue;
          if (requested && !requested.has(task.id)) continue;
          if (!requested && !["failed", "interrupted"].includes(task.status)) continue;
          if (!["failed", "interrupted"].includes(task.status)) continue;
          this.preparingRetries.add(task.id);
          preparedTaskIds.push(task.id);
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
    } finally {
      for (const id of preparedTaskIds) this.preparingRetries.delete(id);
    }
  }

  async hydrate(batches: readonly ExportBatch[]): Promise<void> {
    for (const batch of batches) {
      // In-memory scheduled work belongs to the live executor, not recovery.
      if (this.pendingStarts.has(batch.id) || this.states.get(batch.id)?.batch.tasks.some((task) => this.activeTasks.has(task.id) || this.preparingRetries.has(task.id))) continue;
      let state = this.states.get(batch.id);
      if (!state) {
        try { state = (await this.dependencies.jobStore.load(batch.id)).state; }
        catch (error) {
          if (error instanceof StoreError && error.code !== "corrupt") throw error;
          state = { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch: structuredClone(batch), updatedAt: now() };
          await this.dependencies.jobStore.save(state);
        }
      }
      let recovered = false;
      for (const task of state.batch.tasks) {
        if (task.status !== "queued" && !EXECUTION.has(task.status)) continue;
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
    this.pump();
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
    await Promise.all([...this.activeTasks.values()].map(({ work }) => work));
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
        // transition() already persists interrupted tasks; rewriting every
        // unchanged batch makes shutdown O(job history) in fsyncs.
        const derived = deriveBatchStatus(state.batch.tasks);
        if (derived !== state.batch.status) {
          state.batch.status = derived;
          await this.persist(state);
        }
      }
    }
  }

  private mediaFor(state: QueueState, task: ExportTask): MediaItem | undefined {
    return state.batch.mediaSnapshots?.find((item) => item.id === task.mediaId) ?? this.mediaLookup?.(task.mediaId);
  }

  private mediaLookup?: (mediaId: string) => MediaItem | undefined;

  setMediaLookup(lookup: (mediaId: string) => MediaItem | undefined): void { this.mediaLookup = lookup; }

  private async execute(state: QueueState, task: ExportTask, threads: number, permit?: NvencPermit): Promise<void> {
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
      assertPriceOnlyTemplate(state.batch.templateSnapshot);
      assertShapeCoverExportReady(state.batch.templateSnapshot);
      await access(media.sourcePath, constants.R_OK);
      if (await fingerprintFile(media.sourcePath) !== media.fingerprint) throw new JianjiError("原始素材在导出前已发生变化。", "input_invalid", "input", false);
      await verifyApprovedHybridTemplate(state.batch.templateSnapshot, media, state.batch.preset, this.dependencies.ffmpeg);
      const missing = await validateTemplateResources(state.batch.templateSnapshot, this.dependencies.fontResolver);
      if (missing.length > 0) throw new JianjiError(`模板资源缺失：${missing.join("、")}`, "resource_missing", "resource", false);
      await assertOutputDirectorySafe(state.batch.outputDirectory, [media]);
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
        videoEncoder: this.resolveEncoder(),
      });
      const files = [...compiled.textFiles, ...compiled.binaryFiles ?? []];
      temporaryTextFiles = files.map((file) => file.path);
      const written = await Promise.allSettled(files.map((file) => writeFile(file.path, file.content, { mode: 0o600 })));
      for (const item of written) if (item.status === "rejected") throw item.reason;
      const verifyHybridCopies = async () => {
        if (!state.batch.templateSnapshot.layers.some(layer => layer.type === "sticker" && layer.cover?.hybridApproved)) return;
        for (const file of compiled.binaryFiles ?? []) {
          const expected = `sha256:${createHash("sha256").update(file.content).digest("hex")}`;
          if (await fingerprintFile(file.path) !== expected) throw new Error("UNSAFE: HYBRID_TASK_COPY_CHANGED");
        }
      };
      await verifyHybridCopies();
      if (await this.stopRequested(state, task)) {
        await Promise.all(temporaryTextFiles.map((filePath) => unlink(filePath).catch(() => undefined)));
        return;
      }
      permit?.assertValid();
      let encoderStarted = false;
      const running = this.dependencies.ffmpeg.run([...compiled.args, partialPath], (event) => {
        if (permit && !encoderStarted && (event.outTimeMs ?? 0) > 0) {
          encoderStarted = true;
          void permit.started().then(() => this.pump());
        }
        const value = event.progress === 1 ? 1 : event.outTimeMs === undefined ? task.progress : Math.min(0.99, event.outTimeMs / (compiled.durationSeconds * 1_000_000));
        if (value > task.progress && (value - task.progress >= 0.01 || value === 1)) {
          task.progress = Math.max(task.progress, value);
          this.persistProgress(state);
        }
      });
      this.controllers.set(task.id, running);
      if (this.cancelRequested.has(task.id)) await running.cancel();
      const result = await running.promise.catch((error) => { throw error; });
      this.controllers.delete(task.id);
      if (result.code === 0 && !this.cancelRequested.has(task.id)) await verifyHybridCopies();
      await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
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
      if (result.code !== 0) throw new JianjiError(result.stderr.includes("CUDA_ERROR_OUT_OF_MEMORY")
        ? "GPU 显存不足，无法启动硬件编码。请释放显存后重试导出。"
        : result.stderr.includes("OpenEncodeSessionEx failed: incompatible client key (21)")
          ? "无法申请 NVENC 编码会话（error 21）。请等待其他硬件编码任务结束后重试；若仍失败，请检查显卡驱动。"
        : redactResult(result.stderr), "ffmpeg_failed", "process", true);
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
      await verifyApprovedHybridTemplate(state.batch.templateSnapshot, media, state.batch.preset, this.dependencies.ffmpeg);
      await verifyHybridOutput(state.batch.templateSnapshot, partialPath, this.dependencies.ffmpeg);
      await verifyApprovedHybridTemplate(state.batch.templateSnapshot, media, state.batch.preset, this.dependencies.ffmpeg);
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
      this.finalArtifactCommitted(state, task);
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

  private finalArtifactCommitted(state: QueueState, task: ExportTask): void {
    if (!state.batch.projectId || !task.outputArtifact) return;
    // Detached notification cannot hold a render slot or enter the render failure catch.
    try {
      const work = this.dependencies.onFinalArtifactCommitted?.({ projectId: state.batch.projectId, batchId: state.batch.id, taskId: task.id, artifact: structuredClone(task.outputArtifact) });
      void Promise.resolve(work).catch(() => { try { this.dependencies.onFinalArtifactNotificationError?.(); } catch { /* Diagnostic only. */ } });
    } catch { try { this.dependencies.onFinalArtifactNotificationError?.(); } catch { /* Diagnostic only. */ } }
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

  private persistProgress(state: QueueState): void {
    if (this.pendingProgressSaves.has(state.batch.id)) return;
    this.pendingProgressSaves.add(state.batch.id);
    // Progress is mutable; one pending save captures the latest value. Lifecycle
    // transitions still await their own durable save after the progress write.
    void this.persist(state).finally(() => this.pendingProgressSaves.delete(state.batch.id)).catch(() => undefined);
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

  private emit(): void { this.dependencies.onSnapshot?.(this.snapshot(this.dependencies.snapshotProjectId?.())); }
}

function redactResult(stderr: string): string {
  return stderr.replace(/(?:\/[^\s:'"]+)+/g, "<path>").trim().slice(-2_000) || "FFmpeg 未返回错误详情。";
}
