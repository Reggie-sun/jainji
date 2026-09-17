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
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import { prepareAgentTemplate } from "./agent-template-preparation.js";
import type { PreviewRevision } from "./supervisor-protocol.js";

interface RunnerDependencies {
  frames(media: MediaItem, signal: AbortSignal): Promise<string[]>;
  plan(ruleId: RuleId, brief: string, frames: string[], signal: AbortSignal, catalog?: AgentDecorationCatalog, selection?: AgentSelectionContext): Promise<PackagingPlan>;
  enqueue(template: EditTemplate, media: MediaItem, signal: AbortSignal): Promise<string>;
  prepared?(template: EditTemplate, media: MediaItem, version: number, signal: AbortSignal): Promise<void>;
  stickerAssets: StickerAssets;
  decorations?: DecorationOptions;
  resolutionMode?: ExportSettings["resolutionMode"];
  autoCatalog?: AgentDecorationCatalog;
  coverSticker?: FrozenCoverSticker;
  preserveSourceStickers?: boolean;
  selectCoverSticker?(frames: string[], signal: AbortSignal, previousSelections: readonly string[]): Promise<FrozenCoverSticker>;
  detectCoverTracks?(media: MediaItem, signal: AbortSignal, onStage: (stage: string) => void): Promise<AutomaticCoverTrack[]>;
  supervise?(template: EditTemplate, media: MediaItem, tracks: AutomaticCoverTrack[], rebuild: (revision: PreviewRevision) => EditTemplate, signal: AbortSignal, onStage: (stage: string) => void): Promise<EditTemplate>;
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
    const stickerUsage = new Map<string, number>();
    const priceStyleUsage = new Map<PriceStyleId, number>();
    const pendingFrames = new Map<string, Promise<string[]>>();
    const pendingCoverTracks = new Map<string, Promise<AutomaticCoverTrack[]>>();
    const pendingCoverStickers = new Map<number, Promise<FrozenCoverSticker>>();
    const selectedCoverIds: string[] = [];
    const reviewed: Array<{ index: number; template: EditTemplate; source: MediaItem }> = [];
    const coverForVersion = (version: number, frames: string[]): Promise<FrozenCoverSticker> => {
      let pending = pendingCoverStickers.get(version);
      if (!pending) {
        const previous = version > 1 ? coverForVersion(version - 1, frames) : Promise.resolve();
        pending = previous.then(async () => {
          signal.throwIfAborted();
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
    const worker = async () => {
      while (next < media.length) {
        const index = next++;
        const source = media[index];
        const item = run.items[index];
        if (signal.aborted) { item.status = "cancelled"; continue; }
        item.status = "analyzing";
        this.dependencies.onChange();
        const onStage = (stage: string) => { item.summary = stage; this.dependencies.onChange(); };
        try {
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
          const coverSticker = this.dependencies.selectCoverSticker ? await coverForVersion(item.version, frames) : this.dependencies.coverSticker;
          signal.throwIfAborted();
          let coverTracks: AutomaticCoverTrack[] | undefined;
          let sourceStickerTracks: AutomaticCoverTrack[] | undefined;
          if (coverSticker?.automatic || this.dependencies.preserveSourceStickers) {
            if (!this.dependencies.detectCoverTracks) throw new ProviderError("原贴纸识别服务不可用，本条已停止。");
            item.summary = this.dependencies.prepared ? "正在读取人工确认的覆盖区间…" : "正在由执行 Agent 识别、主管 Agent 看图修正原贴纸…";
            this.dependencies.onChange();
            let detecting = pendingCoverTracks.get(source.id);
            if (!detecting) {
              detecting = this.dependencies.detectCoverTracks(source, signal, onStage);
              pendingCoverTracks.set(source.id, detecting);
            }
            const tracks = await detecting;
            if (this.dependencies.preserveSourceStickers) sourceStickerTracks = tracks;
            else coverTracks = tracks;
            signal.throwIfAborted();
          }
          const selection = this.dependencies.autoCatalog ? {
            catalogSeed: run.id,
            outputIndex: index, totalOutputs: media.length,
            stickerUsage: Array.from(stickerUsage, ([id, count]) => ({ id, count })),
            priceStyleUsage: Array.from(priceStyleUsage, ([id, count]) => ({ id, count })),
          } : undefined;
          const plan = await this.dependencies.plan(run.ruleId, brief, frames, signal, this.dependencies.autoCatalog, selection);
          signal.throwIfAborted();
          const preparation = { plan, ruleId: run.ruleId, source, resolutionMode: this.dependencies.resolutionMode,
            stickerAssets: this.dependencies.stickerAssets, decorations: this.dependencies.decorations, catalog: this.dependencies.autoCatalog,
            coverSticker, coverTracks, sourceStickerTracks, runId: run.id, version: item.version };
          let template = prepareAgentTemplate(preparation);
          if (this.dependencies.supervise && !this.dependencies.prepared) {
            const original = template;
            template = await this.dependencies.supervise(template, source, sourceStickerTracks ?? coverTracks ?? [], revision => {
              const candidatePlan = revision.corners?.length && "stickers" in plan
                ? { ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, ...revision.corners!.find(corner => corner.corner === sticker.corner) })) }
                : plan;
              const rebuilt = prepareAgentTemplate({ ...preparation, plan: candidatePlan,
                ...(this.dependencies.preserveSourceStickers ? { sourceStickerTracks: revision.tracks } : { coverTracks: revision.tracks }) });
              // Rebuilding stickers must not regenerate or modify the user's frozen text layer.
              return { ...original, layers: [...original.layers.filter(layer => layer.type === "text"), ...rebuilt.layers.filter(layer => layer.type !== "text")] };
            }, signal, onStage);
            signal.throwIfAborted();
          }
          if (selection && "stickers" in plan) {
            for (const { sticker } of plan.stickers) stickerUsage.set(sticker, (stickerUsage.get(sticker) ?? 0) + 1);
            priceStyleUsage.set(plan.priceStyle, (priceStyleUsage.get(plan.priceStyle) ?? 0) + 1);
          }
          if (this.dependencies.prepared) await this.dependencies.prepared(template, source, item.version, signal);
          else if (this.dependencies.supervise) reviewed.push({ index, template: structuredClone(template), source });
          else item.taskId = await this.dependencies.enqueue(template, source, signal);
          item.summary = this.dependencies.prepared ? `${plan.summary} · 人工确认覆盖，等待动态预览批准` : sourceStickerTracks !== undefined ? `${plan.summary} · 保留原贴纸，仅补空缺角落和时段` : coverTracks !== undefined ? `${plan.summary} · ${coverTracks.length ? `已自动生成 ${coverTracks.length} 段贴纸覆盖轨迹` : "未识别到需覆盖的原贴纸"}` : plan.summary;
          if (this.dependencies.supervise) item.summary += " · 主管样片检查通过，等待本轮检查结束后导出";
          item.status = this.dependencies.prepared || this.dependencies.supervise ? "prepared" : "exporting";
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "素材分析或本地导出准备失败，请检查素材、字体和输出目录后重试。";
        } finally {
          const remaining = remainingVersions.get(source.id)! - 1;
          remainingVersions.set(source.id, remaining);
          if (remaining === 0) { pendingFrames.delete(source.id); pendingCoverTracks.delete(source.id); }
        }
        this.dependencies.onChange();
      }
    };
    try {
      await Promise.all(Array.from({ length: this.dependencies.prepared || this.dependencies.supervise ? 1 : Math.min(executionLimits().analysis, media.length) }, () => worker()));
      // The existing queue owns both previews and formal exports. Finish all previews
      // before starting any formal job, so later versions cannot collide with exports.
      for (const { index, template, source } of reviewed) {
        const item = run.items[index];
        if (signal.aborted) { item.status = "cancelled"; continue; }
        try {
          item.taskId = await this.dependencies.enqueue(template, source, signal);
          item.status = signal.aborted ? "cancelled" : "exporting";
          item.summary = `${item.summary?.split(" · 主管样片检查通过")[0]} · 主管样片检查通过，已提交导出`;
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "主管样片检查通过，但正式导出提交失败。";
        }
        this.dependencies.onChange();
      }
    } finally {
      pendingFrames.clear();
      pendingCoverTracks.clear();
      run.status = signal.aborted ? "cancelled" : "finished";
      this.dependencies.onChange();
    }
  }
}
