import path from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AgentStartInput } from "../shared/agent.js";
import { AgentStartSchema, GenerateBriefSchema, getRule, MAX_AGENT_OUTPUTS } from "../shared/agent.js";
import type { ApplicationService } from "./application.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { DEFAULT_PRESET, type MediaItem } from "./domain.js";
import { AgentProvider, ProviderError, type AgentDecorationCatalog } from "./agent-provider.js";
import { AgentRunner } from "./agent-runner.js";
import { extractAgentFrames } from "./agent-frames.js";
import { assertOutputDirectorySafe, canonicalPath } from "./paths.js";
import type { ExportQueue } from "./queue.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { resolveFont } from "./ffmpeg.js";
import { DecorationSchema, decorationTimingContext, isUploadedStickerId, type DecorationOptions } from "../shared/decorations.js";
import { decorationFontFamilies, decorationStickerIds, type AssetLibrary } from "./asset-library.js";
import { AUTOMATIC_STICKERS, isAutomaticStickerAllowed } from "../shared/automatic-stickers.js";
import { LIBRARY_STICKERS } from "../shared/asset-library.js";
import { BUNDLED_STICKERS } from "../shared/bundled-stickers.js";
import { stickerPreview } from "./sticker-preview.js";
import { resolveCoverSticker, previousCoverStickerId, unusedCoverStickerIds } from "./cover-sticker.js";
import { recognizeSourceStickerKnowledge } from "./source-sticker-recognition.js";
import { SourceStickerKnowledgeSession } from "./source-sticker-knowledge-session.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import type { EditTemplate } from "./domain.js";
import { assertReviewResolved } from "./cover-review-session.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import { superviseRenderedTemplate } from "./supervised-preview.js";
import { CoverPlacementSession, completedCoverPlacements } from "./cover-placement-session.js";
import { proposeCoverPlacement } from "./cover-placement-proposal.js";
import { AgentPreviewStore } from "./agent-preview-store.js";

export class AgentController {
  private runner?: AgentRunner;
  private preparing = false;
  private testing = false;
  private generatingBrief = false;
  private preparingController?: AbortController;
  private testController?: AbortController;
  private briefController?: AbortController;
  private pendingOperation?: Promise<void>;
  private readonly previews = new AgentPreviewStore();
  constructor(private readonly service: ApplicationService, private readonly queue: ExportQueue, private readonly ffmpeg: FfmpegAdapter, private readonly onChange: () => void, private readonly stickerAssets: StickerAssets, private readonly library?: AssetLibrary, readonly provider = new AgentProvider(), readonly visionProvider = new AgentProvider(), readonly reviewerProvider = new AgentProvider(), private readonly knowledgeStore?: SourceStickerKnowledgeStore) {}

  get busy(): boolean { return this.preparing || this.testing || this.generatingBrief || Boolean(this.runner?.running); }
  snapshot() { const run = this.runner?.snapshot(); return run?.projectId === this.service.currentProject.id ? run : undefined; }
  assertIdle(): void { if (this.busy) throw new Error("Agent 正在处理，请等待或先停止当前任务。"); }
  async previewPath(runId: string, itemId: string): Promise<string> { return this.previews.resolve(this.snapshot(), runId, itemId); }

  async test(): Promise<void> {
    this.assertIdle(); this.testing = true; this.testController = new AbortController();
    try { await this.provider.test(this.testController.signal); }
    finally { this.testing = false; this.testController = undefined; }
  }

  async generateBrief(input: unknown): Promise<string> {
    this.assertIdle();
    if (!this.provider.status().configured) throw new Error("请先接入模型。");
    this.generatingBrief = true;
    this.briefController = new AbortController();
    let settle!: () => void;
    this.pendingOperation = new Promise<void>((resolve) => { settle = resolve; });
    try {
      const parsed = GenerateBriefSchema.parse(input);
      const options = DecorationSchema.parse(parsed.decorations ?? {});
      const previews = options.mode === "agent" ? (await this.autoCatalog(this.briefController.signal)).previews ?? [] : await this.manualStickerPreviews(options, this.briefController.signal);
      return await this.provider.generateBrief(parsed, this.briefController.signal, previews);
    }
    finally { this.generatingBrief = false; this.briefController = undefined; this.pendingOperation = undefined; settle(); }
  }

