import { useEffect, useLayoutEffect, useState } from "react";
import { AutomationRequestSchema, type AutomationRun, type AutomationStatus, type AutomationTask } from "../shared/automation";
import type { BatchProductionStart } from "../shared/batch-production";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import "./automation.css";

type AutomationComposerProps = {
  production?: BatchProductionStart;
  cleanup?: QianchuanLibraryClear;
  disabled?: boolean;
};

const initialTime = "00:30";
const runLabels: Record<AutomationRun["state"], string> = { RUNNING: "正在执行", COMPLETED: "已完成", BLOCKED: "已阻断", SKIPPED: "已跳过" };

export function AutomationComposer({ production, cleanup, disabled = false }: AutomationComposerProps) {
  const [name, setName] = useState("");
  const [time, setTime] = useState(initialTime);
  const [enabled, setEnabled] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [uploadAfterProduction, setUploadAfterProduction] = useState(false);
  const [uploadExisting, setUploadExisting] = useState(false);
  const [uploadFrom, setUploadFrom] = useState("");
  const [productionTasks, setProductionTasks] = useState<AutomationTask[]>([]);
  const [loadingProductionTasks, setLoadingProductionTasks] = useState(false);
  const [productionTasksError, setProductionTasksError] = useState("");
  const [scheduleCleanup, setScheduleCleanup] = useState(false);
  const [auditMaterials, setAuditMaterials] = useState(true);
  const [zeroImpressions, setZeroImpressions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const automationAvailable = typeof window.jianji.getAutomation === "function" && typeof window.jianji.createAutomation === "function";

  useEffect(() => {
    if (!uploadExisting) return;
    if (typeof window.jianji.getAutomation !== "function") {
      setProductionTasksError("当前版本尚未加载定时服务，暂时无法读取制作任务。");
      setLoadingProductionTasks(false);
      return;
    }
    let active = true;
    setLoadingProductionTasks(true);
    setProductionTasksError("");
    void window.jianji.getAutomation().then(status => {
      if (active) setProductionTasks(status.tasks.filter(task => task.request.production && !task.request.cleanup && !task.request.upload));
    }).catch(value => {
      if (active) setProductionTasksError(message(value));
    }).finally(() => {
      if (active) setLoadingProductionTasks(false);
    });
    return () => { active = false; };
  }, [uploadExisting]);

  const currentCleanup = cleanup ?? (production && scheduleCleanup ? planCleanup(production, auditMaterials, zeroImpressions) : undefined);
  const sourceTask = productionTasks.find(task => task.id === uploadFrom);
  const useExistingUpload = uploadExisting && Boolean(sourceTask);
  const useProduction = Boolean(production) && !uploadExisting;
  const upload = uploadExisting ? useExistingUpload : useProduction && uploadAfterProduction;
  const cleanupInputInvalid = !cleanup && scheduleCleanup && !currentCleanup;
  const authorizationScope = JSON.stringify({ name: name.trim(), time, enabled, cleanup: currentCleanup,
    production: useProduction ? production : undefined, upload, uploadFrom: uploadExisting ? uploadFrom : undefined,
    scheduleCleanup, auditMaterials, zeroImpressions, uploadAfterProduction, uploadExisting });
  useLayoutEffect(() => setAuthorized(false), [authorizationScope]);
  const candidate = {
    name,
    time,
    enabled,
    ...(currentCleanup ? { cleanup: currentCleanup } : {}),
    ...(useProduction && production ? { production } : {}),
    upload,
    ...(useExistingUpload ? { uploadFrom } : {}),
    confirmation: authorized ? "AUTHORIZE_FIXED_AUTOMATION" : undefined,
  };
  const validation = AutomationRequestSchema.safeParse(candidate);
  const hasRequiredProductionPlans = Boolean(production?.entries.length && production.entries.every(entry => entry.douyinUpload?.plan));
  const cleanupPlanCount = (cleanup ?? (production ? planCleanup(production, true, true) : undefined))?.accounts
    .reduce((total, account) => total + (account.plans?.length ?? 0), 0) ?? 0;
  const independentlyUploadableTasks = productionTasks;

  const create = async () => {
    if (!validation.success || disabled || saving) return;
    setSaving(true);
    setError("");
    try {
      await window.jianji.createAutomation(validation.data);
      setName("");
      setEnabled(false);
      setAuthorized(false);
      setUploadAfterProduction(false);
      setUploadExisting(false);
      setUploadFrom("");
      setScheduleCleanup(false);
    } catch (value) {
      setError(message(value));
    } finally {
      setSaving(false);
    }
  };

  return <section className="card automation-composer" aria-label="保存定时自动化任务">
    <div className="automation-heading"><h2>保存每日自动化</h2><span>新任务默认暂停</span></div>
    {!automationAvailable && <p className="automation-unavailable" role="status">当前版本尚未加载定时服务，定时任务暂不可用。</p>}
    <div className="automation-fields">
      <label>任务名称<input value={name} maxLength={80} disabled={disabled || saving} onChange={event => setName(event.target.value)} placeholder="例如：晚间批量制作" /></label>
      <label>每天执行时间<input type="time" lang="zh-CN" value={time} disabled={disabled || saving} onChange={event => setTime(event.target.value)} /></label>
    </div>

    {production && <div className="automation-options">
      <label className="automation-option"><input type="checkbox" checked={uploadAfterProduction} disabled={disabled || saving || uploadExisting || !hasRequiredProductionPlans}
        onChange={event => setUploadAfterProduction(event.target.checked)} /><span>制作完成后自动上传并确认所选批次</span></label>
      {!hasRequiredProductionPlans && <small>自动上传需要为每个所选模板明确选择账号和计划；已保存的计划选择仍会绑定到制作任务。</small>}
      {!cleanup && <fieldset className="automation-cleanup-options" disabled={disabled || saving || uploadExisting}>
        <legend>同时清理同批已选择的计划素材（可选）</legend>
        <label className="automation-option"><input type="checkbox" checked={scheduleCleanup} onChange={event => setScheduleCleanup(event.target.checked)} /><span>每日制作前清理所选计划素材</span></label>
        {scheduleCleanup && <div className="automation-rule-options">
          <label className="automation-option"><input type="checkbox" checked={auditMaterials} onChange={event => setAuditMaterials(event.target.checked)} /><span>审核不通过、生态审核不通过、审核通过可优化</span></label>
          <label className="automation-option"><input type="checkbox" checked={zeroImpressions} onChange={event => setZeroImpressions(event.target.checked)} /><span>近 15 天零展示（仅所选计划内、加入计划满 15 天）</span></label>
          {cleanupInputInvalid && <small className="automation-error" role="status">{cleanupPlanCount ? "已选择计划清理，但没有选择清理规则；请至少勾选一种，或取消清理。" : "已选择计划清理，但未为模板选择上传计划；请补齐清理范围，或取消清理。"}</small>}
        </div>}
      </fieldset>}
    </div>}
    {(production || !cleanup) && <div className="automation-options">
      <label className="automation-option"><input type="checkbox" checked={uploadExisting} disabled={disabled || saving || scheduleCleanup || !automationAvailable}
        onChange={event => { setUploadExisting(event.target.checked); setUploadFrom(""); setUploadAfterProduction(false); }} /><span>独立上传已有制作专用任务</span></label>
      {uploadExisting && <div className="automation-source">
        <label>制作任务<select value={uploadFrom} disabled={disabled || saving || loadingProductionTasks} onChange={event => setUploadFrom(event.target.value)}>
          <option value="">请选择已有制作专用任务</option>
          {independentlyUploadableTasks.map(task => <option key={task.id} value={task.id}>{task.request.name} · {task.request.time}</option>)}
        </select></label>
        {loadingProductionTasks && <small role="status">正在读取制作专用任务…</small>}
        {!loadingProductionTasks && !productionTasksError && !productionTasks.length && <small>暂无可选的制作专用任务。请先保存一个不含清理和上传的制作任务。</small>}
        {productionTasksError && <small className="automation-error" role="alert">{productionTasksError}</small>}
      </div>}
    </div>}

    <div className="automation-scope" aria-label="固定执行范围">
      <strong>固定执行范围</strong>
      {currentCleanup && <p>计划素材清理：{cleanupPlanCount} 个已选计划，{auditMaterials && zeroImpressions && scheduleCleanup ? "三类审核素材 + 近 15 天零展示" : currentCleanup.planMaterialRule === "ZERO_IMPRESSIONS_15D" ? "近 15 天零展示" : currentCleanup.planMaterialRule === "AUDIT_AND_ZERO_IMPRESSIONS_15D" ? "三类审核素材 + 近 15 天零展示" : "三类审核素材"}。不会清空账号视频库。</p>}
      {useProduction && production && <p>制作：固定绑定 {production.entries.length} 个已选模板及当前设置。{upload ? "制作完成后自动上传并确认选定批次。" : "不自动上传；已选择的上传计划会保留为后续目标。"}</p>}
      {useExistingUpload && sourceTask && <p>独立上传：固定引用“{sourceTask.request.name}”的制作结果，并自动上传和确认对应批次。</p>}
      {uploadExisting && !sourceTask && <p>请选择一个已有制作专用任务。</p>}
      {!currentCleanup && !useProduction && !useExistingUpload && <p>请选择有效的计划清理范围或制作模板。</p>}
      {currentCleanup && <ul>{currentCleanup.accounts.flatMap(account => (account.plans ?? []).map(plan => <li key={`${account.expectedAdvertiserId}:${plan.adId}`}>{account.product} · 账户 {account.expectedAdvertiserId} · {plan.name}（计划 {plan.adId}）</li>))}</ul>}
    </div>

    <p className="automation-runtime-note">关闭主窗口会隐藏到后台继续运行；显式退出简辑或关闭电脑会停止。错过时间会跳过，失败后不会自动重试。</p>
    <label className="automation-option automation-enable"><input type="checkbox" checked={enabled} disabled={disabled || saving} onChange={event => setEnabled(event.target.checked)} /><span>保存后立即启用此每日任务</span></label>
    <label className="automation-option automation-authorization"><input type="checkbox" checked={authorized} disabled={disabled || saving} onChange={event => setAuthorized(event.target.checked)} /><span>我授权简辑在以上固定范围定时执行；如包含清理会自动删除所选计划素材，如包含上传会自动上传并确认批次。</span></label>
    {error && <p className="automation-error" role="alert">{error}</p>}
    {!validation.success && (name || uploadExisting || currentCleanup || production) && <p className="automation-error" role="status">{validation.error.issues[0]?.message}</p>}
    <button type="button" className="button primary" disabled={disabled || saving || !automationAvailable || cleanupInputInvalid || !validation.success} onClick={() => void create()}>{saving ? "正在保存…" : "保存定时任务"}</button>
  </section>;
}

export function AutomationPanel() {
  const [status, setStatus] = useState<AutomationStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const automationAvailable = typeof window.jianji.getAutomation === "function" && typeof window.jianji.onAutomation === "function" &&
    typeof window.jianji.configureAutomation === "function" && typeof window.jianji.removeAutomation === "function";

  const refresh = async () => {
    if (!automationAvailable) return;
    setRefreshing(true);
    setError("");
    try { setStatus(await window.jianji.getAutomation()); }
    catch (value) { setError(message(value)); }
    finally { setRefreshing(false); setLoading(false); }
  };

  useEffect(() => {
    if (!automationAvailable) {
      setLoading(false);
      return;
    }
    let active = true;
    const unsubscribe = window.jianji.onAutomation(value => {
      if (active) { setStatus(value); setError(value.error ?? ""); setLoading(false); }
    });
    void window.jianji.getAutomation().then(value => {
      if (active) { setStatus(value); setError(value.error ?? ""); }
    }).catch(value => {
      if (active) setError(message(value));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; unsubscribe(); };
  }, [automationAvailable]);

  return <section className="card automation-task-panel" aria-label="定时任务列表">
    <div className="automation-heading"><h2>每日自动化任务</h2><button type="button" className="button secondary compact" disabled={refreshing || !automationAvailable} onClick={() => void refresh()}>{refreshing ? "正在刷新…" : "刷新状态"}</button></div>
    {!automationAvailable && <p className="automation-unavailable" role="status">当前版本尚未加载定时服务，定时任务暂不可用。</p>}
    {status && <p className="automation-timezone">本机时区：{status.timeZone}{status.running ? " · 有任务正在执行" : ""}</p>}
    {loading && <p role="status">正在读取定时任务…</p>}
    {(error || status?.error) && <p className="automation-error" role="alert">{error || status?.error}</p>}
    {!loading && status && !status.tasks.length && <p>暂无定时任务。</p>}
    <div className="automation-task-list">
      {status?.tasks.map(task => <AutomationTaskRow key={task.id} task={task} timeZone={status.timeZone} onStatus={setStatus} />)}
    </div>
  </section>;
}

function AutomationTaskRow({ task, timeZone, onStatus }: { task: AutomationTask & { nextRunAt?: string }; timeZone: string; onStatus(status: AutomationStatus): void }) {
  const [time, setTime] = useState(task.request.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setTime(task.request.time), [task.request.time]);
  const configure = async (enabled: boolean, nextTime = task.request.time) => {
    setBusy(true); setError("");
    try { onStatus(await window.jianji.configureAutomation({ id: task.id, enabled, time: nextTime })); }
    catch (value) { setError(message(value)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`删除定时任务“${task.request.name}”？已发生的清理、制作或上传记录不会撤销。`)) return;
    setBusy(true); setError("");
    try { onStatus(await window.jianji.removeAutomation(task.id)); }
    catch (value) { setError(message(value)); }
    finally { setBusy(false); }
  };
  const lastRun = task.lastRun;
  return <article className="automation-task" aria-label={task.request.name}>
    <div className="automation-task-title"><strong>{task.request.name}</strong><span className={`automation-state${task.request.enabled ? " enabled" : ""}`}>{task.request.enabled ? "已启用" : "已暂停"}</span></div>
    <p>{task.summary}</p>
    <div className="automation-task-controls"><label>每天<input type="time" lang="zh-CN" value={time} disabled={busy} onChange={event => setTime(event.target.value)} /></label>
      <button type="button" className="button secondary compact" disabled={busy || time === task.request.time} onClick={() => void configure(task.request.enabled, time)}>保存时间</button>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void configure(!task.request.enabled)}>{task.request.enabled ? "暂停" : "启用"}</button>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void remove()}>删除</button>
    </div>
    {task.nextRunAt && task.request.enabled && <small>下次执行：{formatTime(task.nextRunAt, timeZone)}</small>}
    {lastRun && <small>最近执行：{runLabels[lastRun.state]} · {formatTime(lastRun.startedAt, timeZone)} · {lastRun.message}</small>}
    {error && <small className="automation-error" role="alert">{error}</small>}
  </article>;
}

function planCleanup(production: BatchProductionStart, auditMaterials: boolean, zeroImpressions: boolean): QianchuanLibraryClear | undefined {
  if (!auditMaterials && !zeroImpressions) return undefined;
  const accounts: QianchuanLibraryClear["accounts"] = [];
  for (const entry of production.entries) {
    const selection = entry.douyinUpload;
    const plan = selection?.plan;
    if (!selection || !plan) continue;
    const target = accounts.find(account => account.product === selection.accountProduct && account.expectedAdvertiserId === plan.advertiserId);
    if (!target) accounts.push({ product: selection.accountProduct, expectedAdvertiserId: plan.advertiserId, plans: [plan] });
    else if (!target.plans?.some(value => value.adId === plan.adId)) target.plans = [...(target.plans ?? []), plan];
  }
  if (!accounts.length) return undefined;
  return {
    confirmation: "DELETE_PLAN_MATERIALS",
    ...(zeroImpressions ? { planMaterialRule: auditMaterials ? "AUDIT_AND_ZERO_IMPRESSIONS_15D" : "ZERO_IMPRESSIONS_15D" } : {}),
    accounts,
  };
}

function formatTime(value: string, timeZone: string): string {
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function message(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "操作未完成，请重试。"; }
