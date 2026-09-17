import { z } from "zod";

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.number().int().nonnegative().safe();
export const KnowledgeLookupReasonSchema = z.enum(["not-started", "unknown", "absent", "coverage", "hit", "refresh", "run", "disputed", "integrity", "future_schema", "source_changed", "locked", "quota", "cancelled"]);
export const KnowledgeProductionStageSchema = z.enum(["waiting", "knowledge", "frames", "cover-selection", "creative", "prepare", "preview", "reconcile", "enqueue"]);
export const KnowledgePreviewActionSchema = z.enum(["pass", "stop", "revise", "inspect", "invalid", "rebind"]);
/** Diagnostic records only: never a publication proof, queue state or human quality verdict.
 * Digest references identify observations; their evidence may expire independently of this log.
 */
export const KnowledgeOutcomeSchema = z.object({
  schemaVersion: z.literal(1), id: Id, runId: Id, projectId: Id, mediaId: Id, version: z.number().int().positive(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), elapsedMs: Count,
  result: z.enum(["queued", "failed", "cancelled"]), taskId: Id.optional(), stage: KnowledgeProductionStageSchema,
  failureStage: z.enum(["identify", "recognition", "preview", "publication", "admission"]).optional(),
  lookup: KnowledgeLookupReasonSchema, sourceKey: Digest.optional(), revisionId: Id.optional(), factsDigest: Digest.optional(),
  templateDigest: Digest.optional(), previewEvidenceDigests: z.array(Digest).max(256).optional(),
  requests: z.object({ executor: Count, recognitionSupervisor: Count, previewSupervisor: Count, creative: Count }).strict(),
  requestMetric: z.literal("provider-invocations"),
  revisions: Count, renders: Count, executor: z.string().max(160).optional(), supervisor: z.string().max(160).optional(), creative: z.string().max(160).optional(),
  modelVerdict: z.enum(["passed", "not-passed", "not-evaluated"]), sourceIssueReported: z.boolean(),
  previewActions: z.array(KnowledgePreviewActionSchema).max(16).optional(),
  quality: z.literal("not-evaluated"),
}).strict();
export type KnowledgeOutcome = z.infer<typeof KnowledgeOutcomeSchema>;
export type KnowledgeLookupReason = z.infer<typeof KnowledgeLookupReasonSchema>;
export type KnowledgeProductionStage = z.infer<typeof KnowledgeProductionStageSchema>;
