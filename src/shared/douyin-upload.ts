import { z } from "zod";
import { QianchuanAccountSchema, QianchuanProductSchema, accountAvailable } from "./qianchuan-account.js";

export const DouyinUploadSelectionSchema = z.object({ enabled: z.literal(true), caption: z.string().max(4096).optional() }).strict();
export type DouyinUploadSelection = z.infer<typeof DouyinUploadSelectionSchema>;
export const UploadIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const UploadIdentitySchema = z.object({ project_id: z.string().uuid(), batch_id: z.string().uuid(), export_task_id: z.string().uuid() }).strict();
export type UploadIdentity = z.infer<typeof UploadIdentitySchema>;

export function isLoopbackUrl(value: string, websocket = false): boolean {
  try {
    const url = new URL(value);
    return (websocket ? url.protocol === "ws:" : url.protocol === "http:") &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export const CreatorUrlSchema = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.origin === "https://creator.douyin.com" && !url.username && !url.password && !url.search && !url.hash && !/%|\\/.test(url.pathname);
}, "只能使用抖音创作者后台的已核实页面地址。");
// Empty until the source-owned production page contract is actually reconnoitred.
export const VERIFIED_DOUYIN_UPLOAD_PATHS: readonly string[] = [];
const timeout = z.number().int().positive().max(86_400_000);
export const UploadTimeoutsSchema = z.object({
  connect: timeout.default(10_000), navigation: timeout.default(45_000), fileInput: timeout.default(30_000),
  processing: timeout.default(1_800_000), action: timeout.default(15_000), confirmation: timeout.default(120_000),
}).strict();
export const DouyinUploadConfigSchema = z.object({
  enabled: z.boolean().default(false),
  cdpEndpoint: z.string().max(2048).refine(value => isLoopbackUrl(value) && new URL(value).pathname === "/", "CDP 必须是无凭据的本机 loopback HTTP 地址。").default("http://127.0.0.1:9222"),
  uploadPageUrl: CreatorUrlSchema.refine(value => VERIFIED_DOUYIN_UPLOAD_PATHS.includes(new URL(value).pathname), "真实上传页面合同尚未核实，不能保存猜测路由。").optional(),
  timeouts: UploadTimeoutsSchema.default({}), captureFailureDiagnostics: z.boolean().default(false),
}).strict();
export type DouyinUploadConfig = z.infer<typeof DouyinUploadConfigSchema>;

const metadata = z.record(z.string().max(64).regex(/^[a-zA-Z0-9_-]+$/), z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()])).refine(value =>
  Object.keys(value).length <= 16 && new TextEncoder().encode(JSON.stringify(value)).length <= 4096 &&
  !Object.keys(value).some(key => /selector|script|url|account|cookie|password|token|credential|product|shop/i.test(key)), "metadata 仅允许有限的诊断标量。");
