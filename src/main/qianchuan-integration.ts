import path from "node:path";
import { z } from "zod";
import type { DouyinUploadService } from "./douyin-upload-service.js";
import { QianchuanReportCaptureSchema, QianchuanReportListSchema } from "../shared/qianchuan-report.js";
import { QianchuanDeliveryCommandSchema, QianchuanDeliveryPrepareSchema, QianchuanDeliveryConfirmSchema, type QianchuanDeliveryPrepared, type QianchuanIntegrationStatus } from "../shared/qianchuan-integration.js";
import { captureQianchuanReport } from "./qianchuan-report-capture.js";
import { QianchuanReportStore } from "./qianchuan-report-store.js";
import { QianchuanDeliveryStore } from "./qianchuan-delivery-store.js";
import { QianchuanDelivery } from "./qianchuan-delivery.js";
import { QianchuanLiveDelivery } from "./qianchuan-delivery-page.js";

/** Composition over the existing account owner, with no browser or write recipes of its own. */
export class QianchuanIntegration {
  private readonly reports: QianchuanReportStore;
  private readonly audit: QianchuanDeliveryStore;
  private readonly delivery: QianchuanDelivery;
  private readonly preparations = new Map<string, { public: QianchuanDeliveryPrepared; configDigest: string; senderId: number; requestId: string }>();
  constructor(private readonly uploads: DouyinUploadService, root: string, private readonly live = new QianchuanLiveDelivery()) {
    this.reports = new QianchuanReportStore(path.join(root, "qianchuan-reports"));
    this.audit = new QianchuanDeliveryStore(path.join(root, "qianchuan-delivery"));
    this.delivery = new QianchuanDelivery(this.audit, this.live);
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
    const envelope = z.object({ operation: z.enum(["prepare", "confirm"]), input: z.unknown() }).strict().safeParse(input);
    if (envelope.success) return envelope.data.operation === "prepare" ? this.prepare(envelope.data.input, senderId) : this.confirm(envelope.data.input, senderId);
    const command = QianchuanDeliveryCommandSchema.parse(input);
    await this.audit.initialize();
    return this.uploads.withAccountOperation({ requestId: command.requestId, product: command.draft.accountSlot,
      expectedAdvertiserId: command.draft.advertiserId }, senderId,
    signal => this.delivery.execute(command.draft, command.authorization, signal));
  }
  private async prepare(input: unknown, senderId: number) {
    const request = QianchuanDeliveryPrepareSchema.parse(input);
    for (const [key, value] of this.preparations) if (Date.parse(value.public.expiresAt) <= Date.now()) this.preparations.delete(key);
    if (this.delivery.stopped || this.preparations.size >= 64) throw new Error("本地投放已停止或预检过多，请停止后核查。");
    const candidate = await this.uploads.withAccountOperation(request, senderId, async (signal, _read, prepareAccount) => {
      await this.audit.initialize();
      if (await this.audit.hasUnresolved(request.expectedAdvertiserId)) throw new Error("该账户存在未知投放结果，只能核查，不可新增写入。");
      const target = await prepareAccount();
      const observed = await this.live.withTarget(target, signal, session => session.prepare(request, signal));
      return { public: observed, configDigest: target.configDigest, senderId, requestId: request.requestId };
    }, async (value, signal) => { signal.throwIfAborted(); this.preparations.set(value.public.preflightId, value); });
    return candidate.public;
  }
  private async confirm(input: unknown, senderId: number) {
    const request = QianchuanDeliveryConfirmSchema.parse(input), candidate = this.preparations.get(request.preflightId), now = Date.now();
    if (!candidate || candidate.senderId !== senderId || Date.parse(candidate.public.expiresAt) <= now ||
      Date.parse(request.expiresAt) <= now || Date.parse(request.expiresAt) > now + 3600000) throw new Error("预检或授权已失效，请重新预检。");
    // Consume this main-issued preflight once, before yielding or acquiring another resource.
    this.preparations.delete(request.preflightId);
    const draft = candidate.public.draft;
    return this.uploads.withAccountOperation({ requestId: request.requestId, product: draft.accountSlot, expectedAdvertiserId: draft.advertiserId }, senderId,
      async (signal, _read, prepareAccount) => {
        await this.audit.initialize(); const target = await prepareAccount();
        if (target.configDigest !== candidate.configDigest) throw new Error("账号配置已变化，请重新预检。");
        return this.live.withTarget(target, signal, async session => {
          await session.readFresh(draft, signal); signal.throwIfAborted();
          const expiresAt = new Date(Math.min(Date.parse(request.expiresAt), Date.parse(candidate.public.expiresAt))).toISOString();
          const authorization = this.delivery.issueQualificationAuthorization(draft, { maxTargetBudget: request.maxTargetBudget,
            totalBudgetIncrease: request.totalBudgetIncrease, maxActions: 1, expiresAt }, {
            evidenceId: candidate.public.recipeEvidenceId, recipeDigest: candidate.public.recipeDigest, configDigest: target.configDigest, senderId });
          return this.delivery.execute(draft, authorization, signal, { configDigest: target.configDigest, senderId });
        });
      });
  }
  cancel(input: unknown, senderId: number): void {
    this.uploads.cancelAccountOperation(input, senderId);
    const request = z.object({ requestId: z.string().uuid() }).strict().parse(input);
    for (const [key, value] of this.preparations) if (value.senderId === senderId && value.requestId === request.requestId) this.preparations.delete(key);
  }
  async stop(senderId: number): Promise<void> { this.delivery.stop(); this.preparations.clear(); await this.uploads.stopAccountOperations(senderId); }
}
