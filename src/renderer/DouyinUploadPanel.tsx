import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import {
  DouyinUploadConfigSchema,
  UploadSuccessSchema,
  type DouyinUploadConfig,
  type DouyinUploadStatus,
  type UploadResult,
  type UploadState,
} from "../shared/douyin-upload";

const defaultConfig = DouyinUploadConfigSchema.parse({});
const uploadStateLabels: Record<UploadState, string> = {
  PENDING: "等待上传",
  CONNECTING_BROWSER: "连接浏览器",
  OPENING_UPLOAD_PAGE: "打开上传页面",
  UPLOADING: "上传文件",
  WAITING_UPLOAD_COMPLETE: "等待平台处理",
  SUBMITTING: "提交发布",
  VERIFYING: "核查发布结果",
  SUCCEEDED: "已确认接受",
  FAILED_RETRYABLE: "可继续处理",
  FAILED_TERMINAL: "已停止",
  NEEDS_HUMAN: "需要人工处理",
  CANCELLED: "已停止",
};
const publishOutcomeLabels = {
  NOT_SUBMITTED: "尚未提交",
  MAY_HAVE_SUBMITTED: "可能已提交，需要核查",
  ACCEPTED: "平台已接受",
  REJECTED_KNOWN: "平台已拒绝",
} as const;
const timeoutFields: { key: keyof DouyinUploadConfig["timeouts"]; label: string }[] = [
  { key: "connect", label: "连接超时（毫秒）" },
  { key: "navigation", label: "页面加载超时（毫秒）" },
  { key: "fileInput", label: "文件选择超时（毫秒）" },
  { key: "processing", label: "平台处理超时（毫秒）" },
  { key: "action", label: "页面操作超时（毫秒）" },
  { key: "confirmation", label: "结果核查总时限（毫秒）" },
];

export function DouyinUploadPanel({ projectId, status, onState }: {
  projectId: string;
  status?: DouyinUploadStatus;
  onState(state: DesktopState): void;
}) {
  const [config, setConfig] = useState<DouyinUploadConfig>(() => status?.config ?? defaultConfig);
  const configKey = JSON.stringify(status?.config ?? defaultConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tasks = status?.tasks.filter((task) => task.project_id === projectId) ?? [];

  useEffect(() => setConfig(status?.config ?? defaultConfig), [configKey]);

  const perform = async (action: () => Promise<DesktopState>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { onState(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "抖音上传操作未完成，请检查任务状态后重试。"); }
    finally { setBusy(false); }
  };
  const updateConfig = <K extends keyof DouyinUploadConfig>(key: K, value: DouyinUploadConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));

  return <section className="card brief-card" aria-labelledby="douyin-upload-panel-title">
    <div className="card-header"><h2 id="douyin-upload-panel-title">抖音上传任务</h2><span>独立于本地导出</span></div>
    {status
      ? <p role={status.ready ? "status" : "alert"}>{status.ready ? "上传前置条件已就绪。" : status.message}</p>
      : <p role="status">上传状态尚未载入；当前没有可确认的上传准备状态。</p>}
    <div className="brief-card">
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={(event) => updateConfig("enabled", event.target.checked)} />启用抖音上传</label>
      <small>此设置不会替制作请求授权发布；每次制作仍需单独选择。</small>
      <label htmlFor="douyin-upload-cdp">本机 Chrome CDP 地址</label>
      <div className="model-picker"><input id="douyin-upload-cdp" type="url" value={config.cdpEndpoint} disabled={busy} onChange={(event) => updateConfig("cdpEndpoint", event.target.value)} /></div>
      <small>由你启动并登录 Chrome；应用使用这里配置的本机 CDP 地址。</small>
      <label htmlFor="douyin-upload-page">已核实的创作者后台上传页</label>
      <div className="model-picker"><input id="douyin-upload-page" type="url" value={config.uploadPageUrl ?? ""} disabled={busy} onChange={(event) => updateConfig("uploadPageUrl", event.target.value || undefined)} /></div>
      <small>未核实的页面合同会保持未就绪；请勿填写猜测的页面地址。</small>
      <fieldset disabled={busy}>
        <legend>操作时限</legend>
        {timeoutFields.map(({ key, label }) => <label key={key} htmlFor={`douyin-upload-timeout-${key}`}>{label}<input id={`douyin-upload-timeout-${key}`} type="number" min={1} step={1} value={config.timeouts[key]} onChange={(event) => setConfig((current) => ({ ...current, timeouts: { ...current.timeouts, [key]: event.target.valueAsNumber } }))} /></label>)}
      </fieldset>
      <label><input type="checkbox" checked={config.captureFailureDiagnostics} disabled={busy} onChange={(event) => updateConfig("captureFailureDiagnostics", event.target.checked)} />保存有限的失败诊断</label>
      <small>当前只保留本机结构化记录；页面脱敏未核实，暂不采集截图或完整页面。</small>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void perform(() => window.jianji.saveDouyinUploadConfig(config))}>{busy ? "正在保存…" : "保存上传设置"}</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div aria-label="当前项目的抖音上传任务">
      {tasks.length === 0
        ? <p>当前项目还没有上传任务。</p>
        : tasks.map((task) => <DouyinUploadTask key={task.upload_task_id} task={task} projectId={projectId} busy={busy} onAction={(action) => void perform(action)} />)}
    </div>
  </section>;
}