export const FinalArtifactInputSchema = UploadIdentitySchema.extend({
  video_path: z.string().min(1).max(4096).refine(value => value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)),
  artifact_sha256: UploadIdSchema, size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  caption: z.string().max(4096).optional(), metadata: metadata.optional(),
}).strict();
export type FinalArtifactInput = z.infer<typeof FinalArtifactInputSchema>;
export const UploadStateSchema = z.enum(["PENDING", "CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE", "SUBMITTING", "VERIFYING", "SUCCEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "NEEDS_HUMAN", "CANCELLED"]);
export type UploadState = z.infer<typeof UploadStateSchema>;
export const PublishOutcomeSchema = z.enum(["NOT_SUBMITTED", "MAY_HAVE_SUBMITTED", "ACCEPTED", "REJECTED_KNOWN"]);
export const UploadFailureSchema = z.object({
  category: z.enum(["input", "store", "browser", "page", "account", "publish", "cancel"]),
  code: z.enum(["ARTIFACT_CHANGED", "INPUT_CONFLICT", "UNSUPPORTED_FORMAT", "ARTIFACT_UNAVAILABLE", "EXPORT_NOT_COMMITTED", "STORE_UNAVAILABLE", "CDP_UNAVAILABLE", "NAVIGATION_FAILED", "PAGE_CONTRACT_CHANGED", "PAGE_CONTRACT_UNVERIFIED", "LOGIN_REQUIRED", "ACCOUNT_UNCONFIRMED", "CHALLENGE_REQUIRED", "CAPTION_REQUIRED", "CONTENT_REJECTED", "PUBLISH_OUTCOME_UNKNOWN", "PUBLISH_CONFIRMATION_UNAVAILABLE", "UPLOAD_OUTCOME_UNKNOWN", "CAPACITY_INSUFFICIENT", "ACCOUNT_CONFIG_CHANGED", "ACCOUNT_CONFIG_UNAVAILABLE", "STOPPED", "TIMEOUT"]),
  retryable: z.boolean(), requires_human: z.boolean(), message: z.string().max(500), next_action: z.string().max(500),
}).strict();
export type UploadFailure = z.infer<typeof UploadFailureSchema>;
export const UploadSuccessSchema = z.object({
  platform_content_id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), accepted_status: z.enum(["reviewing", "published"]),
  url: CreatorUrlSchema, observed_at: z.string().datetime(), confirmation_source: z.enum(["browser", "human"]),
  evidence: z.string().min(1).max(500),
}).strict().refine(value => new URL(value.url).pathname.split("/").includes(value.platform_content_id), "接受证据必须定位到同一个 content ID。");
export type UploadSuccess = z.infer<typeof UploadSuccessSchema>;
export const UploadResultSchema = UploadIdentitySchema.extend({
  upload_task_id: UploadIdSchema, artifact_sha256: UploadIdSchema, file_name: z.string(), state: UploadStateSchema,
  publish_outcome: PublishOutcomeSchema, retryable: z.boolean(), retry_count: z.number().int().nonnegative(), attempt_count: z.number().int().nonnegative().optional(), timestamp: z.string().datetime(),
  success: UploadSuccessSchema.optional(), failure: UploadFailureSchema.optional(), duplicate_of: UploadIdSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.state === "SUCCEEDED") !== Boolean(value.success) || (value.success && value.failure) ||
    (value.state === "SUCCEEDED" && value.publish_outcome !== "ACCEPTED") ||
    (value.retryable && value.publish_outcome !== "NOT_SUBMITTED")) ctx.addIssue({ code: "custom", message: "非法上传结果组合。" });
});
export type UploadResult = z.infer<typeof UploadResultSchema>;
export interface DouyinUploadStatus {
  config: Omit<QianchuanUploadConfig, "accountConfigPath">;
  configSelected: boolean;
  accounts: import("./qianchuan-account.js").QianchuanAccountSummary[];
  ready: boolean; message: string; tasks: QianchuanUploadResult[]; legacyTasks: UploadResult[];
  batches?: QianchuanUploadBatchSummary[];
  closedBatches?: QianchuanClosedBatchSummary[];
}

export const ClosedUploadBatchSchema = z.object({
  projectId: z.string().uuid(), pageBatchId: z.string().uuid(), advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/), adId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  expectedCount: z.number().int().min(1).max(250), taskIds: z.array(UploadIdSchema).min(1).max(250), archiveSha256: UploadIdSchema, closedAt: z.string().datetime(),
}).strict().refine(value => value.taskIds.length === value.expectedCount && value.taskIds.every((id, index) => index === 0 || id > value.taskIds[index - 1]!), "结束批次必须绑定排序且不重复的完整成员。");
export type ClosedUploadBatch = z.infer<typeof ClosedUploadBatchSchema>;
export interface QianchuanUploadBatchSummary {
  projectId: string; pageBatchId: string; advertiserId: string; adId: string; expectedCount: number;
  taskIds: string[]; readyCount: number; unknownCount: number; notSelectedCount: number; canClose: boolean;
}
export interface QianchuanClosedBatchSummary extends Omit<QianchuanUploadBatchSummary, "canClose"> { closedAt: string; tasks: QianchuanUploadResult[]; }

