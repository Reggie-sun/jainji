import type { QianchuanClosedBatchSummary, QianchuanUploadBatchSummary } from "../shared/douyin-upload";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { qianchuanTargetName } from "./qianchuan-account-display";
import { qianchuanUploadLabels } from "./qianchuan-upload-status";

export function QianchuanClosureConfirmation({ batch, accounts = [], busy, onConfirm, onCancel }: { batch: QianchuanUploadBatchSummary; accounts?: QianchuanAccountSummary[]; busy: boolean; onConfirm(): void; onCancel(): void }) {
  return <div role="group" aria-label="确认结束本批本地上传">
    <p>项目 {batch.projectId} · {qianchuanTargetName(batch.advertiserId, accounts)} · 账户 {batch.advertiserId} / 计划 {batch.adId}</p>
    <p>批次 {batch.pageBatchId} · 计划 {batch.expectedCount} 条 · 已准入 {batch.taskIds.length} 条 · 尚未准入 {batch.expectedCount - batch.taskIds.length} 条 · 已准入结果 READY {batch.readyCount} 条 / UNKNOWN {batch.unknownCount} 条 / 未选 {batch.notSelectedCount} 条 · 平台已接收 {batch.acceptedCount ?? 0} 条</p>
    <p>结束后，已准入的未选任务与尚未准入成员都永久失去本批上传资格，不能恢复。尚未准入成员不代表已上传。视频、原结果及防重传历史全部保留；平台结果不变，不代表已确认或发布。其他批次需另行明确继续。</p>
    <button type="button" disabled={busy || !batch.canClose} onClick={onConfirm}>确认结束本批本地上传</button>
    <button type="button" disabled={busy} onClick={onCancel}>保留本批</button>
  </div>;
}

export function QianchuanUploadHistory({ batches, accounts = [] }: { batches?: QianchuanClosedBatchSummary[]; accounts?: QianchuanAccountSummary[] }) {
  if (!batches?.length) return null;
  return <section aria-label="已结束的本地上传历史">
    <h3>已结束的本地上传历史（只读）</h3>
    {batches.map(batch => <details key={batch.pageBatchId}>
      <summary>本地上传已结束 · 计划 {batch.expectedCount} / 已准入 {batch.taskIds.length} / 尚未准入 {batch.expectedCount - batch.taskIds.length} · 原 READY {batch.readyCount} / UNKNOWN {batch.unknownCount} / 未选 {batch.notSelectedCount} · 平台已接收 {batch.acceptedCount ?? 0}</summary>
      <p>项目 {batch.projectId} · {qianchuanTargetName(batch.advertiserId, accounts)} · 账户 {batch.advertiserId} / 计划 {batch.adId} · 批次 {batch.pageBatchId}</p>
      <p>结束时间 {batch.closedAt}。尚未准入仅表示没有本地上传任务，不推断平台结果；本批不再执行，原结果保留。平台结果不变，防重传记录继续有效。</p>
      {batch.tasks.map(task => <div key={task.upload_task_id}><strong>{task.file_name}</strong><p>原结果：{qianchuanUploadLabels[task.state]} · {task.upload_outcome}</p>
        {task.acceptedEvidence && <small>原平台接收回执 {task.acceptedEvidence.observedAt} · 视频 ID {task.acceptedEvidence.platformVideoId}</small>}
        {task.failure && <small>{task.failure.message} {task.failure.next_action}</small>}
        {task.readyEvidence && <small>原 READY 观察时间 {task.readyEvidence.observedAt} · 当时已选择 {task.readyEvidence.selectedCount} 条</small>}
      </div>)}
    </details>)}
  </section>;
}
