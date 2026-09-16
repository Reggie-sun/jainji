import { randomUUID } from "node:crypto";
import { outputDimensions, type ExportSettings } from "../shared/export-settings.js";
import { MAX_AGENT_OUTPUTS, ProductionMultiplierSchema, type AgentRun, type RuleId } from "../shared/agent.js";
import { EditTemplateSchema, type EditTemplate, type MediaItem } from "./domain.js";
import { materializePlan, ProviderError, type AgentDecorationCatalog, type AgentSelectionContext, type PackagingPlan } from "./agent-provider.js";
import type { StickerAssets } from "./builtin-stickers.js";
import type { DecorationOptions } from "../shared/decorations.js";
import { executionLimits } from "./execution-limits.js";
import type { PriceStyleId } from "../shared/price-styles.js";
import { manualCoverLayers, automaticCoverLayers, type FrozenCoverSticker } from "./cover-sticker.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";

interface RunnerDependencies {
  frames(media: MediaItem, signal: AbortSignal): Promise<string[]>;
  plan(ruleId: RuleId, brief: string, frames: string[], signal: AbortSignal, catalog?: AgentDecorationCatalog, selection?: AgentSelectionContext): Promise<PackagingPlan>;
  enqueue(template: EditTemplate, media: MediaItem, signal: AbortSignal): Promise<string>;
  stickerAssets: StickerAssets;
  decorations?: DecorationOptions;
  resolutionMode?: ExportSettings["resolutionMode"];
  autoCatalog?: AgentDecorationCatalog;
  coverSticker?: FrozenCoverSticker;
  selectCoverSticker?(frames: string[], signal: AbortSignal): Promise<FrozenCoverSticker>;
  detectCoverTracks?(media: MediaItem, signal: AbortSignal): Promise<AutomaticCoverTrack[]>;
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
    let pendingCoverSticker: Promise<FrozenCoverSticker> | undefined;
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
          if (this.dependencies.selectCoverSticker && !pendingCoverSticker) pendingCoverSticker = this.dependencies.selectCoverSticker(frames, signal);
          const coverSticker = pendingCoverSticker ? await pendingCoverSticker : this.dependencies.coverSticker;
          signal.throwIfAborted();
          let coverTracks: AutomaticCoverTrack[] | undefined;
          if (coverSticker?.automatic) {
            if (!this.dependencies.detectCoverTracks) throw new ProviderError("自动覆盖识别服务不可用，本条已停止。");
            item.summary = "正在自动识别并追踪全部原贴纸…";
            this.dependencies.onChange();
            let detecting = pendingCoverTracks.get(source.id);
            if (!detecting) {
              detecting = this.dependencies.detectCoverTracks(source, signal);
              pendingCoverTracks.set(source.id, detecting);
            }
            coverTracks = await detecting;
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
          const dimensions = outputDimensions(source, { resolutionMode: this.dependencies.resolutionMode ?? "source" });
          let template = materializePlan(plan, run.ruleId, dimensions, this.dependencies.stickerAssets, this.dependencies.decorations, this.dependencies.autoCatalog);
          if (coverSticker) {
            const layers = coverTracks !== undefined ? automaticCoverLayers(coverSticker, source, dimensions, coverTracks) : manualCoverLayers(coverSticker, source, dimensions);
            template = EditTemplateSchema.parse({ ...template, layers: [...template.layers, ...layers] });
          }
          if (selection && "stickers" in plan) {
            for (const { sticker } of plan.stickers) stickerUsage.set(sticker, (stickerUsage.get(sticker) ?? 0) + 1);
            priceStyleUsage.set(plan.priceStyle, (priceStyleUsage.get(plan.priceStyle) ?? 0) + 1);
          }
          item.taskId = await this.dependencies.enqueue(template, source, signal);
          item.summary = coverTracks !== undefined ? `${plan.summary} · ${coverTracks.length ? `已自动生成 ${coverTracks.length} 段贴纸覆盖轨迹` : "未识别到需覆盖的原贴纸"}` : plan.summary;
          item.status = "exporting";
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
      await Promise.all(Array.from({ length: Math.min(executionLimits().analysis, media.length) }, () => worker()));
    } finally {
      pendingFrames.clear();
      pendingCoverTracks.clear();
      run.status = signal.aborted ? "cancelled" : "finished";
      this.dependencies.onChange();
    }
  }
}
