import { z } from "zod";
import { createHash } from "node:crypto";
import { DouyinUploadConfigSchema, DouyinUploadSelectionSchema, FinalArtifactInputSchema, UploadIdentitySchema, UploadIdSchema, UploadResultSchema, type FinalArtifactInput, type UploadIdentity } from "../shared/douyin-upload.js";
const LegacyIntentSchema = UploadIdentitySchema.extend({ selection: DouyinUploadSelectionSchema, config: DouyinUploadConfigSchema }).strict();
const TaskSchema = z.object({
  input: FinalArtifactInputSchema, inputDigest: UploadIdSchema, config: DouyinUploadConfigSchema, snapshotPath: z.string(),
  revisions: z.array(z.object({ caption: z.string().optional(), timestamp: z.string().datetime() }).strict()), result: UploadResultSchema.superRefine((value, ctx) => {
    if (value.failure && ["UPLOAD_OUTCOME_UNKNOWN", "CAPACITY_INSUFFICIENT", "ACCOUNT_CONFIG_CHANGED", "ACCOUNT_CONFIG_UNAVAILABLE"].includes(value.failure.code)) ctx.addIssue({ code: "custom", message: "Unknown v1 failure code" });
  }),
}).strict();
export const LegacyStateSchema = z.object({ version: z.literal(1), config: DouyinUploadConfigSchema, intents: z.array(LegacyIntentSchema), tasks: z.array(TaskSchema) }).strict();
export const LegacyMarkerSchema = z.object({ version: z.literal(1), upload_task_id: UploadIdSchema, artifact_sha256: UploadIdSchema, input_digest: UploadIdSchema, timestamp: z.string().datetime() }).strict();
export function legacyTaskId(input: FinalArtifactInput): string {
  return digest({ schema: "jianji-douyin-upload/1", project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, artifact_sha256: input.artifact_sha256 });
}
export function legacyInputDigest(input: FinalArtifactInput): string {
  return digest({ ...input, metadata: input.metadata ? Object.fromEntries(Object.entries(input.metadata).sort(([a], [b]) => a.localeCompare(b))) : undefined });
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function intentKey(identity: UploadIdentity): string { return JSON.stringify([identity.project_id, identity.batch_id, identity.export_task_id]); }

/** Validate old records without reinterpreting their identity, authorization or outcome. */
export function validateLegacy(value: unknown, markers: Map<string, z.infer<typeof LegacyMarkerSchema>>) {
  const state = LegacyStateSchema.parse(value);
  const ids = new Set<string>(), identities = new Set<string>();
  for (const task of state.tasks) {
    const id = task.result.upload_task_id;
    if (id !== legacyTaskId(task.input) || task.inputDigest !== legacyInputDigest(task.input) || ids.has(id) || identities.has(intentKey(task.input)) || intentKey(task.result) !== intentKey(task.input) || task.result.artifact_sha256 !== task.input.artifact_sha256) throw new Error("Legacy task binding mismatch");
    ids.add(id); identities.add(intentKey(task.input));
    const marker = markers.get(id);
    if (marker && (marker.artifact_sha256 !== task.input.artifact_sha256 || marker.input_digest !== task.inputDigest)) throw new Error("Legacy marker mismatch");
    if (task.result.publish_outcome !== "NOT_SUBMITTED" && !marker && !task.result.duplicate_of) throw new Error("Missing legacy marker");
  }
  for (const id of markers.keys()) if (!ids.has(id)) throw new Error("Orphan legacy marker");
  for (const task of state.tasks) if (task.result.duplicate_of && !ids.has(task.result.duplicate_of)) throw new Error("Missing legacy duplicate");
  return state;
}
