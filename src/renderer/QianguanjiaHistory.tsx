import { useEffect, useMemo, useRef, useState } from "react";
import { QianguanjiaAccountReports } from "./QianguanjiaAccountReports";
import { QianguanjiaPlans } from "./QianguanjiaPlans";
import { QianguanjiaSupplierComparison } from "./QianguanjiaSupplierComparison";
import { QIANCHUAN_QUERY_METRICS, type QianchuanQueryMetric } from "../shared/qianchuan-backend.js";
import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account.js";
import { QianguanjiaAnalysisInputSchema, type QianguanjiaReportPage, type QianguanjiaReportField } from "../shared/qianguanjia-analysis.js";
import type { QianguanjiaAccountDirectory, QianguanjiaDesktopApi } from "../shared/qianguanjia.js";
import { QianchuanReportListSchema, QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "../shared/qianchuan-report.js";
import { compareQianchuanSnapshots, haveComparableSnapshotScope } from "../shared/qianguanjia-view.js";

const supplierMetrics: { field: QianguanjiaReportField; local: QianchuanQueryMetric; label: string }[] = [
  { field: "statCostForRoi2", local: "stat_cost_for_roi2", label: "平台消耗" },
  { field: "totalPayOrderCountForRoi2", local: "total_pay_order_count_for_roi2", label: "成交订单数" },
  { field: "totalPayOrderGmvIncludeCouponForRoi2", local: "total_pay_order_gmv_include_coupon_for_roi2", label: "含券成交金额" },
  { field: "totalPrepayAndPayOrderRoi2", local: "total_prepay_and_pay_order_roi2", label: "平台支付 ROI" },
];
const localMetrics = [
  { field: QIANCHUAN_QUERY_METRICS[0], label: "平台消耗" },
  { field: QIANCHUAN_QUERY_METRICS[1], label: "成交订单数" },
  { field: QIANCHUAN_QUERY_METRICS[2], label: "含券成交金额" },
  { field: QIANCHUAN_QUERY_METRICS[3], label: "平台支付 ROI" },
] as const;
const accountKey = (account: Pick<QianchuanAccountSummary, "product" | "advertiserId">) => JSON.stringify([account.product, account.advertiserId]);
const localDate = (value: string) => value.slice(0, 10);
const displayTime = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
function beijingDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function snapshotLabel(snapshot: QianchuanReportSnapshot) {
  const kind = snapshot.kind === "report" ? "账户报表" : `素材报表 · 计划 ${snapshot.adId}`;
  return `${displayTime(snapshot.capturedAt)} · ${kind} · ${snapshot.startTime} 至 ${snapshot.endTime}`;
}

export function QianguanjiaHistory({ active, api, sessionId, directory, accounts, onBusy, onSessionInvalid }: {
  active: boolean;
  api: QianguanjiaDesktopApi;
  sessionId: string;
  directory?: QianguanjiaAccountDirectory;
  accounts: QianchuanAccountSummary[];
  onBusy?: (busy: boolean) => void;
  onSessionInvalid?: () => void;
}) {
  const [planBusy,setPlanBusy]=useState(false);
  const [crossBusy, setCrossBusy] = useState(false);
  const [source, setSource] = useState<"direct" | "supplier" | "local">("direct");
  const [startDate, setStartDate] = useState(beijingDate), [endDate, setEndDate] = useState(beijingDate);
  const [supplierSelection, setSupplierSelection] = useState<string[] | null>(null);
  const [localAccountValue, setLocalAccountValue] = useState("");
  const [localSnapshots, setLocalSnapshots] = useState<QianchuanReportSnapshot[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error" | "stopped">("ready");
  const [localReadVersion, setLocalReadVersion] = useState(0);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [comparisonSnapshotId, setComparisonSnapshotId] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierState, setSupplierState] = useState<{ key: string; loading?: boolean; data?: QianguanjiaReportPage; error?: string; notice?: string }>();
  const request = useRef<{ requestId: string; key: string }>();
  const supplierGeneration = useRef(0), historyGeneration = useRef(0);

  const supplierAccounts = directory?.accounts ?? [];
  const selectedSupplierIds = (supplierSelection ?? supplierAccounts.map(account => account.advertiserId)).filter(id => supplierAccounts.some(account => account.advertiserId === id));
  const usableLocalAccounts = accounts.filter(account => /^[1-9][0-9]{0,19}$/.test(account.advertiserId));
  const selectedLocalAccount = usableLocalAccounts.find(account => accountKey(account) === localAccountValue) ?? usableLocalAccounts[0];
  const supplierKey = JSON.stringify([active, source, sessionId, selectedSupplierIds, startDate, endDate, supplierPage]);
  const visibleSupplier = source === "supplier" && active && supplierState?.key === supplierKey ? supplierState : undefined;

  function cancelSupplier(notifyParent: boolean) {
    const activeRequest = request.current;
    if (!activeRequest) return;
    request.current = undefined;
    supplierGeneration.current++;
    void api.cancelQianguanjiaQuery({ requestId: activeRequest.requestId }).catch(() => undefined);
    onBusy?.(false);
    if (notifyParent) onSessionInvalid?.();
  }

  useEffect(() => { setSupplierSelection(null); }, [sessionId, directory?.observedAt]);

  useEffect(() => {
    supplierGeneration.current++;
    cancelSupplier(true);
    setSupplierState(undefined);
    setSupplierPage(1);
    setSelectedSnapshotId(""); setComparisonSnapshotId(""); setPlanFilter(""); setMaterialFilter("");
    return () => {
      supplierGeneration.current++;
      cancelSupplier(true);
    };
  }, [active, source, sessionId, selectedSupplierIds.join(","), selectedLocalAccount?.product, selectedLocalAccount?.advertiserId, startDate, endDate]);

  useEffect(() => {
    if (!active || source !== "local" || !selectedLocalAccount) {
      setLocalSnapshots([]); setHistoryState("ready");
      return;
    }
    let current = true;
    const version = ++historyGeneration.current;
    setLocalSnapshots([]); setHistoryState("loading"); setSelectedSnapshotId(""); setComparisonSnapshotId("");
    const parsedScope = QianchuanReportListSchema.safeParse({ product: selectedLocalAccount.product, expectedAdvertiserId: selectedLocalAccount.advertiserId });
    if (!parsedScope.success) { setHistoryState("error"); return () => { current = false; }; }
    void window.jianji.listQianchuanReports(parsedScope.data).then(values => {
      const snapshots = values.map(value => QianchuanReportSnapshotSchema.parse(value));
      if (snapshots.some(snapshot => snapshot.product !== parsedScope.data.product || snapshot.advertiserId !== parsedScope.data.expectedAdvertiserId)) throw new Error("scope");
      if (!current || version !== historyGeneration.current) return;
      setLocalSnapshots(snapshots.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
      setHistoryState("ready");
    }).catch(() => { if (current && version === historyGeneration.current) { setLocalSnapshots([]); setHistoryState("error"); } });
    return () => { current = false; };
  }, [active, source, selectedLocalAccount?.product, selectedLocalAccount?.advertiserId, localReadVersion]);

  function stopLocalRead() {
    historyGeneration.current++;
    setLocalSnapshots([]);
    setSelectedSnapshotId(""); setComparisonSnapshotId("");
    setHistoryState("stopped");
  }

  async function querySupplier(page = supplierPage) {
    if (!active || source !== "supplier" || !sessionId || !selectedSupplierIds.length) return;
    if (request.current || planBusy) return;
    const query = QianguanjiaAnalysisInputSchema.safeParse({ kind: "report", startDate, endDate, advertiserIds: selectedSupplierIds, page, limit: 20 });
    if (!query.success) { setSupplierState({ key: supplierKey, error: query.error.issues[0]?.message ?? "请检查账户与报表日期范围。" }); return; }
    const requestId = crypto.randomUUID(), key = JSON.stringify([active, source, sessionId, selectedSupplierIds, startDate, endDate, page]);
    const epoch = ++supplierGeneration.current;
    setSupplierPage(page);
    request.current = { requestId, key };
    setSupplierState({ key, loading: true }); onBusy?.(true);
    try {
      const result = await api.queryQianguanjia({ ...query.data, requestId, sessionId });
      if (request.current?.requestId !== requestId || epoch !== supplierGeneration.current) return;
      if (result.kind !== "report" || result.requestId !== requestId || result.sessionId !== sessionId) throw new Error("identity");
      const data = result.data;
      if (data.source !== "qianguanjia" || data.scope !== "supplier-product-account-report" || data.startDate !== startDate || data.endDate !== endDate ||
        data.page !== page || data.limit !== 20 || data.advertiserIds.length !== selectedSupplierIds.length || data.advertiserIds.some((id, index) => id !== selectedSupplierIds[index]) ||
        data.rows.some(row => !selectedSupplierIds.includes(row.advertiserId) || row.date !== `${startDate}~${endDate}` && !(startDate === endDate && row.date === startDate)) ||
        new Set(data.rows.map(row => row.advertiserId)).size !== data.rows.length) throw new Error("scope");
      setSupplierState({ key, data });
    } catch {
      if (request.current?.requestId === requestId && epoch === supplierGeneration.current) {
        setSupplierState({ key, error: "历史报表读取失败或范围无法核对。请重新连接千管家后再查；没有使用今日汇总替代。" });
        onSessionInvalid?.();
      }
    } finally {
      if (request.current?.requestId === requestId) { request.current = undefined; onBusy?.(false); }
    }
  }

  function cancelQuery() {
    if (!request.current) return;
    cancelSupplier(true);
    setSupplierState({ key: supplierKey, notice: "查询已取消，迟到结果不会显示。" });
  }

  const filteredSnapshots = useMemo(() => localSnapshots.filter(snapshot =>
    localDate(snapshot.startTime) >= startDate && localDate(snapshot.endTime) <= endDate &&
    (!planFilter || snapshot.kind === "materials" && snapshot.adId === planFilter)), [localSnapshots, startDate, endDate, planFilter]);
  const selectedSnapshot = filteredSnapshots.find(snapshot => snapshot.id === selectedSnapshotId);
  const compatibleComparisons = selectedSnapshot ? filteredSnapshots.filter(snapshot => snapshot.id !== selectedSnapshot.id && haveComparableSnapshotScope(selectedSnapshot, snapshot)) : [];
  const comparisonSnapshot = compatibleComparisons.find(snapshot => snapshot.id === comparisonSnapshotId);
  const comparison = selectedSnapshot && comparisonSnapshot ? compareQianchuanSnapshots(selectedSnapshot, comparisonSnapshot) : null;
  const materialRows = selectedSnapshot?.kind === "materials" ? selectedSnapshot.rows.filter(row => !materialFilter || [row.materialId, row.videoId ?? "", row.name].some(value => value.toLocaleLowerCase().includes(materialFilter.trim().toLocaleLowerCase()))) : [];
  const comparedMaterialRows = comparison?.kind === "materials" ? comparison.matchedRows.filter(row => !materialFilter || [row.materialId, row.videoId ?? "", row.name].some(value => value.toLocaleLowerCase().includes(materialFilter.trim().toLocaleLowerCase()))) : [];
  const plans = [...new Set(localSnapshots.flatMap(snapshot => snapshot.kind === "materials" ? [snapshot.adId] : []))].sort();
  const canNext = visibleSupplier?.data?.total !== null && visibleSupplier?.data?.total !== undefined && supplierPage * 20 < visibleSupplier.data.total;
  const missingSupplierRows = visibleSupplier?.data ? selectedSupplierIds.filter(id => !visibleSupplier.data!.rows.some(row => row.advertiserId === id)) : [];

  return <section className="qianguanjia-card" aria-label="千管家历史报表" data-testid="qianguanjia-history">
    <div className="qianguanjia-card-title"><h2>历史报表</h2><span>{source === "direct" ? "全部已保存千川账户" : source === "supplier" ? "账户与日期维度" : `${localSnapshots.length} 份本地快照`}</span></div>
    <div className="qianchuan-query-fields">
      <label>历史来源<select aria-label="历史报表来源" value={source} disabled={!active || crossBusy || Boolean(visibleSupplier?.loading)} onChange={event => setSource(event.target.value as "direct" | "supplier" | "local")}>
        <option value="direct">千川跨账户报表</option><option value="supplier">千管家中台报表</option><option value="local">已保存的千川快照</option>
      </select></label>
      {source === "local" && <label>本地账户<select aria-label="本地历史账户" value={selectedLocalAccount ? accountKey(selectedLocalAccount) : ""} disabled={!active || !usableLocalAccounts.length} onChange={event => setLocalAccountValue(event.target.value)}>
        <option value="">请选择本地账户</option>{usableLocalAccounts.map(account => <option key={accountKey(account)} value={accountKey(account)}>{qianchuanAccountName(account)} · {account.advertiserId}</option>)}
      </select></label>}
      <label>开始日期<input aria-label="历史报表开始日期" type="date" value={startDate} disabled={!active || crossBusy || Boolean(visibleSupplier?.loading)} onChange={event => { setStartDate(event.target.value); setSupplierPage(1); }} /></label>
      <label>结束日期<input aria-label="历史报表结束日期" type="date" value={endDate} disabled={!active || crossBusy || Boolean(visibleSupplier?.loading)} onChange={event => { setEndDate(event.target.value); setSupplierPage(1); }} /></label>
    </div>
    {source === "direct" ? <QianguanjiaAccountReports active={active} accounts={accounts} directory={directory} startDate={startDate} endDate={endDate} onBusy={value => { setCrossBusy(value); onBusy?.(value); }} /> : source === "supplier" ? <>
      <div role="group" aria-label="选择历史报表账户" style={{ display: "grid", gap: 8, gridColumn: "1 / -1" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7 }}><input type="checkbox" aria-label="全部授权账户" style={{ width: "auto", minHeight: "auto" }} checked={supplierAccounts.length > 0 && selectedSupplierIds.length === supplierAccounts.length} disabled={!active || Boolean(visibleSupplier?.loading) || !supplierAccounts.length} onChange={event => setSupplierSelection(event.target.checked ? supplierAccounts.map(account => account.advertiserId) : [])} />全部授权账户（{supplierAccounts.length}）</label>
        {supplierAccounts.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "4px 12px", maxHeight: 144, overflowY: "auto", padding: "4px 0" }}>
          {supplierAccounts.map(account => <label key={account.advertiserId} style={{ display: "flex", alignItems: "center", gap: 7 }}><input type="checkbox" aria-label={`${account.name} · ${account.advertiserId}`} style={{ width: "auto", minHeight: "auto" }} checked={selectedSupplierIds.includes(account.advertiserId)} disabled={!active || Boolean(visibleSupplier?.loading)} onChange={event => {
            const selected = new Set(selectedSupplierIds); if (event.target.checked) selected.add(account.advertiserId); else selected.delete(account.advertiserId);
            setSupplierSelection(supplierAccounts.filter(item => selected.has(item.advertiserId)).map(item => item.advertiserId)); setSupplierPage(1);
          }} />{account.name} · {account.advertiserId}</label>)}
        </div>}
      </div>
      <div className="qianchuan-query-actions"><button type="button" className="button" disabled={!active || !sessionId || !selectedSupplierIds.length || Boolean(visibleSupplier?.loading) || planBusy} onClick={() => void querySupplier(1)}>查询历史报表</button>
        {visibleSupplier?.loading && <button type="button" className="button secondary" onClick={cancelQuery}>取消查询</button>}</div>
      {!sessionId && <p className="qianguanjia-data-scope">请先连接并读取授权账户，再选择账户查询。</p>}
      {sessionId && !supplierAccounts.length && <p className="qianguanjia-data-scope">当前会话尚未读取授权账户。</p>}
      {sessionId && supplierAccounts.length > 0 && selectedSupplierIds.length === 0 && <p className="qianguanjia-data-scope">至少选择一个授权账户。</p>}
      {visibleSupplier?.loading && <p role="status">正在读取所选账户的历史报表…</p>}
      {visibleSupplier?.error && <p role="alert">{visibleSupplier.error}</p>}
      {visibleSupplier?.notice && <p role="status">{visibleSupplier.notice}</p>}
      {visibleSupplier?.data && (visibleSupplier.data.availability === "not-provided" || visibleSupplier.data.total === null) && <div className="qianguanjia-empty" role="status"><strong>当前接口没有提供可用历史报表</strong><p>返回总数未知；没有用首页今日汇总填充历史结果。</p></div>}
      {visibleSupplier?.data?.availability === "provided" && visibleSupplier.data.total === 0 && <div className="qianguanjia-empty" role="status"><strong>所选范围没有报表行</strong><p>{startDate} 至 {endDate} · {selectedSupplierIds.length} 个账户</p></div>}
      {visibleSupplier?.data?.availability === "provided" && visibleSupplier.data.total !== null && visibleSupplier.data.total > 0 && <>
        <p className="qianguanjia-data-scope">千管家中台 · 视频推广账户范围报表 · {visibleSupplier.data.startDate} 至 {visibleSupplier.data.endDate} · 请求 {selectedSupplierIds.length} 个账户，返回 {visibleSupplier.data.rows.length} 行 · 读取于 {displayTime(visibleSupplier.data.observedAt)}。不合计 ROI；计划和素材维度未由此接口返回。</p>
        {!visibleSupplier.data.rows.length ? <p role="status">第 {supplierPage} 页没有行数据；总数为 {visibleSupplier.data.total}。</p> : <div className="qianchuan-query-table">
          <table><thead><tr><th>查询区间</th><th>账户</th>{supplierMetrics.map(metric => <th key={metric.field}>{metric.label}</th>)}</tr></thead><tbody>
            {visibleSupplier.data.rows.map((row, index) => <tr key={`${row.advertiserId}:${row.date}:${index}`}><td>{row.date}</td><td>{row.name}<br /><small>{row.advertiserId}</small></td>{supplierMetrics.map(metric => <td key={metric.field} title={metric.field}>{row.metrics[metric.field] ?? "—"}</td>)}</tr>)}
          </tbody></table>
        </div>}
        {missingSupplierRows.length > 0 && <p role="status">当前页未返回 {missingSupplierRows.length} 个所选账户的行数据；不补零，可能需要查看其他页。</p>}
        <div className="qianguanjia-pagination"><span>第 {supplierPage} 页 · 共 {visibleSupplier.data.total} 行</span><button type="button" className="button secondary" disabled={supplierPage <= 1 || Boolean(visibleSupplier.loading)} onClick={() => { const next = supplierPage - 1; setSupplierPage(next); void querySupplier(next); }}>上一页</button><button type="button" className="button secondary" disabled={!canNext || Boolean(visibleSupplier.loading)} onClick={() => { const next = supplierPage + 1; setSupplierPage(next); void querySupplier(next); }}>下一页</button></div>
      </>}
      {!visibleSupplier?.data && !visibleSupplier?.error && !visibleSupplier?.notice && !visibleSupplier?.loading && <div className="qianguanjia-empty"><strong>选择账户和日期后查询</strong><p>只展示本次实际返回的账户、日期和平台指标，不会用今日全域汇总替代历史记录。</p></div>}
      <QianguanjiaPlans active={active} api={api} sessionId={sessionId} startDate={startDate} endDate={endDate} externalBusy={Boolean(visibleSupplier?.loading)} onBusy={value=>{setPlanBusy(value);onBusy?.(value);}} onSessionInvalid={onSessionInvalid} />
      <QianguanjiaSupplierComparison current={visibleSupplier?.data} sessionId={sessionId} accountIds={selectedSupplierIds} />
    </> : <>
      {selectedLocalAccount && <div className="qianchuan-query-actions">
        {historyState === "loading"
          ? <button type="button" className="button secondary" onClick={stopLocalRead}>停止显示本次读取</button>
          : <button type="button" className="button secondary" disabled={!active} onClick={() => setLocalReadVersion(version => version + 1)}>重新读取本地快照</button>}
      </div>}
      {historyState === "loading" && <p role="status">正在读取本地已保存快照…可停止等待并隐藏迟到结果；底层 IPC 本身不支持取消。</p>}
      {historyState === "error" && <p role="alert">本地历史快照读取失败或完整性校验未通过，已隐藏该账户的全部记录。</p>}
      {historyState === "stopped" && <p role="status">已停止显示本次本地快照读取。底层 IPC 不能取消；迟到结果会忽略，可重新读取。</p>}
      {historyState === "ready" && !selectedLocalAccount && <div className="qianguanjia-empty"><strong>没有可读取的本地账户</strong><p>请先配置千川账户；这里仅读取已保存的完整报表快照。</p></div>}
      {historyState === "ready" && selectedLocalAccount && <>
        <div className="qianchuan-query-fields">
          <label>计划筛选<select aria-label="历史报表计划筛选" value={planFilter} onChange={event => { setPlanFilter(event.target.value); setSelectedSnapshotId(""); setComparisonSnapshotId(""); }}><option value="">全部计划</option>{plans.map(adId => <option key={adId} value={adId}>{adId}</option>)}</select></label>
          <label>本地快照<select aria-label="本地历史快照" value={selectedSnapshotId} onChange={event => { setSelectedSnapshotId(event.target.value); setComparisonSnapshotId(""); setMaterialFilter(""); }}><option value="">请选择与日期范围匹配的快照</option>{filteredSnapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>
          {selectedSnapshot && <label>对比快照<select aria-label="对比历史快照" value={comparisonSnapshotId} onChange={event => setComparisonSnapshotId(event.target.value)}><option value="">选择兼容快照</option>{compatibleComparisons.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>}
          {selectedSnapshot?.kind === "materials" && <label>素材筛选<input aria-label="历史素材筛选" value={materialFilter} onChange={event => setMaterialFilter(event.target.value)} placeholder="素材 ID、视频 ID 或名称" /></label>}
        </div>
        {!localSnapshots.length && <div className="qianguanjia-empty"><strong>该账户还没有已保存的快照</strong><p>这里只展示既有千川历史报表 owner 已保存的记录，不会自动发起真实采集。</p></div>}
        {localSnapshots.length > 0 && !filteredSnapshots.length && <div className="qianguanjia-empty"><strong>没有符合筛选条件的快照</strong><p>检查日期范围和计划筛选。</p></div>}
        {selectedSnapshot && <div className="qianchuan-query-result">
          <p className="qianguanjia-data-scope">来源：千川本地完整快照 · 账户 {selectedSnapshot.advertiserId} · {selectedSnapshot.startTime} 至 {selectedSnapshot.endTime}（北京时间） · 采集于 {displayTime(selectedSnapshot.capturedAt)}。指标沿用平台返回值，单位及归因口径按原快照保留。{selectedSnapshot.kind === "report" && "账户汇总仅为商品自选控成本口径，不能泛化为全账户或全投放模式总计。"}</p>
          {selectedSnapshot.kind === "report" ? <dl className="qianchuan-query-metrics">{localMetrics.map(metric => <div key={metric.field}><dt>{metric.label}</dt><dd title={`${metric.field} / ${selectedSnapshot.metrics[metric.field].value}`}>{selectedSnapshot.metrics[metric.field].display}</dd></div>)}</dl> : <>
            <p>计划 {selectedSnapshot.adId} · 筛选后显示 {materialRows.length} / {selectedSnapshot.total} 条；每行是独立素材快照记录。</p>
            {!materialRows.length ? <p role="status">当前素材筛选没有匹配项。</p> : <div className="qianchuan-query-table"><table><thead><tr><th>素材 / 视频</th>{localMetrics.map(metric => <th key={metric.field}>{metric.label}</th>)}</tr></thead><tbody>
              {materialRows.map(row => <tr key={row.materialId}><td>{row.name}<br /><small>素材 ID {row.materialId}<br />视频 ID {row.videoId ?? "未返回"}</small></td>{localMetrics.map(metric => <td key={metric.field} title={`${metric.field} / ${row.metrics[metric.field].value}`}>{row.metrics[metric.field].display}</td>)}</tr>)}
            </tbody></table></div>}
          </>}
          {selectedSnapshot && !compatibleComparisons.length && <p className="qianguanjia-data-scope">没有同账户、同类型{selectedSnapshot.kind === "materials" ? "且同计划" : ""}的第二份快照可比较。</p>}
          {comparison && comparisonSnapshot && <section aria-label="历史快照对比" className="qianguanjia-history-comparison"><div className="qianguanjia-card-title"><h3>快照对比</h3><span>左侧快照 − 对比快照</span></div>
            <p>{snapshotLabel(selectedSnapshot)}<br />对比：{snapshotLabel(comparisonSnapshot)}</p>
            {comparison.kind === "report" ? <div className="qianchuan-query-table"><table><thead><tr><th>指标</th><th>所选快照</th><th>对比快照</th><th>差值</th></tr></thead><tbody>{localMetrics.map(metric => <tr key={metric.field}><th>{metric.label}</th><td>{selectedSnapshot.kind === "report" ? selectedSnapshot.metrics[metric.field].display : "—"}</td><td>{comparisonSnapshot.kind === "report" ? comparisonSnapshot.metrics[metric.field].display : "—"}</td><td>{comparison.metricDeltas[metric.field] ?? "无法按原始数字精确相减"}</td></tr>)}</tbody></table></div> : <>
              <p>按完全相同的素材 ID 关联 {comparison.matchedRows.length} 条；左侧未匹配 {comparison.unmatchedLeft} 条，右侧未匹配 {comparison.unmatchedRight} 条。名称不参与关联。</p>
              {comparedMaterialRows.length > 0 && <div className="qianchuan-query-table"><table><thead><tr><th>素材 ID</th>{localMetrics.map(metric => <th key={metric.field}>{metric.label}差值</th>)}</tr></thead><tbody>{comparedMaterialRows.map(row => <tr key={row.materialId}><td>{row.name}<br /><small>{row.materialId}</small></td>{localMetrics.map(metric => <td key={metric.field}>{row.metricDeltas[metric.field] ?? "无法按原始数字精确相减"}</td>)}</tr>)}</tbody></table></div>}
            </>}
          </section>}
        </div>}
      </>}
      <p className="qianguanjia-data-scope">本地计划和素材维度来自快照中的平台 ID；不通过名称相似度补齐身份。历史快照只供查看与比较，不触发采集、上传或投放操作。</p>
    </>}
    <details><summary>数据来源与指标口径</summary>
      {source === "supplier" ? <><p>报表来自已连接千管家会话的 `reportPageByProduct` 接口，按视频推广、广告主和日期维度返回；本页用显式账户 ID 请求，不读取首页 `uniHomeTop` 来填充历史。</p>
        <p>{supplierMetrics.map(metric => `${metric.label}：${metric.field}`).join("；")}。原样展示中台返回文本，不跨日期求和 ROI；金额单位、归因窗口和 ROI 口径尚未与千川平台对账。</p></> : <><p>数据来自千川历史报表 owner 已保存的完整账户或素材快照；按快照记录的北京时间窗口和平台 ID 过滤。素材比较只匹配相同素材 ID。</p>
        <p>账户汇总快照仅覆盖商品自选控成本口径，不能代表全账户或全投放模式；计划和素材数据按快照平台 ID 限定。指标字段：{localMetrics.map(metric => `${metric.label}：${metric.field}`).join("；")}。展示原始格式和值，不推导或累加 ROI。</p></>}
    </details>
  </section>;
}
