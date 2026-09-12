import path from "node:path";
import type { AgentStartInput } from "../shared/agent.js";
import { AgentStartSchema } from "../shared/agent.js";
import type { ApplicationService } from "./application.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { DEFAULT_PRESET, type MediaItem } from "./domain.js";
import { AgentProvider } from "./agent-provider.js";
import { AgentRunner } from "./agent-runner.js";
import { extractAgentFrames } from "./agent-frames.js";
import { assertOutputDirectorySafe, canonicalPath } from "./paths.js";
import type { ExportQueue } from "./queue.js";

export class AgentController {
  readonly provider = new AgentProvider();
  private runner?: AgentRunner;
  private preparing = false;
  private testing = false;
  private preparingController?: AbortController;
  private testController?: AbortController;
  constructor(private readonly service: ApplicationService, private readonly queue: ExportQueue, private readonly ffmpeg: FfmpegAdapter, private readonly onChange: () => void) {}

  get busy(): boolean { return this.preparing || this.testing || Boolean(this.runner?.running); }
  snapshot() { const run = this.runner?.snapshot(); return run?.projectId === this.service.currentProject.id ? run : undefined; }
  assertIdle(): void { if (this.busy) throw new Error("Agent 正在处理，请等待或先停止当前任务。"); }

  async test(): Promise<void> {
    this.assertIdle(); this.testing = true; this.testController = new AbortController();
    try { await this.provider.test(this.testController.signal); }
    finally { this.testing = false; this.testController = undefined; }
  }

  async start(input: AgentStartInput, approvedDirectories: ReadonlySet<string>): Promise<void> {
    this.assertIdle();
    if (!this.provider.status().configured) throw new Error("请先接入 API Key。");
    if (this.queue.snapshot().batches.some(({ batch }) => batch.tasks.some((task) =>
      ["validating", "running", "verifying", "cancelling"].includes(task.status) ||
      (batch.projectId === this.service.currentProject.id && task.status === "queued")))) {
      throw new Error("请等待当前导出完成，或先停止队列中的任务。");
    }
    this.preparing = true;
    this.preparingController = new AbortController();
    try {
      const parsed = AgentStartSchema.parse(input);
      if (!path.isAbsolute(parsed.outputDirectory)) throw new Error("请选择有效的输出目录。");
      const outputDirectory = await canonicalPath(parsed.outputDirectory);
      if (!approvedDirectories.has(outputDirectory)) throw new Error("请通过系统对话框选择输出目录。");
      const ids = [...new Set(parsed.mediaIds)];
      if (this.service.currentProject.exportBatches.length + ids.length > 100) throw new Error("当前项目的导出记录已达上限，请保存并新建项目。");
      const media = ids.map((id) => this.service.getMedia(id));
      if (media.some((item) => !item || item.probeStatus !== "ready")) throw new Error("所选素材不可用，请重新导入。");
      await assertOutputDirectorySafe(outputDirectory, media as MediaItem[]);
      this.preparingController.signal.throwIfAborted();
      const projectId = this.service.currentProject.id;
      this.runner = new AgentRunner({
        frames: (item, signal) => extractAgentFrames(this.ffmpeg, item, signal),
        plan: (rule, brief, frames, signal) => this.provider.plan(rule, brief, frames, signal),
        enqueue: async (template, item, signal) => {
          signal.throwIfAborted();
          const batch = await this.queue.createBatch({ projectId, template, mediaIds: [item.id], mediaItems: [item], outputDirectory, preset: DEFAULT_PRESET });
          if (signal.aborted) await this.queue.cancel(batch.tasks[0].id);
          else void this.queue.start(batch.id).catch(() => { this.onChange(); });
          return batch.tasks[0].id;
        },
        onChange: this.onChange,
      });
      this.runner.start(projectId, parsed.ruleId, parsed.brief, media as MediaItem[]);
    } finally { this.preparing = false; this.preparingController = undefined; }
  }

  async cancel(): Promise<void> {
    this.preparingController?.abort();
    this.testController?.abort();
    this.runner?.cancel();
    for (const item of this.runner?.snapshot()?.items ?? []) {
      if (item.taskId) await this.queue.cancel(item.taskId);
    }
    await this.runner?.settled();
  }
}
