import { useEffect, useRef, useState } from "react";
import type { QianguanjiaAccountDirectory, QianguanjiaDesktopApi, QianguanjiaHomeSummary, QianguanjiaSessionOption } from "../shared/qianguanjia";

const groups = [["ALL", "全部推广"], ["LIVE_PROM_GOODS", "直播推广"], ["VIDEO_PROM_GOODS", "短视频推广"]] as const;
const metrics = [["statCost", "消耗"], ["totalPayOrderCountForRoi2", "成交订单数"], ["totalPayOrderGmvIncludeCouponForRoi2", "成交金额（含优惠券）"], ["totalPrepayAndPayOrderRoi2", "支付 ROI"]] as const;
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

export function QianguanjiaPanel({ active, api }: { active: boolean; api: QianguanjiaDesktopApi }) {
  const [sessions, setSessions] = useState<QianguanjiaSessionOption[]>([]), [sessionId, setSessionId] = useState("");
  const [directory, setDirectory] = useState<QianguanjiaAccountDirectory>(), [home, setHome] = useState<QianguanjiaHomeSummary>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const request = useRef<string>();
  const connected = typeof api.queryQianguanjia === "function";
  const clear = () => { setSessions([]); setSessionId(""); setDirectory(undefined); setHome(undefined); };
  const release = () => {
    const id = request.current; request.current = undefined;
    if (id) void api.cancelQianguanjiaQuery({ requestId: id }).catch(() => undefined);
    if (connected) void api.disconnectQianguanjia().catch(() => undefined);
  };
  useEffect(() => {
    if (!active) { release(); clear(); setBusy(false); setError(""); setNotice(""); }
    return release;
  }, [active]);

  async function read(kind: "discover" | "accounts" | "home") {
    if (!active || !connected || request.current || kind !== "discover" && !sessionId) return;
    const requestId = crypto.randomUUID(); request.current = requestId; setBusy(true); setError(""); setNotice("");
    // One result never remains attributed to a failed or changed supplier session.
    if (kind === "accounts") setDirectory(undefined);
    if (kind === "home") setHome(undefined);
    if (kind === "discover") clear();
    try {
      const next = await api.queryQianguanjia(kind === "discover" ? { kind, requestId } : { kind, requestId, sessionId });
      if (request.current !== requestId) return;
      if (next.requestId !== requestId || next.kind !== kind || next.kind !== "discover" && next.sessionId !== sessionId) throw new Error();
      if (next.kind === "discover") {
        setSessions(next.sessions);
        if (next.sessions.length === 1) setSessionId(next.sessions[0]!.sessionId);
        setNotice(next.sessions.length ? `发现 ${next.sessions.length} 个正常业务页面，请选择页面后读取。` : "没有发现可连接的千管家页面。请保持已登录的千管家首页或账户管理页打开。浏览器需要已允许本地调试连接。");
        if (next.unavailableBrowsers) setNotice(value => `${value} 部分浏览器连接不可用。`);
      } else if (next.kind === "accounts") setDirectory(next.data);
      else { if (next.data.scope !== "supplier-home-aggregate") throw new Error(); setHome(next.data); }
    } catch {
      if (request.current === requestId) {
        clear(); void api.disconnectQianguanjia().catch(() => undefined);
        setError("读取未完成。请重新发现页面，并检查千管家正常登录与试用权限。");
      }
    } finally { if (request.current === requestId) { request.current = undefined; setBusy(false); } }
  }

  return <section aria-label="千管家只读数据" className="qianchuan-backend-panel">
    <p>连接你已登录并授权的千管家 Chrome 页面，读取授权账户和今日投放汇总。账户目录仅供查看；首页汇总涵盖供应商当前登录用户的统计范围，不按简辑的单个账号或计划筛选。</p>
    {!connected && <p role="alert">千管家界面接线尚未加载，请等待应用主进程更新。</p>}
    <div className="qianchuan-query-fields"><label>千管家页面<select aria-label="千管家页面" value={sessionId} disabled={busy || !active} onChange={event => {
      setSessionId(event.target.value); setDirectory(undefined); setHome(undefined); setError(""); setNotice("");
    }}><option value="">请选择已登录页面</option>{sessions.map(item => <option key={item.sessionId} value={item.sessionId}>{item.label}</option>)}</select></label></div>
    <div className="qianchuan-query-actions">
      <button type="button" className="button secondary" disabled={busy || !active || !connected} onClick={() => void read("discover")}>发现已登录页面</button>
      <button type="button" className="button" disabled={busy || !active || !sessionId} onClick={() => void read("accounts")}>读取授权账户</button>
      <button type="button" className="button" disabled={busy || !active || !sessionId} onClick={() => void read("home")}>读取今日汇总</button>
      {busy && <button type="button" className="button secondary" onClick={() => { release(); clear(); setBusy(false); setNotice("查询已取消，请重新发现页面。"); }}>取消千管家查询</button>}
      {!busy && sessions.length > 0 && <button type="button" className="button secondary" onClick={() => { release(); clear(); setNotice("连接已断开，浏览器和原页面保留。"); }}>断开连接</button>}
    </div>
    {busy && <p role="status">正在读取千管家…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {directory && <div className="qianchuan-query-result" data-testid="qianguanjia-directory"><p>授权账户共 {directory.accounts.length} 个 · 读取于 {time(directory.observedAt)}</p>
      {directory.accounts.length === 0 ? <p>当前会话没有返回授权账户。</p> : <div className="qianchuan-query-table qianguanjia-account-table"><table><thead><tr><th>账户名称</th><th>广告主 ID</th><th>授权状态</th></tr></thead><tbody>{directory.accounts.map(item => <tr key={item.advertiserId}><td>{item.name}</td><td>{item.advertiserId}</td><td>{item.authStatusDesc}</td></tr>)}</tbody></table></div>}
    </div>}
    {home && <div className="qianchuan-query-result" data-testid="qianguanjia-home"><p>供应商首页汇总 · {home.date}（北京时间，截至本次读取） · 读取于 {time(home.observedAt)}</p><p>此处是供应商当前用户的汇总，不代表任一单账户或计划的效果。</p>
      {groups.map(([key, label]) => <section key={key} aria-label={label}><h3>{label}</h3><dl className="qianchuan-query-metrics">{metrics.map(([field, name]) => <div key={field}><dt>{name}</dt><dd>{home.groups[key].current[field]}</dd></div>)}</dl></section>)}
    </div>}
  </section>;
}
