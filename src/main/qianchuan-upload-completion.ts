import { automationConfirmationRecoveryLock, persistAutomationConfirmationIntent } from "./automation-upload.js";
import type { UploadBrowserPort } from "./douyin-upload-service.js";
import type { DouyinUploadStore, UploadTaskRecord } from "./douyin-upload-store.js";
import { UploadIdentitySchema, uploadFailure, type ReadyEvidence } from "../shared/douyin-upload.js";

interface Dependencies {
  store: DouyinUploadStore;
  port: UploadBrowserPort;
  saveReady(tasks: UploadTaskRecord[], evidence: ReadyEvidence[], signal: AbortSignal): Promise<void>;
  saveUnknown(tasks: UploadTaskRecord[]): Promise<void>;
  accepted(): void;
}

/** Shared once-only confirmation; task authority and persistence remain in the original store. */
export async function confirmReadyUpload(tasks: UploadTaskRecord[], signal: AbortSignal, dependencies: Dependencies): Promise<void> {
  const { store, port } = dependencies, first = tasks[0]!, authorization = first.authorization;
  const ownership = store.fence(first.result.upload_task_id)?.pageOwnership;
  if (!port.confirmAutomation || !ownership || tasks.length !== authorization.expectedCount || tasks.some(task => {
    const fence = store.fence(task.result.upload_task_id);
    return task.result.state !== "WAITING_FOR_CONFIRMATION" || task.result.upload_outcome !== "READY" || !task.result.readyEvidence ||
      JSON.stringify(task.authorization) !== JSON.stringify(authorization) || !fence || !store.hasMarker(task.result.upload_task_id) ||
      JSON.stringify(fence.pageOwnership) !== JSON.stringify(ownership) || task.result.readyEvidence.selectedCount > authorization.expectedCount ||
      JSON.stringify(task.result.readyEvidence.pageOwnership) !== JSON.stringify(ownership);
  })) throw new Error("原上传标签页、弹窗或 READY 文件无法唯一绑定，未自动确认。");
  signal.throwIfAborted();
  const finalReady = await port.pollReady(tasks, signal);
  if (!finalReady || finalReady.length !== tasks.length) throw new Error("最终整批 READY 核验未通过，未自动确认。");
  await dependencies.saveReady(tasks, finalReady, signal);
  const confirmationTasks = structuredClone(tasks), acceptance = store.beginAutomationAcceptance(confirmationTasks);
  const files = tasks.map(task => ({
    identity: UploadIdentitySchema.parse({ project_id: task.input.project_id, batch_id: task.input.batch_id, export_task_id: task.input.export_task_id }),
    uploadTaskId: task.result.upload_task_id, artifactSha256: task.input.artifact_sha256, fileName: task.result.file_name,
    sizeBytes: task.input.size_bytes, selectedIndex: store.fence(task.result.upload_task_id)!.selectedIndex, readyEvidence: task.result.readyEvidence!,
  }));
  const failure = uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "自动确认已进入一次性处理；千川是否接受仍未知。",
    automationConfirmationRecoveryLock(authorization.pageBatchId), true).failure;
  try {
    for (const task of tasks) task.result = { ...task.result, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED",
      readyEvidence: undefined, retryable: false, failure, timestamp: new Date().toISOString() };
    // The durable unknown barrier must precede the intent and both platform clicks.
    await dependencies.saveUnknown(tasks);
    signal.throwIfAborted();
    await persistAutomationConfirmationIntent(store.root, { version: 1, pageBatchId: authorization.pageBatchId, target: authorization.target,
      expectedCount: authorization.expectedCount, pageOwnership: ownership, files, recordedAt: new Date().toISOString() });
    signal.throwIfAborted();
    const proof = await port.confirmAutomation(confirmationTasks, ownership, signal);
    signal.throwIfAborted();
    if (!proof) throw uploadFailure("UPLOAD_OUTCOME_UNKNOWN", "page", "上传结果未知，禁止再次自动确认。", failure.next_action, true);
    await store.acceptAutomation(acceptance, proof);
    dependencies.accepted();
  } finally { store.endAutomationAcceptance(acceptance); }
}
