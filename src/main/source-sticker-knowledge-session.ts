import { randomUUID } from "node:crypto";
import { KnowledgeCandidateSchema, coversRanges, sourceObservationsChanged, type KnowledgeCandidate, type KnowledgeEvidence, type KnowledgeRevision, type SourceFacts, type SourceIdentity, type SourceKnowledgeProgress } from "../shared/source-sticker-knowledge.js";
import type { EditTemplate, MediaItem } from "./domain.js";
import { ProviderError } from "./api-transport.js";
import { SourceStickerKnowledgeStore, KnowledgeStoreError, factsDigest, sourceKey, type KnowledgeRun } from "./source-sticker-knowledge-store.js";
import { knowledgeTracks, templateDigest, type KnowledgeReviewOptions, type KnowledgeReviewHandoff } from "./supervisor-knowledge.js";
import { PreviewReviewSession, type SupervisedPreviewResult } from "./supervised-preview.js";
import type { PreviewRevision } from "./supervisor-protocol.js";

type Recognition = { facts: SourceFacts; evidence: KnowledgeEvidence[]; blobs: Map<string, Buffer>; requests: number };
type SourceState = { source: SourceIdentity; head?: KnowledgeRevision; candidate: KnowledgeCandidate; blobs: Map<string, Buffer>; blocked: boolean; unresolvedIssue: boolean; recognized: boolean; persistence: "saved" | "not-saved" };
export interface KnowledgeBinding { readonly media: MediaItem; readonly horizonMs: number; readonly key: string }
export interface KnowledgePreviewInput {
  template: EditTemplate;
  tracks: ReturnType<typeof knowledgeTracks>;
  rebuild(revision: PreviewRevision): EditTemplate;
  signal: AbortSignal;
  onStage(stage: string): void;
  session: PreviewReviewSession;
  knowledge: Omit<KnowledgeReviewOptions, "capture" | "outputSettingsDigest">;
  media: MediaItem;
}
export interface KnowledgeVersion {
  template: EditTemplate;
  readonly reviewSession: PreviewReviewSession;
}
type Version = KnowledgeVersion & { binding: KnowledgeBinding; rebuild: KnowledgePreviewInput["rebuild"]; digest: string; headId: string | null; run: KnowledgeRun; checkedTemplate: string };
type Progress = { value: SourceKnowledgeProgress; started: number; notify?: (value: SourceKnowledgeProgress) => void };
function report(progress: Progress, patch: Partial<SourceKnowledgeProgress>): void {
  Object.assign(progress.value, patch, { elapsedMs: Date.now() - progress.started });
  progress.notify?.(structuredClone(progress.value));
}
function failureReason(error: unknown): string {
  if (error instanceof KnowledgeStoreError) return {
    conflict: "源知识存在争议或并发修订，已停止复用；重新检查不会清除已有反证。",
    integrity: "源知识完整性无法确认，已停止制作；请保留知识文件以便恢复。",
    future_schema: "源知识来自不兼容版本，已保留文件并停止复用。",
    source_changed: "源文件已变化，请重新导入素材。",
    locked: "知识库被占用或需要恢复，自动制作已停止。",
    cancelled: "本轮已取消，未完成候选不会发布。",
    quota: "知识或反证未能安全保存，本轮已停止；请保留现有知识文件。",
  }[error.code];
  return "原贴纸检查未完成，本轮未回退旧知识；请查看本条失败原因。";
}
/** Only fact references flow into the next version; published preview evidence stays immutable. */
function retainSourceEvidence(candidate: KnowledgeCandidate, blobs: Map<string, Buffer>) {
  const ids = new Set([...candidate.facts.observations.map(o => o.evidenceId),
    ...candidate.facts.targets.flatMap(t => t.segments.flatMap(s => s.evidenceIds)),
    ...candidate.facts.exclusions.flatMap(e => e.evidenceIds), ...candidate.changes.flatMap(c => c.evidenceIds)]);
  const originals = candidate.evidence.filter(e => e.kind === "source");
  for (const id of ids) { const frame = originals.find(e => e.id === id); if (frame?.crop) ids.add(frame.crop.sourceEvidenceId); }
  const evidence = originals.filter(e => ids.has(e.id)), retained = new Map<string, Buffer>();
  for (const frame of evidence) {
    const bytes = blobs.get(frame.digest); if (!bytes) throw new ProviderError("源事实证据字节缺失。");
    retained.set(frame.digest, bytes);
  }
  return { candidate: KnowledgeCandidateSchema.parse({ ...candidate, evidence }), blobs: retained };
}
interface SessionOptions {
  store: SourceStickerKnowledgeStore;
  identify(media: MediaItem, signal: AbortSignal): Promise<SourceIdentity>;
  recognize(media: MediaItem, source: SourceIdentity, horizonMs: number, signal: AbortSignal, onStage: (stage: string) => void, onWindow: (window: Recognition) => Promise<void>, onRequest: () => void): Promise<Recognition>;
  review(input: KnowledgePreviewInput): Promise<SupervisedPreviewResult>;
  executor: string;
  supervisor: string;
  refreshMediaIds?: ReadonlySet<string>;
}

