import { rm } from "node:fs/promises";
import type { AgentRun } from "../shared/agent.js";
import { canonicalPath, isPathWithinDirectory } from "./paths.js";

/** Run-local owner for accepted supervisor videos. Paths never enter public state. */
export class AgentPreviewStore {
  private readonly directories = new Set<string>();
  private readonly files = new Map<string, string>();

  private key(runId: string, itemId: string): string { return `${runId}:${itemId}`; }
  private url(runId: string, itemId: string): string { return `jianji-agent-preview://${runId}/${itemId}`; }

  retainDirectory(directory: string): void { this.directories.add(directory); }

  register(runId: string, itemId: string, filePath: string): string {
    if (![...this.directories].some(directory => isPathWithinDirectory(directory, filePath))) throw new Error("主管样片不属于当前任务。");
    this.files.set(this.key(runId, itemId), filePath);
    return this.url(runId, itemId);
  }

  async resolve(run: AgentRun | undefined, runId: string, itemId: string): Promise<string> {
    const item = run?.id === runId ? run.items.find(value => value.id === itemId) : undefined;
    const file = item?.previewUrl === this.url(runId, itemId) ? this.files.get(this.key(runId, itemId)) : undefined;
    if (!file) throw new Error("主管样片不存在。");
    const resolved = await canonicalPath(file);
    if (![...this.directories].some(directory => isPathWithinDirectory(directory, resolved))) throw new Error("主管样片归属不匹配。");
    return resolved;
  }

  /** Remove failed or otherwise unreferenced preview directories. */
  async prune(): Promise<void> {
    const registered = [...this.files.values()];
    const stale = [...this.directories].filter(directory => !registered.some(file => isPathWithinDirectory(directory, file)));
    for (const directory of stale) this.directories.delete(directory);
    const results = await Promise.allSettled(stale.map(directory => rm(directory, { recursive: true, force: true })));
    results.forEach((result, index) => { if (result.status === "rejected") this.directories.add(stale[index]); });
  }

  async clear(): Promise<void> {
    const directories = [...this.directories];
    this.directories.clear(); this.files.clear();
    await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })));
  }
}