  private async manualStickerPreviews(options: DecorationOptions, signal: AbortSignal): Promise<{ id: string; url: string }[]> {
    if (options.mode === "agent") return [];
    const previews = [];
    for (const id of decorationStickerIds(options).filter(isUploadedStickerId)) {
      signal.throwIfAborted();
      const asset = this.stickerAssets[id];
      if (!asset) throw new Error("上传的贴纸缺失，请重新上传。");
      previews.push({ id, url: await stickerPreview(this.ffmpeg, asset, signal) });
    }
    return previews;
  }

  private async autoCatalog(signal: AbortSignal, cover = false): Promise<AgentDecorationCatalog> {
    const builtins = cover ? [...AUTOMATIC_STICKERS, ...BUNDLED_STICKERS, ...LIBRARY_STICKERS] : AUTOMATIC_STICKERS;
    const libraryIds = new Set(LIBRARY_STICKERS.map(({ id }) => id));
    const stickers = [
      ...new Map(builtins.filter(({ id }) => Boolean(this.stickerAssets[id]) || Boolean(this.library) && libraryIds.has(id)).map(({ id, label }) => [id, { id, label }])).values(),
      ...Object.keys(this.stickerAssets).filter(isUploadedStickerId).map((id) => ({ id, label: `用户上传贴纸 ${id.slice(9, 17)}` })),
    ];
    const previews = [];
    for (const { id } of stickers.filter(({ id }) => isUploadedStickerId(id))) {
      signal.throwIfAborted();
      previews.push({ id, url: await stickerPreview(this.ffmpeg, this.stickerAssets[id]!, signal) });
    }
    return { fonts: [], stickers, previews };
  }