/** Run-local source facts and version dependencies have one owner. No queue or model lifecycle lives here. */
export class SourceStickerKnowledgeSession {
  private readonly sources = new Map<string, Promise<SourceState>>();
  private readonly bindings = new Set<KnowledgeBinding>();
  private readonly versions = new Map<KnowledgeVersion, Version>();
  private readonly versionIds = new Set<string>();
  private readonly runs = new Set<KnowledgeRun>();
  private readonly progress = new Map<KnowledgeBinding, Progress>();
  private closed = false;
  constructor(private readonly options: SessionOptions) {}

  private live(signal: AbortSignal): void { signal.throwIfAborted(); if (this.closed) throw new ProviderError("源知识会话已结束。"); }
  private async state(binding: KnowledgeBinding): Promise<SourceState> {
    if (!this.bindings.has(binding) || this.closed) throw new ProviderError("源知识绑定不属于本轮。");
    return this.sources.get(binding.key)!;
  }
  private async token(source: SourceIdentity, signal?: AbortSignal): Promise<KnowledgeRun> {
    const token = await this.options.store.beginRun(source, signal); this.runs.add(token); return token;
  }
  async acquire(media: MediaItem, horizonMs: number, signal: AbortSignal, onStage: (stage: string) => void, onProgress?: (value: SourceKnowledgeProgress) => void): Promise<KnowledgeBinding> {
    const progress: Progress = { started: Date.now(), notify: onProgress, value: { phase: "checking", recognitionRequests: 0, previewRequests: 0, revisions: 0, renders: 0, elapsedMs: 0, executor: this.options.executor, supervisor: this.options.supervisor } };
    report(progress, {});
    try {
    this.live(signal);
    const source = await this.options.identify(media, signal);
    if (source.fingerprint !== media.fingerprint || !Number.isSafeInteger(horizonMs) || horizonMs < 1 || horizonMs > source.durationMs) throw new ProviderError("源素材或识别时域已变化，请重新导入。");
    await this.options.store.verifySource(media.sourcePath, source); this.live(signal);
    const key = sourceKey(source), requiredRanges = [{ startMs: 0, endMs: horizonMs }];
    report(progress, { sourceKey: key });
    let pending = this.sources.get(key);
    const shared = Boolean(pending);
    if (!pending) {
      pending = (async () => {
        // Recognition fences late model responses before onWindow. Accepted counterevidence
        // must drain despite cancellation; publication uses a separate signal-bound token.
        const run = await this.token(source);
        const head = await this.options.store.readHead(source);
        let facts: SourceFacts, evidence: KnowledgeEvidence[], blobs: Map<string, Buffer>, requests = 0;
        const resolvedDisputeIds: string[] = [];
        const counterevidence = async (window: Recognition) => {
          if (!head) return;
          const overlap = head.revision.candidate.facts.reviewedRanges.flatMap(a => window.facts.reviewedRanges.map(b => ({ startMs: Math.max(a.startMs, b.startMs), endMs: Math.min(a.endMs, b.endMs) })).filter(r => r.endMs > r.startMs));
          const observedIds = new Set(window.facts.observations.map(o => o.evidenceId));
          const times = window.evidence.filter(e => e.kind === "source" && observedIds.has(e.id) && overlap.some(r => e.timeMs >= r.startMs && e.timeMs < r.endMs)).map(e => e.timeMs);
          if (!sourceObservationsChanged(head.revision.candidate.facts, window.facts, times)) return;
          const id = randomUUID(), originals = window.evidence.filter((e): e is Extract<KnowledgeEvidence, { kind: "source" }> => e.kind === "source" && overlap.some(r => e.timeMs >= r.startMs && e.timeMs < r.endMs));
          // This accepted handoff must finish even if a later window fails or is cancelled.
          await this.options.store.recordDispute(run, { schemaVersion: 1, id, revisionId: head.revision.id, ranges: overlap, kind: "incomplete_boundary", reason: "重新识别与已有源事实矛盾", evidence: originals, at: new Date().toISOString() }, window.blobs);
          resolvedDisputeIds.push(id);
        };
        const warm = head && coversRanges(head.revision.candidate.facts.reviewedRanges, requiredRanges) && !this.options.refreshMediaIds?.has(media.id);
        report(progress, { phase: warm ? "reusing" : "recognizing", origin: warm ? "warm" : this.options.refreshMediaIds?.has(media.id) ? "refresh" : "cold",
          reason: warm ? "源身份与所需时域匹配" : this.options.refreshMediaIds?.has(media.id) ? "本轮主动重新检查" : head ? "已有知识时域不足" : "尚无已核查知识", revisionId: head?.revision.id });
        if (warm) {
          onStage("复用已核查的源贴纸知识；本版仍需创作和样片检查…");
          ({ facts, evidence } = head.revision.candidate); evidence = evidence.filter(e => e.kind === "source"); blobs = head.blobs;
        } else {
          onStage("首次检查或重新检查源贴纸…");
          ({ facts, evidence, blobs, requests } = await this.options.recognize(media, source, horizonMs, signal, onStage, counterevidence, () => report(progress, { recognitionRequests: progress.value.recognitionRequests + 1 })));
          report(progress, { recognitionRequests: requests });
          if (!resolvedDisputeIds.length) await counterevidence({ facts, evidence, blobs, requests });
        }
        this.live(signal); await this.options.store.verifySource(media.sourcePath, source);
        const candidate = KnowledgeCandidateSchema.parse({ schemaVersion: 1, state: "candidate", id: randomUUID(), source, baseRevisionId: head?.revision.id ?? null, runId: run.id, requiredRanges,
          facts, evidence, resolvedDisputeIds, changes: !warm && head ? [{ ranges: facts.reviewedRanges, reason: "重新核查原图", evidenceIds: facts.observations.map(o => o.evidenceId).slice(0, 2048) }] : [],
          provenance: { executor: this.options.executor, supervisor: this.options.supervisor, contractVersion: 1, requests, at: new Date().toISOString() } });
        return { source, ...retainSourceEvidence(candidate, blobs), head: head?.revision, blocked: resolvedDisputeIds.length > 0, unresolvedIssue: false, recognized: !warm, persistence: warm ? "saved" : "not-saved" };
      })();
      this.sources.set(key, pending);
    }
    const state = await pending;
    if (this.options.refreshMediaIds?.has(media.id) && !state.recognized) {
      state.blocked = state.unresolvedIssue = true;
      throw new ProviderError("同源素材已经开始暖复用，不能迟到追加刷新；请将该源整体重新检查。");
    }
    if (state.unresolvedIssue) throw new ProviderError("本轮源贴纸存在未解决反证，后续同源版本已停止。");
    if (!coversRanges(state.candidate.facts.reviewedRanges, requiredRanges)) throw new ProviderError("本轮源知识时域不足，不能复用为全程。");
    this.live(signal);
    if (shared) report(progress, { phase: "reusing", origin: "run", reason: "本轮同源素材共享核查事实；仍检查新样片", revisionId: state.head?.id });
    report(progress, { reviewedRanges: state.candidate.facts.reviewedRanges });
    const binding = Object.freeze({ key, media: structuredClone(media), horizonMs }); this.bindings.add(binding); this.progress.set(binding, progress); return binding;
    } catch (error) {
      report(progress, { phase: "blocked", reason: signal.aborted ? "本轮已取消，未完成候选不会发布。" : failureReason(error) });
      if (error instanceof KnowledgeStoreError) throw new ProviderError(failureReason(error));
      throw error;
    }
  }
  async tracks(binding: KnowledgeBinding) { return knowledgeTracks((await this.state(binding)).candidate, binding.horizonMs); }

