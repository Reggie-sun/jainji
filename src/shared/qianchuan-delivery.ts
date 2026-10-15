import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";

const uuid = z.string().uuid();
const platformId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const platformVideoId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const version = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/);
const money = z.string().regex(/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/);
const roi = z.string().regex(/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/);
const idList = z.array(platformId).max(500).refine(values => new Set(values).size === values.length, "ID list must be distinct");
const materialBinding = z.object({ platformVideoId, materialId: platformId }).strict();
const materialBindings = z.array(materialBinding).min(1).max(200).superRefine((values, context) => {
  if (new Set(values.map(value => value.materialId)).size !== values.length) context.addIssue({ code: "custom", message: "material IDs must be distinct" });
});
const action = z.enum(["create-plan", "bind-materials", "set-roi", "set-budget", "pause", "enable"]);

const base = z.object({
  schemaVersion: z.literal(1),
  draftId: uuid,
  provider: z.literal("qianchuan-browser"),
  accountSlot: QianchuanProductSchema,
  advertiserId: platformId,
  mode: z.literal("product-cost-control"),
  action,
  beforeVersion: version,
});

const CreateDraftSchema = base.extend({
  action: z.literal("create-plan"),
  productId: platformId,
  beforeValues: z.object({ productEligible: z.literal(true) }).strict(),
  target: z.object({
    materials: materialBindings,
    budget: money,
    budgetType: z.literal("daily"),
    roi,
    status: z.literal("paused"),
  }).strict(),
}).strict();

const BindMaterialsDraftSchema = base.extend({
  action: z.literal("bind-materials"),
  adId: platformId,
  productId: platformId,
  beforeValues: z.object({ materialIds: idList }).strict(),
  target: z.object({ materials: materialBindings }).strict(),
}).strict();

const SetRoiDraftSchema = base.extend({
  action: z.literal("set-roi"),
  adId: platformId,
  beforeValues: z.object({ roi }).strict(),
  target: z.object({ roi }).strict(),
}).strict();

const SetBudgetDraftSchema = base.extend({
  action: z.literal("set-budget"),
  adId: platformId,
  beforeValues: z.object({ budget: money, budgetType: z.literal("daily") }).strict(),
  target: z.object({ budget: money, budgetType: z.literal("daily") }).strict(),
}).strict();

const PauseDraftSchema = base.extend({
  action: z.literal("pause"),
  adId: platformId,
  beforeValues: z.object({ status: z.enum(["paused", "enabled"]) }).strict(),
  target: z.object({ status: z.literal("paused") }).strict(),
}).strict();

const EnableDraftSchema = base.extend({
  action: z.literal("enable"),
  adId: platformId,
  beforeValues: z.object({ status: z.enum(["paused", "enabled"]) }).strict(),
  target: z.object({ status: z.literal("enabled") }).strict(),
}).strict();

export const QianchuanDeliveryDraftSchema = z.discriminatedUnion("action", [
  CreateDraftSchema,
  BindMaterialsDraftSchema,
  SetRoiDraftSchema,
  SetBudgetDraftSchema,
  PauseDraftSchema,
  EnableDraftSchema,
]).superRefine((value, context) => {
  if (value.action !== "bind-materials") return;
  const existing = new Set(value.beforeValues.materialIds);
  if (value.target.materials.some(material => existing.has(material.materialId))) context.addIssue({ code: "custom", message: "material is already bound" });
});
export type QianchuanDeliveryDraft = z.infer<typeof QianchuanDeliveryDraftSchema>;

