import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CoverIdentitySchema, CoverReviewDraftSchema, CoverSegmentSchema, type CoverReviewDraft } from "../shared/cover-review.js";
import type { MediaItem } from "./domain.js";

const Base = { projectId: z.string().uuid(), draftId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), mediaId: z.string().uuid() };
export const CoverReviewCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("put_segment"), identity: CoverIdentitySchema, segment: CoverSegmentSchema }).strict(),
  z.object({ ...Base, type: z.literal("delete_segment"), segmentId: z.string().uuid() }).strict(),
  z.object({ ...Base, type: z.literal("no_cover") }).strict(),
  z.object({ ...Base, type: z.literal("confirm_geometry") }).strict(),
  z.object({ ...Base, type: z.literal("resolve_issue"), issueId: z.string().uuid(), action: z.enum(["accept_uncertainty", "correct", "no_cover"]) }).strict(),
  z.object({ ...Base, type: z.literal("merge"), fromId: z.string().uuid(), intoId: z.string().uuid() }).strict(),
  z.object({ ...Base, type: z.literal("split"), segmentId: z.string().uuid(), atMs: z.number().int().positive() }).strict(),
]);
export type CoverReviewCommand = z.infer<typeof CoverReviewCommandSchema>;

export function createCoverReviewDraft(projectId: string, media: readonly MediaItem[]): CoverReviewDraft {
  const timestamp = new Date().toISOString();
  return CoverReviewDraftSchema.parse({ id: randomUUID(), runId: randomUUID(), projectId, revision: 0, mode: "assisted", status: "needs_human", createdAt: timestamp, updatedAt: timestamp,
    media: media.map((source) => ({ mediaId: source.id, sourceFingerprint: source.fingerprint, durationMs: source.durationMs,
      analysis: "not_started", disposition: "unresolved", identities: [], segments: [], evidence: [], observations: [], issues: [], decisions: [] })), frozen: [] });
}

export function editCoverReviewDraft(current: CoverReviewDraft, input: unknown): CoverReviewDraft {
  const command = CoverReviewCommandSchema.parse(input);
  if (command.projectId !== current.projectId || command.draftId !== current.id || command.expectedRevision !== current.revision) throw new Error("审阅修订已过期，请刷新后再编辑。");
  if (!["needs_human", "awaiting_approval"].includes(current.status)) throw new Error("请先结束分析或预览，再编辑审阅草稿。");
  const draft = structuredClone(current);
  const media = draft.media.find(({ mediaId }) => mediaId === command.mediaId);
  if (!media) throw new Error("审阅素材不存在。");
  draft.revision += 1; draft.status = "needs_human"; draft.frozen = []; delete draft.approval;
  draft.updatedAt = new Date().toISOString();
  const decision = (action: typeof media.decisions[number]["action"], refs: Partial<Pick<typeof media.decisions[number], "issueId" | "identityId" | "segmentId">> = {}) => {
    media.decisions.push({ id: randomUUID(), action, revision: draft.revision, at: draft.updatedAt, ...refs });
  };
  switch (command.type) {
    case "put_segment": {
      if (command.segment.identityId !== command.identity.id) throw new Error("覆盖身份不匹配。");
      const identity = { ...command.identity, origin: "human" as const };
      const index = media.identities.findIndex(({ id }) => id === identity.id);
      if (index < 0) media.identities.push(identity); else media.identities[index] = identity;
      const segment = { ...command.segment, origin: "human" as const };
      const segmentIndex = media.segments.findIndex(({ id }) => id === segment.id);
      if (segmentIndex < 0) media.segments.push(segment); else media.segments[segmentIndex] = segment;
      media.disposition = "unresolved";
      decision("correct", { identityId: identity.id, segmentId: segment.id });
      break;
    }
    case "delete_segment": {
      if (!media.segments.some(({ id }) => id === command.segmentId)) throw new Error("覆盖区间不存在。");
      media.segments = media.segments.filter(({ id }) => id !== command.segmentId);
      media.disposition = "unresolved";
      decision("delete_false_positive", { segmentId: command.segmentId });
      break;
    }
    case "no_cover": media.disposition = "no_cover"; decision("no_cover"); break;
    case "confirm_geometry":
      if (!media.segments.length) throw new Error("请补充覆盖框或明确选择不覆盖。");
      media.disposition = "cover"; decision("confirm_geometry"); break;
    case "resolve_issue":
      if (!media.issues.some(({ id }) => id === command.issueId)) throw new Error("审阅问题不存在。");
      decision(command.action, { issueId: command.issueId }); break;
    case "merge": {
      const source = media.identities.find(({ id }) => id === command.fromId);
      const target = media.identities.find(({ id }) => id === command.intoId);
      if (!source || !target || source === target) throw new Error("合并身份无效。");
      target.derivedFrom = [...new Set([...(target.derivedFrom ?? []), source.id])];
      for (const segment of media.segments) if (segment.identityId === source.id) segment.identityId = target.id;
      media.identities = media.identities.filter(({ id }) => id !== source.id);
      media.disposition = "unresolved"; decision("merge", { identityId: target.id }); break;
    }
    case "split": {
      const segment = media.segments.find(({ id }) => id === command.segmentId);
      if (!segment || command.atMs <= segment.track.startMs || command.atMs >= segment.track.endMs) throw new Error("拆分时间必须位于可见区间内部。");
      // Keep the original keys: each interval holds/interpolates exactly the original path.
      const second = structuredClone(segment); second.id = randomUUID(); second.track.startMs = command.atMs;
      segment.track.endMs = command.atMs; media.segments.push(second);
      media.disposition = "unresolved"; decision("split", { segmentId: segment.id }); break;
    }
  }
  return CoverReviewDraftSchema.parse(draft);
}

export function assertReviewResolved(draft: CoverReviewDraft): void {
  for (const media of draft.media) {
    if (media.disposition === "unresolved") throw new Error("请逐素材确认覆盖范围或明确不覆盖。");
    if (media.issues.some((issue) => !media.decisions.some(({ issueId }) => issueId === issue.id))) throw new Error("仍有未处置的审阅问题。");
  }
}

export function recoverCoverReviewDraft(draft: CoverReviewDraft): CoverReviewDraft {
  const recovered = structuredClone(draft);
  if (["analyzing", "reviewing", "preparing_preview"].includes(recovered.status)) {
    if (recovered.review?.status === "running") {
      recovered.review.status = "incomplete";
      for (const media of recovered.media) media.issues.push({ id: randomUUID(), kind: "insufficient_evidence", evidenceIds: media.evidence.map(({ id }) => id), reason: "上次独立复核已中断，未自动重试；请人工检查。", origin: "review" });
    }
    recovered.status = "needs_human"; recovered.frozen = []; delete recovered.approval;
    for (const media of recovered.media) {
      if (media.analysis !== "complete") { media.analysis = "incomplete"; media.analysisError = "上次审阅准备已中断，未自动重新调用模型。"; }
    }
  }
  return recovered;
}