  async review(binding: KnowledgeBinding, template: EditTemplate, rebuild: KnowledgePreviewInput["rebuild"], signal: AbortSignal, onStage: (stage: string) => void): Promise<KnowledgeVersion> {
    this.live(signal);
    if (this.versionIds.has(template.id)) throw new ProviderError("同一版本不能重新开始检查预算。");
    this.versionIds.add(template.id);
    const version = { template, binding, rebuild, reviewSession: new PreviewReviewSession() } as Version;
    await this.check(version, signal, onStage); this.versions.set(version, version); return version;
  }
  private async check(version: Version, signal: AbortSignal, onStage: (stage: string) => void): Promise<void> {
    const progress = this.progress.get(version.binding)!;
    try {
    this.live(signal);
    const state = await this.state(version.binding), previous = state.head;
    if (state.unresolvedIssue) throw new ProviderError("本轮源贴纸存在未解决反证，不能另开版本继承旧候选。");
    const run = await this.token(state.source, signal);
    const candidate = KnowledgeCandidateSchema.parse({ ...state.candidate, id: randomUUID(), runId: run.id, baseRevisionId: previous?.id ?? null, requiredRanges: [{ startMs: 0, endMs: version.binding.horizonMs }], evidence: state.candidate.evidence.filter(e => e.kind === "source") });
    let handoff: KnowledgeReviewHandoff | undefined;
    const result = await this.options.review({ template: version.template, tracks: knowledgeTracks(candidate, version.binding.horizonMs), media: version.binding.media,
      rebuild: version.rebuild, signal, onStage: stage => {
        const budget = version.reviewSession.snapshot();
        report(progress, { previewRequests: budget.turns, revisions: budget.revisions, renders: budget.renders }); onStage(stage);
      }, session: version.reviewSession,
      knowledge: { candidate, blobs: state.blobs, previousRevision: previous,
        onSourceIssue: () => { state.blocked = true; state.unresolvedIssue = true; report(progress, { phase: "correcting", reason: "发现原贴纸事实问题，正在有界修正" }); },
        onDispute: async ({ dispute, blobs }) => { state.blocked = true; await this.options.store.recordDispute(run, dispute, blobs); },
        onReviewed: async value => { handoff = value; return "not-saved"; },
      } });
    this.live(signal); await this.options.store.verifySource(version.binding.media.sourcePath, state.source); this.live(signal);
    if (!handoff || !result.knowledge || result.session !== version.reviewSession || handoff.candidate.id !== result.knowledge.candidate.id || handoff.proof.factsDigest !== factsDigest(handoff.candidate.facts)
      || handoff.proof.previewEvidenceIds.some(id => { const frame = handoff!.candidate.evidence.find(e => e.id === id); return frame?.kind !== "preview" || frame.templateDigest !== templateDigest(result.template); })) throw new ProviderError("样片未绑定当前源事实和模板，本条已停止。");
    if (state.head?.id !== previous?.id) throw new ProviderError("本轮源知识发生并发修订，本条已停止。");
    const changed = !previous || previous.factsDigest !== handoff.proof.factsDigest;
    let persistence: "saved" | "not-saved" = "saved";
    if (changed) {
      try { state.head = await this.options.store.publish(run, handoff.candidate, handoff.proof, handoff.blobs); }
      catch (error) {
        // Only a pre-transaction quota rejection with an unchanged, readable head is safe.
        if (!(error instanceof KnowledgeStoreError) || error.code !== "quota") throw error;
        const head = await this.options.store.readHead(state.source);
        if (head?.revision.id !== previous?.id || (state.blocked && previous)) throw error;
        persistence = "not-saved";
      }
    } else {
      const head = await this.options.store.readHead(state.source);
      if (head?.revision.id !== previous!.id || state.blocked) throw new ProviderError("源贴纸反证未解决或修订已变化。");
    }
    this.live(signal);
    const retained = retainSourceEvidence(KnowledgeCandidateSchema.parse({ ...handoff.candidate, baseRevisionId: state.head?.id ?? null, evidence: handoff.candidate.evidence.filter(e => e.kind === "source"), changes: persistence === "saved" ? [] : handoff.candidate.changes, resolvedDisputeIds: [] }), handoff.blobs);
    state.candidate = retained.candidate; state.blobs = retained.blobs;
    state.blocked = false; state.unresolvedIssue = false; state.persistence = persistence;
    version.run = run; version.digest = handoff.proof.factsDigest; version.headId = state.head?.id ?? null;
    version.template = { ...result.template, sourceStickerKnowledge: { sourceKey: version.binding.key, revisionId: persistence === "saved" ? state.head!.id : handoff.candidate.id,
      factsDigest: version.digest, reviewedRanges: structuredClone(handoff.candidate.facts.reviewedRanges), verification: "sampled", persistence } };
    version.checkedTemplate = templateDigest(version.template);
    const budget = version.reviewSession.snapshot();
    report(progress, { phase: persistence === "saved" ? "reviewed" : "not-saved", revisionId: version.template.sourceStickerKnowledge!.revisionId,
      reason: persistence === "saved" ? "已基于当前源事实通过本版样片检查。" : "本版样片已通过，但知识保存空间不足，未保存供下次复用。",
      reviewedRanges: handoff.candidate.facts.reviewedRanges, previewRequests: budget.turns, revisions: budget.revisions, renders: budget.renders });
    } catch (error) {
      const budget = version.reviewSession.snapshot();
      report(progress, { phase: "blocked", reason: signal.aborted ? "本轮已取消，未完成候选不会发布。" : failureReason(error),
        previewRequests: budget.turns, revisions: budget.revisions, renders: budget.renders });
      throw error;
    }
  }
  private current(version: Version, state: SourceState): boolean { return !state.blocked && version.headId === (state.head?.id ?? null) && version.digest === factsDigest(state.candidate.facts); }

