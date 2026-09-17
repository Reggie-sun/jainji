import { createHash, randomUUID } from "node:crypto";
import {
  KnowledgeCandidateSchema, KnowledgeDisputeSchema, KnowledgeEvidenceSchema, coversRanges, sourceGeometryChanged,
  type KnowledgeCandidate, type KnowledgeDispute, type KnowledgeEvidence, type KnowledgePublicationProof, type KnowledgeRevision, type ReviewedRange,
} from "../shared/source-sticker-knowledge.js";
import { factsDigest, sourceKey } from "./source-sticker-knowledge-store.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import type { EditTemplate } from "./domain.js";
import type { EvidenceBinding, SupervisorEvidenceHandoff, SupervisorEvidenceImage } from "./supervisor-evidence.js";
import type { PreviewIssue, PreviewIssueRecord, PreviewRevision, PreviewReviewInput } from "./supervisor-protocol.js";
import { interpolateCoverRectangle } from "../shared/cover-sticker.js";

export interface KnowledgeReviewHandoff { candidate: KnowledgeCandidate; proof: KnowledgePublicationProof; blobs: Map<string, Buffer> }
export interface DisputeHandoff { dispute: KnowledgeDispute; blobs: Map<string, Buffer> }
export interface KnowledgeReviewOptions {
  candidate: KnowledgeCandidate;
  blobs: ReadonlyMap<string, Buffer>;
  previousRevision?: KnowledgeRevision;
  outputSettingsDigest: string;
  capture(images: readonly SupervisorEvidenceImage[], binding: EvidenceBinding): SupervisorEvidenceHandoff;
  // The coordinator owns persistence. A confirmed handoff is awaited even after cancellation.
  onDispute?(handoff: DisputeHandoff): Promise<void>;
  onReviewed?(handoff: KnowledgeReviewHandoff): Promise<"saved" | "not-saved">;
}

export function templateDigest(template: EditTemplate): string { return createHash("sha256").update(JSON.stringify(template)).digest("hex"); }
export function knowledgeTracks(candidate: KnowledgeCandidate, horizonMs = candidate.source.durationMs): AutomaticCoverTrack[] {
  return candidate.facts.targets.flatMap((target) => target.segments.flatMap(({ track }) => {
    if (track.startMs >= horizonMs) return [];
    const endMs = Math.min(track.endMs, horizonMs), keyframes = structuredClone(track.keyframes.filter(frame => frame.timeMs <= endMs));
    if (track.keyframes.some(frame => frame.timeMs > endMs) && !keyframes.some(frame => frame.timeMs === endMs)) keyframes.push({ timeMs: endMs, rectangle: interpolateCoverRectangle(track.keyframes, endMs) });
    return [{ targetId: target.id, track: { ...track, endMs, keyframes } }];
  }));
}
function outsideRanges(available: ReviewedRange[], allowed: ReviewedRange[]): ReviewedRange[] {
  let result = available.map((range) => ({ ...range }));
  for (const range of allowed) result = result.flatMap((part) => part.endMs <= range.startMs || part.startMs >= range.endMs ? [part]
    : [{ startMs: part.startMs, endMs: Math.min(part.endMs, range.startMs) }, { startMs: Math.max(part.startMs, range.endMs), endMs: part.endMs }].filter((value) => value.endMs > value.startMs));
  return result;
}

