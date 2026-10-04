import { useEffect, useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule";

export function QianchuanVideoLibrarySchedule({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [status, setStatus] = useState<QianchuanLibraryScheduleStatus>();
  const [time, setTime] = useState("00:30");
  const [includePlanMaterials, setIncludePlanMaterials] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const running = status?.lastRun?.state === "RUNNING";
  useEffect(() => {
    let active = true;
    const receive = (value: QianchuanLibraryScheduleStatus) => { if (active) { setStatus(value); setTime(value.settings.time); setIncludePlanMaterials(value.settings.includePlanMaterials ?? false); } };
    const unsubscribe = window.jianji.onQianchuanVideoLibrarySchedule(receive);
    void window.jianji.getQianchuanVideoLibrarySchedule().then(receive).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "无法读取定时清空设置。"); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const save = async (enabled: boolean) => {
    if (!status || saving || running) return;
    setSaving(true); setError("");
    try {
      const next = await window.jianji.saveQianchuanVideoLibrarySchedule({ confirmation: "DELETE_ALL_VIDEOS", enabled, time,
        includePlanMaterials: enabled ? includePlanMaterials : status.settings.includePlanMaterials,
        accounts: enabled ? configured.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId, ...(includePlanMaterials ? { expectedAdId: account.adId } : {}) })) : status.settings.accounts });
      setStatus(next); setTime(next.settings.time);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "定时清空设置未保存。"); }
    finally { setSaving(false); }
  };
  return <div aria-label="每日定时清空视频库">
    <p>每日定时清空 <small>按本机时间（{status?.timeZone ?? "本地时区"}）执行。</small></p>
    <label>每天清空时间 <input type="time" value={time} disabled={saving || running} onChange={event => setTime(event.target.value)} /></label>
    <label><input type="checkbox" checked={includePlanMaterials} disabled={busy || saving || running} onChange={event => setIncludePlanMaterials(event.target.checked)} /> 同时清理计划内审核不通过、生态审核不通过、审核通过可优化素材</label>
    {includePlanMaterials && <p>一次筛选三类；无生态审核不通过选项则跳过。保存后绑定当前计划，换计划需重新保存。删除可能影响这些素材的投放。</p>}
    <p>启用后，每天自动并行永久删除以下账号视频库中的全部视频，不备份视频：</p>
    <p>{configured.map(account => `${qianchuanProductName(account.product, accounts)}（${account.advertiserId}）`).join("、") || "请先配置千川账号。"}</p>
    {includePlanMaterials && <p>当前计划：{configured.map(account => `${qianchuanProductName(account.product, accounts)}（${account.adId}）`).join("、")}</p>}
    <div className="douyin-upload-actions">
      <button className="button primary compact" type="button" disabled={!status || busy || saving || running || !configured.length || !time || !!status.error} onClick={() => void save(true)}>{saving ? "正在保存…" : status?.settings.enabled ? "保存定时清空设置" : "启用每日自动清空"}</button>
      <button className="button secondary compact" type="button" disabled={!status?.settings.enabled || saving || running} onClick={() => void save(false)}>关闭定时清空</button>
    </div>
    <p>{status?.automaticLaunch?.enabled ? "到时系统会自动启动简辑；软件已打开时复用现有实例。" : "请保持简辑打开，或保存设置以启用系统定时启动。"}电脑需开机并登录桌面，对应 Chrome 需保持打开。关机或休眠错过时间不会补删；正在制作、导出或上传时跳过，当天不自动重试。</p>
    {status?.automaticLaunch && <p role={status.settings.enabled && !status.automaticLaunch.enabled ? "alert" : "status"}>{status.automaticLaunch.message}</p>}
    {status && <p role="status">{status.settings.enabled ? `已启用：每天 ${status.settings.time}` : "定时清空未启用"}{status.nextRunAt ? ` · 下次 ${new Date(status.nextRunAt).toLocaleString()}` : ""}</p>}
    {status?.settings.enabled && <p>已绑定账号：{status.settings.accounts.map(target => `${qianchuanProductName(target.product, accounts)}（${target.expectedAdvertiserId}）`).join("、")}</p>}
    {status?.settings.enabled && status.settings.includePlanMaterials && <p>已启用三类计划素材清理：{status.settings.accounts.map(target => `${qianchuanProductName(target.product, accounts)}（计划 ${target.expectedAdId}）`).join("、")}</p>}
    {status?.lastRun && <div role="status"><p>上次执行：{new Date(status.lastRun.startedAt).toLocaleString()} · {status.lastRun.message}</p>
      {status.lastRun.results.map(result => <p key={result.product}>{qianchuanProductName(result.product, accounts)} · {result.message}</p>)}
    </div>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
  </div>;
}
