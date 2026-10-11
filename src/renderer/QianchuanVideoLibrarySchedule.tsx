import { useEffect, useRef, useState } from "react";
import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import { qianchuanTargetName } from "./qianchuan-account-display";
import type { QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule";
import type { AutomationTask } from "../shared/automation";
import { cleanupDate, QianchuanCleanupResults } from "./QianchuanCleanupResults";
import { AutomationTimeConflict } from "./AutomationTaskDetails";

export function QianchuanVideoLibrarySchedule({ accounts, busy, tasks = [], onStatus }: {
  accounts: QianchuanAccountSummary[]; busy: boolean; tasks?: AutomationTask[]; onStatus?(status: QianchuanLibraryScheduleStatus): void;
}) {
  const [status, setStatus] = useState<QianchuanLibraryScheduleStatus>();
  const [time, setTime] = useState("00:30");
  const [includePlanMaterials, setIncludePlanMaterials] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLDetailsElement>(null);
  const [editing, setEditing] = useState(false);
  const configured = accounts.filter(account => account.available);
  const running = status?.lastRun?.state === "RUNNING";
  const available = typeof window.jianji.getQianchuanVideoLibrarySchedule === "function" && typeof window.jianji.onQianchuanVideoLibrarySchedule === "function";
  useEffect(() => {
    if (!available) return;
    let active = true;
    const receive = (value: QianchuanLibraryScheduleStatus) => { if (active) { setStatus(value); setTime(value.settings.time); setIncludePlanMaterials(value.settings.includePlanMaterials ?? false); onStatus?.(value); } };
    const unsubscribe = window.jianji.onQianchuanVideoLibrarySchedule(receive);
    void window.jianji.getQianchuanVideoLibrarySchedule().then(receive).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "无法读取定时清空设置。"); });
    return () => { active = false; unsubscribe(); };
  }, [available, onStatus]);
  const save = async (enabled: boolean) => {
    if (!status || busy || saving || running || typeof window.jianji.saveQianchuanVideoLibrarySchedule !== "function") return;
    setSaving(true); setError("");
    try {
      const next = await window.jianji.saveQianchuanVideoLibrarySchedule({ confirmation: "DELETE_ALL_VIDEOS", enabled, time: enabled ? time : status.settings.time,
        includePlanMaterials: enabled ? includePlanMaterials : status.settings.includePlanMaterials,
        accounts: enabled ? configured.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId, ...(includePlanMaterials ? { expectedAdId: account.adId } : {}) })) : status.settings.accounts });
      setStatus(next); setTime(next.settings.time); setIncludePlanMaterials(next.settings.includePlanMaterials ?? false); onStatus?.(next);
      if (editor.current) editor.current.open = false;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "定时清空设置未保存。"); }
    finally { setSaving(false); }
  };
  return <section className="qianchuan-cleanup-card automation-library-task" aria-label="账号视频库全部清空">
    <div className="qianchuan-cleanup-heading"><h3>账号视频库全部清空</h3><span className="qianchuan-cleanup-badge">{running ? "正在执行" : status?.settings.enabled ? "已启用" : status ? "已暂停" : available ? "读取中…" : "暂不可用"}</span>
      {status?.settings.enabled && <button className="button secondary compact" type="button" disabled={busy || saving || running || typeof window.jianji.saveQianchuanVideoLibrarySchedule !== "function"} onClick={() => void save(false)}>暂停视频库清空</button>}
    </div>
    <p><strong>执行内容：</strong>永久删除已绑定账号视频库中的全部视频{status?.settings.includePlanMaterials ? "，同时清理已绑定计划内的审核不通过、生态审核不通过、审核通过可优化素材" : ""}。</p>
    <p className="automation-runtime-note">这是原每日清理任务，原设置和执行记录继续保留。计划素材清理与视频库全部清空的范围不同。</p>
    {!available && <p role="status">当前版本尚未加载视频库清空定时服务。</p>}
    {status && <div className="qianchuan-cleanup-schedule-summary" role="status">
      <strong>每天 {status.settings.time}</strong><span>{status.settings.accounts.length} 个账号 · 视频库全部视频{status.settings.includePlanMaterials ? " + 计划内三类素材" : ""}</span>
      {status.settings.enabled && status.nextRunAt && <small>下次执行：{cleanupDate(status.nextRunAt)}</small>}
    </div>}
    {!!status?.settings.accounts.length && <ul className="automation-targets">{status.settings.accounts.map(target => <li key={target.product}><strong>{qianchuanTargetName(target.expectedAdvertiserId, accounts, target.product)}</strong><span>账户 {target.expectedAdvertiserId}{status.settings.includePlanMaterials ? ` · 计划 ${target.expectedAdId}` : ""}</span></li>)}</ul>}
    <AutomationTimeConflict names={status?.settings.enabled ? tasks.filter(task => task.request.enabled && task.request.time === status.settings.time).map(task => task.request.name) : []} />
    <details ref={editor} className="qianchuan-cleanup-schedule-editor" onToggle={event => setEditing(event.currentTarget.open)}><summary>编辑视频库清空设置</summary>
      <label className="qianchuan-cleanup-time">每天执行时间<input type="time" lang="zh-CN" aria-label="视频库清空执行时间" value={time} disabled={busy || saving || running} onChange={event => setTime(event.target.value)} /><small>本机时区：{status?.timeZone ?? "本地时区"}</small></label>
      <p><strong>视频库全部视频</strong> · 每日任务会永久清空素材库，不备份视频。</p>
      <label className="qianchuan-cleanup-schedule-option"><input type="checkbox" checked={includePlanMaterials} disabled={busy || saving || running} onChange={event => setIncludePlanMaterials(event.target.checked)} /><span>同时清理计划内三类素材<small>审核不通过、生态审核不通过、审核通过可优化。可能影响这些素材的投放。</small></span></label>
      <p>本次保存的账号：{configured.map(account => `${qianchuanAccountName(account)}（账户 ${account.advertiserId}）`).join("、") || "请先配置千川账号。"}</p>
      {editing && <details className="qianchuan-cleanup-targets"><summary>核对账号{includePlanMaterials ? "和计划" : ""}</summary><ul>{configured.map(account => <li key={account.product}><strong>{qianchuanAccountName(account)}</strong><span>账户 {account.advertiserId}{includePlanMaterials ? ` · 计划 ${account.adId}` : ""}</span></li>)}</ul></details>}
      {includePlanMaterials && <p>三类一起筛选；无生态审核选项时跳过。换计划后需重新保存。</p>}
      <div className="qianchuan-cleanup-buttons"><button className="button primary" type="button" disabled={!status || busy || saving || running || !configured.length || !time || !!status.error || typeof window.jianji.saveQianchuanVideoLibrarySchedule !== "function"} onClick={() => void save(true)}>{saving ? "正在保存…" : status?.settings.enabled ? "保存定时设置" : "启用视频库清空"}</button></div>
    </details>
    <details className="qianchuan-cleanup-requirements"><summary>运行条件与已绑定账号</summary>
      <p>{status?.automaticLaunch?.enabled ? "到时系统会自动启动简辑；软件已打开时复用现有实例。" : "请保持简辑打开，或保存设置以启用系统定时启动。"}电脑需开机并登录桌面，对应 Chrome 需保持打开。关机或休眠错过时间不会补删；正在制作、导出或上传时跳过，当天不自动重试。</p>
      {status?.automaticLaunch && <p>{status.automaticLaunch.message}</p>}
      {status?.settings.enabled && <ul>{status.settings.accounts.map(target => <li key={target.product}><strong>{qianchuanTargetName(target.expectedAdvertiserId, accounts, target.product)}</strong><span>账户 {target.expectedAdvertiserId}{status.settings.includePlanMaterials ? ` · 计划 ${target.expectedAdId}` : ""}</span></li>)}</ul>}
    </details>
    {status?.settings.enabled && status.automaticLaunch && !status.automaticLaunch.enabled && <p className="qianchuan-cleanup-error" role="alert">{status.automaticLaunch.message}</p>}
    {status?.lastRun && <QianchuanCleanupResults title={`上次执行 · ${cleanupDate(status.lastRun.startedAt)}`} results={status.lastRun.results} accounts={accounts} message={status.lastRun.message} />}
    {(error || status?.error) && <p className="qianchuan-cleanup-error" role="alert">{error || status?.error}</p>}
  </section>;
}