/** Ephemeral evidence assembly for one supervisor result, not a second persistent owner. */
export class SupervisorKnowledgeReview {
  candidate: KnowledgeCandidate;
  private readonly records = new Map<string, KnowledgeEvidence>();
  private readonly blobs = new Map<string, Buffer>();
  private readonly reviewed = new Set<string>();
  private currentPreviewIds: string[] = [];
  private readonly persistedDisputes = new Set<string>();
  constructor(private readonly options: KnowledgeReviewOptions, priorIssues: readonly PreviewIssueRecord[] = []) {
    this.candidate = KnowledgeCandidateSchema.parse(options.candidate);
    if (options.previousRevision && (options.previousRevision.id !== this.candidate.baseRevisionId || options.previousRevision.sourceKey !== sourceKey(this.candidate.source) || !options.onDispute)) throw new Error("知识基础修订或反证交接不可用");
    if (!/^[a-f0-9]{64}$/.test(options.outputSettingsDigest)) throw new Error("输出设置摘要无效");
    this.add(this.candidate.evidence.filter((e) => e.kind === "source"), options.blobs);
    for (const issue of priorIssues) if (issue.disputedRevisionId && issue.disputedRevisionId === options.previousRevision?.id) this.persistedDisputes.add(issue.id);
    // These references came from the already completed recognition-supervisor stage.
    for (const id of [...this.candidate.facts.observations.map((o) => o.evidenceId), ...this.candidate.facts.targets.flatMap((t) => t.segments.flatMap((s) => s.evidenceIds)), ...this.candidate.facts.exclusions.flatMap((e) => e.evidenceIds)]) this.reviewed.add(id);
  }
  private add(records: readonly KnowledgeEvidence[], blobs: ReadonlyMap<string, Buffer>): void {
    for (const input of records) {
      const record = KnowledgeEvidenceSchema.parse(input), bytes = blobs.get(record.digest);
      if (!bytes || bytes.length !== record.byteLength || createHash("sha256").update(bytes).digest("hex") !== record.digest) throw new Error("监督证据缺失或摘要不匹配");
      const previous = this.records.get(record.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error("监督证据编号冲突");
      this.records.set(record.id, record); this.blobs.set(record.digest, Buffer.from(bytes));
    }
  }
  observe(images: readonly SupervisorEvidenceImage[], template: EditTemplate): void {
    const captured = this.options.capture(images, { candidateId: this.candidate.id, factsDigest: factsDigest(this.candidate.facts), templateDigest: templateDigest(template), outputSettingsDigest: this.options.outputSettingsDigest });
    if (sourceKey(captured.source) !== sourceKey(this.candidate.source)) throw new Error("监督证据对应的源素材已变化");
    this.add(captured.evidence, captured.blobs);
    this.currentPreviewIds = captured.evidence.filter((e) => e.kind === "preview").map((e) => e.id);
    for (const image of images) {
      if (!image.sourceEvidenceId || !this.records.has(image.sourceEvidenceId)) throw new Error("监督图像没有原图证据引用");
      this.reviewed.add(image.sourceEvidenceId);
      if (image.fullSourceEvidenceId) {
        if (!this.records.has(image.fullSourceEvidenceId)) throw new Error("监督局部图缺少全图父证据");
        this.reviewed.add(image.fullSourceEvidenceId);
      }
    }
  }
  context(): NonNullable<PreviewReviewInput["knowledge"]> {
    return { candidateId: this.candidate.id, sourceKey: sourceKey(this.candidate.source), baseRevisionId: this.candidate.baseRevisionId,
      factsDigest: factsDigest(this.candidate.facts), requiredRanges: structuredClone(this.candidate.requiredRanges), facts: structuredClone(this.candidate.facts), evidenceIds: [...this.reviewed] };
  }
  validateIssue(issue: PreviewIssue): void {
    const required = issue.scope === "source" ? this.candidate.requiredRanges : [{ startMs: 0, endMs: this.candidate.source.durationMs }];
    if (!coversRanges(required, issue.ranges) || issue.ranges.some((range) => !issue.evidenceIds.some((id) => {
      const frame = this.records.get(id); return frame?.kind === "source" && this.reviewed.has(id) && frame.timeMs >= range.startMs && frame.timeMs < range.endMs;
    })) || issue.evidenceIds.some((id) => this.records.get(id)?.kind !== "source" || !this.reviewed.has(id))) throw new Error("问题必须绑定适用时段内实际核查过的原图");
    if (issue.scope === "source" && issue.targetId && !this.candidate.facts.targets.some((target) => target.id === issue.targetId)) throw new Error("问题目标不存在");
  }
  async dispute(issue: PreviewIssue): Promise<string | undefined> {
    const previous = this.options.previousRevision;
    if (issue.scope !== "source" || !previous || sourceGeometryChanged(previous.candidate.facts, this.candidate.facts, issue.ranges, issue.targetId)) return;
    const ids = new Set(issue.evidenceIds);
    for (const id of issue.evidenceIds) { const frame = this.records.get(id); if (frame?.kind === "source" && frame.crop) ids.add(frame.crop.sourceEvidenceId); }
    const evidence = [...ids].map((id) => this.records.get(id)!).filter((e): e is Extract<KnowledgeEvidence, { kind: "source" }> => e.kind === "source");
    const dispute = KnowledgeDisputeSchema.parse({ schemaVersion: 1, id: issue.id, revisionId: previous.id, ranges: issue.ranges, kind: issue.kind, targetId: issue.targetId, reason: issue.reason, evidence, at: new Date().toISOString() });
    await this.options.onDispute!({ dispute, blobs: new Map(evidence.map((e) => [e.digest, Buffer.from(this.blobs.get(e.digest)!)])) });
    this.persistedDisputes.add(issue.id);
    return previous.id;
  }
  correction(decision: PreviewRevision, issues: PreviewIssueRecord[], horizonMs: number): KnowledgeCandidate | undefined {
    if (!decision.sourceFacts) return undefined;
    const resolved = issues.filter((issue): issue is Extract<PreviewIssueRecord, { scope: "source" }> => issue.scope === "source" && issue.status === "open" && Boolean(decision.resolvedIssueIds?.includes(issue.id)));
    if (!resolved.length || JSON.stringify(decision.sourceFacts.reviewedRanges) !== JSON.stringify(this.candidate.facts.reviewedRanges)) throw new Error("源事实修正必须解决已绑定原图的问题，不能扩大核查时段");
    for (const issue of resolved) if (!sourceGeometryChanged(this.candidate.facts, decision.sourceFacts, issue.ranges, issue.targetId)) throw new Error("源事实修正没有解决对应目标和时段的问题");
    const targets = new Set([...this.candidate.facts.targets, ...decision.sourceFacts.targets].map((target) => target.id));
    for (const targetId of targets) {
      const allowed = resolved.filter((issue) => !issue.targetId || issue.targetId === targetId).flatMap((issue) => issue.ranges);
      if (sourceGeometryChanged(this.candidate.facts, decision.sourceFacts, outsideRanges(this.candidate.facts.reviewedRanges, allowed), targetId)) throw new Error("源事实修正改变了问题范围之外的目标");
    }
    const facts = decision.sourceFacts;
    if (facts.observations.some((observation) => !this.reviewed.has(observation.evidenceId))) throw new Error("修正引用了未核查的原图");
    const candidate = KnowledgeCandidateSchema.parse({ ...this.candidate, id: randomUUID(), facts,
      evidence: [...this.records.values()].filter((e) => e.kind === "source"),
      changes: [...this.candidate.changes, ...resolved.map((issue) => ({ targetId: issue.targetId, ranges: issue.ranges, reason: issue.reason, evidenceIds: issue.evidenceIds }))],
      resolvedDisputeIds: [...new Set([...this.candidate.resolvedDisputeIds, ...resolved.filter(issue => this.persistedDisputes.has(issue.id)).map((issue) => issue.id)])] });
    if (JSON.stringify(knowledgeTracks(candidate, horizonMs)) !== JSON.stringify(decision.tracks)) throw new Error("源事实与用于重建的轨迹不一致");
    return candidate;
  }
  accept(candidate: KnowledgeCandidate): void {
    this.candidate = candidate;
    // Previews belong to the old candidate/template; no verdict survives a fact correction.
    for (const [id, record] of this.records) if (record.kind === "preview") this.records.delete(id);
    this.currentPreviewIds = [];
  }
  handoff(): KnowledgeReviewHandoff {
    const evidence = [...this.records.values()].filter((e) => e.kind === "source" || this.currentPreviewIds.includes(e.id));
    const candidate = KnowledgeCandidateSchema.parse({ ...this.candidate, evidence });
    const proof: KnowledgePublicationProof = { candidateId: candidate.id, factsDigest: factsDigest(candidate.facts), sourceReviewed: true, previewPassed: true,
      unresolvedIssueIds: [], sourceEvidenceIds: [...this.reviewed], previewEvidenceIds: [...this.currentPreviewIds] };
    if (!proof.previewEvidenceIds.length) throw new Error("没有可交接的配对样片证据");
    return { candidate, proof, blobs: new Map(evidence.map((e) => [e.digest, Buffer.from(this.blobs.get(e.digest)!)])) };
  }
  async persist(handoff: KnowledgeReviewHandoff): Promise<"saved" | "not-saved" | "not-requested"> {
    return this.options.onReviewed ? this.options.onReviewed(handoff) : "not-requested";
  }
}
