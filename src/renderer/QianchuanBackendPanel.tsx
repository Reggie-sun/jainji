import { useEffect, useRef, useState } from "react";
import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QIANCHUAN_QUERY_METRICS, QianchuanBackendQuerySchema, type QianchuanBackendResult, type QianchuanQueryMetrics } from "../shared/qianchuan-backend";
import "./qianchuan-backend.css";

const metricLabels = ["消耗", "成交订单数", "成交金额（含优惠券）", "支付 ROI"];
function chinaDate() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function Metrics({ metrics }: { metrics: QianchuanQueryMetrics }) {
  return <dl className="qianchuan-query-metrics">{QIANCHUAN_QUERY_METRICS.map((key, index) => <div key={key}><dt>{metricLabels[index]}</dt><dd title={metrics[key].value}>{metrics[key].display}</dd></div>)}</dl>;
}

export function QianchuanBackendPanel({ accounts, active }: { accounts: QianchuanAccountSummary[]; active: boolean }) {
  const [product, setProduct] = useState(accounts.find(account => account.available)?.product ?? "");
  const account = accounts.find(account => account.product === product);
  const identity = `${product}:${account?.advertiserId ?? ""}:${account?.adId ?? ""}:${account?.available ?? false}`;
  const [kind, setKind] = useState<"plan" | "materials" | "report">("plan");
  const [adId, setAdId] = useState(account?.adId ?? "");
  const [startDate, setStartDate] = useState(chinaDate);
  const [endDate, setEndDate] = useState(chinaDate);
  const [result, setResult] = useState<QianchuanBackendResult>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<string>();
  const cancel = () => {
    const requestId = request.current;
    request.current = undefined;
    if (requestId) void window.jianji.cancelQianchuanBackendQuery({ requestId }).catch(() => undefined);
  };
  useEffect(() => { setAdId(account?.adId ?? ""); setResult(undefined); setError(""); }, [identity]);
  useEffect(() => {
    setBusy(false);
    if (!active) cancel();
    return cancel;
  }, [active, identity]);
  const reset = () => { setResult(undefined); setError(""); };
  async function read(offset = 0) {
    if (!active || !account?.available || request.current) return;
    const requestId = crypto.randomUUID();
    const parsed = QianchuanBackendQuerySchema.safeParse({ product: account.product, expectedAdvertiserId: account.advertiserId, requestId, kind,
      ...(kind === "report" ? {} : { adId }), ...(kind === "plan" ? {} : { startDate, endDate }),
      ...(kind === "materials" ? { offset, limit: 100 } : {}),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查查询条件。"); return; }
    request.current = requestId; setBusy(true); setError(""); setResult(undefined);
    try {
      const next = await window.jianji.queryQianchuanBackend(parsed.data);
      if (request.current !== requestId) return;
      if (next.advertiserId !== account.advertiserId || next.kind !== kind || next.kind !== "report" && next.adId !== adId) throw new Error("identity");
      setResult(next);
    } catch {
      if (request.current === requestId) setError("查询失败，请检查账号网页、登录状态及查询范围后重试。");
    } finally {
      if (request.current === requestId) { request.current = undefined; setBusy(false); }
    }
  }
  return <section className="qianchuan-backend-panel" aria-label="千川数据查询">
    <p>读取所选账号的计划详情、计划素材指标或商品自选控成本汇总。查询会连接或打开对应账号浏览器；登录失效时请先在浏览器中登录后再查询。</p>
    <div className="qianchuan-query-fields">
      <label>查询账号<select aria-label="查询账号" value={product} disabled={busy} onChange={event => { setProduct(event.target.value); reset(); }}>
        <option value="">请选择已配置账号</option>{accounts.filter(item => item.available).map(item => <option key={item.product} value={item.product}>{qianchuanAccountName(item)} · {item.advertiserId}</option>)}
      </select></label>
      <label>查询内容<select aria-label="查询内容" value={kind} disabled={busy} onChange={event => { setKind(event.target.value as typeof kind); reset(); }}>
        <option value="plan">计划详情</option><option value="materials">计划素材指标</option><option value="report">商品控成本汇总</option>
      </select></label>
      {kind !== "report" && <label>计划 ID<input aria-label="查询计划 ID" inputMode="numeric" value={adId} disabled={busy} onChange={event => { setAdId(event.target.value); reset(); }} /></label>}
      {kind !== "plan" && <><label>开始日期<input aria-label="查询开始日期" type="date" value={startDate} disabled={busy} onChange={event => { setStartDate(event.target.value); reset(); }} /></label>
        <label>结束日期<input aria-label="查询结束日期" type="date" value={endDate} disabled={busy} onChange={event => { setEndDate(event.target.value); reset(); }} /></label></>}
    </div>
    {kind !== "plan" && <p>按北京时间查询，最多 31 天；今天的数据截至本次读取时刻。</p>}
    <div className="qianchuan-query-actions"><button type="button" className="button" disabled={busy || !active || !account?.available} onClick={() => void read()}>查询</button>
      {busy && <button type="button" className="button secondary" onClick={() => { cancel(); setBusy(false); setError("查询已取消。"); }}>取消查询</button>}</div>
    {busy && <p role="status">正在读取千川数据…</p>}{error && <p role="alert">{error}</p>}
    {result && <div className="qianchuan-query-result">
      <p>账户 {result.advertiserId} · 读取于 {new Date(result.observedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
      {result.kind === "plan" ? <><h3>{result.name}</h3><dl className="qianchuan-query-metrics"><div><dt>计划 ID</dt><dd>{result.adId}</dd></div><div><dt>预算（元）</dt><dd>{(Number(result.budget) / 100000).toFixed(2)}</dd></div><div><dt>ROI 目标</dt><dd>{result.roiGoal}</dd></div></dl>
        <ul>{result.products.map(item => <li key={item.id}>{item.name} · {item.id}</li>)}</ul></> : <>
        <p>时间范围：{result.startTime} 至 {result.endTime}（北京时间）</p>
        {result.kind === "report" ? <Metrics metrics={result.metrics} /> : <>
          <p>共 {result.total} 条素材{result.total > 0 && `，当前第 ${Math.floor(result.offset / result.limit) + 1} 页`}</p>
          <div className="qianchuan-query-table"><table><thead><tr><th>素材</th>{metricLabels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {result.rows.map(row => <tr key={row.materialId}><td>{row.name}<br /><small>{row.materialId}</small></td>{QIANCHUAN_QUERY_METRICS.map(key => <td key={key} title={row.metrics[key].value}>{row.metrics[key].display}</td>)}</tr>)}
          </tbody></table></div>
          <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={busy || !result.offset} onClick={() => void read(result.offset - result.limit)}>上一页</button>
            <button type="button" className="button secondary" disabled={busy || result.offset + result.limit >= result.total} onClick={() => void read(result.offset + result.limit)}>下一页</button></div>
        </>}
      </>}
    </div>}
  </section>;
}
