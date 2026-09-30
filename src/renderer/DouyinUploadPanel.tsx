import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { QianchuanUploadConfigSchema, type DouyinUploadStatus, type QianchuanUploadResult } from "../shared/douyin-upload";
import "./douyin-upload.css";
import { QianchuanAccountSettings } from "./QianchuanAccountSettings";
import { qianchuanUploadLabels as labels } from "./qianchuan-upload-status";
import { qianchuanProductName } from "../shared/qianchuan-account";
const processingStates: QianchuanUploadResult["state"][] = ["CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"];
const defaultConfig = QianchuanUploadConfigSchema.parse({});
export function DouyinUploadPanel({ projectId, status, onState }: { projectId: string; status?: DouyinUploadStatus; onState(state: DesktopState): void; }) {
  const [config, setConfig] = useState<DouyinUploadStatus["config"]>(status?.config ?? defaultConfig);
  const key = JSON.stringify(status?.config ?? defaultConfig), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const tasks = status?.tasks.filter(task => task.project_id === projectId) ?? [];
  const uploaded = tasks.filter(task => task.upload_outcome === "READY").length;
  const pending = tasks.filter(task => task.state === "PENDING").length;
  const processing = tasks.filter(task => processingStates.includes(task.state)).length;
  const currentPlan = (task: QianchuanUploadResult) => status?.accounts.find(account => account.available && account.product === task.accountProduct && account.advertiserId === task.advertiserId && account.adId !== task.adId)?.adId;
  useEffect(() => setConfig(status?.config ?? defaultConfig), [key]);
  const perform = async (action: () => Promise<DesktopState>) => {
    if (busy) return false; setBusy(true); setError("");
    try { onState(await action()); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "千川操作未完成，请检查状态。"); return false; }
    finally { setBusy(false); }
  };
  return <section className="card brief-card douyin-upload-panel" aria-labelledby="douyin-upload-panel-title">
    <div className="card-header"><h2 id="douyin-upload-panel-title">千川上传任务</h2><span>上传完成后由你确认</span></div>
    <p role={status?.ready ? "status" : "alert"}>{status?.message ?? "上传状态尚未载入。"}</p>
    <div className="brief-card">
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))} />启用千川上传</label>
      <small>选好本次账号，正式成片导出后由程序自动上传；每组最多 9 条，全部成功后继续。</small>
      <QianchuanAccountSettings accounts={status?.accounts} busy={busy} onSave={input => perform(() => window.jianji.saveQianchuanAccount(input))} />
      <details className="douyin-upload-advanced"><summary>高级设置</summary>
        <p>通常无需调整，遇到上传问题时再使用。</p>
        <div className="douyin-upload-actions">
          <button className="button secondary compact" type="button" disabled={busy} onClick={() => void perform(() => window.jianji.selectQianchuanAccountConfig())}>导入已有账号配置</button>
          <button className="button secondary compact" type="button" disabled={busy || !status?.configSelected} onClick={() => void perform(() => window.jianji.refreshQianchuanAccounts())}>刷新账号摘要</button>
        </div>
        {status?.accounts.map(account => <p key={account.product}>{qianchuanProductName(account.product, status.accounts)} · {account.available ? `账户 ${account.advertiserId} / 计划 ${account.adId}` : "缺少可用配置"}</p>)}
        <fieldset disabled={busy}><legend>操作时限（毫秒）</legend>{(Object.keys(config.timeouts) as (keyof typeof config.timeouts)[]).map(field => <label key={field}>{({ connect: "连接", navigation: "页面加载", fileInput: "文件选择", processing: "平台处理", action: "页面操作", confirmation: "只读核查" })[field]}<input type="number" min={1} value={config.timeouts[field]} onChange={event => setConfig(current => ({ ...current, timeouts: { ...current.timeouts, [field]: event.target.valueAsNumber } }))} /></label>)}</fieldset>
        <label><input type="checkbox" checked={config.captureFailureDiagnostics} disabled={busy} onChange={event => setConfig(current => ({ ...current, captureFailureDiagnostics: event.target.checked }))} />保存有限本机诊断</label>
      </details>
      <div className="douyin-upload-actions">
        <button className="button primary compact" type="button" disabled={busy} onClick={() => void perform(() => window.jianji.saveDouyinUploadConfig(config))}>保存上传设置</button>
        {JSON.stringify(config) !== key && <small>有未保存的修改</small>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    {!!tasks.length && <p role="status" aria-label="上传进度">已上传 {uploaded} / {tasks.length} 条 · 待上传 {pending} 条 · 处理中 {processing} 条 · 需处理 {tasks.length - uploaded - pending - processing} 条</p>}
    {!!uploaded && <small>已保存上传记录；同一视频在本账号、本计划下不会重复上传，重启后仍有效。</small>}
    <div aria-label="当前项目的千川上传任务">{tasks.map(task => <article key={task.upload_task_id} className="card brief-card">
      <h3>{task.file_name}</h3><p>{task.accountProduct} · 账户 {task.advertiserId} / 计划 {task.adId}</p><p>{labels[task.state]}</p>
      {task.upload_outcome === "READY" && <small>上传记录已保存 · 本计划不会重复上传</small>}
      {currentPlan(task) && <p>本任务保留原计划 {task.adId}；当前保存计划为 {currentPlan(task)}。{task.upload_outcome === "NOT_SELECTED" ? "整批从未选过文件时，可明确改传。" : "已有文件选择记录，不能改传或重传。"}</p>}
      {task.upload_outcome === "MAY_HAVE_UPLOADED" && !processingStates.includes(task.state) && <p>已保存防重传记录；结果未知，禁止重新上传，请核查原页面。</p>}
      {task.readyEvidence && <small>已核对文件列表；观察时已选择 {task.readyEvidence.selectedCount} 条。请在任务 Chrome 页面检查并自行确认。浏览器关闭后草稿可能丢失。</small>}
      {task.failure && <><p role="alert">{task.failure.message}</p><small>下一步：{task.failure.next_action}</small></>}
      {task.duplicate_of ? <small>已关联同目标的既有上传记录；没有再次选文件。</small> : <>
        {currentPlan(task) && task.upload_outcome === "NOT_SELECTED" && ["PENDING", "FAILED_RETRYABLE", "NEEDS_HUMAN"].includes(task.state) && <><button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.retargetDouyinUpload(projectId, task.upload_task_id, currentPlan(task)!))}>本批改传当前计划 {currentPlan(task)}</button><small>更改后仍需点击“安全继续”；已有未知任务的阻塞会保留。</small></>}
        {!["FAILED_TERMINAL", "CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state) && <button type="button" disabled={busy || task.upload_outcome === "NOT_SELECTED" && !!currentPlan(task)} onClick={() => void perform(() => window.jianji.resumeDouyinUpload(projectId, task.upload_task_id))}>{task.upload_outcome === "NOT_SELECTED" ? "安全继续" : "只读核查页面"}</button>}
        {task.state !== "WAITING_FOR_CONFIRMATION" && <button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.stopDouyinUpload(projectId, task.upload_task_id))}>停止任务</button>}
      </>}
    </article>)}{!tasks.length && <p>当前项目没有千川上传任务。</p>}</div>
    {!!status?.legacyTasks.length && <details><summary>旧创作者中心记录（只读）</summary>{status.legacyTasks.map(task => <p key={task.upload_task_id}>{task.file_name} · {task.state} · {task.publish_outcome}</p>)}</details>}
  </section>;
}
