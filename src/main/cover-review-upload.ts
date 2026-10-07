import type { DouyinUploadService } from "./douyin-upload-service.js";
import type { ExportBatch } from "./domain.js";
import type { QianchuanUploadSelection } from "../shared/douyin-upload.js";
import { reviewDigest } from "./cover-review-approval.js";
import { intentKey } from "./douyin-upload-store.js";

/** Bridge approved exports to the existing private upload ledger, never preview files. */
export async function registerReviewedCoverUploads(upload: DouyinUploadService, batches: ExportBatch[], selection: QianchuanUploadSelection, signal: AbortSignal): Promise<void> {
  const keys = batches.flatMap(batch => batch.tasks.map(task => intentKey({ project_id: batch.projectId!, batch_id: batch.id, export_task_id: task.id })));
  if (!keys.length || new Set(keys).size !== keys.length || batches.some(batch => !batch.projectId || batch.projectId !== batches[0].projectId)) throw new Error("审阅上传任务集合无效。");
  signal.throwIfAborted();
  if (upload.store.unavailable) throw new Error("上传记录不可用，请核查后再确认。");
  const existing = upload.store.intents().filter(intent => keys.includes(intentKey(intent)));
  if (existing.length) {
    if (existing.length !== keys.length || existing.some(intent => reviewDigest(intent.selection) !== reviewDigest(selection) || intent.authorization.expectedCount !== keys.length) || new Set(existing.map(intent => reviewDigest(intent.authorization))).size !== 1) throw new Error("审阅上传记录不完整或目标冲突，请保留原记录并核查，不能重新登记。");
    // Replay does not restore browser permission or reselect already fenced files.
    return;
  }
  if (batches.some(batch => batch.tasks.some(task => task.status !== "queued"))) throw new Error("未登记上传的任务已开始或结束，不能通过再次批准给历史成片追加上传。");
  await upload.withExportAdmission(async () => {
    signal.throwIfAborted();
    await upload.beginProduction();
    const authorization = await upload.preflight(selection, keys.length);
    signal.throwIfAborted();
    if (!authorization) throw new Error("千川账号预检未授予上传权限。");
    await upload.registerBatches(batches, selection, authorization);
  });
}
