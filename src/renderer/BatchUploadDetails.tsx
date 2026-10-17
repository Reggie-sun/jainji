import { useState } from "react";
import type { BatchProductionDetail, BatchProductionDetailRequest } from "../shared/batch-production";
import { Heading } from "./ui";
import { qianchuanDuplicate, qianchuanDuplicateNote, qianchuanPlannedUploadCount, qianchuanUploaded, qianchuanUploadLabel } from "./qianchuan-upload-status";
import { QianchuanUploadHistory } from "./QianchuanUploadHistory";
import { qianchuanTargetName } from "./qianchuan-account-display";
import { batchDetailError, useBatchProductionDetails } from "./useBatchProductionDetails";

export interface BatchUploadContext extends BatchProductionDetailRequest { name: string }

export function BatchUploadDetails({ request, active }: { request: BatchUploadContext; active: boolean }) {
  const { detail, error } = useBatchProductionDetails(request, active);
  const [uploadError, setUploadError] = useState("");
  const [resuming, setResuming] = useState(false);
  const resume = async (uploadTaskId: string, historicalPageBatchId?: string) => {
    if (resuming) return;
    setResuming(true); setUploadError("");
    try { await window.jianji.resumeBatchUpload({ runId: request.runId, jobId: request.jobId, uploadTaskId, ...(historicalPageBatchId ? { historicalPageBatchId } : {}) }); }
    catch (cause) { setUploadError(batchDetailError(cause)); }
    finally { setResuming(false); }
  };
  return <>
    <Heading title={`${request.name} · 上传任务`}>查看本批成片的上传状态；每条记录保留制作时的账号和计划。</Heading>
    {error && <p className="notice error" role="alert">{error}</p>}
    {uploadError && <p className="notice error" role="alert">{uploadError}</p>}
    {detail ? <BatchUploadList detail={detail} onResumeUpload={(id, batchId) => void resume(id, batchId)} resuming={resuming} /> : !error && <p role="status">正在读取上传任务…</p>}
  </>;
}

export function BatchUploadList({ detail, onResumeUpload, resuming }: { detail: BatchProductionDetail; onResumeUpload?(id: string, historicalPageBatchId?: string): void; resuming?: boolean }) {
  const { job, upload } = detail;
  const tasks = upload?.tasks ?? [];
  const accounts = upload?.accounts ?? [];
  const accountIds = [...new Set([...tasks, ...(upload?.closedBatches ?? [])].map(target => target.advertiserId).filter(Boolean))];
  const duplicates = tasks.filter(qianchuanDuplicate).length;
  const activeTasks = tasks.filter(task => !qianchuanDuplicate(task));
  const active = activeTasks.filter(task => ["CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state));
  const blockingActive = tasks.filter(task => ["CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state));
  const processing = active.filter(task => !qianchuanUploaded(task));
  const uploaded = activeTasks.filter(qianchuanUploaded).length;
  const pending = activeTasks.filter(task => task.state === "PENDING").length;
  const unknown = activeTasks.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED" && !active.includes(task)).length;
  const blockingUnknown = tasks.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED" && !blockingActive.includes(task)).length;
  const planned = qianchuanPlannedUploadCount(tasks, upload?.closedBatches ?? [], job.actualCount || job.requestedCount);
  return <section className="card brief-card" aria-label="本项千川上传">
    <div className="card-header"><h2>千川上传 · {accountIds.length ? accountIds.map(id => `${qianchuanTargetName(id, accounts, job.accountProduct)}（账户 ${id}）`).join("、") : "等待账号任务"}</h2><span>导出与上传进度分别记录</span></div>
    <p role="status" aria-label="本项上传进度">已上传 {uploaded} / {planned} 条 · 重复跳过 {duplicates} 条 · 待上传 {pending} 条 · 处理中 {processing.length} 条 · 结果未知 {unknown} 条 · 需处理 {activeTasks.length - uploaded - pending - processing.length - unknown} 条 · 整批就绪后自动确认</p>
    <small>上传记录会保存，同账号同计划下不重复上传。所有入口整批就绪后自动确认，以平台接收回执为准；结果未知时停止并保留原页面。</small>
    {upload?.message && <p>{upload.message}</p>}
    {onResumeUpload && upload?.recoverableBatches?.map(batch => <div key={batch.pageBatchId} className="result-row">
      <div className="result-info"><strong>恢复 {batch.count} 条未上传成片</strong><p>原账户 {batch.advertiserId} / 原计划 {batch.adId} · 核验通过后继续上传并在整批就绪后自动确认</p></div>
      <button type="button" className="button secondary" disabled={resuming || blockingActive.length > 0 || blockingUnknown > 0} onClick={() => onResumeUpload(batch.uploadTaskId, batch.pageBatchId)}>恢复本批上传</button>
    </div>)}
    {!!unknown && <p className="notice error" role="alert">{unknown} 条上传结果未知，需核查原 Chrome 上传页面；这些文件禁止重新上传。尚未选文件的成片仍保留在队列中。</p>}
    {!job.accountProduct && <p>本项制作未选择千川上传。</p>}
    {job.accountProduct && !tasks.length && !upload?.closedBatches?.length && <p>尚无已准入的上传任务；制作完成后由原上传服务处理。若上传受阻，请核对上方状态和账号配置。</p>}
    {tasks.map(task => <div className="result-row" key={task.upload_task_id}>
      <div className="result-info"><strong>{task.file_name}</strong><p>{qianchuanUploadLabel(task)} · {qianchuanTargetName(task.advertiserId, accounts, task.accountProduct)} · 账户 {task.advertiserId} / 计划 {task.adId}</p>
        {qianchuanDuplicate(task) ? <small>{qianchuanDuplicateNote(task)}</small> : <>
        {task.failure && <small className="batch-error">{task.failure.message} {task.failure.next_action}</small>}
        {!!task.attempt_count && <small>上传已启动 {task.attempt_count} 次{task.retry_count ? ` · 连接 / 准备已重试 ${task.retry_count} 次` : ""}；启动不表示已选文件或上传成功。</small>}
        {task.upload_outcome === "READY" && <small>上传记录已保存 · 等待确认</small>}
        {task.acceptedEvidence && <small>平台已接收 · 视频 ID {task.acceptedEvidence.platformVideoId} · 不表示审核通过或已经产生投放</small>}
        {task.upload_outcome === "MAY_HAVE_UPLOADED" && !active.includes(task) && <small>结果未知，禁止重新上传，请核查原页面。</small>}
        </>}
      </div>
      {onResumeUpload && !upload?.historical && !task.duplicate_of && ["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN", "CANCELLED"].includes(task.state) &&
        <button type="button" className="button secondary compact" disabled={resuming || blockingActive.length > 0 || (blockingUnknown > 0 && task.upload_outcome === "NOT_SELECTED")} onClick={() => onResumeUpload(task.upload_task_id)}>{task.upload_outcome === "MAY_HAVE_UPLOADED" ? "核查原上传页" : "安全继续"}</button>}
    </div>)}
    <QianchuanUploadHistory batches={upload?.closedBatches} accounts={accounts} />
  </section>;
}
