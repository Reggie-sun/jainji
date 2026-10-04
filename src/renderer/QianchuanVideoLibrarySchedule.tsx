import { useEffect, useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule";

export function QianchuanVideoLibrarySchedule({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [status, setStatus] = useState<QianchuanLibraryScheduleStatus>();
  const [time, setTime] = useState("00:30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const running = status?.lastRun?.state === "RUNNING";
  useEffect(() => {
    let active = true;
    const receive = (value: QianchuanLibraryScheduleStatus) => { if (active) { setStatus(value); setTime(value.settings.time); } };
    const unsubscribe = window.jianji.onQianchuanVideoLibrarySchedule(receive);
    void window.jianji.getQianchuanVideoLibrarySchedule().then(receive).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "无法读取定时清空设置。"); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const save = async (enabled: boolean) => {
    if (!status || saving || running) return;
    setSaving(true); setError("");
    try {
      const next = await window.jianji.saveQianchuanVideoLibrarySchedule({ confirmation: "DELETE_ALL_VIDEOS", enabled, time,
        accounts: enabled ? configured.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId })) : status.settings.accounts });
      setStatus(next); setTime(next.settings.time);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "定时清空设置未保存。"); }
    finally { setSaving(false); }
  };
  return <div aria-label="每日定时清空视频库">
    <p>每日定时清空 <small>按本机时间（{status?.timeZone ?? "本地时区"}）执行。</small></p>
    <label>每天清空时间 <input type="time" value={time} disabled={saving || running} onChange={event => setTime(event.target.value)} /></label>
    <p>启用后，每天自动并行永久删除以下账号视频库中的全部视频，不备份视频：</p>
    <p>{configured.map(account => `${qianchuanProductName(account.product, accounts)}（${account.advertiserId}）`).join("、") || "请先配置千川账号。"}</p>
    <div className="douyin-upload-actions">
      <button className="button primary compact" type="button" disabled={!status || busy || saving || running || !configured.length || !time || !!status.error} onClick={() => void save(true)}>{saving ? "正在保存…" : status?.settings.enabled ? "保存定时清空设置" : "启用每日自动清空"}</button>
      <button className="button secondary compact" type="button" disabled={!status?.settings.enabled || saving || running} onClick={() => void save(false)}>关闭定时清空</button>
    </div>
    <p>请保持简辑和对应 Chrome 打开，最小化不影响执行。软件关闭或电脑休眠错过时间不会补删；正在制作、导出或上传时跳过，当天不自动重试。</p>
    {status && <p role="status">{status.settings.enabled ? `已启用：每天 ${status.settings.time}` : "定时清空未启用"}{status.nextRunAt ? ` · 下次 ${new Date(status.nextRunAt).toLocaleString()}` : ""}</p>}
    {status?.settings.enabled && <p>已绑定账号：{status.settings.accounts.map(target => `${qianchuanProductName(target.product, accounts)}（${target.expectedAdvertiserId}）`).join("、")}</p>}
    {status?.lastRun && <div role="status"><p>上次执行：{new Date(status.lastRun.startedAt).toLocaleString()} · {status.lastRun.message}</p>
      {status.lastRun.results.map(result => <p key={result.product}>{qianchuanProductName(result.product, accounts)} · {result.message}</p>)}
    </div>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
  </div>;
}
