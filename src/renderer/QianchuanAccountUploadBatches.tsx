import { useState } from "react";
import type { DouyinUploadStatus, QianchuanUploadBatchSummary } from "../shared/douyin-upload";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanClosureConfirmation } from "./QianchuanUploadHistory";
import { qianchuanTargetName } from "./qianchuan-account-display";

export function QianchuanAccountUploadBatches({ batches = [], accounts, busy, expanded = false, onClose }: {
  batches?: DouyinUploadStatus["accountBatches"]; accounts: QianchuanAccountSummary[]; busy: boolean;
  expanded?: boolean;
  onClose(batch: QianchuanUploadBatchSummary): Promise<boolean>;
}) {
  const [closing, setClosing] = useState<string>();
  if (!batches.length) return null;
  return <details className="douyin-upload-advanced" open={expanded}>
    <summary>查看未结束上传（{batches.length} 批）</summary>
    <p>这些历史批次会阻止切换上传方式。核查原上传页面后，可逐批明确结束本地上传；视频和防重传记录保留。</p>
    {batches.map(batch => <div key={batch.pageBatchId} className="brief-card">
      <p>{qianchuanTargetName(batch.advertiserId, accounts)} · 计划 {batch.adId} · 待确认 {batch.readyCount} 条 / 结果未知 {batch.unknownCount} 条 / 未选文件 {batch.notSelectedCount} 条</p>
      <button type="button" disabled={busy || !batch.canClose} onClick={() => setClosing(batch.pageBatchId)}>结束本批本地上传</button>
      {!batch.canClose && <small>本批正在处理或尚不满足结束条件，请保留原页面并核查上传任务。</small>}
      {closing === batch.pageBatchId && <QianchuanClosureConfirmation batch={batch} accounts={accounts} busy={busy}
        onConfirm={() => void onClose(batch).then(done => { if (done) setClosing(undefined); })}
        onCancel={() => setClosing(undefined)} />}
    </div>)}
  </details>;
}
