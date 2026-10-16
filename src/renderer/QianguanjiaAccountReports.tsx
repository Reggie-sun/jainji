import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import type { QianguanjiaAccountDirectory } from "../shared/qianguanjia.js";
import { QIANCHUAN_QUERY_METRICS } from "../shared/qianchuan-backend.js";
import { QianchuanReportCaptureSchema } from "../shared/qianchuan-report.js";
import { compareQianchuanSnapshots } from "../shared/qianguanjia-view.js";
import { qianguanjiaReportTargets, validateAccountReport, latestAccountReport, exportQianguanjiaAccountReportsCsv,
  type AccountReportRow } from "../shared/qianguanjia-account-reports.js";

const labels = ["平台消耗", "成交订单数", "含券成交金额", "平台支付 ROI"];
const statuses: Record<AccountReportRow["status"], string> = {
  pending: "尚未读取", reading: "正在读取", complete: "已读取完整快照", failed: "读取失败", cancelled: "已取消", missing: "无匹配历史快照", blocked: "账户不可读取",
};
type Work = { cancelled: boolean; mode: "capture" | "history"; requestId?: string; timer?: ReturnType<typeof setTimeout> };
const clock = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

/** Transient presentation orchestration over the original account lease, report capture and store. */
export function QianguanjiaAccountReports({ active, accounts, directory, startDate, endDate, onBusy }: {
  active: boolean; accounts: QianchuanAccountSummary[]; directory?: QianguanjiaAccountDirectory;
  startDate: string; endDate: string; onBusy?: (value: boolean) => void;
}) {
  let targets: ReturnType<typeof qianguanjiaReportTargets> = [], targetError = "";
  try { targets = qianguanjiaReportTargets(accounts, directory); } catch { targetError = "已保存账户存在无效或重复身份，未进行跨账户读取。请到原千川账号设置核对。"; }
  const [selected, setSelected] = useState<string[] | null>(null);
  const selectedTargets = targets.filter(target => selected === null || selected.includes(target.key));
  const accountIdentity = JSON.stringify(targets.map(target => [target.key, target.available, target.blockedReason]));
  const selectionIdentity = JSON.stringify(selectedTargets.map(target => target.key));
  const identity = JSON.stringify([active, accountIdentity, selectionIdentity, startDate, endDate]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const binding = JSON.stringify([accountIdentity, selectionIdentity]);
  const [result, setResult] = useState<{ identity: string; rows: AccountReportRow[]; mode: "capture" | "history" }>();
  const [baseline, setBaseline] = useState<{ binding: string; rows: AccountReportRow[]; startDate: string; endDate: string }>();
  const [busy, setBusy] = useState(false), [cancelled, setCancelled] = useState(false), [notice, setNotice] = useState("");
  const workRef = useRef<Work>(), mounted = useRef(true), busyRef = useRef(onBusy); busyRef.current = onBusy;
  const rows = result?.identity === identity ? result.rows : selectedTargets.map(target => ({ target, status: target.available ? "pending" : "blocked", note: target.blockedReason } as AccountReportRow));
  const visibleBaseline = baseline?.binding === binding ? baseline : undefined;
  const complete = rows.filter(row => row.status === "complete").length;
  const validation = selectedTargets[0] ? QianchuanReportCaptureSchema.safeParse({ kind: "report", product: selectedTargets[0].product,
    expectedAdvertiserId: selectedTargets[0].advertiserId, requestId: "00000000-0000-4000-8000-000000000001", startDate, endDate }) : undefined;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateError = validation && !validation.success ? validation.error.issues[0]?.message ?? "日期范围无效。" : endDate > today ? "结束日期不能晚于当前北京时间日期。" : "";

  function cancelWork() {
    const work = workRef.current;
    if (!work || work.cancelled) return;
    work.cancelled = true;
    if (work.timer) clearTimeout(work.timer);
    if (work.mode === "capture" && work.requestId) void window.jianji.cancelQianchuanIntegration({ requestId: work.requestId }).catch(() => undefined);
    if (mounted.current) setCancelled(true);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelWork(); }; }, []);
  useEffect(() => { cancelWork(); setNotice(""); setResult(undefined); return cancelWork; }, [identity]);
  useEffect(() => { setBaseline(undefined); }, [binding]);

  async function read(mode: "capture" | "history") {
    if (!active || busy || workRef.current || targetError || dateError || !selectedTargets.length) return;
    const work: Work = { mode, cancelled: false }, frozenIdentity = identity;
    const currentRows: AccountReportRow[] = selectedTargets.map(target => ({ target, status: mode === "history" || target.available ? "pending" : "blocked", note: mode === "history" ? undefined : target.blockedReason }));
    workRef.current = work; setBusy(true); setCancelled(false); setNotice(""); busyRef.current?.(true);
    const validView = () => mounted.current && identityRef.current === frozenIdentity && workRef.current === work;
    const publish = () => { if (validView()) setResult({ identity: frozenIdentity, rows: currentRows.map(row => ({ ...row })), mode }); };
    publish();
    try {
      for (const row of currentRows) {
        if (work.cancelled || !validView()) break;
        if (mode === "capture" && !row.target.available) continue;
        row.status = "reading"; publish();
        try {
          if (mode === "capture") {
            work.requestId = crypto.randomUUID();
            work.timer = setTimeout(() => {
              if (workRef.current !== work || work.cancelled) return;
              cancelWork(); if (validView()) setNotice("单账户读取超过 180 秒，已请求取消；停止后续账户，不自动重试。");
            }, 180000);
            const raw = await window.jianji.captureQianchuanReport({ kind: "report", product: row.target.product,
              expectedAdvertiserId: row.target.advertiserId, requestId: work.requestId, startDate, endDate, browserAccess: "existing-only" });
            if (!work.cancelled && validView()) row.snapshot = validateAccountReport(raw, row.target, startDate, endDate);
          } else {
            const raw = await window.jianji.listQianchuanReports({ product: row.target.product, expectedAdvertiserId: row.target.advertiserId });
            if (!work.cancelled && validView()) row.snapshot = latestAccountReport(raw, row.target, startDate, endDate);
          }
          if (work.cancelled || !validView()) break;
          row.status = row.snapshot ? "complete" : "missing";
          row.note = row.snapshot ? undefined : "该账户没有与所选日期精确匹配的完整账户报表；不是零消耗。";
        } catch {
          if (work.cancelled || !validView()) break;
          row.status = "failed"; row.snapshot = undefined;
          row.note = mode === "capture" ? "原千川读取或快照身份校验失败。请核对该账户原浏览器、登录、出口及任务占用；没有启动、切换或重试浏览器。" : "原快照读取或完整性校验失败，未使用部分历史数据。";
        } finally { if (work.timer) clearTimeout(work.timer); work.timer = undefined; work.requestId = undefined; }
        publish();
      }
      if (work.cancelled) for (const row of currentRows) if (row.status === "pending" || row.status === "reading") {
        row.status = "cancelled"; row.snapshot = undefined; row.note = "本轮已停止，未显示迟到结果；此前完整保存的快照仍在原历史中。";
      }
      publish();
      if (validView()) setNotice(previous => previous || (work.cancelled ? "本轮读取已取消，未再读取剩余账户。" : `本轮结束：${currentRows.filter(row => row.status === "complete").length} / ${currentRows.length} 个账户有完整报表；其余账户保持具体状态，不补零。`));
    } finally {
      if (work.timer) clearTimeout(work.timer);
      if (workRef.current === work) workRef.current = undefined;
      if (mounted.current) { setBusy(false); setCancelled(false); }
      busyRef.current?.(false);
    }
  }

  function download() {
    if (!result || result.identity !== identity || busy) return;
    const csv = exportQianguanjiaAccountReportsCsv(rows, startDate, endDate);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `千管家-跨账户-${startDate}-${endDate}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <section aria-label="千川跨账户报表">
    <div className="qianguanjia-card-title"><h3>千川跨账户报表</h3><span>{targets.length} 个已保存账户</span></div>
    <p className="qianguanjia-data-scope">直接复用已保存千川账户及原报表入口，不要求供应商目录列出这些账户，也不要求连接千管家会话。仅读取已经打开的原账户浏览器，缺失或不匹配时停止该账户；不启动、重启或切换浏览器。</p>
    <p className="qianguanjia-data-scope">范围为商品自选控成本账户报表，不代表所有投放模式。各账户按各自采集时刻截止，不是同时快照。金额单位及归因定义沿原平台值保留，当前未知，不显示金额合计或跨账户 ROI。</p>
    {targetError && <p role="alert">{targetError}</p>}
    {!targets.length && !targetError && <p role="status">没有已保存的有效账户，请到千川原账号设置配置；本页不会新建授权或猜测身份。</p>}
    {targets.length > 0 && <>
      <div role="group" aria-label="跨账户报表账户" style={{ display: "grid", gap: 6 }}>
        <label><input type="checkbox" aria-label="选择全部本地报表账户" disabled={busy || !active} checked={selectedTargets.length === targets.length} onChange={e => setSelected(e.target.checked ? null : [])} /> 全部已保存账户（{targets.length}）</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(230px,100%),1fr))", gap: 8 }}>
          {targets.map(target => <label key={target.key} style={{ overflowWrap: "anywhere" }}><input type="checkbox" aria-label={`跨账户选择 ${target.advertiserId}`} disabled={busy || !active} checked={selectedTargets.some(row => row.key === target.key)} onChange={e => {
            const next = new Set(selectedTargets.map(row => row.key)); if (e.target.checked) next.add(target.key); else next.delete(target.key); setSelected([...next]);
          }} /> {target.name} · {target.advertiserId}{!target.available ? " · 配置不可读" : ""}</label>)}
        </div>
      </div>
      <p>供应商目录{directory ? `覆盖 ${targets.filter(target => target.supplierListed).length} / ${targets.length} 个已保存账户；未覆盖的账户仍参与本页读取。` : "尚未读取，覆盖未知；不影响本页读取。"}</p>
      <div className="qianchuan-query-actions">
        <button type="button" className="button" disabled={busy || !active || !selectedTargets.length || !!dateError || !!targetError} onClick={() => void read("capture")}>读取并保存所选账户报表</button>
        <button type="button" className="button secondary" disabled={busy || !active || !selectedTargets.length || !!dateError || !!targetError} onClick={() => void read("history")}>读取所选账户历史快照</button>
        {busy && <button type="button" className="button secondary" disabled={cancelled} onClick={cancelWork}>{workRef.current?.mode === "history" ? "停止显示跨账户历史" : "取消跨账户读取"}</button>}
        <button type="button" className="button secondary" disabled={busy || !complete} onClick={() => setBaseline({ binding, rows: structuredClone(rows), startDate, endDate })}>将当前跨账户结果设为基准</button>
        <button type="button" className="button secondary" disabled={busy || result?.identity !== identity} onClick={download}>导出跨账户报表 CSV</button>
      </div>
      {dateError && <p role="alert">{dateError}</p>}
      {busy && <p role="status">{cancelled ? "已请求停止，等待当前原请求清理后释放占用；迟到结果不显示，也不启动后续账户。" : "正在按顺序读取所选账户，单账户上限 180 秒。失败独立保留，不自动重试。"}{workRef.current?.mode === "history" && "历史 IPC 不支持取消，只能停止显示并停止剩余账户读取。"}</p>}
      {notice && <p role="status">{notice}</p>}
      <p>所选 {selectedTargets.length} 个账户 · 完整 {complete} 个 · {rows.filter(row => row.status === "failed" || row.status === "blocked").length} 个失败或不可读 · 其余未读取、缺失或取消。{complete < selectedTargets.length && "当前数据不完整，不能作为全部账户总计。"}</p>
      {visibleBaseline && <p>对比基准：{visibleBaseline.startDate} 至 {visibleBaseline.endDate} · 完整 {visibleBaseline.rows.filter(row => row.status === "complete").length} / {visibleBaseline.rows.length} 个账户。差值为当前 − 基准，只匹配精确账户身份，未折算不同区间长度。<button type="button" className="button secondary" onClick={() => setBaseline(undefined)}>清除跨账户基准</button></p>}
      <div className="qianchuan-query-table"><table><thead><tr><th>账户 / 来源与窗口</th><th>读取状态</th>{labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {rows.map(row => {
          const displayName = targets.find(target => target.key === row.target.key)?.name ?? row.target.name;
          const old = visibleBaseline?.rows.find(previous => previous.target.key === row.target.key && previous.status === "complete")?.snapshot;
          const comparison = row.snapshot && old ? compareQianchuanSnapshots(row.snapshot, old) : undefined;
          return <tr key={row.target.key}><td>{displayName}<br /><small>账户 {row.target.advertiserId}<br />供应商目录 {row.target.supplierListed === undefined ? "未知" : row.target.supplierListed ? "已列出" : "未列出"}</small>
            {row.snapshot && <p><small>来源：千川浏览器 · 原完整账户快照<br />{row.snapshot.startTime} 至 {row.snapshot.endTime}（北京时间）<br />截止 {clock(row.snapshot.asOf)} · 采集 {clock(row.snapshot.capturedAt)}<br />快照 {row.snapshot.id}</small></p>}{old && <p><small>基准实际窗口：{old.startTime} 至 {old.endTime}（北京时间）<br />基准截止 {clock(old.asOf)} · 采集 {clock(old.capturedAt)}<br />基准快照 {old.id}</small></p>}</td>
            <td><span>{statuses[row.status]}</span>{row.note && <p>{row.note}</p>}</td>
            {QIANCHUAN_QUERY_METRICS.map(metric => <td key={metric}>{row.snapshot?.metrics[metric].display ?? "—"}{visibleBaseline && <><br /><small>基准 {old?.metrics[metric].display ?? "未知"}<br />差值 {comparison?.kind === "report" ? comparison.metricDeltas[metric] ?? "未知" : "未知"}</small></>}</td>)}
          </tr>;
        })}
      </tbody></table></div>
    </>}
    <details><summary>跨账户读取口径</summary><p>DataSetKey=product_roi2_promotion；Dimensions=marketing_goal；固定 advertiser_id、pricing_category=2、marketing_goal=1、ecp_app_id=1、campaign_type=1、adlab_mode=1 及 promotion_overview=1。沿用原配方，不猜测未知枚举或单位。</p><p>每个账户使用原账户操作租约、前后配置及出口核验与原报表保存；账户/会话身份不匹配拒绝。部分失败不抹去其他完整结果，也不把失败或未返回值转成零。CSV 同样包含缺失账户及状态。</p></details>
  </section>;
}
