import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";
import { QianchuanDeliveryDraftSchema, QianchuanDeliveryAuthorizationSchema,
  type QianchuanDeliveryActionCapability, type QianchuanDeliveryAuditState, type QianchuanDeliveryDraft,
} from "./qianchuan-delivery.js";

export const QianchuanDeliveryCommandSchema = z.object({
  requestId: z.string().uuid(), draft: QianchuanDeliveryDraftSchema, authorization: QianchuanDeliveryAuthorizationSchema,
}).strict();
export type QianchuanDeliveryCommand = z.infer<typeof QianchuanDeliveryCommandSchema>;

export const QianchuanDeliveryPrepareSchema = z.object({
  requestId: z.string().uuid(), product: QianchuanProductSchema,
  expectedAdvertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/), adId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  action: z.enum(["set-budget", "set-roi"]), targetValue: z.string().regex(/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,6})?$/),
}).strict();
export type QianchuanDeliveryPrepare = z.infer<typeof QianchuanDeliveryPrepareSchema>;
export const QianchuanDeliveryPreparedSchema = z.object({
  preflightId: z.string().uuid(), draft: QianchuanDeliveryDraftSchema, expiresAt: z.string().datetime(),
  capabilityStatus: z.enum(["live-read-verified", "live-write-verified"]),
  recipeEvidenceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), recipeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  productIds: z.array(z.string().regex(/^[1-9][0-9]{0,19}$/)).min(1).max(50),
}).strict();
export type QianchuanDeliveryPrepared = z.infer<typeof QianchuanDeliveryPreparedSchema>;
export const QianchuanDeliveryConfirmSchema = z.object({
  requestId: z.string().uuid(), preflightId: z.string().uuid(),
  maxTargetBudget: z.string().regex(/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/),
  totalBudgetIncrease: z.string().regex(/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/),
  maxActions: z.literal(1), expiresAt: z.string().datetime(),
}).strict();
export type QianchuanDeliveryConfirm = z.infer<typeof QianchuanDeliveryConfirmSchema>;

export interface QianchuanIntegrationStatus {
  capabilities: QianchuanDeliveryActionCapability[];
  stopped: boolean;
  auditUnavailable: boolean;
  operations: { operationId: string; action: QianchuanDeliveryDraft["action"]; state: QianchuanDeliveryAuditState; adId?: string; createdAt: string; updatedAt: string }[];
}
