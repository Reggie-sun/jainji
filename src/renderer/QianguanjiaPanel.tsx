import { useCallback, useEffect, useRef, useState } from "react";
import type { QianguanjiaAccountDirectory, QianguanjiaDesktopApi, QianguanjiaHomeSummary, QianguanjiaSessionOption } from "../shared/qianguanjia";
import "./qianchuan-backend.css";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianguanjiaMaterials } from "./QianguanjiaMaterials";
import { QianguanjiaHistory } from "./QianguanjiaHistory";
import { QianguanjiaAccountReports } from "./QianguanjiaAccountReports";
import { qianguanjiaReportTargets } from "../shared/qianguanjia-account-reports";
import { QianguanjiaAnalysisRangeSchema } from "../shared/qianguanjia-analysis";

const groups = [["ALL", "全部推广"], ["LIVE_PROM_GOODS", "直播推广"], ["VIDEO_PROM_GOODS", "短视频推广"]] as const;
const metrics = [["statCost", "消耗"], ["totalPayOrderCountForRoi2", "成交订单数"], ["totalPayOrderGmvIncludeCouponForRoi2", "成交金额（含优惠券）"], ["totalPrepayAndPayOrderRoi2", "支付 ROI"]] as const;
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const overviewMetrics = [metrics[0], metrics[2], metrics[1], metrics[3]];

