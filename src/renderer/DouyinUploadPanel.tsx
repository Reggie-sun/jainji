import { useEffect, useState } from "react";
import { QianchuanClosureConfirmation, QianchuanUploadHistory } from "./QianchuanUploadHistory";
import type { DesktopState } from "../shared/desktop";
import { QianchuanUploadConfigSchema, type DouyinUploadStatus, type QianchuanUploadBatchSummary, type QianchuanUploadResult } from "../shared/douyin-upload";
import "./douyin-upload.css";
import { QianchuanSettingsPage } from "./QianchuanSettingsPage";
import { QianchuanVideoLibraryActions } from "./QianchuanVideoLibraryActions";
import { WorkspacePage } from "./WorkspacePage";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import type { QianchuanPage } from "./QianchuanWorkspace";
import { qianchuanUploadLabels as labels } from "./qianchuan-upload-status";
import { qianchuanTargetName } from "./qianchuan-account-display";
const processingStates: QianchuanUploadResult["state"][] = ["CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"];
const defaultConfig = QianchuanUploadConfigSchema.parse({});
export function DouyinUploadPanel({ projectId, status, onState, page = "uploads", onPage, onAutomation }: {
  projectId: string; status?: DouyinUploadStatus; onState(state: DesktopState): void;
  page?: QianchuanPage; onPage?(page: QianchuanPage): void; onAutomation?(cleanup: QianchuanLibraryClear): void;
}) {
  const [config, setConfig] = useState<DouyinUploadStatus["config"]>(status?.config ?? defaultConfig);
  const key = JSON.stringify(status?.config ?? defaultConfig), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const tasks = status?.tasks.filter(task => task.project_id === projectId && task.state !== "DISCARDED") ?? [];
  const uploaded = tasks.filter(task => ["READY", "ACCEPTED"].includes(task.upload_outcome)).length;
  const pending = tasks.filter(task => task.state === "PENDING").length;
  const processing = tasks.filter(task => processingStates.includes(task.state)).length;
  const historicalBatches = status?.historicalBatches?.filter(batch => batch.projectId === projectId) ?? [];
  const [deleting, setDeleting] = useState<string>();
  const [closing, setClosing] = useState<string>();
  const [feedback, setFeedback] = useState("");
  const [planEdit, setPlanEdit] = useState<{ task: QianchuanUploadResult; sequence: number }>();
  const currentPlan = (task: QianchuanUploadResult) => status?.accounts.find(account => account.available && account.product === task.accountProduct && account.advertiserId === task.advertiserId && account.adId !== task.adId)?.adId;
  useEffect(() => setConfig(status?.config ?? defaultConfig), [key]);
  const perform = async (action: () => Promise<DesktopState>) => {
    if (busy) return false; setBusy(true); setError("");
    try { onState(await action()); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "千川操作未完成，请检查状态。"); return false; }
    finally { setBusy(false); }
  };
  const renderClosureBatches = (batches: QianchuanUploadBatchSummary[]) => batches.map(batch => <div key={batch.pageBatchId} className="brief-card">
    <p>项目 {batch.projectId} · 批次 {batch.pageBatchId} · 计划 {batch.expectedCount} 条 · 已准入 {batch.taskIds.length} 条 · 尚未准入 {batch.expectedCount - batch.taskIds.length} 条 · {qianchuanTargetName(batch.advertiserId, status?.accounts ?? [])} · 账户 {batch.advertiserId} / 计划 {batch.adId} · 已准入结果 READY {batch.readyCount} / UNKNOWN {batch.unknownCount} / 未选 {batch.notSelectedCount} · 平台已接收 {batch.acceptedCount ?? 0}</p>
    <button type="button" disabled={busy || !batch.canClose} onClick={() => setClosing(batch.pageBatchId)}>结束本批本地上传</button>
    {closing === batch.pageBatchId && <QianchuanClosureConfirmation batch={batch} accounts={status?.accounts} busy={busy}
      onConfirm={() => void perform(() => window.jianji.closeDouyinUploadBatch(projectId, batch.taskIds[0]!)).then(done => { if (done) setClosing(undefined); })}
      onCancel={() => setClosing(undefined)} />}
  </div>);
  return <>
    <WorkspacePage active={page === "accounts"} label="账号与计划">
      <QianchuanSettingsPage config={config} status={status} configKey={key} busy={busy} planEdit={planEdit} onConfig={setConfig} onPerform={perform} onFeedback={setFeedback} />
    </WorkspacePage>
    <WorkspacePage active={page === "materials"} label="素材管理">
      <QianchuanVideoLibraryActions accounts={status?.accounts ?? []} busy={busy} onAutomation={onAutomation} />
    </WorkspacePage>
    <WorkspacePage active={page === "uploads"} label="上传任务">
    <section className="card brief-card douyin-upload-panel" aria-labelledby="douyin-upload-panel-title">
    <div className="card-header"><h2 id="douyin-upload-panel-title">千川上传任务</h2><span>普通上传由你确认，定时任务按已保存授权自动确认</span></div>
    <p role={status?.ready ? "status" : "alert"}>{status?.message ?? "上传状态尚未载入。"}</p>
    <button type="button" className="text-button" onClick={() => onPage?.("accounts")}>前往账号与计划</button>
    {!!tasks.length && <p role="status" aria-label="上传进度">已上传 {uploaded} / {tasks.length} 条 · 待上传 {pending} 条 · 处理中 {processing} 条 · 需处理 {tasks.length - uploaded - pending - processing} 条</p>}
    {status?.batches?.length ? renderClosureBatches(status.batches) : null}
    {!!historicalBatches.length && <section aria-label="历史本地上传批次"><h3>历史批次（本次制作之前）</h3>{renderClosureBatches(historicalBatches)}</section>}
    {!!uploaded && <small>已保存上传记录；同一视频在本账号、本计划下不会重复上传，重启后仍有效。</small>}
    <div aria-label="当前项目的千川上传任务">{tasks.map(task => <article key={task.upload_task_id} className="card brief-card">
      <h3>{task.file_name}</h3><p>{qianchuanTargetName(task.advertiserId, status?.accounts ?? [], task.accountProduct)} · 账户 {task.advertiserId} / 计划 {task.adId}</p><p>{labels[task.state]}</p>
      {task.upload_outcome === "READY" && <small>上传记录已保存 · 本计划不会重复上传</small>}
      {currentPlan(task) && <p>本任务保留原计划 {task.adId}；当前保存计划为 {currentPlan(task)}。{task.upload_outcome === "NOT_SELECTED" ? "整批从未选过文件时，可明确改传。" : "已有文件选择记录，不能改传或重传。"}</p>}
      {task.upload_outcome === "MAY_HAVE_UPLOADED" && !processingStates.includes(task.state) && <p>已保存防重传记录；结果未知，禁止重新上传，请核查原页面。</p>}
      {task.acceptedEvidence && <small>平台已接收该计划素材 · 视频 ID {task.acceptedEvidence.platformVideoId} · {task.acceptedEvidence.observedAt}。此状态不表示审核通过或已经产生投放。</small>}
      {task.readyEvidence && <small>已核对文件列表；观察时已选择 {task.readyEvidence.selectedCount} 条。请在任务 Chrome 页面检查并自行确认。浏览器关闭后草稿可能丢失。</small>}
      {task.failure && <><p role="alert">{task.failure.message}</p><small>下一步：{task.failure.next_action}</small></>}
      {!["ACCEPTED", "WAITING_FOR_CONFIRMATION", ...processingStates].includes(task.state) && <div className="douyin-upload-actions"><button type="button" disabled={busy || !status?.accounts.some(account => account.available && account.product === task.accountProduct && account.advertiserId === task.advertiserId)} onClick={() => { setFeedback(""); setPlanEdit(current => ({ task, sequence: (current?.sequence ?? 0) + 1 })); onPage?.("accounts"); }}>更换产品 / 千川计划</button><small>同账户换品时保存新名称和计划链接；保存新计划不会自动重传旧任务。</small></div>}
      {task.state === "ACCEPTED" ? null : task.duplicate_of ? <small>已关联同目标的既有上传记录；没有再次选文件。</small> : <>
        {currentPlan(task) && task.upload_outcome === "NOT_SELECTED" && ["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN"].includes(task.state) && <><button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.retargetDouyinUpload(projectId, task.upload_task_id, currentPlan(task)!))}>本批改传当前计划 {currentPlan(task)}</button><small>更改后仍需点击“安全继续”；已有未知任务的阻塞会保留。</small></>}
        {!["FAILED_TERMINAL", "CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state) && <button type="button" disabled={busy || task.upload_outcome === "NOT_SELECTED" && !!currentPlan(task)} onClick={() => { setFeedback(""); void perform(() => window.jianji.resumeDouyinUpload(projectId, task.upload_task_id)).then(done => { if (done) setFeedback("请求已接收，实际进度见任务状态；接收不代表上传完成或平台确认。"); }); }}>{task.upload_outcome === "NOT_SELECTED" ? "安全继续" : "只读核查页面"}</button>}
        {task.state !== "WAITING_FOR_CONFIRMATION" && <button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.stopDouyinUpload(projectId, task.upload_task_id))}>停止任务</button>}
        {["PENDING", "NEEDS_HUMAN", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"].includes(task.state) && <button type="button" disabled={busy} onClick={() => setDeleting(task.upload_task_id)}>删除本批上传任务</button>}
        {deleting === task.upload_task_id && <div role="group" aria-label="确认删除本批上传任务"><p>永久删除这一整批上传任务，不能恢复。本地成片保留；结果未知文件的防重传记录仍有效。</p><button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.discardDouyinUploadBatch(projectId, task.upload_task_id)).then(done => { if (done) setDeleting(undefined); })}>确认删除整批</button><button type="button" disabled={busy} onClick={() => setDeleting(undefined)}>保留任务</button></div>}
      </>}
    </article>)}{!tasks.length && <p>当前项目没有千川上传任务。</p>}</div>
    <QianchuanUploadHistory batches={status?.closedBatches} accounts={status?.accounts} />
    {!!status?.legacyTasks.length && <details><summary>旧创作者中心记录（只读）</summary>{status.legacyTasks.map(task => <p key={task.upload_task_id}>{task.file_name} · {task.state} · {task.publish_outcome}</p>)}</details>}
    </section>
    </WorkspacePage>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
  </>;
}
