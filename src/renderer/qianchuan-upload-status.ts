import type { QianchuanUploadBatchSummary, QianchuanUploadResult, QianchuanUploadTaskStatus } from "../shared/douyin-upload";

export const qianchuanUploadLabels: Record<QianchuanUploadResult["state"], string> = {
  PENDING: "等待上传", CONNECTING_BROWSER: "连接浏览器", OPENING_UPLOAD_PAGE: "打开千川计划", UPLOADING: "上传文件", WAITING_UPLOAD_COMPLETE: "等待平台处理",
  WAITING_FOR_CONFIRMATION: "已上传，待确认", ACCEPTED: "平台已接收", FAILED_RETRYABLE: "可明确继续", FAILED_TERMINAL: "已停止", NEEDS_HUMAN: "需要人工处理", CANCELLED: "已停止", DISCARDED: "已删除上传任务",
};

export function qianchuanUploaded(task: QianchuanUploadTaskStatus): boolean {
  return !task.duplicate_of && (["READY", "ACCEPTED"].includes(task.upload_outcome) || task.rowReady === true && task.state === "WAITING_UPLOAD_COMPLETE" && task.upload_outcome === "MAY_HAVE_UPLOADED" && !task.failure);
}

export function qianchuanUploadLabel(task: QianchuanUploadTaskStatus): string {
  if (task.duplicate_of) return "重复任务，已跳过";
  return task.rowReady && qianchuanUploaded(task) && task.state === "WAITING_UPLOAD_COMPLETE" ? "已上传，等待整批处理" : qianchuanUploadLabels[task.state];
}

export function qianchuanDuplicate(task: QianchuanUploadTaskStatus): boolean { return Boolean(task.duplicate_of); }

export function qianchuanDuplicateNote(task: QianchuanUploadTaskStatus): string {
  if (task.acceptedEvidence) return `引用既有平台接收回执 · 视频 ID ${task.acceptedEvidence.platformVideoId} · 原回执时间 ${task.acceptedEvidence.observedAt}；本批未重新上传。`;
  if (task.readyEvidence) return `关联既有待确认记录 · 原观察时间 ${task.readyEvidence.observedAt}；本批未重新上传。`;
  if (task.upload_outcome === "MAY_HAVE_UPLOADED") return "关联既有记录的原上传结果未知；本批已跳过，需核查原任务。";
  return "已关联同目标的既有上传记录；本批已跳过，没有再次选文件。";
}

export function qianchuanBatchNewAcceptedCount(batch: Pick<QianchuanUploadBatchSummary, "acceptedCount" | "newAcceptedCount">): number {
  return batch.newAcceptedCount ?? batch.acceptedCount ?? 0;
}

export function qianchuanBatchDuplicateCount(batch: Pick<QianchuanUploadBatchSummary, "duplicateCount">): number {
  return batch.duplicateCount ?? 0;
}

export function qianchuanPlannedUploadCount(
  tasks: readonly Pick<QianchuanUploadTaskStatus, "upload_task_id">[],
  batches: readonly Pick<QianchuanUploadBatchSummary, "pageBatchId" | "expectedCount" | "taskIds">[] = [],
  fallback = tasks.length,
): number {
  const ids = new Set(tasks.map(task => task.upload_task_id));
  const relevant = new Map<string, number>();
  const coveredTaskIds = new Set<string>();
  for (const batch of batches) {
    if (batch.taskIds.some(id => ids.has(id))) {
      relevant.set(batch.pageBatchId, batch.expectedCount);
      for (const id of batch.taskIds) if (ids.has(id)) coveredTaskIds.add(id);
    }
  }
  if (!relevant.size) return fallback;
  const plannedBatches = [...relevant.values()].reduce((total, count) => total + count, 0);
  const unbatchedTasks = [...ids].filter(id => !coveredTaskIds.has(id)).length;
  return plannedBatches + unbatchedTasks;
}