export function QianguanjiaPanel({ active, api, accounts = [] }: { active: boolean; api: QianguanjiaDesktopApi; accounts?: QianchuanAccountSummary[] }) {
  const [sessions, setSessions] = useState<QianguanjiaSessionOption[]>([]), [sessionId, setSessionId] = useState("");
  const [directory, setDirectory] = useState<QianguanjiaAccountDirectory>(), [home, setHome] = useState<QianguanjiaHomeSummary>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"home" | "accounts" | "history" | "materials">("home");
  const [summaryDate, setSummaryDate] = useState(() => new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0,10));
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  const validDate = summaryDate <= today && QianguanjiaAnalysisRangeSchema.safeParse({startDate:summaryDate,endDate:summaryDate}).success;
  let savedAccounts: ReturnType<typeof qianguanjiaReportTargets> = [], savedAccountError = "";
  try { savedAccounts = qianguanjiaReportTargets(accounts,directory); } catch { savedAccountError = "已保存账户身份无效，无法展示账户覆盖。请到千川原账户设置核对。"; }
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const childScope=useRef({tab,active,version:0});
  if(childScope.current.tab!==tab||childScope.current.active!==active)childScope.current={tab,active,version:childScope.current.version+1};
  const childVersion=childScope.current.version;
  const childBusy=(source:typeof tab,value:boolean)=>{if(childScope.current.active&&childScope.current.tab===source&&childScope.current.version===childVersion)setAnalysisBusy(value);};
  const invalidateSession = useCallback(() => { setSessions([]);setSessionId("");setDirectory(undefined);setHome(undefined);setNotice("查询已停止或页面会话已变化，请点击刷新数据重新读取。"); }, []);
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [pageIndex, setPageIndex] = useState(0);
  const request = useRef<string>();
  const generation = useRef(0);
  const cleanup = useRef(Promise.resolve());
  const connected = typeof api.queryQianguanjia === "function";
  const clear = () => { setSessions([]); setSessionId(""); setDirectory(undefined); setHome(undefined); setPageIndex(0); };
  const disconnect = (requestId?: string) => {
    cleanup.current = cleanup.current.then(async () => {
      if (requestId) await api.cancelQianguanjiaQuery({ requestId }).catch(() => undefined);
      if (connected) await api.disconnectQianguanjia().catch(() => undefined);
    }).catch(() => undefined);
  };
  const release = () => {
    generation.current++;
    const id = request.current; request.current = undefined;
    disconnect(id);
  };
  useEffect(() => {
    if (!active) { clear(); setBusy(false); setAnalysisBusy(false); setError(""); setNotice(""); return; }
    if (connected) void refresh();
    return release;
  }, [active, connected]);

  async function read(kind: "discover" | "accounts" | "home", selectedSession = sessionId) {
    if (!active || !connected || request.current || kind !== "discover" && !selectedSession || kind === "home" && !validDate) return;
    const requestId = crypto.randomUUID(); request.current = requestId; setBusy(true); setError(""); setNotice("");
    // One result never remains attributed to a failed or changed supplier session.
    if (kind === "accounts") setDirectory(undefined);
    if (kind === "home") setHome(undefined);
    if (kind === "discover") clear();
    try {
      const next = await api.queryQianguanjia(kind === "discover" ? { kind, requestId } : kind === "home" ? {kind,requestId,sessionId:selectedSession,date:summaryDate} : { kind, requestId, sessionId: selectedSession });
      if (request.current !== requestId) return;
      if (next.requestId !== requestId || next.kind !== kind || next.kind !== "discover" && next.sessionId !== selectedSession) throw new Error();
      if (next.kind === "discover") {
        setSessions(next.sessions);
        if (next.sessions.length === 1) setSessionId(next.sessions[0]!.sessionId);
        setNotice(next.sessions.length ? `已发现 ${next.sessions.length} 个正常业务页面。` : "没有发现可读取的千管家页面。请保持原千管家已登录页面打开后刷新；本地历史报表仍可使用。");
        if (next.unavailableBrowsers) setNotice(value => `${value} 部分浏览器连接不可用。`);
      } else if (next.kind === "accounts") { setDirectory(next.data); setPageIndex(0); }
      else { if (next.data.scope !== "supplier-home-aggregate" || next.data.date !== summaryDate) throw new Error(); setHome(next.data); }
      return next;
    } catch {
      if (request.current === requestId) {
        clear(); disconnect();
        setError("千管家数据读取未完成。请确认原千管家页面可正常查看数据，再点击“刷新数据”。");
      }
    } finally { if (request.current === requestId) { request.current = undefined; setBusy(false); } }
  }

  async function readSession(selected: string, current = generation.current) {
    const accounts = await read("accounts", selected);
    if (generation.current !== current || accounts?.kind !== "accounts") return;
    if (validDate) await read("home", selected);
    else setNotice("账户目录已读取。请选择有效日期后刷新汇总。");
  }
  async function refresh() {
    if (!active || !connected || request.current || tab !== "accounts" && !validDate) return;
    const current = generation.current;
    setBusy(true); setError(""); setNotice("");
    await cleanup.current;
    if (generation.current !== current) return;
    if (sessionId) { await read(tab === "accounts" ? "accounts" : "home"); return; }
    const discovered = await read("discover");
    if (generation.current !== current || discovered?.kind !== "discover") return;
    if (discovered.sessions.length > 1) { setNotice("发现多个千管家页面，请选择本次数据来源。"); return; }
    if (discovered.sessions.length !== 1) return;
    await readSession(discovered.sessions[0]!.sessionId, current);
  }
  const filtered = (directory?.accounts ?? []).filter(item => (!status || item.authStatusDesc === status) &&
    `${item.name}\n${item.advertiserId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.ceil(filtered.length / 10), currentPage = Math.min(pageIndex, Math.max(0, pages - 1));
  const rows = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const selected = (tab === "accounts" ? directory : home) ?? directory ?? home;

  return <section aria-label="千管家只读数据" className="qianchuan-backend-panel qianguanjia-console">
    <header className="qianguanjia-page-heading"><h1>千管家</h1><p>查看账户、历史报表与成片素材</p></header>
      <nav className="task-page-tabs" aria-label="千管家页面">
        <button type="button" disabled={busy} aria-current={tab === "home" ? "page" : undefined} onClick={() => {setAnalysisBusy(false);setTab("home");}}>数据概览</button>
        <button type="button" disabled={busy} aria-current={tab === "accounts" ? "page" : undefined} onClick={() => {setAnalysisBusy(false);setTab("accounts");}}>账户管理</button>
        <button type="button" disabled={busy} aria-current={tab === "history" ? "page" : undefined} onClick={() => {setAnalysisBusy(false);setTab("history");}}>历史报表</button>
        <button type="button" disabled={busy} aria-current={tab === "materials" ? "page" : undefined} onClick={() => {setAnalysisBusy(false);setTab("materials");}}>素材中心</button>
      </nav>
    <div className="qianguanjia-console-toolbar"><div><span className={`qianguanjia-connection ${selected ? "is-connected" : ""}`}>{selected ? "已读取" : busy ? "正在读取" : "待查询"}</span><span>数据来源：千管家</span>{selected && <small>更新于 {time(selected.observedAt)}</small>}</div>
      <div className="qianguanjia-console-actions"><button type="button" className="button secondary" disabled={busy || analysisBusy || !active || !connected || tab !== "accounts" && !validDate} onClick={() => void refresh()}>刷新数据</button>
      {busy && <button type="button" className="button secondary" onClick={() => { release(); clear(); setBusy(false); setNotice("本次读取已取消。点击刷新数据可重新读取。"); }}>取消千管家查询</button>}
      </div></div>
    <div className="qianguanjia-console-messages">{!connected && <p role="alert">千管家界面接线尚未加载，请等待应用主进程更新。</p>}
      {busy && <p role="status">正在读取千管家…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>
    {tab === "history" && <QianguanjiaHistory active={active} api={api} sessionId={sessionId} directory={directory} accounts={accounts} onBusy={value=>childBusy('history',value)} onSessionInvalid={invalidateSession} />}
    {tab === "materials" && <QianguanjiaMaterials active={active} api={api} sessionId={sessionId} directory={directory} accounts={accounts} onBusy={value=>childBusy('materials',value)} onSessionInvalid={invalidateSession} />}
    {sessions.length > 1 && <div className="qianchuan-query-fields"><label>千管家页面<select aria-label="千管家页面" value={sessionId} disabled={busy || analysisBusy || !active} onChange={event => {
      const selected = event.target.value;
      setSessionId(selected); setDirectory(undefined); setHome(undefined); setError(""); setNotice("");
      if (selected) void readSession(selected);
    }}><option value="">请选择本次数据来源</option>{sessions.map(item => <option key={item.sessionId} value={item.sessionId}>{item.label}</option>)}</select></label></div>}
    <div hidden={tab !== "home"} className="qianguanjia-console-body">
      <div className="qianguanjia-console-main">
        <section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>数据概览</h2><label>汇总日期<input aria-label="汇总日期（北京时间）" type="date" max={today} value={summaryDate} disabled={busy || analysisBusy} onChange={event=>{setSummaryDate(event.target.value);setHome(undefined);setError("");setNotice("日期已更改，点击刷新数据读取所选日期。");}} /></label></div>
          <p className="qianguanjia-data-scope">{summaryDate} · 北京时间 · 默认查看昨日，可选择今天或历史日期。下方汇总来自千管家当前授权范围；你的 {savedAccounts.length} 个已保存千川账户另列如下。</p>
          {!validDate && <p role="alert">请选择不晚于今天的有效汇总日期。</p>}
          <dl className="qianguanjia-kpis">{overviewMetrics.map(([field, name]) => <div key={field} className="qianguanjia-kpi"><dt>{name}</dt><dd>{home?.groups.ALL.current[field] ?? "—"}</dd></div>)}</dl>
          <p className="qianguanjia-data-scope">当前供应商用户的全域汇总，不代表任一单账户或计划的效果。</p>
          {savedAccounts.length > 0 && <><p className="qianguanjia-data-scope">我的 {savedAccounts.length} 个千川账户：{savedAccounts.map(account=>account.name).join("、")}。{directory ? `千管家目录覆盖 ${savedAccounts.filter(account=>account.supplierListed).length} / ${savedAccounts.length}；其余账户仍可使用原千川报表。` : "供应商覆盖待核对；不影响原千川报表入口。"}</p><button type="button" className="qianguanjia-text-button" disabled={busy || analysisBusy} onClick={()=>setTab("accounts")}>查看我的 {savedAccounts.length} 个千川账户 →</button><br /></>}
          <button type="button" className="qianguanjia-text-button" onClick={() => {setAnalysisBusy(false);setTab("accounts");}}>{directory ? `查看 ${directory.accounts.length} 个授权账户 →` : "查看授权账户 →"}</button>
        </section>
        <section className="qianguanjia-card"><div className="qianguanjia-card-title"><h2>推广数据</h2><span>按读取日期统计</span></div>
          {home?.availability === "not-provided" ? <div className="qianguanjia-empty"><strong>所选日期汇总暂未提供</strong><p>{home.date} 千管家返回空汇总；指标保持未知，已读取的账户目录仍可查看。</p></div> : home ? <div className="qianchuan-query-result" data-testid="qianguanjia-home">{groups.map(([key, label]) => <section key={key} className="qianguanjia-group" aria-label={label}><h3>{label}</h3><dl className="qianchuan-query-metrics">{metrics.map(([field, name]) => <div key={field}><dt>{name}</dt><dd>{home.groups[key].current[field] ?? "—"}</dd></div>)}</dl></section>)}
            <p className="qianguanjia-data-scope">供应商首页汇总 · {home.date} · 采集于 {time(home.observedAt)}。此处只展示本次实际读取的分类数据。</p></div> : <div className="qianguanjia-empty"><span aria-hidden="true">▥</span><strong>尚未取得所选日期汇总</strong><p>进入本页自动读取已有登录页面；也可点击刷新数据重新读取。</p></div>}
        </section>
        {accounts.length > 0 && <div className="qianguanjia-card"><QianguanjiaAccountReports active={active && tab === "home" && !busy} accounts={accounts} directory={directory} startDate={summaryDate} endDate={summaryDate} onBusy={value=>childBusy("home",value)} /></div>}
      </div>
    </div>
    <section hidden={tab !== "accounts"} className="qianguanjia-card qianguanjia-directory-page"><div className="qianguanjia-card-title"><h2>账户管理</h2><span>{directory ? `已读取 ${directory.accounts.length} 个授权账户` : "等待读取"}</span></div>
      <section aria-label="我的千川账户"><h3>我的千川账户 · {savedAccounts.length} 个</h3>
        {savedAccountError && <p role="alert">{savedAccountError}</p>}
        {savedAccounts.length > 0 ? <><div className="qianchuan-query-table"><table><thead><tr><th>账户</th><th>广告主 ID</th><th>配置</th><th>千管家覆盖</th></tr></thead><tbody>{savedAccounts.map(account=><tr key={account.key}><td>{account.name}</td><td>{account.advertiserId}</td><td>{account.available ? "配置已保存" : "配置不可读取"}</td><td>{account.supplierListed === undefined ? "供应商覆盖待核对" : account.supplierListed ? "供应商目录已列出" : "供应商目录未列出；可用原千川报表"}</td></tr>)}</tbody></table></div><button type="button" className="button secondary" disabled={busy || analysisBusy} onClick={()=>setTab("home")}>查看我的账户数据</button></> : !savedAccountError && <p>尚未保存千川账户。</p>}
      </section>
      <h3>千管家返回的授权账户</h3>
      <div className="qianguanjia-account-filters"><label>账户搜索<input aria-label="搜索授权账户" placeholder="输入账户名称或广告主 ID" value={search} onChange={event => { setSearch(event.target.value); setPageIndex(0); }} /></label>
        <label>授权状态<select aria-label="授权状态筛选" value={status} onChange={event => { setStatus(event.target.value); setPageIndex(0); }}><option value="">全部状态</option>{[...new Set(directory?.accounts.map(item => item.authStatusDesc) ?? [])].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      {directory ? <div data-testid="qianguanjia-directory">{!directory.accounts.length ? <p>当前会话没有返回授权账户。</p> : !filtered.length ? <p>没有匹配的授权账户。</p> : <><div className="qianchuan-query-table qianguanjia-account-table"><table><thead><tr><th>账户名称</th><th>广告主 ID</th><th>授权状态</th></tr></thead><tbody>{rows.map(item => <tr key={item.advertiserId}><td><span className="qianguanjia-account-avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>{item.name}</td><td className="qianguanjia-advertiser-id">{item.advertiserId}</td><td><span className="qianguanjia-auth-status">{item.authStatusDesc}</span></td></tr>)}</tbody></table></div>
        <div className="qianguanjia-pagination"><span>共 {filtered.length} 条 · 第 {currentPage + 1} / {pages} 页</span><button type="button" className="button secondary" aria-label="上一页账户" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>上一页</button><button type="button" className="button secondary" aria-label="下一页账户" disabled={currentPage + 1 >= pages} onClick={() => setPageIndex(currentPage + 1)}>下一页</button></div></>}
        <p className="qianguanjia-data-scope">读取于 {time(directory.observedAt)} · 目录仅供查看，不更改本地上传账号、计划和历史任务。</p></div> : <div className="qianguanjia-empty"><strong>尚未读取授权账户</strong><p>进入本页自动读取已有登录页面；也可点击刷新数据重新读取。</p></div>}
      <p className="qianguanjia-data-scope">实际上传账户不一定都在千管家当前目录中。在素材中心读取本地记录后，可核对覆盖情况，并选择冻结账户和计划读取千川素材效果。</p>
      <button type="button" className="button secondary" disabled={busy||analysisBusy||!active} onClick={()=>{setAnalysisBusy(false);setTab('materials');}}>核对实际投放覆盖与效果</button>
    </section>
  </section>;
}