export class UploadError extends Error {
  constructor(readonly failure: UploadFailure) { super(failure.message); this.name = "UploadError"; }
}
export function uploadFailure(code: UploadFailure["code"], category: UploadFailure["category"], message: string, next_action: string, requires_human = false, retryable = false): UploadError {
  return new UploadError({ code, category, message, next_action, requires_human, retryable });
}

export const QianchuanUploadSelectionSchema = z.object({ enabled: z.literal(true), accountProduct: QianchuanProductSchema }).strict();
export type QianchuanUploadSelection = z.infer<typeof QianchuanUploadSelectionSchema>;
export const QianchuanUploadConfigSchema = z.object({
  enabled: z.boolean().default(false),
  accountConfigPath: z.string().min(1).max(4096).refine(value => !value.includes("\0") && (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value))).optional(),
  timeouts: UploadTimeoutsSchema.default({}), captureFailureDiagnostics: z.boolean().default(false),
}).strict();
export type QianchuanUploadConfig = z.infer<typeof QianchuanUploadConfigSchema>;
export const FrozenAccountSchema = QianchuanAccountSchema.innerType().extend({ configDigest: UploadIdSchema }).strict().refine(accountAvailable, "请选择包含账户和计划 ID 的账号。");
export const UploadAuthorizationSchema = z.object({
  target: FrozenAccountSchema, pageBatchId: z.string().uuid(), expectedCount: z.number().int().min(1).max(250),
}).strict();
export type UploadAuthorization = z.infer<typeof UploadAuthorizationSchema>;
export const PageOwnershipSchema = z.object({
  targetId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), pageBatchId: z.string().uuid(), modalSessionId: z.string().uuid(),
}).strict();
export type PageOwnership = z.infer<typeof PageOwnershipSchema>;
export const ReadyEvidenceSchema = z.object({
  advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/), adId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  fileName: z.string().min(1).max(255), selectedCount: z.number().int().min(1).max(250), observedAt: z.string().datetime(), pageOwnership: PageOwnershipSchema,
}).strict();
export type ReadyEvidence = z.infer<typeof ReadyEvidenceSchema>;
export const QianchuanUploadStateSchema = z.enum(["PENDING", "CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE", "WAITING_FOR_CONFIRMATION", "FAILED_RETRYABLE", "FAILED_TERMINAL", "NEEDS_HUMAN", "CANCELLED", "DISCARDED"]);
export const QianchuanUploadOutcomeSchema = z.enum(["NOT_SELECTED", "MAY_HAVE_UPLOADED", "READY"]);
export const QianchuanUploadResultSchema = UploadIdentitySchema.extend({
  upload_task_id: UploadIdSchema, artifact_sha256: UploadIdSchema, file_name: z.string().min(1).max(255),
  accountProduct: QianchuanProductSchema, advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/), adId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  state: QianchuanUploadStateSchema, upload_outcome: QianchuanUploadOutcomeSchema,
  retryable: z.boolean(), retry_count: z.number().int().nonnegative(), attempt_count: z.number().int().nonnegative(), timestamp: z.string().datetime(),
  readyEvidence: ReadyEvidenceSchema.optional(), failure: UploadFailureSchema.optional(), duplicate_of: UploadIdSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.state === "WAITING_FOR_CONFIRMATION") !== Boolean(value.readyEvidence) ||
    (value.upload_outcome === "READY") !== Boolean(value.readyEvidence) ||
    value.readyEvidence && (value.readyEvidence.advertiserId !== value.advertiserId || value.readyEvidence.adId !== value.adId || !value.duplicate_of && value.readyEvidence.fileName !== value.file_name || value.failure) ||
    value.retryable && (value.upload_outcome !== "NOT_SELECTED" || value.state === "DISCARDED")) ctx.addIssue({ code: "custom", message: "非法千川上传结果组合。" });
});
export type QianchuanUploadResult = z.infer<typeof QianchuanUploadResultSchema>;