function DouyinUploadTask({ task, projectId, busy, onAction }: {
  task: UploadResult;
  projectId: string;
  busy: boolean;
  onAction(action: () => Promise<DesktopState>): void;
}) {
  const [caption, setCaption] = useState("");
  const [contentId, setContentId] = useState("");
  const [acceptedStatus, setAcceptedStatus] = useState<"reviewing" | "published">("reviewing");
  const [detailUrl, setDetailUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [formError, setFormError] = useState("");
  const terminal = ["SUCCEEDED", "FAILED_TERMINAL", "CANCELLED"].includes(task.state);
  const mayHaveSubmitted = task.publish_outcome === "MAY_HAVE_SUBMITTED";
  const canContinue = !task.duplicate_of && (mayHaveSubmitted || ["PENDING", "FAILED_RETRYABLE", "VERIFYING", "NEEDS_HUMAN", "CANCELLED"].includes(task.state));
  const canReviseCaption = !task.duplicate_of && task.publish_outcome === "NOT_SUBMITTED" && task.state === "NEEDS_HUMAN";
  const canConfirm = !task.duplicate_of && mayHaveSubmitted;
  const prefix = `douyin-upload-${task.upload_task_id}`;

  const confirmAccepted = () => {
    const parsed = UploadSuccessSchema.safeParse({
      platform_content_id: contentId,
      accepted_status: acceptedStatus,
      url: detailUrl,
      observed_at: new Date().toISOString(),
      confirmation_source: "human",
      evidence,
    });
    if (!parsed.success) {
      setFormError("请填写有效的 content ID、对应的创作者后台详情页 URL 和实际观察依据。");
      return;
    }
    setFormError("");
    onAction(() => window.jianji.confirmDouyinUpload(projectId, task.upload_task_id, parsed.data));
  };

  return <article className="card brief-card" aria-label={`抖音上传任务 ${task.file_name}`}>
    <div className="card-header"><h2>{task.file_name}</h2><div className="row-actions">
      {canContinue && <button type="button" className="button secondary compact" disabled={busy} onClick={() => onAction(() => window.jianji.resumeDouyinUpload(projectId, task.upload_task_id))}>{mayHaveSubmitted ? "只读核查 / 人工处理" : "继续处理"}</button>}
      {!terminal && !task.duplicate_of && <button type="button" className="text-button muted" disabled={busy} onClick={() => onAction(() => window.jianji.stopDouyinUpload(projectId, task.upload_task_id))}>停止任务</button>}
    </div></div>
    <p>{uploadStateLabels[task.state]} · {publishOutcomeLabels[task.publish_outcome]}</p>
    {task.success && <small>平台状态：{task.success.accepted_status === "reviewing" ? "审核中" : "已发布"} · content ID：{task.success.platform_content_id}</small>}
    {task.failure && <><p role={task.failure.requires_human ? "alert" : "status"}>{task.failure.message}</p><small>下一步：{task.failure.next_action}</small></>}
    {task.duplicate_of && <small>已关联既有结果：{task.duplicate_of}</small>}
    {canReviseCaption && <div className="brief-card">
      <label htmlFor={`${prefix}-caption`}>修正文案（尚未提交）</label>
      <textarea id={`${prefix}-caption`} rows={3} maxLength={4096} value={caption} disabled={busy} onChange={(event) => setCaption(event.target.value)} />
      <button type="button" className="button secondary compact" disabled={busy || !caption.trim()} onClick={() => onAction(() => window.jianji.reviseDouyinUploadCaption(projectId, task.upload_task_id, caption))}>保存文案</button>
    </div>}
    {canConfirm && <div className="brief-card">
      <h3>人工确认平台已接受</h3>
      <p>请先打开同一作品的创作者后台详情页，核对 content ID 和页面状态，再填写你实际观察到的证据。系统会把确认来源记录为人工。</p>
      <label htmlFor={`${prefix}-content-id`}>平台 content ID</label>
      <div className="model-picker"><input id={`${prefix}-content-id`} value={contentId} maxLength={128} disabled={busy} onChange={(event) => setContentId(event.target.value)} /></div>
      <label htmlFor={`${prefix}-accepted-status`}>后台显示状态</label>
      <select id={`${prefix}-accepted-status`} value={acceptedStatus} disabled={busy} onChange={(event) => setAcceptedStatus(event.target.value as "reviewing" | "published")}><option value="reviewing">审核中</option><option value="published">已发布</option></select>
      <label htmlFor={`${prefix}-detail-url`}>同一 content ID 的创作者后台详情页 URL</label>
      <div className="model-picker"><input id={`${prefix}-detail-url`} type="url" value={detailUrl} disabled={busy} onChange={(event) => setDetailUrl(event.target.value)} /></div>
      <label htmlFor={`${prefix}-evidence`}>实际观察依据</label>
      <textarea id={`${prefix}-evidence`} rows={3} maxLength={500} value={evidence} disabled={busy} onChange={(event) => setEvidence(event.target.value)} />
      {formError && <p role="alert">{formError}</p>}
      <button type="button" className="button primary compact" disabled={busy || !contentId || !detailUrl || !evidence.trim()} onClick={confirmAccepted}>确认此作品已被平台接受</button>
    </div>}
  </article>;
}
