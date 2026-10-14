import { useEffect, useRef, useState } from "react";
import type { QianguanjiaAccountDirectory, QianguanjiaDesktopApi, QianguanjiaHomeSummary, QianguanjiaSessionOption } from "../shared/qianguanjia";

const groups = [["ALL", "全部推广"], ["LIVE_PROM_GOODS", "直播推广"], ["VIDEO_PROM_GOODS", "短视频推广"]] as const;
const metrics = [["statCost", "消耗"], ["totalPayOrderCountForRoi2", "成交订单数"], ["totalPayOrderGmvIncludeCouponForRoi2", "成交金额（含优惠券）"], ["totalPrepayAndPayOrderRoi2", "支付 ROI"]] as const;
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const overviewMetrics = [metrics[0], metrics[2], metrics[1], metrics[3]];

export function QianguanjiaPanel({ active, api, onNavigate }: { active: boolean; api: QianguanjiaDesktopApi; onNavigate?(page: "reports" | "materials" | "uploads"): void }) {
  const [sessions, setSessions] = useState<QianguanjiaSessionOption[]>([]), [sessionId, setSessionId] = useState("");
  const [directory, setDirectory] = useState<QianguanjiaAccountDirectory>(), [home, setHome] = useState<QianguanjiaHomeSummary>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"home" | "accounts">("home"), [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [pageIndex, setPageIndex] = useState(0);
  const request = useRef<string>();
  const generation = useRef(0);
  const connected = typeof api.queryQianguanjia === "function";
  const clear = () => { setSessions([]); setSessionId(""); setDirectory(undefined); setHome(undefined); setPageIndex(0); };
  const release = () => {
    generation.current++;
    const id = request.current; request.current = undefined;
    if (id) void api.cancelQianguanjiaQuery({ requestId: id }).catch(() => undefined);
    if (connected) void api.disconnectQianguanjia().catch(() => undefined);
  };
  useEffect(() => {
    if (!active) { release(); clear(); setBusy(false); setError(""); setNotice(""); }
    return release;
  }, [active]);

  async function read(kind: "discover" | "accounts" | "home", selectedSession = sessionId) {
    if (!active || !connected || request.current || kind !== "discover" && !selectedSession) return;
    const requestId = crypto.randomUUID(); request.current = requestId; setBusy(true); setError(""); setNotice("");
    // One result never remains attributed to a failed or changed supplier session.
    if (kind === "accounts") setDirectory(undefined);
    if (kind === "home") setHome(undefined);
    if (kind === "discover") clear();
    try {
      const next = await api.queryQianguanjia(kind === "discover" ? { kind, requestId } : { kind, requestId, sessionId: selectedSession });
      if (request.current !== requestId) return;
      if (next.requestId !== requestId || next.kind !== kind || next.kind !== "discover" && next.sessionId !== selectedSession) throw new Error();
      if (next.kind === "discover") {
        setSessions(next.sessions);
        if (next.sessions.length === 1) setSessionId(next.sessions[0]!.sessionId);
        setNotice(next.sessions.length ? `发现 ${next.sessions.length} 个正常业务页面，请选择页面后读取。` : "没有发现可连接的千管家页面。请保持已登录的千管家首页或账户管理页打开。浏览器需要已允许本地调试连接。");
        if (next.unavailableBrowsers) setNotice(value => `${value} 部分浏览器连接不可用。`);
      } else if (next.kind === "accounts") { setDirectory(next.data); setPageIndex(0); setTab("accounts"); }
      else { if (next.data.scope !== "supplier-home-aggregate") throw new Error(); setHome(next.data); setTab("home"); }
      return next;
    } catch {
      if (request.current === requestId) {
        clear(); void api.disconnectQianguanjia().catch(() => undefined);
        setError("读取未完成。请重新发现页面，并检查千管家正常登录与试用权限。");
      }
    } finally { if (request.current === requestId) { request.current = undefined; setBusy(false); } }
  }

  async function connect() {
    const current = generation.current;
    const discovered = await read("discover");
    if (generation.current !== current || discovered?.kind !== "discover") return;
    if (discovered.sessions.length > 1) { setSettings(true); setNotice("发现多个业务页面，请在连接设置中选择要使用的页面。"); return; }
    if (discovered.sessions.length !== 1) { setSettings(true); return; }
    const selected = discovered.sessions[0]!.sessionId;
    const accounts = await read("accounts", selected);
    if (generation.current !== current || accounts?.kind !== "accounts") return;
    await read("home", selected);
  }
  const filtered = (directory?.accounts ?? []).filter(item => (!status || item.authStatusDesc === status) &&
    `${item.name}\n${item.advertiserId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.ceil(filtered.length / 10), currentPage = Math.min(pageIndex, Math.max(0, pages - 1));
  const rows = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const selected = (tab === "accounts" ? directory : home) ?? directory ?? home;

  return <section aria-label="千管家只读数据" className="qianchuan-backend-panel qianguanjia-console">
    <header className="qianguanjia-console-header"><div className="qianguanjia-console-brand"><span aria-hidden="true">◇</span><strong>JIANJI</strong><span>投放工作台</span></div>
      <nav aria-label="投放工作台业务导航">
        <button type="button" aria-current={tab === "home" ? "page" : undefined} onClick={() => setTab("home")}>首页</button>
        <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.("reports")}>推广管理</button>
        <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.("reports")}>数据报表</button>
        <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.("materials")}>素材中心</button>
        <button type="button" aria-current={tab === "accounts" ? "page" : undefined} onClick={() => setTab("accounts")}>账户管理</button>
      </nav>
    </header>
    <div className="qianguanjia-console-toolbar"><div><span className={`qianguanjia-connection ${selected ? "is-connected" : ""}`}>{selected ? "已连接授权会话" : "未连接"}</span><span>数据来源：千管家</span>{selected && <small>更新于 {time(selected.observedAt)}</small>}</div>
      <div className="qianguanjia-console-actions"><button type="button" className="button" disabled={busy || !active || !connected} onClick={() => void connect()}>连接已授权账户</button>
        <button type="button" className="button secondary" disabled={busy || !active || !sessionId} onClick={() => void read(tab === "accounts" ? "accounts" : "home")}>刷新数据</button>
      {busy && <button type="button" className="button secondary" onClick={() => { release(); clear(); setBusy(false); setNotice("查询已取消，请重新发现页面。"); }}>取消千管家查询</button>}
      {!busy && sessions.length > 0 && <button type="button" className="button secondary" onClick={() => { release(); clear(); setNotice("连接已断开，浏览器和原页面保留。"); }}>断开连接</button>}
      </div></div>
    <div className="qianguanjia-console-messages">{!connected && <p role="alert">千管家界面接线尚未加载，请等待应用主进程更新。</p>}
      {busy && <p role="status">正在读取千管家…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>
    <details className="qianguanjia-connection-settings" open={settings} onToggle={event => setSettings(event.currentTarget.open)}><summary>连接设置</summary>
      <p>沿用已正常登录并授权的千管家首页或账户管理页，不需要再次授权。没有发现页面时，请确认原 Chrome 浏览器已允许本地调试连接。</p>
      <div className="qianchuan-query-fields"><label>千管家页面<select aria-label="千管家页面" value={sessionId} disabled={busy || !active} onChange={event => {
        setSessionId(event.target.value); setDirectory(undefined); setHome(undefined); setError(""); setNotice("");
      }}><option value="">请选择已登录页面</option>{sessions.map(item => <option key={item.sessionId} value={item.sessionId}>{item.label}</option>)}</select></label></div>
      <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={busy || !active || !connected} onClick={() => void read("discover")}>发现已登录页面</button>
        <button type="button" className="button secondary" disabled={busy || !active || !sessionId} onClick={() => void read("accounts")}>读取授权账户</button>
        <button type="button" className="button secondary" disabled={busy || !active || !sessionId} onClick={() => void read("home")}>读取今日汇总</button></div>
    </details>
    <div hidden={tab !== "home"} className="qianguanjia-console-body">
      <main className="qianguanjia-console-main"><div className="qianguanjia-mode-bar"><strong>全域推广</strong><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.("reports")}>计划与预算查询 →</button></div>
        <section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>数据概览</h2><span>{home?.date ?? "今日"} · 北京时间</span></div>
          <dl className="qianguanjia-kpis">{overviewMetrics.map(([field, name], index) => <div key={field} className={`qianguanjia-kpi qianguanjia-kpi-${index}`}><dt>{name}</dt><dd>{home?.groups.ALL.current[field] ?? "—"}</dd><span aria-hidden="true">{["¥", "↗", "▤", "%"][index]}</span></div>)}</dl>
          <p className="qianguanjia-data-scope">当前供应商用户的全域汇总，不代表任一单账户或计划的效果。</p>
        </section>
        <section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>推广数据</h2><span>按读取日期统计</span></div>
          {home ? <div className="qianchuan-query-result" data-testid="qianguanjia-home">{groups.map(([key, label]) => <section key={key} className="qianguanjia-group" aria-label={label}><h3>{label}</h3><dl className="qianchuan-query-metrics">{metrics.map(([field, name]) => <div key={field}><dt>{name}</dt><dd>{home.groups[key].current[field]}</dd></div>)}</dl></section>)}
            <p className="qianguanjia-data-scope">供应商首页汇总 · {home.date}。时间序列尚未接入，此处只展示本次实际读取的分类数据。</p></div> : <div className="qianguanjia-empty"><span aria-hidden="true">▥</span><strong>连接账户，查看投放数据</strong><p>读取授权账户、今日消耗、成交金额、订单数与支付 ROI。</p></div>}
        </section>
      </main>
      <aside className="qianguanjia-console-aside"><section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>账户概况</h2></div><strong className="qianguanjia-account-total">{directory?.accounts.length ?? "—"}<small>个授权账户</small></strong><p>沿用原有授权，账户目录与本地上传目标分别管理。</p><button type="button" className="qianguanjia-text-button" onClick={() => setTab("accounts")}>查看授权账户 →</button></section>
        <section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>快捷入口</h2></div><div className="qianguanjia-shortcuts">{([["reports", "↗", "计划 · ROI · 预算"], ["materials", "▣", "素材管理"], ["uploads", "↑", "上传任务"]] as const).map(([page, icon, label]) => <button key={page} type="button" disabled={!onNavigate} onClick={() => onNavigate?.(page)}><span aria-hidden="true">{icon}</span>{label}</button>)}</div></section>
        <section className="qianguanjia-card qianguanjia-scope-note"><h2>投放管理</h2><p>计划与素材操作进入简辑现有页面。今日汇总仅查询数据；调整预算、ROI 和创建投放尚未接入本工作台。</p></section>
      </aside>
    </div>
    <section hidden={tab !== "accounts"} className="qianguanjia-card qianguanjia-directory-page"><div className="qianguanjia-card-title"><h2>账户管理</h2><span>{directory ? `已读取 ${directory.accounts.length} 个授权账户` : "等待连接"}</span></div>
      <div className="qianguanjia-account-filters"><label>账户搜索<input aria-label="搜索授权账户" placeholder="输入账户名称或广告主 ID" value={search} onChange={event => { setSearch(event.target.value); setPageIndex(0); }} /></label>
        <label>授权状态<select aria-label="授权状态筛选" value={status} onChange={event => { setStatus(event.target.value); setPageIndex(0); }}><option value="">全部状态</option>{[...new Set(directory?.accounts.map(item => item.authStatusDesc) ?? [])].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      {directory ? <div data-testid="qianguanjia-directory">{!directory.accounts.length ? <p>当前会话没有返回授权账户。</p> : !filtered.length ? <p>没有匹配的授权账户。</p> : <><div className="qianchuan-query-table qianguanjia-account-table"><table><thead><tr><th>账户名称</th><th>广告主 ID</th><th>授权状态</th></tr></thead><tbody>{rows.map(item => <tr key={item.advertiserId}><td><span className="qianguanjia-account-avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>{item.name}</td><td className="qianguanjia-advertiser-id">{item.advertiserId}</td><td><span className="qianguanjia-auth-status">{item.authStatusDesc}</span></td></tr>)}</tbody></table></div>
        <div className="qianguanjia-pagination"><span>共 {filtered.length} 条 · 第 {currentPage + 1} / {pages} 页</span><button type="button" className="button secondary" aria-label="上一页账户" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>上一页</button><button type="button" className="button secondary" aria-label="下一页账户" disabled={currentPage + 1 >= pages} onClick={() => setPageIndex(currentPage + 1)}>下一页</button></div></>}
        <p className="qianguanjia-data-scope">读取于 {time(directory.observedAt)} · 目录仅供查看，不更改本地上传账号、计划和历史任务。</p></div> : <div className="qianguanjia-empty"><strong>尚未读取授权账户</strong><p>点击上方“连接已授权账户”，使用已有正常登录会话。</p></div>}
    </section>
  </section>;
}
