import path from "node:path";
import type { AgentStartInput } from "../shared/agent.js";
import { AgentStartSchema, MAX_AGENT_OUTPUTS } from "../shared/agent.js";
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
import { DecorationSchema } from "../shared/decorations.js";
import { decorationFontFamilies, type AssetLibrary } from "./asset-library.js";

const AUTO_STICKER_LABELS: Readonly<Record<string, string>> = {
  sparkle: "星芒", arrow: "箭头", heart: "爱心", burst: "爆闪",
};

export class AgentController {
  private runner?: AgentRunner;
  private preparing = false;
  private testing = false;
  private generatingBrief = false;
  private preparingController?: AbortController;
  private testController?: AbortController;
  private briefController?: AbortController;
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
    try { return await this.provider.generateBrief(input, this.briefController.signal); }
    finally { this.generatingBrief = false; this.briefController = undefined; }
  }

  private async autoCatalog(): Promise<AgentDecorationCatalog> {
    const stickers = Object.entries(AUTO_STICKER_LABELS)
      .filter(([id]) => Boolean(this.stickerAssets[id]))
      .map(([id, label]) => ({ id, label }));
    return { fonts: [], stickers };
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
    try {
      const parsed = AgentStartSchema.parse(input);
      const decorations = DecorationSchema.parse(parsed.decorations ?? {});
      const autoCatalog = decorations.mode === "agent" ? await this.autoCatalog() : undefined;
      const stickerAssets = decorations.mode === "agent" ? this.stickerAssets : this.library ? await this.library.prepare(decorations, this.stickerAssets) : this.stickerAssets;
      this.preparingController.signal.throwIfAborted();
      for (const family of decorationFontFamilies(decorations)) {
        const font = this.library ? await this.library.resolveFont(family) : await resolveFont(family);
        if (!font) throw new Error("所选字体不可用，请重新选择已安装字体。");
      }
      if (!path.isAbsolute(parsed.outputDirectory)) throw new Error("请选择有效的输出目录。");
      const outputDirectory = await canonicalPath(parsed.outputDirectory);
      if (!approvedDirectories.has(outputDirectory)) throw new Error("请通过系统对话框选择输出目录。");
      const ids = [...new Set(parsed.mediaIds)];
      if (this.service.currentProject.exportBatches.length + ids.length * (parsed.multiplier ?? 1) > MAX_AGENT_OUTPUTS) throw new Error(`按当前倍数制作将超过项目 ${MAX_AGENT_OUTPUTS} 条导出记录上限，请减少倍数或新建项目。`);
      const media = ids.map((id) => this.service.getMedia(id));
      if (media.some((item) => !item || item.probeStatus !== "ready")) throw new Error("所选素材不可用，请重新导入。");
      await assertOutputDirectorySafe(outputDirectory, media as MediaItem[]);
      this.preparingController.signal.throwIfAborted();
      const projectId = this.service.currentProject.id;
      this.runner = new AgentRunner({
        frames: (item, signal) => extractAgentFrames(this.ffmpeg, item, signal),
        plan: (rule, brief, frames, signal, catalog) => this.provider.plan(rule, brief, frames, signal, catalog),
        enqueue: async (template, item, signal) => {
          signal.throwIfAborted();
          const batch = await this.queue.createBatch({ projectId, template, mediaIds: [item.id], mediaItems: [item], outputDirectory, preset: { ...DEFAULT_PRESET, container: parsed.exportFormat ?? DEFAULT_PRESET.container } });
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
    } finally { this.preparing = false; this.preparingController = undefined; }
  }

  async cancel(): Promise<void> {
    this.preparingController?.abort();
    this.testController?.abort();
    this.briefController?.abort();
    this.runner?.cancel();
    for (const item of this.runner?.snapshot()?.items ?? []) {
      if (item.taskId) await this.queue.cancel(item.taskId);
    }
    await this.runner?.settled();
  }
}
