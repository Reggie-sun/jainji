import { useState } from "react";
import type { QianchuanUnselectedContinuation as Continuation, QianchuanUploadBatchSummary } from "../shared/douyin-upload";

export function QianchuanUnselectedContinuation({ batch, busy, onConfirm }: {
  batch: QianchuanUploadBatchSummary; busy: boolean; onConfirm(input: Continuation): void;
}) {
  const [submitted, setSubmitted] = useState(false), next = batch.unselectedContinuation;
  if (!next) return null;
  return <details>
    <summary>手动提交后，接续剩余 {next.count} 条</summary>
    <p>保留原来 {next.submittedTaskIds.length} 条的上传记录；本次只上传剩余 {next.count} 条，继续使用账户 {batch.advertiserId} / 计划 {batch.adId}。</p>
    <label><input type="checkbox" checked={submitted} disabled={busy} onChange={event => setSubmitted(event.target.checked)} />我已在千川提交原来的 {next.submittedTaskIds.length} 条</label>
    <button type="button" disabled={busy || !batch.canClose || !submitted} onClick={() => onConfirm({ projectId: batch.projectId,
      uploadTaskId: next.uploadTaskId, expectedPageBatchId: batch.pageBatchId, expectedUnselectedCount: next.count,
      submittedTaskIds: next.submittedTaskIds, confirmation: "CONTINUE_UNSELECTED" })}>接续剩余 {next.count} 条</button>
  </details>;
}