export const QianchuanDeliveryAuthorizationSchema = z.object({
  authorizationId: uuid,
  sessionId: uuid,
  draftId: uuid,
  draftDigest: z.string().regex(/^[a-f0-9]{64}$/),
  currency: z.literal("CNY"),
  budgetType: z.literal("daily"),
  maxTargetBudget: money,
  totalBudgetIncrease: money,
  maxActions: z.number().finite().int().min(1).max(1000),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict().refine(value => Date.parse(value.expiresAt) > Date.parse(value.issuedAt), "expiresAt must follow issuedAt");
export type QianchuanDeliveryAuthorization = z.infer<typeof QianchuanDeliveryAuthorizationSchema>;

export const QIANCHUAN_DELIVERY_ACTIONS = action.options;
export const QianchuanDeliveryCapabilityStatusSchema = z.enum([
  "not-investigated", "static-located", "isolated-verified", "live-read-verified", "live-write-verified", "unavailable",
]);

const safeEvidenceId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const QianchuanDeliveryActionCapabilitySchema = z.object({
  action,
  status: QianchuanDeliveryCapabilityStatusSchema,
  reason: z.string().min(1).max(240).regex(/^[^\u0000-\u001f\u007f]*$/),
  evidenceId: safeEvidenceId.optional(),
  observedAt: z.string().datetime().optional(),
}).strict();
export type QianchuanDeliveryActionCapability = z.infer<typeof QianchuanDeliveryActionCapabilitySchema>;

export const QIANCHUAN_DELIVERY_RESULT_REASONS = [
  "CAPABILITY_UNQUALIFIED", "INVALID_DRAFT", "INVALID_AUTHORIZATION", "AUTHORIZATION_EXPIRED",
  "PRECONDITION_CHANGED", "ADVERTISER_HAS_UNKNOWN", "BUDGET_LIMIT", "ACTION_LIMIT", "STORE_UNAVAILABLE", "STOPPED", "PRE_SUBMIT_FAILURE",
  "PLATFORM_REJECTED", "SUBMIT_OUTCOME_UNKNOWN", "READBACK_MISMATCH", "READBACK_CONFIRMED", "READ_FAILED",
] as const;
export const QianchuanDeliveryResultSchema = z.object({
  state: z.enum(["NOT_SENT", "REJECTED", "CONFIRMED", "UNKNOWN"]),
  reason: z.enum(QIANCHUAN_DELIVERY_RESULT_REASONS),
  action: action.optional(),
  operationId: uuid.optional(),
  adId: platformId.optional(),
}).strict();
export type QianchuanDeliveryResult = z.infer<typeof QianchuanDeliveryResultSchema>;

export const QianchuanDeliveryAuditStateSchema = z.enum(["PENDING", "NOT_SENT", "REJECTED", "CONFIRMED", "UNKNOWN"]);
export type QianchuanDeliveryAuditState = z.infer<typeof QianchuanDeliveryAuditStateSchema>;

export function moneyMinorUnits(value: string): bigint {
  const parsed = money.parse(value);
  const [whole, fraction] = parsed.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction!);
}

export function minorUnitsMoney(value: bigint): string {
  if (value < 0n) throw new Error("Money cannot be negative");
  const whole = value / 100n, fraction = (value % 100n).toString().padStart(2, "0");
  const result = `${whole}.${fraction}`;
  return money.parse(result);
}

export function deliveryBudgetIncrease(value: QianchuanDeliveryDraft): bigint {
  const draft = QianchuanDeliveryDraftSchema.parse(value);
  if (draft.action === "create-plan") return moneyMinorUnits(draft.target.budget);
  if (draft.action === "set-budget") {
    const difference = moneyMinorUnits(draft.target.budget) - moneyMinorUnits(draft.beforeValues.budget);
    return difference > 0n ? difference : 0n;
  }
  return 0n;
}

export function maxTargetBudget(value: QianchuanDeliveryDraft): bigint | undefined {
  const draft = QianchuanDeliveryDraftSchema.parse(value);
  return draft.action === "create-plan" || draft.action === "set-budget" ? moneyMinorUnits(draft.target.budget) : undefined;
}

export function safeEvidenceReference(value: unknown): string | undefined {
  const parsed = safeEvidenceId.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function actionReason(status: z.infer<typeof QianchuanDeliveryCapabilityStatusSchema>): string {
  switch (status) {
    case "not-investigated": return "No qualified recipe is registered for this advertiser and mode.";
    case "static-located": return "Static evidence does not qualify a live write.";
    case "isolated-verified": return "Isolated verification does not qualify a live write.";
    case "live-read-verified": return "Live read evidence does not qualify a live write.";
    case "live-write-verified": return "A trusted live write recipe is registered for this advertiser and mode.";
    case "unavailable": return "This action is currently unavailable.";
  }
}
