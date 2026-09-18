import { CoverPlacementSchema, type CoverPlacement } from "../shared/cover-placement.js";
import type { SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { EditTemplateSchema, type EditTemplate, type MediaItem, type ExportBatch } from "./domain.js";
import type { PreviewRevision } from "./supervisor-protocol.js";
import { sourceKey, type SourceStickerKnowledgeStore, type KnowledgeRun } from "./source-sticker-knowledge-store.js";
import { templateDigest } from "./supervisor-knowledge.js";
import { ProviderError } from "./api-transport.js";

interface Options {
  identify(media: MediaItem, signal: AbortSignal): Promise<SourceIdentity>;
  store: Pick<SourceStickerKnowledgeStore, "beginRun" | "endRun" | "readHead" | "admit">;
  propose(media: MediaItem, signal: AbortSignal, onStage: (stage: string) => void): Promise<CoverPlacement>;
  review(input: { media: MediaItem; placement: CoverPlacement; template: EditTemplate; rebuild(revision: PreviewRevision): EditTemplate;
    signal: AbortSignal; onStage(stage: string): void }): Promise<{ template: EditTemplate; tracks: CoverPlacement["tracks"] }>;
  cached: readonly CoverPlacement[];
  refreshMediaIds?: ReadonlySet<string>;
}

export function completedCoverPlacements(history: readonly ExportBatch[]): CoverPlacement[] {
  return history.slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .flatMap(batch => batch.templateSnapshot.coverPlacement && batch.tasks.some(task => task.status === "completed") ? [batch.templateSnapshot.coverPlacement] : []);
}

/** Approximate rendering proposals, never source facts. Durable ownership stays with frozen export templates. */
export class CoverPlacementSession {
  private readonly placements = new Map<string, CoverPlacement>();
  private readonly accepted = new Map<string, string>();
  private readonly proposalFailures = new Map<string, unknown>();
  private readonly runs = new Map<string, { token: KnowledgeRun; revisionId: string | null }>();
  constructor(private readonly options: Options) {}
  private async identify(media: MediaItem, signal: AbortSignal): Promise<SourceIdentity> {
    signal.throwIfAborted();
    const source = await this.options.identify(media, signal);
    if (source.fingerprint !== media.fingerprint || source.durationMs !== media.durationMs || source.width !== media.width || source.height !== media.height || source.rotation !== media.rotation) throw new ProviderError("原素材已变化，不能复用覆盖方案。");
    try {
      const key = sourceKey(source);
      let run = this.runs.get(key);
      if (!run) { run = { token: await this.options.store.beginRun(source, signal), revisionId: null }; this.runs.set(key, run); }
      run.revisionId = (await this.options.store.readHead(source))?.revision.id ?? null;
    } catch { throw new ProviderError("源贴纸知识存在争议或完整性未知，本条覆盖已停止；不能绕过阻断复用旧位置。"); }
    signal.throwIfAborted();
    return source;
  }
  async acquire(media: MediaItem, signal: AbortSignal, onStage: (stage: string) => void): Promise<CoverPlacement> {
    const source = await this.identify(media, signal), key = sourceKey(source);
    if (this.proposalFailures.has(key)) throw this.proposalFailures.get(key);
    const saved = this.placements.get(key) ?? (!this.options.refreshMediaIds?.has(media.id)
      ? this.options.cached.find(value => sourceKey(value.source) === key) : undefined);
    if (saved) {
      onStage("复用近似覆盖候选；本版仍需检查真实样片…");
      return structuredClone(saved);
    }
    try {
      const proposal = CoverPlacementSchema.parse(await this.options.propose(media, signal, onStage));
      signal.throwIfAborted();
      if (sourceKey(proposal.source) !== key) throw new ProviderError("覆盖方案与源素材身份不符。");
      this.placements.set(key, proposal);
      return structuredClone(proposal);
    } catch (error) { this.proposalFailures.set(key, error); throw error; }
  }
  async review(media: MediaItem, placement: CoverPlacement, template: EditTemplate, rebuild: (revision: PreviewRevision) => EditTemplate,
    signal: AbortSignal, onStage: (stage: string) => void): Promise<EditTemplate> {
    const key = sourceKey(placement.source);
    try {
      if (sourceKey(await this.identify(media, signal)) !== key) throw new ProviderError("覆盖方案的源素材已变化。");
      const result = await this.options.review({ media, placement: structuredClone(placement), template, rebuild, signal, onStage });
      signal.throwIfAborted();
      if (sourceKey(await this.identify(media, signal)) !== key) throw new ProviderError("样片检查期间源素材已变化。");
      const reviewed = CoverPlacementSchema.parse({ ...placement, tracks: result.tracks });
      const accepted = EditTemplateSchema.parse({ ...result.template, coverPlacement: reviewed });
      this.accepted.set(accepted.id, templateDigest(accepted));
      this.placements.set(key, reviewed);
      return accepted;
    } catch (error) { this.placements.delete(key); throw error; }
  }
  async assertCurrent(media: MediaItem, template: EditTemplate, signal: AbortSignal): Promise<void> {
    if (!template.coverPlacement || this.accepted.get(template.id) !== templateDigest(template)) throw new ProviderError("覆盖方案未通过本轮样片检查或已变化。");
    if (sourceKey(await this.identify(media, signal)) !== sourceKey(template.coverPlacement.source)) throw new ProviderError("覆盖方案的源素材已变化。");
  }
  async enqueue(media: MediaItem, template: EditTemplate, signal: AbortSignal, submit: () => Promise<string>): Promise<string> {
    await this.assertCurrent(media, template, signal);
    const run = this.runs.get(sourceKey(template.coverPlacement!.source))!;
    // Atomic handoff uses the existing knowledge owner, never a second admission lock.
    return this.options.store.admit(run.token, run.revisionId, async () => { signal.throwIfAborted(); return submit(); });
  }
  async close(): Promise<void> {
    try { await Promise.all([...this.runs.values()].map(run => this.options.store.endRun(run.token))); }
    finally { this.runs.clear(); this.placements.clear(); this.accepted.clear(); this.proposalFailures.clear(); }
  }
}
