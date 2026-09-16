import { z } from "zod";
import { CoverRectangleSchema, CoverTrackSchema, MAX_MANUAL_COVERS } from "./cover-sticker.js";

const Id = z.string().uuid();
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Time = z.string().datetime({ offset: true });
const Revision = z.number().int().nonnegative();
const PreviewUuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const CoverPreviewPathSchema = z.string().regex(new RegExp(`^${PreviewUuid}/${PreviewUuid}/[0-9]+/previews/${PreviewUuid}\\.(mp4|mov|mkv)$`));
export const CoverReviewStatusSchema = z.enum(["draft", "analyzing", "reviewing", "needs_human", "preparing_preview", "awaiting_approval", "approved", "stale", "cancelled", "failed"]);
export const CoverEvidenceSchema = z.object({
  id: Id, relativePath: z.string().regex(/^[a-zA-Z0-9_-]+\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/).refine((value) => !value.split("/").includes("..")),
  digest: Digest, pts: z.number().finite(), timeBase: z.number().finite().positive(), timeOriginSeconds: z.number().finite().optional(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  transform: z.object({ scaleX: z.number().positive(), scaleY: z.number().positive(), offsetX: z.number().finite(), offsetY: z.number().finite() }).strict(),
}).strict();
export const CoverIdentitySchema = z.object({ id: Id, label: z.string().min(1).max(120), semantics: z.enum(["sticker", "subtitle", "product", "unknown"]), origin: z.enum(["algorithm", "human", "review"]), derivedFrom: z.array(Id).optional() }).strict();
export const CoverSegmentSchema = z.object({ id: Id, identityId: Id, origin: z.enum(["algorithm", "human", "review"]), track: CoverTrackSchema }).strict();
export const CoverIssueSchema = z.object({
  id: Id, kind: z.enum(["missing_target", "incomplete_boundary", "wrong_semantics", "duplicate_identity", "uncertain_presence", "insufficient_evidence"]),
  identityId: Id.optional(), segmentId: Id.optional(), evidenceIds: z.array(Id), reason: z.string().min(1).max(2000), origin: z.enum(["algorithm", "review", "local"]),
  suggestion: CoverRectangleSchema.optional(),
}).strict();
export const CoverDecisionSchema = z.object({
  id: Id, issueId: Id.optional(), identityId: Id.optional(), segmentId: Id.optional(),
  action: z.enum(["accept_uncertainty", "correct", "delete_false_positive", "no_cover", "confirm_geometry", "split", "merge"]),
  revision: Revision, at: Time,
}).strict();
export const CoverReviewMediaSchema = z.object({
  mediaId: Id, sourceFingerprint: z.string().min(1), durationMs: z.number().int().positive(),
  analysis: z.enum(["not_started", "complete", "incomplete"]), analysisError: z.string().max(2000).optional(),
  disposition: z.enum(["unresolved", "cover", "no_cover"]), identities: z.array(CoverIdentitySchema).max(MAX_MANUAL_COVERS),
  segments: z.array(CoverSegmentSchema).max(MAX_MANUAL_COVERS), evidence: z.array(CoverEvidenceSchema),
  observations: z.array(z.object({ evidenceId: Id, identityId: Id.optional(), presence: z.enum(["PRESENT", "ABSENT", "UNKNOWN"]), rectangle: CoverRectangleSchema.optional(), origin: z.string().min(1).max(120) }).strict()),
  issues: z.array(CoverIssueSchema), decisions: z.array(CoverDecisionSchema),
}).strict().superRefine((media, ctx) => {
  for (const key of ["identities", "segments", "evidence", "issues", "decisions"] as const) {
    if (new Set(media[key].map((item) => item.id)).size !== media[key].length) ctx.addIssue({ code: "custom", path: [key], message: "审阅编号不得重复" });
  }
  for (const segment of media.segments) {
    if (!media.identities.some(({ id }) => id === segment.identityId)) ctx.addIssue({ code: "custom", message: "覆盖身份不存在" });
    if (segment.track.endMs > media.durationMs || segment.track.keyframes.some(({ timeMs }) => timeMs > media.durationMs)) ctx.addIssue({ code: "custom", message: "覆盖时段超出素材时长" });
    if (media.segments.some((other) => other.id !== segment.id && other.identityId === segment.identityId && other.track.startMs < segment.track.endMs && segment.track.startMs < other.track.endMs)) ctx.addIssue({ code: "custom", message: "同一身份的可见区间不得重叠" });
  }
  if (media.observations.some((item) => !media.evidence.some(({ id }) => id === item.evidenceId))) ctx.addIssue({ code: "custom", message: "观察缺少证据" });
});
export const FrozenCoverVersionSchema = z.object({
  mediaId: Id, version: z.number().int().positive(), templateJson: z.string().min(1), templateDigest: Digest,
  presetJson: z.string().min(1), bindingDigest: Digest,
  preview: z.object({ relativePath: CoverPreviewPathSchema, digest: Digest, viewed: z.boolean() }).strict().optional(),
}).strict();
export const CoverApprovalSchema = z.object({
  submissionId: Id, revision: Revision, bindingDigest: Digest, approvedAt: Time,
  receipts: z.array(z.object({ mediaId: Id, version: z.number().int().positive(), templateDigest: Digest, batchId: Id, taskId: Id }).strict()),
}).strict();
const ReviewFindingSchema = CoverIssueSchema.omit({ id: true, origin: true });
export const IndependentReviewRecordSchema = z.object({
  revision: Revision, connectionId: z.union([Id, z.literal("chatgpt")]), model: z.string().min(1),
  status: z.enum(["running", "complete", "incomplete"]), maxRequests: Revision, usedRequests: Revision,
  attempts: z.array(z.object({ phase: z.enum(["blind", "compare"]), status: z.enum(["started", "success", "error"]), usedRequests: Revision, mediaId: Id, frameIds: z.array(Id), findings: z.array(ReviewFindingSchema).optional() }).strict()),
}).strict().refine((record) => record.usedRequests <= record.maxRequests);
export const CoverReviewDraftSchema = z.object({
  id: Id, runId: Id, projectId: Id, revision: Revision, mode: z.literal("assisted"), status: CoverReviewStatusSchema,
  createdAt: Time, updatedAt: Time, media: z.array(CoverReviewMediaSchema).min(1).max(250),
  frozen: z.array(FrozenCoverVersionSchema).max(250), approval: CoverApprovalSchema.optional(),
  requestJson: z.string().min(1).optional(),
  settingsDigest: Digest.optional(),
  frameTimes: z.record(Id, z.array(z.number().finite().nonnegative())).optional(),
  requestPlan: z.object({ maxRequests: Revision, usedRequests: Revision }).strict().refine((value) => value.usedRequests <= value.maxRequests).optional(),
  review: IndependentReviewRecordSchema.optional(),
}).strict().superRefine((draft, ctx) => {
  if (new Set(draft.media.map(({ mediaId }) => mediaId)).size !== draft.media.length) ctx.addIssue({ code: "custom", message: "素材编号不得重复" });
  const keys = draft.frozen.map((item) => `${item.mediaId}:${item.version}`);
  if (draft.frozen.some(({ preview }) => preview && !preview.relativePath.startsWith(`${draft.projectId}/${draft.id}/${draft.revision}/previews/`))) ctx.addIssue({ code: "custom", message: "预览归属不匹配" });
  if (new Set(keys).size !== keys.length || draft.frozen.some((item) => !draft.media.some(({ mediaId }) => mediaId === item.mediaId))) ctx.addIssue({ code: "custom", message: "冻结版本集合无效" });
  if (draft.approval && draft.approval.revision !== draft.revision) ctx.addIssue({ code: "custom", message: "批准修订已过期" });
});
export type CoverReviewDraft = z.infer<typeof CoverReviewDraftSchema>;
export type CoverReviewMedia = z.infer<typeof CoverReviewMediaSchema>;
export type CoverEvidence = z.infer<typeof CoverEvidenceSchema>;
export type CoverSegment = z.infer<typeof CoverSegmentSchema>;
