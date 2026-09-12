import { randomUUID } from "node:crypto";
import { type AgentRun, type RuleId } from "../shared/agent.js";
import type { EditTemplate, MediaItem } from "./domain.js";
import { materializePlan, ProviderError, type PackagingPlan } from "./agent-provider.js";
import type { BuiltinStickerAssets } from "./builtin-stickers.js";

interface RunnerDependencies {
  frames(media: MediaItem, signal: AbortSignal): Promise<string[]>;
  plan(ruleId: RuleId, brief: string, frames: string[], signal: AbortSignal): Promise<PackagingPlan>;
  enqueue(template: EditTemplate, media: MediaItem, signal: AbortSignal): Promise<string>;
  stickerAssets: BuiltinStickerAssets;
  onChange(): void;
}

export class AgentRunner {
  private run?: AgentRun;
  private controller?: AbortController;
  private pending?: Promise<void>;
  constructor(private readonly dependencies: RunnerDependencies) {}

  snapshot(): AgentRun | undefined { return this.run && structuredClone(this.run); }
  get running(): boolean { return this.run?.status === "running"; }

  start(projectId: string, ruleId: RuleId, brief: string, media: readonly MediaItem[]): AgentRun {
    if (this.running) throw new Error("Agent 正在处理，请等待完成或停止当前任务。");
    if (media.length === 0 || media.some((item) => item.probeStatus !== "ready")) throw new Error("请先导入有效素材。");
    this.controller = new AbortController();
    this.run = {
      id: randomUUID(), projectId, ruleId, status: "running",
      items: media.map((item) => ({ mediaId: item.id, name: item.displayName, status: "waiting" })),
    };
    const frozen = structuredClone(media);
    this.pending = this.execute(this.run, brief, frozen, this.controller.signal);
    return this.snapshot()!;
  }

  cancel(): void { this.controller?.abort(); }
  async settled(): Promise<void> { await this.pending; }

  private async execute(run: AgentRun, brief: string, media: readonly MediaItem[], signal: AbortSignal): Promise<void> {
    try {
      for (const [index, source] of media.entries()) {
        const item = run.items[index];
        if (signal.aborted) { item.status = "cancelled"; continue; }
        item.status = "analyzing";
        this.dependencies.onChange();
        try {
          const frames = await this.dependencies.frames(source, signal);
          signal.throwIfAborted();
          const plan = await this.dependencies.plan(run.ruleId, brief, frames, signal);
          signal.throwIfAborted();
          const template = materializePlan(plan, run.ruleId, source, this.dependencies.stickerAssets);
          item.taskId = await this.dependencies.enqueue(template, source, signal);
          item.summary = plan.summary;
          item.status = "exporting";
        } catch (error) {
          item.status = signal.aborted ? "cancelled" : "failed";
          item.error = signal.aborted ? undefined : error instanceof ProviderError ? error.message : "素材分析或本地导出准备失败，请检查素材、字体和输出目录后重试。";
        }
        this.dependencies.onChange();
      }
    } finally {
      run.status = signal.aborted ? "cancelled" : "finished";
      this.dependencies.onChange();
    }
  }
}
