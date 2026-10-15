import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QIANCHUAN_QUERY_METRICS } from "../shared/qianchuan-backend";
import { QianchuanReportCaptureSchema, QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "../shared/qianchuan-report";
import { exportQianchuanReportCsv } from "../shared/qianchuan-report-export";
import type { QianchuanIntegrationStatus } from "../shared/qianchuan-integration";
import type { QianchuanDeliveryActionCapability } from "../shared/qianchuan-delivery";
import { QianchuanDeliveryPanel } from "./QianchuanDeliveryPanel";

const actionLabels = { "create-plan": "创建商品全域计划", "bind-materials": "加入已有计划", "set-roi": "修改 ROI 目标", "set-budget": "修改预算", pause: "暂停计划", enable: "启用计划" };
const capabilityLabels: Record<QianchuanDeliveryActionCapability["status"], string> = {
  "not-investigated": "尚未核验", "static-located": "仅定位到接口线索", "isolated-verified": "仅隔离验证", "live-read-verified": "仅真实读取验证", "live-write-verified": "真实写入及回读验证", unavailable: "当前不可用",
};
const metricLabels = ["平台消耗", "平台成交订单", "含券成交额", "平台支付 ROI"];
const localTime = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
function compareRaw(left: string, right: string): number {
  const parts = (value: string) => {
    const [mantissa, exponent = "0"] = value.toLowerCase().split("e"), fraction = mantissa!.split(".")[1] ?? "";
    return { integer: BigInt(mantissa!.replace(".", "")), scale: fraction.length - Number(exponent) };
  };
  const a = parts(left), b = parts(right), scale = Math.max(a.scale, b.scale);
  const first = a.integer * 10n ** BigInt(scale - a.scale), second = b.integer * 10n ** BigInt(scale - b.scale);
  return first < second ? -1 : first > second ? 1 : 0;
}

export function QianchuanIntegrationPanel({ account, active, adId, kind, startDate, endDate }: {
  account?: QianchuanAccountSummary; active: boolean; adId: string; kind: "plan" | "materials" | "report"; startDate: string; endDate: string;
}) {
  const [reports, setReports] = useState<QianchuanReportSnapshot[]>([]), [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<QianchuanIntegrationStatus>();
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(""), [sort, setSort] = useState("identity");
  const historyVersion = useRef(0);
  const epoch = useRef(0), current = useRef<string>();
  const identity = `${account?.product ?? ""}:${account?.advertiserId ?? ""}:${account?.available ?? false}`;
  const cancel = () => {
    const requestId = current.current; current.current = undefined;
    if (requestId) void window.jianji.cancelQianchuanIntegration({ requestId }).catch(() => undefined);
  };
  const scope = account?.advertiserId ? { product: account.product, expectedAdvertiserId: account.advertiserId } : undefined;
  async function history(generation: number) {
    if (!scope) return;
    const version = ++historyVersion.current;
    const next = (await window.jianji.listQianchuanReports(scope)).map(snapshot => QianchuanReportSnapshotSchema.parse(snapshot));
    if (next.some(snapshot => snapshot.product !== scope.product || snapshot.advertiserId !== scope.expectedAdvertiserId)) throw new Error("identity");
    if (generation === epoch.current && version === historyVersion.current) setReports(next.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
  }
  function refreshHistory() {
    const generation = epoch.current;
    void history(generation).catch(() => { if (generation === epoch.current) setError("历史报表读取失败，未展示不完整记录。"); });
  }
  useEffect(() => {
    const generation = ++epoch.current;
    cancel(); setBusy(false); setReports([]); setSelectedId(""); setStatus(undefined); setError(""); setNotice(""); setFilter("");
    if (active && scope) {
      void history(generation).catch(() => { if (generation === epoch.current) setError("历史报表未能读取；文件权限或完整性需要核查。当前查询仍可单独使用。"); });
      void window.jianji.getQianchuanIntegration(scope).then(next => { if (generation === epoch.current) setStatus(next); }).catch(() => {
        if (generation === epoch.current) setError("投放能力和审计记录未能核对，写操作保持关闭。");
      });
    }
    return () => { epoch.current++; cancel(); };
  }, [identity, active]);
  useEffect(() => { cancel(); setBusy(false); setError(""); setNotice(""); }, [adId, kind, startDate, endDate]);
  async function capture() {
    if (!active || !scope || !account?.available || current.current) return;
    const requestId = crypto.randomUUID(), generation = epoch.current;
    const parsed = QianchuanReportCaptureSchema.safeParse({ ...scope, requestId, startDate, endDate,
      ...(kind === "materials" ? { kind: "materials", adId } : { kind: "report" }) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请核对报表范围。"); return; }
    current.current = requestId; setBusy(true); setError(""); setNotice("");
    try {
      const snapshot = QianchuanReportSnapshotSchema.parse(await window.jianji.captureQianchuanReport(parsed.data));
      if (current.current !== requestId || generation !== epoch.current) return;
      if (snapshot.product !== scope.product || snapshot.advertiserId !== scope.expectedAdvertiserId || snapshot.kind !== parsed.data.kind ||
        snapshot.kind === "materials" && snapshot.adId !== adId) throw new Error("identity");
      historyVersion.current++;
      setReports(old => [snapshot, ...old.filter(item => item.id !== snapshot.id)]); setSelectedId(snapshot.id);
      setNotice("完整报表已保存。保存记录不授予上传或投放权限。");
    } catch {
      if (current.current === requestId && generation === epoch.current) setError("完整报表未能采集或持久保存，请核对登录、账户、范围及本地权限。没有自动重试；Windows 快照持久化尚未核验。");
    } finally { if (current.current === requestId) { current.current = undefined; setBusy(false); } }
  }
  async function stop() {
    const generation = epoch.current;
    cancel(); setBusy(false);
    try {
      await window.jianji.stopQianchuanIntegration();
      if (generation !== epoch.current) return;
      setNotice("本地后续投放动作已停止。本地停止不等于平台暂停；原平台计划可能仍在投放。");
      if (scope) { const next = await window.jianji.getQianchuanIntegration(scope); if (generation === epoch.current) setStatus(next); }
    } catch { if (generation === epoch.current) setError("停止状态尚未核对，请检查原平台计划是否仍在投放。"); }
  }
  const selected = reports.find(snapshot => snapshot.id === selectedId);
  const rows = selected?.kind === "materials" ? selected.rows.filter(row => !filter || [row.materialId, row.videoId ?? "", row.name].some(value => value.includes(filter))).slice().sort((a, b) =>
    sort === "cost" ? compareRaw(b.metrics.stat_cost_for_roi2.value, a.metrics.stat_cost_for_roi2.value) : a.materialId.localeCompare(b.materialId)) : [];
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([exportQianchuanReportCsv(selected)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `qianchuan-${selected.id}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section className="qianchuan-backend-panel" aria-label="千川完整报表与投放准入">
    <h3>完整报表与历史记录</h3>
    <p>店铺未识别。账户和计划身份以平台核验结果为准；历史报表只供查看，不代表当前值或操作资格。</p>
    <p>汇总范围为商品自选控成本；素材报告绑定上方计划。北京时间，最多 31 天、2000 条素材、180 秒。保留平台原始口径和显示值，原始单位未核验；支付 ROI 与净成交 ROI 不合并。</p>
    <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={busy || !active || !account?.available} onClick={() => void capture()}>{kind === "materials" ? "采集并保存完整素材效果" : "采集并保存账户汇总"}</button>
      <button type="button" className="button secondary" disabled={!active || !scope || busy} onClick={refreshHistory}>读取历史报表</button>
      {busy && <button type="button" className="button secondary" onClick={() => { cancel(); setBusy(false); setNotice("已取消采集，迟到结果不会显示；没有继续采集后续页。"); }}>取消完整采集</button>}</div>
    {busy && <p role="status">正在采集并核对完整报表…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="qianchuan-query-fields"><label>历史快照<select aria-label="历史报表快照" value={selectedId} onChange={event => { setSelectedId(event.target.value); setFilter(""); }}><option value="">请选择完整快照</option>
      {reports.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{localTime(snapshot.capturedAt)} · {snapshot.kind === "materials" ? `计划 ${snapshot.adId} / ${snapshot.total} 条素材` : "商品控成本汇总"} · {snapshot.startTime} 至 {snapshot.endTime}</option>)}</select></label></div>
    {selected && <div className="qianchuan-query-result"><p>来源：千川浏览器 · 账户 {selected.advertiserId} · {selected.startTime} 至 {selected.endTime}（北京时间） · 采集于 {localTime(selected.capturedAt)}</p>
      <button type="button" className="button secondary" onClick={download}>导出当前快照 CSV</button>
      {selected.kind === "report" ? <dl className="qianchuan-query-metrics">{QIANCHUAN_QUERY_METRICS.map((key, i) => <div key={key}><dt>{metricLabels[i]}</dt><dd title={`${key} / ${selected.metrics[key].value}`}>{selected.metrics[key].display}</dd></div>)}</dl> : <>
        <div className="qianchuan-query-fields"><label>素材筛选<input aria-label="历史素材筛选" value={filter} onChange={event => setFilter(event.target.value)} placeholder="素材 ID、视频 ID 或名称" /></label>
          <label>排序<select aria-label="历史素材排序" value={sort} onChange={event => setSort(event.target.value)}><option value="identity">素材 ID</option><option value="cost">平台消耗降序</option></select></label></div>
        <p>显示 {rows.length} / {selected.total} 条素材；导出包含当前完整快照，每个素材只保留一组统计行。</p>
        <div className="qianchuan-query-table"><table><thead><tr><th>素材 / 视频</th>{metricLabels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.materialId}><td>{row.name}<br /><small>{row.materialId}<br />{row.videoId ?? "未返回视频 ID"}</small></td>{QIANCHUAN_QUERY_METRICS.map(key => <td key={key} title={`${key} / ${row.metrics[key].value}`}>{row.metrics[key].display}</td>)}</tr>)}</tbody></table></div>
      </>}
    </div>}
    <h3>投放操作准入</h3><p>每个账户、推广模式和动作分别核验。下方只提供预算与 ROI 的单次范围验证；创建、加入素材和启停没有操作入口。具体准入由主进程预检决定，接口线索不授予权限。</p>
    {status && <><div className="qianchuan-query-table"><table><thead><tr><th>动作</th><th>准入状态</th><th>当前限制</th></tr></thead><tbody>{status.capabilities.map(capability => <tr key={capability.action}><td>{actionLabels[capability.action]}</td><td>{capabilityLabels[capability.status]}</td><td>{capability.status === "live-write-verified" ? "仍需本次对象、动作、金额、次数和时限授权" : "缺少该账户和推广模式的真实写入与回读核验"}{capability.evidenceId && <small> · 证据 {capability.evidenceId}</small>}</td></tr>)}</tbody></table></div>
      {status.auditUnavailable && <p role="alert">投放审计不可用，写操作保持关闭。</p>}
      {status.operations.length > 0 && <div className="qianchuan-query-table"><table><thead><tr><th>操作 ID</th><th>动作</th><th>状态</th><th>最近记录（北京时间）</th></tr></thead><tbody>{status.operations.map(operation => <tr key={operation.operationId}><td>{operation.operationId}</td><td>{actionLabels[operation.action]}</td><td>{operation.state === "UNKNOWN" || operation.state === "PENDING" ? "结果未知，只能核查，不可重发" : operation.state}{operation.adId && <small> · 平台返回计划 {operation.adId}（以回读状态为准）</small>}</td><td>{localTime(operation.updatedAt)}</td></tr>)}</tbody></table></div>}
      {status.stopped && <p>本地投放动作已停止，本次应用会话不会恢复执行权。</p>}</>}
    {active && account && <QianchuanDeliveryPanel account={account} active={active} adId={adId} />}
    <button type="button" className="button secondary" disabled={!active} onClick={() => void stop()}>停止本地投放动作</button>
    <p>本地停止不等于平台暂停；平台暂停需要单独授权并回读状态。未知结果不会提供一键重试。</p>
  </section>;
}
