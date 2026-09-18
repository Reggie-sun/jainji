import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { AgentStartSchema, FrozenAgentStartSchema, type AgentStartInput } from "../shared/agent.js";
import { CoverPreviewPathSchema, CoverReviewDraftSchema, type CoverReviewDraft, type CoverReviewMedia, type CoverEvidence } from "../shared/cover-review.js";
import type { CoverDetectionImage } from "../shared/automatic-cover.js";
import { DEFAULT_PRESET, EditTemplateSchema, ExportPresetSchema, type MediaItem } from "./domain.js";
import type { ApplicationService } from "./application.js";
import type { AgentController } from "./agent-controller.js";
import type { AgentProvider } from "./agent-provider.js";
import type { SelectModel } from "../shared/connections.js";
import type { IndependentMedia } from "./cover-review-provider.js";
import type { ExportQueue } from "./queue.js";
import { fingerprintFile, isPathWithinDirectory } from "./paths.js";
import { createCoverReviewDraft, editCoverReviewDraft, assertReviewResolved } from "./cover-review-session.js";
import { assertApprovable, approvalBinding, reviewDigest } from "./cover-review-approval.js";
import { previewDigest, removeUnreferencedPreviews } from "./cover-review-preview.js";

interface ReviewDependencies {
  root: string;
  extract(media: MediaItem, draft: CoverReviewDraft, signal: AbortSignal): Promise<{ evidence: CoverEvidence[]; images: CoverDetectionImage[]; frameTimesMs: number[] }>;
  analyze(media: CoverReviewMedia, images: CoverDetectionImage[], signal: AbortSignal, request: () => Promise<void>): Promise<CoverReviewMedia>;
  verify(projectId: string, evidence: CoverEvidence[]): Promise<void>;
  images?(projectId: string, evidence: CoverEvidence[], signal: AbortSignal): Promise<CoverDetectionImage[]>;
  reviewMedia?(draft: CoverReviewDraft, signal: AbortSignal): Promise<IndependentMedia[]>;
  discardEvidence?(projectId: string, evidence: CoverEvidence[], retained: CoverEvidence[]): Promise<void>;
  changed(): void;
}

