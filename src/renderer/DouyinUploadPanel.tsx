import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { QianchuanUploadConfigSchema, type DouyinUploadStatus, type QianchuanUploadResult } from "../shared/douyin-upload";
import "./douyin-upload.css";

const labels: Record<QianchuanUploadResult["state"], string> = {
  PENDING: "等待上传", CONNECTING_BROWSER: "连接浏览器", OPENING_UPLOAD_PAGE: "打开千川计划", UPLOADING: "上传文件", WAITING_UPLOAD_COMPLETE: "等待平台处理",
  WAITING_FOR_CONFIRMATION: "上传完成，待在 Chrome 确认", FAILED_RETRYABLE: "可明确继续", FAILED_TERMINAL: "已停止", NEEDS_HUMAN: "需要人工处理", CANCELLED: "已停止",
};
const defaultConfig = QianchuanUploadConfigSchema.parse({});
export function DouyinUploadPanel({ projectId, status, onState }: { projectId: string; status?: DouyinUploadStatus; onState(state: DesktopState): void; }) {
  const [config, setConfig] = useState<DouyinUploadStatus["config"]>(status?.config ?? defaultConfig);
  const key = JSON.stringify(status?.config ?? defaultConfig), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => setConfig(status?.config ?? defaultConfig), [key]);
  const perform = async (action: () => Promise<DesktopState>) => {
    if (busy) return; setBusy(true); setError("");
    try { onState(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "千川操作未完成，请检查状态。"); }
    finally { setBusy(false); }
  };
  return <section className="card brief-card douyin-upload-panel" aria-labelledby="douyin-upload-panel-title">
    <div className="card-header"><h2 id="douyin-upload-panel-title">千川上传任务</h2><span>上传完成后由你确认</span></div>
    <p role={status?.ready ? "status" : "alert"}>{status?.message ?? "上传状态尚未载入。"}</p>
    <div className="brief-card">
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))} />启用千川上传</label>
      <small>每次制作时选择上传账号；每组最多 9 条。</small>
      <p>{status?.configSelected ? "账号配置已就绪" : "首次使用，请选择账号配置文件。"}</p>
      <div className="douyin-upload-actions">
        <button className="button secondary compact" type="button" disabled={busy} onClick={() => void perform(() => window.jianji.selectQianchuanAccountConfig())}>选择账号配置文件</button>
        <button className="button secondary compact" type="button" disabled={busy || !status?.configSelected} onClick={() => void perform(() => window.jianji.refreshQianchuanAccounts())}>刷新账号摘要</button>
      </div>
      {status?.accounts.map(account => <p key={account.product}>{account.product} · {account.available ? `账户 ${account.advertiserId} / 计划 ${account.adId}` : "缺少可用配置"}</p>)}
      <details className="douyin-upload-advanced"><summary>高级设置</summary>
        <p>通常无需调整，遇到上传问题时再使用。</p>
        <fieldset disabled={busy}><legend>操作时限（毫秒）</legend>{(Object.keys(config.timeouts) as (keyof typeof config.timeouts)[]).map(field => <label key={field}>{({ connect: "连接", navigation: "页面加载", fileInput: "文件选择", processing: "平台处理", action: "页面操作", confirmation: "只读核查" })[field]}<input type="number" min={1} value={config.timeouts[field]} onChange={event => setConfig(current => ({ ...current, timeouts: { ...current.timeouts, [field]: event.target.valueAsNumber } }))} /></label>)}</fieldset>
        <label><input type="checkbox" checked={config.captureFailureDiagnostics} disabled={busy} onChange={event => setConfig(current => ({ ...current, captureFailureDiagnostics: event.target.checked }))} />保存有限本机诊断</label>
      </details>
      <div className="douyin-upload-actions">
        <button className="button primary compact" type="button" disabled={busy} onClick={() => void perform(() => window.jianji.saveDouyinUploadConfig(config))}>保存上传设置</button>
        {JSON.stringify(config) !== key && <small>有未保存的修改</small>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div aria-label="当前项目的千川上传任务">{status?.tasks.filter(task => task.project_id === projectId).map(task => <article key={task.upload_task_id} className="card brief-card">
      <h3>{task.file_name}</h3><p>{task.accountProduct} · 账户 {task.advertiserId} / 计划 {task.adId}</p><p>{labels[task.state]}</p>
      {task.readyEvidence && <small>已核对文件列表；观察时已选择 {task.readyEvidence.selectedCount} 条。请在任务 Chrome 页面检查并自行确认。浏览器关闭后草稿可能丢失。</small>}
      {task.failure && <><p role="alert">{task.failure.message}</p><small>下一步：{task.failure.next_action}</small></>}
      {task.duplicate_of ? <small>已关联同目标的既有上传记录；没有再次选文件。</small> : <>
        {!["FAILED_TERMINAL", "CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state) && <button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.resumeDouyinUpload(projectId, task.upload_task_id))}>{task.upload_outcome === "NOT_SELECTED" ? "安全继续" : "只读核查页面"}</button>}
        {task.state !== "WAITING_FOR_CONFIRMATION" && <button type="button" disabled={busy} onClick={() => void perform(() => window.jianji.stopDouyinUpload(projectId, task.upload_task_id))}>停止任务</button>}
      </>}
    </article>) ?? <p>当前项目没有千川上传任务。</p>}</div>
    {!!status?.legacyTasks.length && <details><summary>旧创作者中心记录（只读）</summary>{status.legacyTasks.map(task => <p key={task.upload_task_id}>{task.file_name} · {task.state} · {task.publish_outcome}</p>)}</details>}
  </section>;
}