  async reconcile(versions: readonly KnowledgeVersion[], signal: AbortSignal, onStage: (stage: string) => void): Promise<void> {
    // Rebindings consume each version's existing 5-turn / 2-revision budget. No reset loop.
    while (true) {
      let changed = false;
      for (const handle of versions) {
        this.live(signal); const version = this.versions.get(handle); if (!version) throw new ProviderError("版本不属于本轮。");
        const state = await this.state(version.binding);
        if (state.blocked) throw new ProviderError("源贴纸仍有未解决反证，本轮受影响版本未导出。");
        if (this.current(version, state)) continue;
        onStage("源贴纸事实已修正，正在重建并重新检查受影响版本…");
        report(this.progress.get(version.binding)!, { phase: "correcting", reason: "同源事实已修正，旧样片结论失效，正在重建检查" });
        version.template = version.rebuild({ action: "revise", reason: "同源知识修订传播", tracks: knowledgeTracks(state.candidate, version.binding.horizonMs), corners: version.reviewSession.snapshot().corners });
        await this.check(version, signal, onStage); changed = true;
      }
      if (!changed) return;
    }
  }

  async enqueue<T>(handle: KnowledgeVersion, signal: AbortSignal, enqueue: (template: EditTemplate) => Promise<T>): Promise<T> {
    this.live(signal); const version = this.versions.get(handle); if (!version) throw new ProviderError("版本不属于本轮。");
    const state = await this.state(version.binding);
    if (!this.current(version, state) || templateDigest(version.template) !== version.checkedTemplate) throw new ProviderError("源知识或模板已变化，旧样片批准已失效。");
    return this.options.store.admit(version.run, version.headId, async () => {
      await this.options.store.verifySource(version.binding.media.sourcePath, state.source); this.live(signal);
      if (!this.current(version, state)) throw new ProviderError("源知识已变化，本条未导出。");
      return enqueue(structuredClone(version.template));
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.runs].map(run => this.options.store.endRun(run)));
    this.runs.clear(); this.sources.clear(); this.bindings.clear(); this.versions.clear(); this.versionIds.clear(); this.progress.clear();
  }
}