export class CoverReviewController {
  private operation?: AbortController;
  private pending?: Promise<void>;
  private stopping?: Promise<void>;
  private preservingDrafts = false;
  constructor(private readonly service: ApplicationService, private readonly agent: AgentController, private readonly queue: ExportQueue, private readonly dependencies: ReviewDependencies) {}
  get busy(): boolean { return Boolean(this.operation || this.stopping); }
  assertIdle(): void { if (this.busy) throw new Error("审阅准备正在进行，请等待或停止。"); }
  private assertEnabled(): void {
    if (!this.service.currentProject.coverSticker?.enabled || this.service.currentProject.coverSticker.trackingMode !== "assisted") throw new Error("请先显式启用半自动覆盖。");
  }
  private current(id: string, revision: number): CoverReviewDraft {
    const draft = this.service.currentProject.reviewDrafts?.find((item) => item.id === id);
    if (!draft || draft.projectId !== this.service.currentProject.id || draft.revision !== revision) throw new Error("审阅草稿不存在或修订已过期。");
    return structuredClone(draft);
  }
  private async save(draft: CoverReviewDraft, previous?: number): Promise<void> {
    await this.service.saveReviewDraft(CoverReviewDraftSchema.parse(draft), previous);
    this.dependencies.changed();
  }
  async create(mediaIds: string[]): Promise<void> {
    return this.run(async (signal) => {
    const project = this.service.currentProject;
    if (!project.coverSticker?.enabled || project.coverSticker.trackingMode !== "assisted") throw new Error("请先显式启用半自动覆盖。");
    const media = mediaIds.map((id) => this.service.getMedia(id));
    if (!media.length || media.some((item) => !item || item.probeStatus !== "ready")) throw new Error("请选择有效素材。");
    const draft = createCoverReviewDraft(project.id, media as MediaItem[]);
    draft.status = "draft";
    await this.save(draft);
    try {
      for (const source of media as MediaItem[]) {
        const extracted = await this.dependencies.extract(source, draft, signal);
        draft.frameTimes ??= {}; draft.frameTimes[source.id] = extracted.frameTimesMs;
        draft.media.find(({ mediaId }) => mediaId === source.id)!.evidence = extracted.evidence;
        signal.throwIfAborted();
        await this.save(draft, draft.revision);
      }
      draft.status = "needs_human";
      await this.save(draft, draft.revision);
    } catch (error) {
      draft.status = signal.aborted && !this.preservingDrafts ? "cancelled" : "needs_human";
      for (const item of draft.media.filter((item) => !item.evidence.length)) { item.analysis = "incomplete"; item.analysisError = `视频帧准备未完成：${error instanceof Error ? error.message : "抽帧失败"}。生成预览时会重新准备，已确认的框会保留。`.slice(0, 2000); }
      try { await this.save(draft, draft.revision); }
      catch (error) {
        // A failed save may already have committed before a queue rewrite failed.
        // Keep extracted files when persisted ownership is uncertain.
        throw error;
      }
    }
    });
  }
  async edit(input: unknown): Promise<void> {
    return this.run(async () => {
    const { CoverReviewCommandSchema } = await import("./cover-review-session.js");
    const command = CoverReviewCommandSchema.parse(input);
    const draft = this.current(command.draftId, command.expectedRevision);
    await this.save(editCoverReviewDraft(draft, command), draft.revision);
    await removeUnreferencedPreviews(this.dependencies.root, draft.frozen, this.service.currentProject.reviewDrafts ?? []);
    });
  }
  private async run(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.assertIdle(); this.agent.assertIdle();
    this.operation = new AbortController();
    const pending = work(this.operation.signal);
    this.pending = pending;
    try { await pending; }
    catch (error) { this.service.recoverInterruptedReviews(); throw error; }
    finally { this.operation = undefined; this.pending = undefined; this.dependencies.changed(); }
  }
  cancel(): Promise<void> { return this.stop(true); }
  shutdown(): Promise<void> { return this.stop(false); }
  private stop(cancelDrafts: boolean): Promise<void> {
    if (this.stopping) return this.stopping;
    // Acquire the stop barrier before any asynchronous cancellation or storage.
    const pending = this.pending;
    this.preservingDrafts = !cancelDrafts;
    this.operation?.abort();
    const work = Promise.resolve().then(async () => {
    await this.agent.cancel(); await pending?.catch(() => undefined);
    if (!cancelDrafts) return;
    for (const existing of this.service.currentProject.reviewDrafts ?? []) {
      if (!["awaiting_approval", "needs_human", "approved"].includes(existing.status)) continue;
      const draft = structuredClone(existing); draft.status = "cancelled";
      for (const receipt of draft.approval?.receipts ?? []) await this.queue.cancel(receipt.taskId);
      await this.save(draft, existing.revision);
    }
    });
    this.stopping = work.finally(() => { this.stopping = undefined; this.preservingDrafts = false; this.dependencies.changed(); });
    return this.stopping;
  }
  async analyze(id: string, revision: number): Promise<void> {
    return this.run(async (signal) => {
      const draft = this.current(id, revision);
      this.assertEnabled();
      if (draft.status !== "needs_human") throw new Error("当前状态不能分析。");
      if (draft.media.some((media) => media.analysis !== "not_started" || media.decisions.length)) throw new Error("此草稿已有分析或人工编辑，请新建草稿后再分析。");
      if (!this.agent.visionProvider.status().configured) throw new Error("请先配置视觉识别连接，或直接人工建稿。");
      draft.status = "analyzing"; draft.runId = randomUUID();
      const maxRequests = draft.media.reduce((sum, media) => sum + Math.max(1, Math.ceil((media.evidence.length - 1) / 7)), 0);
      draft.requestPlan = { maxRequests, usedRequests: 0 };
      await this.save(draft, revision);
      try {
        for (let index = 0; index < draft.media.length; index++) {
          signal.throwIfAborted();
          if (!this.dependencies.images) throw new Error("审阅证据读取不可用。");
          const images = await this.dependencies.images(draft.projectId, draft.media[index].evidence, signal);
          draft.media[index] = await this.dependencies.analyze(draft.media[index], images, signal, async () => {
            signal.throwIfAborted();
            if (++draft.requestPlan!.usedRequests > maxRequests) { draft.requestPlan!.usedRequests = maxRequests; throw new Error("识别请求预算已耗尽。"); }
            await this.save(draft, revision);
          });
          await this.save(draft, revision);
        }
        signal.throwIfAborted();
        draft.status = "needs_human";
      } catch {
        draft.status = signal.aborted && !this.preservingDrafts ? "cancelled" : "needs_human";
        for (const media of draft.media) if (media.analysis !== "complete") {
          media.analysis = "incomplete"; media.analysisError = signal.aborted ? "用户停止了分析。" : "自动分析未完成，请人工检查已有证据。";
        }
      }
      await this.save(draft, revision);
    });
  }
  async review(id: string, revision: number, selection: SelectModel, provider: AgentProvider): Promise<void> {
    return this.run(async (signal) => {
      this.assertEnabled();
      const draft = this.current(id, revision);
      if (draft.status !== "needs_human" || draft.review) throw new Error("单轮复核只可主动运行一次；请先完成人工编辑或建立新草稿。");
      if (!this.dependencies.reviewMedia) throw new Error("复核证据读取不可用。");
      await this.validateEvidence(draft); signal.throwIfAborted();
      const maxRequests = 2 * draft.media.reduce((sum, media) => sum + Math.ceil(media.evidence.length / 8), 0);
      draft.review = { revision, connectionId: selection.connectionId, model: selection.model, status: "running", maxRequests, usedRequests: 0, attempts: [] };
      draft.status = "reviewing";
      await this.save(draft, revision);
      try {
        const media = await this.dependencies.reviewMedia(draft, signal);
        signal.throwIfAborted();
        const result = await provider.reviewCovers({ revision, model: selection.model, maxRequests, media }, signal, async (attempt) => {
          draft.review!.usedRequests = attempt.usedRequests;
          draft.review!.attempts.push(attempt);
          if (attempt.status === "success") {
            const item = draft.media.find(({ mediaId }) => mediaId === attempt.mediaId)!;
            for (const finding of attempt.findings ?? []) item.issues.push({ ...finding, id: randomUUID(), origin: "review" });
          }
          await this.save(draft, revision);
        });
        draft.review.status = result.status;
      } catch { draft.review.status = "incomplete"; }
      if (signal.aborted) draft.review.status = "incomplete";
      if (draft.review.status === "incomplete") for (const media of draft.media) media.issues.push({ id: randomUUID(), kind: "insufficient_evidence", evidenceIds: media.evidence.map(({ id }) => id), reason: "独立复核未完成，不能视为没有问题；请逐项人工检查或明确接受不确定性。", origin: "review" });
      draft.status = signal.aborted && !this.preservingDrafts ? "cancelled" : "needs_human";
      await this.save(draft, revision);
    });
  }
  async prepare(id: string, revision: number, input: AgentStartInput, directories: ReadonlySet<string>): Promise<void> {
    return this.run(async (signal) => {
      const draft = this.current(id, revision);
      if (draft.status !== "needs_human") throw new Error("请先完成人工审阅。");
      assertReviewResolved(draft);
      const parsed = AgentStartSchema.parse(input);
      if (parsed.sourceStickerRefresh) throw new Error("半自动审阅不接受原贴纸重新检查意图。");
      if (!this.service.currentProject.coverSticker?.enabled || this.service.currentProject.coverSticker.trackingMode !== "assisted") throw new Error("请显式启用半自动覆盖。");
      draft.settingsDigest = reviewDigest(this.service.currentProject.coverSticker);
      draft.requestJson = JSON.stringify(parsed); draft.frozen = []; delete draft.approval;
      draft.status = "preparing_preview";
      await this.save(draft, revision);
      const createdPreviews: { preview: { relativePath: string } }[] = [];
      try {
        await this.prepareMissingEvidence(draft, signal);
        await this.validateEvidence(draft);
        signal.throwIfAborted();
        this.assertEnabled();
        const cancelPreparation = () => { void this.agent.cancel(); };
        signal.addEventListener("abort", cancelPreparation, { once: true });
        try {
        await this.agent.prepareReview(parsed, directories, draft, async (template, media, version, runnerSignal) => {
          signal.throwIfAborted(); runnerSignal.throwIfAborted();
          const preset = { ...DEFAULT_PRESET, ...parsed.exportSettings, container: parsed.exportFormat ?? DEFAULT_PRESET.container };
          const cacheDirectory = path.join(this.dependencies.root, draft.projectId, draft.id, String(draft.revision), "previews");
          const output = await this.queue.renderPreview({ template, media, preset, cacheDirectory, signal: runnerSignal });
          createdPreviews.push({ preview: { relativePath: path.relative(this.dependencies.root, output).split(path.sep).join("/") } });
          signal.throwIfAborted();
          const bindingDigest = reviewDigest({ projectId: draft.projectId, template, media: [media], preset, outputDirectory: path.resolve(parsed.outputDirectory) });
          draft.frozen.push({ mediaId: media.id, version, templateJson: JSON.stringify(template), templateDigest: reviewDigest(template), presetJson: JSON.stringify(preset), bindingDigest,
            preview: { relativePath: path.relative(this.dependencies.root, output).split(path.sep).join("/"), digest: await previewDigest(output), viewed: false } });
        });
        } finally { signal.removeEventListener("abort", cancelPreparation); }
        signal.throwIfAborted();
        if (draft.frozen.length !== draft.media.length * (parsed.multiplier ?? 1)) throw new Error("冻结版本不完整。");
        draft.status = "awaiting_approval";
      } catch (error) {
        await removeUnreferencedPreviews(this.dependencies.root, createdPreviews, this.service.currentProject.reviewDrafts ?? []);
        draft.status = signal.aborted && !this.preservingDrafts ? "cancelled" : "needs_human"; draft.frozen = [];
        await this.save(draft, revision); throw error;
      }
      try { await this.save(draft, revision); }
      catch (error) { await removeUnreferencedPreviews(this.dependencies.root, createdPreviews, this.service.currentProject.reviewDrafts ?? []); throw error; }
    });
  }
  async previewPath(id: string, revision: number, mediaId: string, version: number): Promise<string> {
    const draft = this.current(id, revision);
    const preview = draft.frozen.find((item) => item.mediaId === mediaId && item.version === version)?.preview;
    if (!preview) throw new Error("预览不存在。");
    const root = await realpath(this.dependencies.root);
    CoverPreviewPathSchema.parse(preview.relativePath);
    if (!preview.relativePath.startsWith(`${draft.projectId}/${draft.id}/${draft.revision}/previews/`)) throw new Error("预览归属不匹配。");
    const requested = path.resolve(root, preview.relativePath);
    const target = await realpath(requested);
    if (target !== requested || !isPathWithinDirectory(root, target) || await previewDigest(target) !== preview.digest) throw new Error("预览文件缺失或摘要不匹配。");
    return target;
  }
  async viewed(id: string, revision: number, mediaId: string, version: number): Promise<void> {
    return this.run(async () => {
    const draft = this.current(id, revision);
    if (draft.status !== "awaiting_approval") throw new Error("草稿不在确认阶段。");
    await this.previewPath(id, revision, mediaId, version);
    draft.frozen.find((item) => item.mediaId === mediaId && item.version === version)!.preview!.viewed = true;
    await this.save(draft, revision);
    });
  }
  private async prepareMissingEvidence(draft: CoverReviewDraft, signal: AbortSignal): Promise<void> {
    for (const media of draft.media) {
      signal.throwIfAborted();
      if (media.evidence.length && draft.frameTimes?.[media.mediaId]?.length) continue;
      const source = this.service.getMedia(media.mediaId);
      if (!source || source.fingerprint !== media.sourceFingerprint || await fingerprintFile(source.sourcePath) !== media.sourceFingerprint) throw new Error("原素材已变化，请重建审阅草稿。");
      // Existing observations and decisions keep their evidence identities.
      if (media.evidence.length) await this.dependencies.verify(draft.projectId, media.evidence);
      const extracted = await this.dependencies.extract(source, draft, signal);
      let saveAttempted = false, saveCompleted = false;
      try {
        signal.throwIfAborted();
        if (!extracted.evidence.length || !extracted.frameTimesMs.length) throw new Error("视频帧准备未完成，请再次生成预览。");
        const next = structuredClone(draft);
        const repaired = next.media.find((item) => item.mediaId === media.mediaId)!;
        if (!repaired.evidence.length) repaired.evidence = extracted.evidence;
        next.frameTimes ??= {}; next.frameTimes[media.mediaId] = extracted.frameTimesMs;
        if (repaired.analysis === "incomplete" && !repaired.observations.length && !repaired.issues.length) {
          repaired.analysis = "not_started";
          delete repaired.analysisError;
        }
        saveAttempted = true;
        await this.save(next, draft.revision);
        saveCompleted = true;
        Object.assign(draft, next);
      } finally {
        // A failed save may have reached disk before a queue-driven rewrite failed.
        // Keep this batch when commit status is uncertain; unpublished memory is not proof of no reference.
        if (!saveAttempted || saveCompleted) {
          const references = new Set((this.service.currentProject.reviewDrafts ?? []).flatMap((item) => item.media.flatMap((media) => media.evidence.map(({ id }) => id))));
          const retained = extracted.evidence.filter(({ id }) => references.has(id));
          if (retained.length !== extracted.evidence.length) await this.dependencies.discardEvidence?.(draft.projectId, extracted.evidence, retained);
        }
      }
    }
  }
  private async validateEvidence(draft: CoverReviewDraft): Promise<void> {
    for (const media of draft.media) {
      if (!media.evidence.length || !draft.frameTimes?.[media.mediaId]?.length) throw new Error("原帧证据未准备完成，请重建草稿。");
      const source = this.service.getMedia(media.mediaId);
      if (!source || source.fingerprint !== media.sourceFingerprint || await fingerprintFile(source.sourcePath) !== media.sourceFingerprint) throw new Error("原素材已变化，请重建审阅草稿。");
      await this.dependencies.verify(draft.projectId, media.evidence);
    }
  }
  async approve(id: string, revision: number, input: AgentStartInput, directories: ReadonlySet<string>): Promise<void> {
    return this.run(async (signal) => {
      const draft = this.current(id, revision);
      this.assertEnabled();
      const frozenRequest = FrozenAgentStartSchema.parse(JSON.parse(draft.requestJson ?? "null"));
      const parsed = (frozenRequest.decorations?.displayMode === "first-3s" ? FrozenAgentStartSchema : AgentStartSchema).parse(input);
      if (parsed.sourceStickerRefresh) throw new Error("半自动审阅不接受原贴纸重新检查意图。");
      if (draft.settingsDigest !== reviewDigest(this.service.currentProject.coverSticker)) throw new Error("覆盖设置已变化，请重新准备预览。");
      if (reviewDigest(parsed) !== reviewDigest(JSON.parse(draft.requestJson ?? "null"))) throw new Error("制作设置已变化，请重新编辑并准备预览。");
      if (!directories.has(await realpath(parsed.outputDirectory))) throw new Error("请重新选择批准的输出目录。");
      assertApprovable(draft); await this.validateEvidence(draft);
      for (const version of draft.frozen) {
        await this.previewPath(id, revision, version.mediaId, version.version);
        const template = EditTemplateSchema.parse(JSON.parse(version.templateJson));
        for (const layer of template.layers) if (layer.type === "sticker" && await fingerprintFile(layer.assetPath) !== layer.assetFingerprint) throw new Error("冻结贴纸已变化，请重新准备预览。");
      }
      draft.approval ??= { submissionId: randomUUID(), revision, bindingDigest: approvalBinding(draft), approvedAt: new Date().toISOString(), receipts: [] };
      draft.status = "approved";
      await this.save(draft, revision);
      for (const version of draft.frozen) {
        signal.throwIfAborted();
        const media = this.service.getMedia(version.mediaId)!;
        const batch = await this.queue.createBatch({ projectId: draft.projectId, template: EditTemplateSchema.parse(JSON.parse(version.templateJson)), mediaIds: [media.id], mediaItems: [media],
          outputDirectory: parsed.outputDirectory, preset: ExportPresetSchema.parse(JSON.parse(version.presetJson)),
          submission: { submissionId: draft.approval.submissionId, mediaId: media.id, version: version.version, bindingDigest: version.bindingDigest } }, signal);
        if (!draft.approval.receipts.some((receipt) => receipt.mediaId === media.id && receipt.version === version.version)) draft.approval.receipts.push({ mediaId: media.id, version: version.version, templateDigest: version.templateDigest, batchId: batch.id, taskId: batch.tasks[0].id });
        try { await this.save(draft, revision); }
        catch (error) { if (signal.aborted && !this.preservingDrafts) await this.queue.cancel(batch.tasks[0].id); throw error; }
        if (signal.aborted) { if (!this.preservingDrafts) await this.queue.cancel(batch.tasks[0].id); signal.throwIfAborted(); }
        if (batch.tasks[0].status === "queued") void this.queue.start(batch.id).catch(() => this.dependencies.changed());
      }
    });
  }
}
