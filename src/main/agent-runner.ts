import { randomUUID } from "node:crypto";
import { type ExportSettings } from "../shared/export-settings.js";
import { MAX_AGENT_OUTPUTS, ProductionMultiplierSchema, type AgentRun, type RuleId } from "../shared/agent.js";
import { type EditTemplate, type MediaItem } from "./domain.js";
import { ProviderError, type AgentDecorationCatalog, type AgentSelectionContext, type PackagingPlan } from "./agent-provider.js";
import type { StickerAssets } from "./builtin-stickers.js";
import type { DecorationOptions } from "../shared/decorations.js";
import { executionLimits } from "./execution-limits.js";
import type { PriceStyleId } from "../shared/price-styles.js";
import { type FrozenCoverSticker } from "./cover-sticker.js";
import { expandSourceCoverTracks, type AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import { prepareAgentTemplate } from "./agent-template-preparation.js";
import type { PreviewRevision } from "./supervisor-protocol.js";
import type { KnowledgeBinding, KnowledgeVersion, SourceStickerKnowledgeSession } from "./source-sticker-knowledge-session.js";
import type { KnowledgeOutcome, KnowledgeProductionStage } from "../shared/source-sticker-knowledge-audit.js";
import type { CoverPlacementSession } from "./cover-placement-session.js";
import { CoverDiagnostics } from "./cover-diagnostics.js";

interface RunnerDependencies {
  frames(media: MediaItem, signal: AbortSignal): Promise<string[]>;
  plan(ruleId: RuleId, brief: string, frames: string[], signal: AbortSignal, catalog?: AgentDecorationCatalog, selection?: AgentSelectionContext): Promise<PackagingPlan>;
  enqueue(template: EditTemplate, media: MediaItem, signal: AbortSignal): Promise<string>;
  publishApproved?(template: EditTemplate, media: MediaItem, samplePath: string, signal: AbortSignal): Promise<string>;
  /** Real render slots from the export queue (encoder-aware); defaults to the legacy cap when absent. */
  renderSlots?(): number;
  prepared?(template: EditTemplate, media: MediaItem, version: number, signal: AbortSignal): Promise<void>;
  stickerAssets: StickerAssets;
  decorations?: DecorationOptions;
  resolutionMode?: ExportSettings["resolutionMode"];
  autoCatalog?: AgentDecorationCatalog;
  coverSticker?: FrozenCoverSticker;
  preserveSourceStickers?: boolean;
  selectCoverSticker?(frames: string[], signal: AbortSignal, previousSelections: readonly string[]): Promise<FrozenCoverSticker>;
  detectCoverTracks?(media: MediaItem, signal: AbortSignal, onStage: (stage: string) => void): Promise<AutomaticCoverTrack[]>;
  knowledge?: Pick<SourceStickerKnowledgeSession, "acquire" | "tracks" | "review" | "reconcile" | "enqueue" | "close">;
  placement?: Pick<CoverPlacementSession, "acquire" | "review" | "enqueue" | "close"> & Partial<Pick<CoverPlacementSession, "previewPath">>;
  retainPreview?(runId: string, itemId: string, previewPath: string): string;
  finalizePreviews?(): Promise<void>;
  recordOutcome?(outcome: KnowledgeOutcome): Promise<void>;
  creativeRequests?(): number;
  creativeModel?: string;
  onChange(): void;
}

export class AgentRunner {
  private run?: AgentRun;
  private controller?: AbortController;
  private pending?: Promise<void>;
  constructor(private readonly dependencies: RunnerDependencies) {}

  snapshot(): AgentRun | undefined { return this.run && structuredClone(this.run); }
  get running(): boolean { return this.run?.status === "running"; }

  start(projectId: string, ruleId: RuleId, brief: string, media: readonly MediaItem[], multiplier = 1): AgentRun {
    if (this.running) throw new Error("Agent 正在处理，请等待完成或停止当前任务。");
    if (media.length === 0 || media.some((item) => item.probeStatus !== "ready")) throw new Error("请先导入有效素材。");
    ProductionMultiplierSchema.parse(multiplier);
    if (media.length * multiplier > MAX_AGENT_OUTPUTS) throw new Error(`本轮成片数量不能超过 ${MAX_AGENT_OUTPUTS} 条，请减少制作倍数。`);
    const versions = structuredClone(media).flatMap((source) => Array.from({ length: multiplier }, (_, index) => ({ source, version: index + 1 })));
    this.controller = new AbortController();
    this.run = {
      id: randomUUID(), projectId, ruleId, status: "running",
      items: versions.map(({ source, version }) => ({ id: randomUUID(), mediaId: source.id, version, name: multiplier === 1 ? source.displayName : `${source.displayName} · 第 ${version} 版`, status: "waiting" })),
    };
    const frozen = versions.map(({ source }) => source);
    this.pending = this.execute(this.run, brief, frozen, this.controller.signal);
    return this.snapshot()!;
  }

  cancel(): void { this.controller?.abort(); }
  async settled(): Promise<void> { await this.pending; }

  private async execute(run: AgentRun, brief: string, media: readonly MediaItem[], signal: AbortSignal): Promise<void> {
    let next = 0;
    const audit = run.items.map(() => ({ started: Date.now(), finished: undefined as number | undefined, stage: "waiting" as KnowledgeProductionStage, creative: 0 }));
    const knowledgeStarted = new Map<string, number>();
    const stopKnowledgeProgress = (item: AgentRun["items"][number], cancelled: boolean, reason: string): void => {
      if (!item.sourceKnowledge) return;
      item.sourceKnowledge = { ...item.sourceKnowledge, elapsedMs: Date.now() - knowledgeStarted.get(item.id)!,
        ...(item.sourceKnowledge.phase === "blocked" ? {} : { phase: "blocked", reason: cancelled ? "本轮已取消，未完成候选不会发布。" : reason }) };
    };
    const stickerUsage = new Map<string, number>();
    const priceStyleUsage = new Map<PriceStyleId, number>();
    const pendingFrames = new Map<string, Promise<string[]>>();
    // Versions and byte-identical copies share mutable supervisor state. Keep
    // each source group together so it can reconcile before immediate enqueue.
    const grouped = new Map<string, number[]>();
    media.forEach((source, index) => {
      const key = this.dependencies.placement || this.dependencies.knowledge ? source.fingerprint : String(index);
      const group = grouped.get(key) ?? [];
      group.push(index); grouped.set(key, group);
    });
    const groupsToRun = [...grouped.values()];
    const pendingCoverStickers = new Map<number, Promise<FrozenCoverSticker>>();
    const selectedCoverIds: string[] = [];
    const reviewed = new Map<number, { index: number; version: KnowledgeVersion; binding: KnowledgeBinding; source: MediaItem }>();
    const placed = new Map<number, { index: number; template: EditTemplate; source: MediaItem }>();
    const coverForVersion = (version: number, frames: string[]): Promise<FrozenCoverSticker> => {
      let pending = pendingCoverStickers.get(version);
      if (!pending) {
        const previous = version > 1 ? coverForVersion(version - 1, frames) : Promise.resolve();
        pending = previous.then(async () => {
          signal.throwIfAborted();
          // The first eligible source supplies the round's reference; all peers
          // share this selection, without depending on a failed/blocked source.
          const selected = await this.dependencies.selectCoverSticker!(frames, signal, [...selectedCoverIds]);
          selectedCoverIds.push(selected.stickerId);
          return selected;
        });
        pendingCoverStickers.set(version, pending);
      }
      return pending;
    };
    const remainingVersions = new Map<string, number>();
    for (const source of media) remainingVersions.set(source.id, (remainingVersions.get(source.id) ?? 0) + 1);
    const processItem = async (index: number) => {
        const source = media[index];
        const item = run.items[index];
        const diagnostics = this.dependencies.placement ? new CoverDiagnostics(() => this.dependencies.onChange()) : undefined;
        if (diagnostics) item.coverDiagnostics = diagnostics.state;
        if (signal.aborted) {
          item.status = "cancelled"; audit[index].finished = Date.now();
          diagnostics?.record("lifecycle", "cancelled", { reason: "cancelled" });
          return;
        }
        item.status = "analyzing";
        this.dependencies.onChange();
        const onStage = (stage: string) => { item.summary = stage; this.dependencies.onChange(); };
        knowledgeStarted.set(item.id, Date.now());
        audit[index].started = Date.now();
        const creativeBefore = this.dependencies.creativeRequests?.() ?? 0;
        try {
          const knowledge = this.dependencies.knowledge;
          audit[index].stage = "knowledge";
          const binding = knowledge ? await knowledge.acquire(source, source.durationMs, signal, onStage,
            progress => { item.sourceKnowledge = progress; this.dependencies.onChange(); }) : undefined;
          const placement = this.dependencies.placement ? await this.dependencies.placement.acquire(source, signal, onStage, diagnostics) : undefined;
          signal.throwIfAborted();
          audit[index].stage = "frames";
          let extracting = pendingFrames.get(source.id);
          if (!extracting) {
            extracting = this.dependencies.frames(source, signal).catch((error) => {
              pendingFrames.delete(source.id);
              throw error;
            });
            pendingFrames.set(source.id, extracting);
          }
          const frames = await extracting;
          signal.throwIfAborted();
          audit[index].stage = "cover-selection";
          const coverSticker = this.dependencies.selectCoverSticker ? await coverForVersion(item.version, frames) : this.dependencies.coverSticker;
          signal.throwIfAborted();
          let coverTracks: AutomaticCoverTrack[] | undefined;
          let sourceStickerTracks: AutomaticCoverTrack[] | undefined;
          if (placement) {
            if (!coverSticker?.automatic || this.dependencies.preserveSourceStickers) throw new ProviderError("近似覆盖方案不能用于原贴纸占位判断。");
            coverTracks = placement.tracks;
          } else if (coverSticker?.automatic || this.dependencies.preserveSourceStickers) {
            if (!binding && (!this.dependencies.prepared || !this.dependencies.detectCoverTracks)) throw new ProviderError("源贴纸知识检查不可用，本条已停止。");
            const tracks = binding ? await knowledge!.tracks(binding) : await this.dependencies.detectCoverTracks!(source, signal, onStage);
            if (this.dependencies.preserveSourceStickers) sourceStickerTracks = tracks;
            else coverTracks = binding ? expandSourceCoverTracks(tracks) : tracks;
            signal.throwIfAborted();
          }
          const selection = this.dependencies.autoCatalog ? {
            catalogSeed: run.id,
            outputIndex: index, totalOutputs: media.length,
            stickerUsage: Array.from(stickerUsage, ([id, count]) => ({ id, count })),
            priceStyleUsage: Array.from(priceStyleUsage, ([id, count]) => ({ id, count })),
          } : undefined;
          audit[index].stage = "creative";
          const plan = await this.dependencies.plan(run.ruleId, brief, frames, signal, this.dependencies.autoCatalog, selection);
          signal.throwIfAborted();
          audit[index].stage = "prepare";
          const preparation = { plan, ruleId: run.ruleId, source, resolutionMode: this.dependencies.resolutionMode,
            stickerAssets: this.dependencies.stickerAssets, decorations: this.dependencies.decorations, catalog: this.dependencies.autoCatalog,
            coverSticker, coverTracks, sourceStickerTracks, preserveCoverMotion: Boolean(this.dependencies.prepared), runId: run.id, version: item.version };
          let template = prepareAgentTemplate(preparation);
          let version: KnowledgeVersion | undefined;
          if ((knowledge && binding || placement) && !this.dependencies.prepared) {
            const original = template;
            const rebuild = (revision: PreviewRevision) => {
              const candidatePlan = revision.corners?.length && "stickers" in plan
                ? { ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, ...revision.corners!.find(corner => corner.corner === sticker.corner) })) }
                : plan;
              const rebuilt = prepareAgentTemplate({ ...preparation, plan: candidatePlan,
                ...(this.dependencies.preserveSourceStickers ? { sourceStickerTracks: revision.tracks } : { coverTracks: placement ? revision.tracks : expandSourceCoverTracks(revision.tracks) }) });
              // Rebuilding stickers must not regenerate or modify the user's frozen text layer.
              return { ...original, layers: [...original.layers.filter(layer => layer.type === "text"), ...rebuilt.layers.filter(layer => layer.type !== "text")] };
            };
            audit[index].stage = "preview";
            if (placement) {
              template = await this.dependencies.placement!.review(source, placement, template, rebuild, signal, onStage, diagnostics);
            }
            else {
              version = await knowledge!.review(binding!, template, rebuild, signal, onStage);
              template = version.template;
            }
            signal.throwIfAborted();
          }
          if (selection && "stickers" in plan) {
            for (const { sticker } of plan.stickers) stickerUsage.set(sticker, (stickerUsage.get(sticker) ?? 0) + 1);
            priceStyleUsage.set(plan.priceStyle, (priceStyleUsage.get(plan.priceStyle) ?? 0) + 1);
          }
          if (this.dependencies.prepared) await this.dependencies.prepared(template, source, item.version, signal);
          else if (version && binding) reviewed.set(index, { index, version, binding, source });
          else if (placement) placed.set(index, { index, template, source });
          else item.taskId = await this.dependencies.enqueue(template, source, signal);
          item.summary = this.dependencies.prepared ? `${plan.summary} · 人工确认覆盖，等待动态预览批准` : sourceStickerTracks !== undefined ? `${plan.summary} · 保留原贴纸，仅补空缺角落和时段` : coverTracks !== undefined ? `${plan.summary} · ${coverTracks.length ? `已自动生成 ${coverTracks.length} 段贴纸覆盖轨迹` : "未识别到需覆盖的原贴纸"}` : plan.summary;
          if (version || placement) item.summary += " · 主管样片检查通过，正在提交导出";
          item.status = this.dependencies.prepared || version || placement ? "prepared" : "exporting";
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          stopKnowledgeProgress(item, signal.aborted, "本版创作或样片准备未完成，未提交导出；请查看本条失败原因。");
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "素材分析或本地导出准备失败，请检查素材、字体和输出目录后重试。";
        } finally {
          diagnostics?.record("lifecycle", item.status === "cancelled" ? "cancelled" : item.status === "failed" ? "failed" : "ok",
            { reason: item.status === "cancelled" ? "cancelled" : item.status === "failed" ? "stage-failed" : "accepted" });
          if (item.status === "failed" || item.status === "cancelled") audit[index].finished = Date.now();
          audit[index].creative = (this.dependencies.creativeRequests?.() ?? 0) - creativeBefore;
          const remaining = remainingVersions.get(source.id)! - 1;
          remainingVersions.set(source.id, remaining);
          if (remaining === 0) pendingFrames.delete(source.id);
        }
        this.dependencies.onChange();
    };
    const finalizeGroup = async (indices: readonly number[]) => {
      const reviewedEntries = indices.flatMap(index => reviewed.get(index) ? [reviewed.get(index)!] : []);
      const knowledgeGroups = new Map<string, typeof reviewedEntries>();
      for (const entry of reviewedEntries) knowledgeGroups.set(entry.binding.key, [...(knowledgeGroups.get(entry.binding.key) ?? []), entry]);
      for (const entries of knowledgeGroups.values()) {
        for (const { index } of entries) audit[index].stage = "reconcile";
        try { await this.dependencies.knowledge!.reconcile(entries.map(entry => entry.version), signal, stage => { for (const entry of entries) run.items[entry.index].summary = stage; this.dependencies.onChange(); }); }
        catch (error) {
          for (const { index } of entries) {
            run.items[index].status = signal.aborted ? "cancelled" : "failed";
            audit[index].finished = Date.now();
            stopKnowledgeProgress(run.items[index], signal.aborted, "源知识修订或证据完整性未确认，受影响版本未导出。");
            run.items[index].error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "源知识修订或证据完整性未确认，受影响版本未导出。";
          }
        }
      }
      for (const { index, version, source } of reviewedEntries) {
        const item = run.items[index];
        if (signal.aborted) { item.status = "cancelled"; audit[index].finished = Date.now(); stopKnowledgeProgress(item, true, ""); continue; }
        if (item.status === "failed") continue;
        try {
          audit[index].stage = "enqueue";
          const published = Boolean(version.previewPath && this.dependencies.publishApproved);
          item.taskId = await this.dependencies.knowledge!.enqueue(version, signal, template =>
            published
              ? this.dependencies.publishApproved!(template, source, version.previewPath!, signal)
              : this.dependencies.enqueue(template, source, signal));
          item.status = signal.aborted ? "cancelled" : "exporting";
          if (!signal.aborted && version.previewPath && this.dependencies.retainPreview) item.previewUrl = this.dependencies.retainPreview(run.id, item.id, version.previewPath);
          item.summary = `${item.summary?.split(" · 主管样片检查通过")[0]} · 主管样片检查通过，${published ? "已发布到输出目录" : "已提交导出"}`;
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          stopKnowledgeProgress(item, signal.aborted, "本版样片已检查，但正式提交未完成；请查看本条失败原因。");
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "主管样片检查通过，但正式导出提交失败，请重试。";
        }
        audit[index].finished = Date.now(); this.dependencies.onChange();
      }
      for (const { index, template, source } of indices.flatMap(index => placed.get(index) ? [placed.get(index)!] : [])) {
        const item = run.items[index];
        try {
          audit[index].stage = "enqueue";
          const previewPath = this.dependencies.placement!.previewPath?.(template);
          const published = Boolean(previewPath && this.dependencies.publishApproved);
          item.taskId = await this.dependencies.placement!.enqueue(source, template, signal, () =>
            published
              ? this.dependencies.publishApproved!(template, source, previewPath!, signal)
              : this.dependencies.enqueue(template, source, signal));
          item.status = signal.aborted ? "cancelled" : "exporting";
          if (!signal.aborted && previewPath && this.dependencies.retainPreview) item.previewUrl = this.dependencies.retainPreview(run.id, item.id, previewPath);
          item.summary = `近似覆盖样片检查通过，${published ? "已发布到输出目录；位置已冻结，下次仍需检查样片" : "已提交导出；位置已冻结，下次仍需检查样片"}`;
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "覆盖样片已检查，但源校验或导出提交失败，请重试。";
        }
        if (item.coverDiagnostics) new CoverDiagnostics(() => this.dependencies.onChange(), item.coverDiagnostics)
          .record("lifecycle", item.status === "cancelled" ? "cancelled" : item.status === "failed" ? "failed" : "ok",
            { reason: item.status === "cancelled" ? "cancelled" : item.status === "failed" ? "stage-failed" : "accepted" });
        audit[index].finished = Date.now(); this.dependencies.onChange();
      }
    };
    const worker = async () => {
      while (next < groupsToRun.length) {
        const group = groupsToRun[next++];
        for (const index of group) await processItem(index);
        await finalizeGroup(group);
      }
    };
    try {
      const concurrency = this.dependencies.prepared ? 1
        : Math.min(executionLimits().analysis, this.dependencies.placement || this.dependencies.knowledge ? Math.min(this.dependencies.renderSlots?.() ?? 3, 6) : Infinity, groupsToRun.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      pendingFrames.clear();
      await this.dependencies.knowledge?.close();
      await this.dependencies.placement?.close();
      if (this.dependencies.recordOutcome) for (const [index, item] of run.items.entries()) {
        const progress = item.sourceKnowledge, detail = audit[index];
        const record: KnowledgeOutcome = {
          schemaVersion: 1, id: item.id, runId: run.id, projectId: run.projectId, mediaId: item.mediaId, version: item.version,
          startedAt: new Date(detail.started).toISOString(), finishedAt: new Date(detail.finished ?? Date.now()).toISOString(), elapsedMs: Math.max(0, (detail.finished ?? Date.now()) - detail.started),
          result: item.taskId ? "queued" : item.status === "cancelled" ? "cancelled" : "failed", taskId: item.taskId,
          stage: detail.stage, lookup: progress?.lookupReason ?? (detail.stage === "waiting" ? "not-started" : "unknown"),
          sourceKey: progress?.sourceKey, revisionId: progress?.revisionId, factsDigest: progress?.factsDigest,
          templateDigest: progress?.templateDigest, previewEvidenceDigests: progress?.previewEvidenceDigests,
          requests: { executor: progress?.executorRequests ?? 0, recognitionSupervisor: progress?.recognitionSupervisorRequests ?? 0, previewSupervisor: progress?.previewRequests ?? 0, creative: detail.creative },
          requestMetric: "provider-invocations",
          revisions: progress?.revisions ?? 0, renders: progress?.renders ?? 0,
          executor: progress?.executor, supervisor: progress?.supervisor, creative: this.dependencies.creativeModel,
          modelVerdict: progress?.modelVerdict ?? "not-evaluated", sourceIssueReported: progress?.sourceIssueReported ?? false, quality: "not-evaluated",
          previewActions: progress?.previewActions,
          failureStage: progress?.failureStage,
        };
        try { await this.dependencies.recordOutcome(record); }
        catch {
          const warning = "制作统计未保存，无法在重启后追溯本次记录；原知识与导出状态不变。";
          if (item.error) item.error += ` ${warning}`; else item.summary = `${item.summary ?? ""} ${warning}`;
        }
      }
      run.status = signal.aborted ? "cancelled" : "finished";
      this.dependencies.onChange();
      await this.dependencies.finalizePreviews?.();
    }
  }
}
