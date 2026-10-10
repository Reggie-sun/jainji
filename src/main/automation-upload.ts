import path from "node:path";
import { z } from "zod";
import { readAutomationFile, writeAutomationFile } from "./automation-files.js";
import { FrozenAccountSchema, PageOwnershipSchema, ReadyEvidenceSchema, UploadIdSchema, UploadIdentitySchema } from "../shared/douyin-upload.js";

const ConfirmationFileSchema = z.object({
  identity: UploadIdentitySchema,
  uploadTaskId: UploadIdSchema,
  artifactSha256: UploadIdSchema,
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().safe(),
  selectedIndex: z.number().int().min(1).max(250),
  readyEvidence: ReadyEvidenceSchema,
}).strict();

export const AutomationConfirmationIntentSchema = z.object({
  version: z.literal(1),
  pageBatchId: z.string().uuid(),
  target: FrozenAccountSchema,
  expectedCount: z.number().int().min(1).max(250),
  pageOwnership: PageOwnershipSchema,
  files: z.array(ConfirmationFileSchema).min(1).max(250),
  recordedAt: z.string().datetime(),
}).strict().superRefine((intent, ctx) => {
  if (intent.files.length !== intent.expectedCount || intent.pageOwnership.pageBatchId !== intent.pageBatchId ||
    new Set(intent.files.map(file => file.identity.export_task_id)).size !== intent.files.length ||
    new Set(intent.files.map(file => file.fileName)).size !== intent.files.length ||
    intent.files.some((file, index) => file.selectedIndex !== index + 1 || file.readyEvidence.fileName !== file.fileName ||
      file.readyEvidence.selectedCount !== intent.expectedCount || file.readyEvidence.pageOwnership.targetId !== intent.pageOwnership.targetId ||
      file.readyEvidence.pageOwnership.pageBatchId !== intent.pageBatchId || file.readyEvidence.pageOwnership.modalSessionId !== intent.pageOwnership.modalSessionId ||
      file.readyEvidence.advertiserId !== intent.target.advertiserId || file.readyEvidence.adId !== intent.target.adId)) {
    ctx.addIssue({ code: "custom", message: "自动确认意图与冻结上传批次不一致。" });
  }
});

export type AutomationConfirmationIntent = z.infer<typeof AutomationConfirmationIntentSchema>;

export function automationConfirmationRecoveryLock(pageBatchId: string): string {
  return `定时千川确认已进入一次性人工核查屏障（${pageBatchId}）；禁止再次确认或恢复为 READY。`;
}

/** Writes the durable one-shot barrier before a scheduled confirmation attempt. */
export async function persistAutomationConfirmationIntent(uploadRoot: string, input: AutomationConfirmationIntent): Promise<void> {
  const intent = AutomationConfirmationIntentSchema.parse(input);
  await writeAutomationFile(path.join(uploadRoot, "automation-confirmations", `${intent.pageBatchId}.json`), intent, true);
}

/** Presence blocks the ordinary read-only recovery path from reclassifying the batch as READY. */
export async function hasAutomationConfirmationIntent(uploadRoot: string, pageBatchId: string): Promise<boolean> {
  const file = path.join(uploadRoot, "automation-confirmations", `${pageBatchId}.json`);
  try {
    const intent = await readAutomationFile(file, value => AutomationConfirmationIntentSchema.parse(value));
    if (intent.pageBatchId !== pageBatchId) throw new Error("定时确认屏障与批次身份不一致。");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
