import path from "node:path";
import type { AgentStartInput } from "../shared/agent.js";
import { AgentStartSchema, GenerateBriefSchema, MAX_AGENT_OUTPUTS } from "../shared/agent.js";
import type { ApplicationService } from "./application.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { DEFAULT_PRESET, type MediaItem } from "./domain.js";
import { AgentProvider, type AgentDecorationCatalog } from "./agent-provider.js";
import { AgentRunner } from "./agent-runner.js";
import { extractAgentFrames } from "./agent-frames.js";
import { assertOutputDirectorySafe, canonicalPath } from "./paths.js";
import type { ExportQueue } from "./queue.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { resolveFont } from "./ffmpeg.js";
import { DecorationSchema, isUploadedStickerId, type DecorationOptions } from "../shared/decorations.js";
import { decorationFontFamilies, decorationStickerIds, type AssetLibrary } from "./asset-library.js";
import { AUTOMATIC_STICKERS } from "../shared/automatic-stickers.js";
import { BUNDLED_STICKERS } from "../shared/bundled-stickers.js";
import { LIBRARY_STICKERS } from "../shared/asset-library.js";
import { stickerPreview } from "./sticker-preview.js";
import { resolveCoverSticker } from "./cover-sticker.js";
import { recognizeAutomaticCovers } from "./automatic-cover.js";

export class AgentController {
  private runner?: AgentRunner;
  private preparing = false;
  private testing = false;
  private generatingBrief = false;
  private preparingController?: AbortController;
  private testController?: AbortController;
  private briefController?: AbortController;
  private pendingOperation?: Promise<void>;
  constructor(private readonly service: ApplicationService, private readonly queue: ExportQueue, private readonly ffmpeg: FfmpegAdapter, private readonly onChange: () => void, private readonly stickerAssets: StickerAssets, private readonly library?: AssetLibrary, readonly provider = new AgentProvider()) {}

  get busy(): boolean { return this.preparing || this.testing || this.generatingBrief || Boolean(this.runner?.running); }
  snapshot() { const run = this.runner?.snapshot(); return run?.projectId === this.service.currentProject.id ? run : undefined; }
  assertIdle(): void { if (this.busy) throw new Error("Agent 正在处理，请等待或先停止当前任务。"); }

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

  private async autoCatalog(signal: AbortSignal): Promise<AgentDecorationCatalog> {
    const labels = new Map(AUTOMATIC_STICKERS.map(({ id, label }) => [id, label]));
    const stickers = [
      ...AUTOMATIC_STICKERS.filter(({ id }) => Boolean(this.stickerAssets[id])),
      ...BUNDLED_STICKERS.filter(({ id }) => Boolean(this.stickerAssets[id])),
      ...(this.library ? LIBRARY_STICKERS : []),
      ...Object.keys(this.stickerAssets).filter(isUploadedStickerId).map((id) => ({ id, label: `用户上传贴纸 ${id.slice(9, 17)}` })),
    ].map(({ id, label }) => ({ id, label: labels.get(id) ?? label }));
    const previews = [];
    for (const { id } of stickers.filter(({ id }) => isUploadedStickerId(id))) {
      signal.throwIfAborted();
      previews.push({ id, url: await stickerPreview(this.ffmpeg, this.stickerAssets[id]!, signal) });
    }
    return { fonts: [], stickers, previews };
  }

  async start(input: AgentStartInput, approvedDirectories: ReadonlySet<string>): Promise<void> {
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
      const history = [...project.exportBatches, ...this.queue.snapshot().batches.filter(({ batch }) => batch.projectId === project.id).map(({ batch }) => batch)];
      const coverSticker = resolveCoverSticker(project.coverSticker, this.stickerAssets, history);
      const autoCatalog = decorations.mode === "agent" ? await this.autoCatalog(this.preparingController.signal) : undefined;
      const stickerAssets = decorations.mode === "agent" ? { ...this.stickerAssets } : this.library ? await this.library.prepare(decorations, this.stickerAssets) : this.stickerAssets;
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
      const projectId = this.service.currentProject.id;
      const previews = new Map<string, Promise<{ id: string; url: string }>>();
      for (const preview of autoCatalog?.previews ?? []) previews.set(preview.id, Promise.resolve(preview));
      let manualPreviews: Promise<{ id: string; url: string }[]> | undefined;
      this.runner = new AgentRunner({
        coverSticker,
        detectCoverTracks: (item, signal) => recognizeAutomaticCovers(this.ffmpeg, item, (images, previous, currentSignal) => this.provider.detectCovers(images, previous, currentSignal), signal),
        resolutionMode: parsed.exportSettings?.resolutionMode ?? DEFAULT_PRESET.resolutionMode,
        frames: (item, signal) => extractAgentFrames(this.ffmpeg, item, signal),
        plan: async (rule, brief, frames, signal, catalog, selection) => {
          if (!catalog) {
            manualPreviews ??= this.manualStickerPreviews(decorations, signal);
            return this.provider.plan(rule, brief, frames, signal, undefined, undefined, await manualPreviews);
          }
          const ids = await this.provider.shortlist(rule, brief, frames, signal, catalog, selection);
          const candidatePreviews = [];
          for (const id of ids) {
            signal.throwIfAborted();
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
          const candidates = { fonts: [], stickers: ids.map((id) => catalog.stickers.find((entry) => entry.id === id)!), previews: candidatePreviews };
          return this.provider.plan(rule, brief, frames, signal, candidates, selection);
        },
        enqueue: async (template, item, signal) => {
          signal.throwIfAborted();
          const batch = await this.queue.createBatch({ projectId, template, mediaIds: [item.id], mediaItems: [item], outputDirectory, preset: { ...DEFAULT_PRESET, ...parsed.exportSettings, container: parsed.exportFormat ?? DEFAULT_PRESET.container } });
          if (signal.aborted) await this.queue.cancel(batch.tasks[0].id);
          else void this.queue.start(batch.id).catch(() => { this.onChange(); });
          return batch.tasks[0].id;
        },
        stickerAssets,
        decorations,
        autoCatalog,
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
  }
}