  async prepareReview(input: AgentStartInput, approvedDirectories: ReadonlySet<string>, draft: CoverReviewDraft, prepared: (template: EditTemplate, media: MediaItem, version: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    assertReviewResolved(draft);
    if (draft.projectId !== this.service.currentProject.id || draft.status !== "preparing_preview") throw new Error("审阅状态不允许准备预览。");
    if (input.mediaIds.length !== draft.media.length || input.mediaIds.some((id) => !draft.media.some(({ mediaId }) => id === mediaId))) throw new Error("制作素材与审阅集合不同。");
    await this.startInternal(input, approvedDirectories, { draft, prepared });
    await this.runner?.settled();
    const failures = this.runner?.snapshot()?.items.filter(({ status }) => status !== "prepared") ?? [];
    if (failures.length) throw new Error(`部分版本准备失败或已取消：${failures.map(({ error }) => error ?? "用户已停止准备").join("；")}`);
  }

  async start(input: AgentStartInput, approvedDirectories: ReadonlySet<string>): Promise<void> {
    return this.startInternal(input, approvedDirectories);
  }

  private async startInternal(input: AgentStartInput, approvedDirectories: ReadonlySet<string>, assisted?: { draft: CoverReviewDraft; prepared: (template: EditTemplate, media: MediaItem, version: number, signal: AbortSignal) => Promise<void> }): Promise<void> {
    this.assertIdle();
    if (!this.provider.status().configured) throw new Error("请先接入模型。");
    if (this.queue.snapshot().batches.some(({ batch }) => batch.tasks.some((task) =>
      ["validating", "running", "verifying", "cancelling"].includes(task.status) ||
      (batch.projectId === this.service.currentProject.id && task.status === "queued")))) {
      throw new Error("请等待当前导出完成，或先停止队列中的任务。");
    }
    this.preparing = true;
    this.preparingController = new AbortController();
    let settle!: () => void;
    this.pendingOperation = new Promise<void>((resolve) => { settle = resolve; });
    try {
      const parsed = AgentStartSchema.parse(input);
      const decorations = DecorationSchema.parse(parsed.decorations ?? {});
      const project = this.service.currentProject;
      if (project.coverSticker?.enabled && project.coverSticker.trackingMode === "assisted" && !assisted) throw new Error("半自动覆盖必须先审阅、预览和批准。");
      const history = [...project.exportBatches, ...this.queue.snapshot().batches.filter(({ batch }) => batch.projectId === project.id).map(({ batch }) => batch)];
      const automaticCover = project.coverSticker?.enabled && (project.coverSticker.trackingMode === "agent" || assisted) ? structuredClone(project.coverSticker) : undefined;
      const preserveSourceStickers = decorations.mode === "agent" && !project.coverSticker?.enabled;
      // Local-random path: stickers / price style / cover selection are all decided without the
      // creative round-trip. Skips provider.shortlist + provider.plan and the auto-cover selection
      // call entirely. Manual and agent paths are untouched.
      const randomPath = decorations.mode === "random" || project.coverSticker?.trackingMode === "random";
      const supervised = !assisted && Boolean(automaticCover || preserveSourceStickers);
      const refresh = parsed.sourceStickerRefresh;
      if (refresh) {
        if (refresh.projectId !== project.id) throw new Error("重新检查意图属于其他项目，请重新选择素材。");
        if (!supervised) throw new Error("重新检查原贴纸仅用于自动识别模式，不改变手动或半自动草稿。");
        if (parsed.mediaIds.some(id => !project.mediaItems.some(item => item.id === id && item.probeStatus === "ready"))) throw new Error("重新检查的素材不属于当前项目或已不可用。");
      }
      if ((automaticCover && !assisted || preserveSourceStickers) && !this.visionProvider.status().configured) throw new Error("请先在模型与 API 中配置独立的视觉识别模型，用于原贴纸识别和空缺角落补齐。");
      if (supervised && !this.reviewerProvider.status().configured) throw new Error("请先在模型与 API 中配置复核模型，用于主管 Agent 修正与样片检查。");
      const coverSticker = automaticCover ? undefined : resolveCoverSticker(project.coverSticker, this.stickerAssets, history, parsed.mediaIds);
      const availableCatalog = decorations.mode === "agent" || automaticCover ? await this.autoCatalog(this.preparingController.signal, Boolean(automaticCover)) : undefined;
      const autoCatalog = decorations.mode === "agent" ? { ...availableCatalog!, stickers: availableCatalog!.stickers.filter(({ id }) => isAutomaticStickerAllowed(id) || isUploadedStickerId(id)) } : undefined;
      const stickerAssets = { ...(decorations.mode === "agent" ? this.stickerAssets : this.library ? await this.library.prepare(decorations, this.stickerAssets) : this.stickerAssets) };
      this.preparingController.signal.throwIfAborted();
      for (const family of decorationFontFamilies(decorations)) {
        const font = this.library ? await this.library.resolveFont(family) : await resolveFont(family);
        if (!font) throw new Error("所选字体不可用，请重新选择已安装字体。");
      }
      if (!path.isAbsolute(parsed.outputDirectory)) throw new Error("请选择有效的输出目录。");
      const outputDirectory = await canonicalPath(parsed.outputDirectory);
      if (!approvedDirectories.has(outputDirectory)) throw new Error("请通过系统对话框选择输出目录。");
      const ids = [...new Set(parsed.mediaIds)];
      if (ids.length * (parsed.multiplier ?? 1) > MAX_AGENT_OUTPUTS) throw new Error(`本轮成片数量不能超过 ${MAX_AGENT_OUTPUTS} 条，请减少制作倍数。`);
      const media = ids.map((id) => this.service.getMedia(id));
      if (media.some((item) => !item || item.probeStatus !== "ready")) throw new Error("所选素材不可用，请重新导入。");
      await assertOutputDirectorySafe(outputDirectory, media as MediaItem[]);
      this.preparingController.signal.throwIfAborted();
      if (supervised && !this.knowledgeStore) throw new Error("源贴纸知识库不可用或需要恢复；自动制作已停止，已有导出和手动模式不受影响。");
      if (refresh && this.service.currentProject.id !== refresh.projectId) throw new Error("项目已切换，请重新设置原贴纸检查意图。");
      // Apply the one-shot intent to every same-byte copy before any source is acquired.
      const refreshFingerprints = new Set((media as MediaItem[]).filter(item => refresh?.mediaIds.includes(item.id)).map(item => item.fingerprint));
      const refreshMediaIds = new Set((media as MediaItem[]).filter(item => refreshFingerprints.has(item.fingerprint)).map(item => item.id));
      const projectId = this.service.currentProject.id;
      const previews = new Map<string, Promise<{ id: string; url: string }>>();
      for (const preview of availableCatalog?.previews ?? []) previews.set(preview.id, Promise.resolve(preview));
      const prepareCandidates = async (ids: string[], catalog: AgentDecorationCatalog, signal: AbortSignal): Promise<AgentDecorationCatalog> => {
        const candidatePreviews = [];
        for (const id of ids) {
          signal.throwIfAborted();
          if (!catalog.stickers.some((entry) => entry.id === id)) throw new ProviderError("模型选择了目录外的贴纸，本条已停止。");
          let preview = previews.get(id);
          if (!preview) {
            preview = (async () => {
              const asset = stickerAssets[id] ?? await this.library!.ensure(id);
              signal.throwIfAborted();
              const url = await stickerPreview(this.ffmpeg, asset, signal);
              (stickerAssets as Record<string, typeof asset>)[id] = asset;
              return { id, url };
            })();
            previews.set(id, preview);
          }
          candidatePreviews.push(await preview);
        }
        signal.throwIfAborted();
        return { fonts: [], stickers: ids.map((id) => catalog.stickers.find((entry) => entry.id === id)!), previews: candidatePreviews };
      };
      const previousCoverId = previousCoverStickerId(history);
      let manualPreviews: Promise<{ id: string; url: string }[]> | undefined;
      const preset = { ...DEFAULT_PRESET, ...parsed.exportSettings, container: parsed.exportFormat ?? DEFAULT_PRESET.container };
      let creativeRequests = 0;
      const knowledge = preserveSourceStickers && !assisted ? new SourceStickerKnowledgeSession({
        refreshMediaIds,
        store: this.knowledgeStore!, executor: this.visionProvider.status().model.slice(0, 160), supervisor: this.reviewerProvider.status().model.slice(0, 160),
        identify: async (item, signal) => {
          const evidence = new SupervisorEvidence(this.ffmpeg, item);
          try { return await evidence.sourceIdentity(signal); } finally { await evidence.dispose(); }
        },
        recognize: (item, source, horizon, signal, onStage, onWindow, onRequest) => recognizeSourceStickerKnowledge(this.ffmpeg, item, source, horizon, signal,
          (images, requestSignal) => { onRequest("executor"); return this.visionProvider.detectCovers(images, undefined, requestSignal); },
          (context, requestSignal) => { onRequest("supervisor"); return this.reviewerProvider.superviseRecognition(context, requestSignal); }, onStage, onWindow),
        review: async input => {
          const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervised-preview-"));
          const evidence = new SupervisorEvidence(this.ffmpeg, input.media);
          let retained = false;
          try {
            const result = await superviseRenderedTemplate({ ...input, durationMs: input.media.durationMs,
            coverEnabled: Boolean(automaticCover), automaticCorners: decorations.mode === "agent",
            knowledge: { ...input.knowledge, outputSettingsDigest: createHash("sha256").update(JSON.stringify(preset)).digest("hex"), capture: (images, binding) => evidence.capture(images, binding) },
            render: (candidate, requestSignal) => this.queue.renderPreview({ template: candidate, media: input.media, preset, cacheDirectory: directory, signal: requestSignal }),
            inspect: (requests, requestSignal, previewPath) => evidence.inspect(requests, requestSignal, previewPath),
            review: (context, requestSignal) => this.reviewerProvider.supervisePreview(context, requestSignal),
            });
            this.previews.retainDirectory(directory); retained = true; return result;
          } finally { await evidence.dispose(); if (!retained) await rm(directory, { recursive: true, force: true }); }
        },
      }) : undefined;
      const placement = automaticCover && !assisted ? new CoverPlacementSession({
        refreshMediaIds,
        store: this.knowledgeStore!,
        cached: completedCoverPlacements(history),
        identify: async (item, signal) => {
          const evidence = new SupervisorEvidence(this.ffmpeg, item);
          try { return await evidence.sourceIdentity(signal); } finally { await evidence.dispose(); }
        },
        propose: (item, signal, onStage, diagnostics) => proposeCoverPlacement(this.ffmpeg, item, signal,
          (context, requestSignal) => this.visionProvider.proposeCoverPlacement(context, requestSignal), onStage, undefined, diagnostics),
        review: async input => {
          const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-preview-"));
          let evidence = new SupervisorEvidence(this.ffmpeg, input.media);
          let retained = false;
          try {
            const result = await superviseRenderedTemplate({ ...input, tracks: input.placement.tracks, trackPurpose: "cover-placement",
            durationMs: input.media.durationMs, coverEnabled: true, automaticCorners: decorations.mode === "agent",
            render: async (candidate, requestSignal, diagnostics) => {
              const preview = await this.queue.renderPreview({ template: candidate, media: input.media, preset, cacheDirectory: directory, signal: requestSignal, diagnostics });
              // Placement evidence has no durable handoff. Each new render replaces
              // obsolete image handles; replayed checkpoints bind to the new preview.
              await evidence.dispose();
              evidence = new SupervisorEvidence(this.ffmpeg, input.media);
              return preview;
            },
            inspect: (requests, requestSignal, previewPath) => evidence.inspect(requests, requestSignal, previewPath),
            review: (context, requestSignal) => this.reviewerProvider.supervisePreview(context, requestSignal),
            });
            this.previews.retainDirectory(directory); retained = true; return result;
          } finally { await evidence.dispose(); if (!retained) await rm(directory, { recursive: true, force: true }); }
        },
      }) : undefined;
      await this.previews.clear();
      this.runner = new AgentRunner({
        knowledge,
        placement,
        recordOutcome: knowledge ? outcome => this.knowledgeStore!.recordOutcome(outcome) : undefined,
        creativeRequests: () => creativeRequests,
        creativeModel: this.provider.status().model.slice(0, 160),
        prepared: assisted?.prepared,
        coverSticker,
        preserveSourceStickers,
        selectCoverSticker: automaticCover ? async (frames, signal, previousSelections) => {
          const eligible = availableCatalog!.stickers;
          const candidateIds = unusedCoverStickerIds(eligible.map(({ id }) => id), previousSelections, previousCoverId);
          const stickers = eligible.filter(({ id }) => candidateIds.includes(id));
          const catalog = { fonts: [], stickers, previews: availableCatalog!.previews?.filter(({ id }) => stickers.some((entry) => entry.id === id)) };
          if (!stickers.length) throw new ProviderError("没有可用的自动覆盖贴纸，请检查本地素材库。");
          creativeRequests++;
          const ids = await this.provider.shortlist(parsed.ruleId, `${decorationTimingContext(decorations?.displayMode)}为本轮原贴纸覆盖选择图案，同一轮全部素材统一一款，下一轮换款，使用白色不透明底板。${parsed.brief}`, frames, signal, catalog, undefined, "cover");
          const stickerId = ids[0];
          if (!stickerId || !catalog.stickers.some((entry) => entry.id === stickerId)) throw new ProviderError("覆盖初筛没有返回有效候选，本轮已停止。");
          if (!stickerAssets[stickerId]) {
            const asset = await this.library!.ensure(stickerId);
            signal.throwIfAborted();
            (stickerAssets as Record<string, typeof asset>)[stickerId] = asset;
          }
          signal.throwIfAborted();
          if (!ids.includes(stickerId) || !stickerAssets[stickerId]) throw new ProviderError("覆盖选款不在有效候选中，本轮已停止。");
          return { stickerId, ...stickerAssets[stickerId]!, rectangle: automaticCover.rectangle, automatic: true };
        } : undefined,
        detectCoverTracks: assisted ? async item => {
          const source = assisted.draft.media.find(({ mediaId }) => mediaId === item.id)!;
          return source.disposition === "no_cover" ? [] : source.segments.map(segment => ({ targetId: segment.id, track: segment.track }));
        } : undefined,
        resolutionMode: parsed.exportSettings?.resolutionMode ?? DEFAULT_PRESET.resolutionMode,
        frames: (item, signal) => extractAgentFrames(this.ffmpeg, item, signal),
        plan: async (rule, brief, frames, signal, catalog, selection) => {
          // Local-random path: pick filter/intensity from the rule without any creative call.
          if (randomPath) {
            const rulePreset = getRule(rule);
            return {
              summary: "本地随机包装 · 零模型调用",
              captions: [],
              filter: rulePreset.filters[0],
              intensity: rulePreset.minIntensity,
            };
          }
          // Manual mode is fully local: stickers, price style, and brief come from the user; only filter/intensity remain
          // and default to the rule's first allowed preset so we never call the creative model on this path.
          if (decorations?.mode !== "agent" && !catalog && !automaticCover) {
            const rulePreset = getRule(rule);
            return {
              summary: "手动包装 · 零模型调用",
              captions: [],
              filter: rulePreset.filters[0],
              intensity: rulePreset.minIntensity,
            };
          }
          brief = `${decorationTimingContext(decorations?.displayMode)}\n${brief}`;
          if (preserveSourceStickers) brief = `保留原视频已有贴纸，不新增覆盖层。请为四角各提供一项候补设计，本地根据独立视觉识别的原贴纸占位，只在空缺角落和时段添加。\n${brief}`;
          if (!catalog) {
            manualPreviews ??= this.manualStickerPreviews(decorations, signal);
            const previews = await manualPreviews;
            creativeRequests++;
            return this.provider.plan(rule, brief, frames, signal, undefined, undefined, previews);
          }
          creativeRequests++;
          const ids = await this.provider.shortlist(rule, brief, frames, signal, catalog, selection);
          const candidates = await prepareCandidates(ids, catalog, signal);
          creativeRequests++;
          return this.provider.plan(rule, brief, frames, signal, candidates, selection);
        },
        enqueue: async (template, item, signal) => {
          signal.throwIfAborted();
          const batch = await this.queue.createBatch({ projectId, template, mediaIds: [item.id], mediaItems: [item], outputDirectory, preset: { ...DEFAULT_PRESET, ...parsed.exportSettings, container: parsed.exportFormat ?? DEFAULT_PRESET.container } });
          if (signal.aborted) await this.queue.cancel(batch.tasks[0].id);
          else void this.queue.start(batch.id).catch(() => { this.onChange(); });
          return batch.tasks[0].id;
        },
        publishApproved: async (template, item, samplePath, signal) => {
          signal.throwIfAborted();
          const preset = { ...DEFAULT_PRESET, ...parsed.exportSettings, container: parsed.exportFormat ?? DEFAULT_PRESET.container };
          const { taskId } = await this.queue.publishApprovedSample({ projectId, template, media: item, preset, samplePath, outputDirectory });
          this.onChange();
          return taskId;
        },
        renderSlots: () => this.queue.renderSlots,
        stickerAssets,
        decorations,
        autoCatalog,
        retainPreview: (runId, itemId, previewPath) => this.previews.register(runId, itemId, previewPath),
        finalizePreviews: () => this.previews.prune(),
        onChange: this.onChange,
      });
      this.runner.start(projectId, parsed.ruleId, parsed.brief, media as MediaItem[], parsed.multiplier ?? 1);
    } finally { this.preparing = false; this.preparingController = undefined; this.pendingOperation = undefined; settle(); }
  }

  async cancel(): Promise<void> {
    this.preparingController?.abort();
    this.testController?.abort();
    this.briefController?.abort();
    this.runner?.cancel();
    for (const item of this.runner?.snapshot()?.items ?? []) {
      if (item.taskId) await this.queue.cancel(item.taskId);
    }
    await Promise.all([this.runner?.settled(), this.pendingOperation]);
    await this.previews.clear();
  }
}
