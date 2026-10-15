import path from "node:path";
import type { DouyinUploadService } from "./douyin-upload-service.js";
import { QianchuanReportCaptureSchema, QianchuanReportListSchema } from "../shared/qianchuan-report.js";
import { QianchuanDeliveryCommandSchema, type QianchuanIntegrationStatus } from "../shared/qianchuan-integration.js";
import { captureQianchuanReport } from "./qianchuan-report-capture.js";
import { QianchuanReportStore } from "./qianchuan-report-store.js";
import { QianchuanDeliveryStore } from "./qianchuan-delivery-store.js";
import { QianchuanDelivery } from "./qianchuan-delivery.js";

/** Composition over the existing account owner, with no browser or write recipes of its own. */
export class QianchuanIntegration {
  private readonly reports: QianchuanReportStore;
  private readonly audit: QianchuanDeliveryStore;
  private readonly delivery: QianchuanDelivery;
  constructor(private readonly uploads: DouyinUploadService, root: string) {
    this.reports = new QianchuanReportStore(path.join(root, "qianchuan-reports"));
    this.audit = new QianchuanDeliveryStore(path.join(root, "qianchuan-delivery"));
    // No real write recipe has completed account/mode-specific qualification.
    this.delivery = new QianchuanDelivery(this.audit);
  }
  async capture(input: unknown, senderId: number) {
    const request = QianchuanReportCaptureSchema.parse(input);
    return this.uploads.withAccountOperation(request, senderId,
      async (signal, read) => { await this.reports.initialize(); signal.throwIfAborted(); return captureQianchuanReport(request, read, signal); },
      async (snapshot, signal) => { signal.throwIfAborted(); await this.reports.save(snapshot, signal); });
  }
  async history(input: unknown) {
    const scope = QianchuanReportListSchema.parse(input);
    return this.reports.list(scope.product, scope.expectedAdvertiserId);
  }
  async status(input: unknown): Promise<QianchuanIntegrationStatus> {
    const scope = QianchuanReportListSchema.parse(input);
    const status: QianchuanIntegrationStatus = { capabilities: this.delivery.capabilities(scope.expectedAdvertiserId),
      stopped: this.delivery.stopped, auditUnavailable: false, operations: [] };
    try {
      await this.audit.initialize();
      status.operations = (await this.audit.list(scope.expectedAdvertiserId)).map(record => ({ operationId: record.operationId,
        action: record.draft.action, state: record.state, ...(record.adId ? { adId: record.adId } : {}), createdAt: record.createdAt, updatedAt: record.updatedAt }));
    } catch { status.auditUnavailable = true; }
    return status;
  }
  async execute(input: unknown, senderId: number) {
    const command = QianchuanDeliveryCommandSchema.parse(input);
    return this.uploads.withAccountOperation({ requestId: command.requestId, product: command.draft.accountSlot,
      expectedAdvertiserId: command.draft.advertiserId }, senderId,
    signal => this.delivery.execute(command.draft, command.authorization, signal));
  }
  cancel(input: unknown, senderId: number): void { this.uploads.cancelAccountOperation(input, senderId); }
  async stop(senderId: number): Promise<void> { this.delivery.stop(); await this.uploads.stopAccountOperations(senderId); }
}
