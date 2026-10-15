import { z } from "zod";
import { QianchuanDeliveryDraftSchema, QianchuanDeliveryAuthorizationSchema,
  type QianchuanDeliveryActionCapability, type QianchuanDeliveryAuditState, type QianchuanDeliveryDraft,
} from "./qianchuan-delivery.js";

export const QianchuanDeliveryCommandSchema = z.object({
  requestId: z.string().uuid(), draft: QianchuanDeliveryDraftSchema, authorization: QianchuanDeliveryAuthorizationSchema,
}).strict();
export type QianchuanDeliveryCommand = z.infer<typeof QianchuanDeliveryCommandSchema>;

export interface QianchuanIntegrationStatus {
  capabilities: QianchuanDeliveryActionCapability[];
  stopped: boolean;
  auditUnavailable: boolean;
  operations: { operationId: string; action: QianchuanDeliveryDraft["action"]; state: QianchuanDeliveryAuditState; adId?: string; createdAt: string; updatedAt: string }[];
}
