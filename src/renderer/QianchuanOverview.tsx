import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanCatalogSchema, QianchuanPlanDisplaySchema, type QianchuanCurrentAccount, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import type { QianchuanPage } from "./QianchuanWorkspace";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";
import { QianchuanSubaccountSelect, QIANCHUAN_ACCOUNT_CHANGED } from "./QianchuanSubaccountSelect";
import { qianchuanUploaded } from "./qianchuan-upload-status";

function QianchuanOverviewPlans({ account }: { account: QianchuanAccountSummary }) {
  const [directory, setDirectory] = useState<{ current: QianchuanCurrentAccount; revision: number; refresh: boolean }>();
  const [catalog, setCatalog] = useState<{ binding: string; plans: QianchuanPlanOption[] }>();
  const [revision, setRevision] = useState(0), [forceRefresh, setForceRefresh] = useState(false);
  const [loading, setLoading] = useState(false), [switching, setSwitching] = useState(false), [error, setError] = useState("");
  const { product, advertiserId: anchor } = account;
  const supported = typeof window.jianji.listQianchuanSubaccounts === "function" && typeof window.jianji.switchQianchuanSubaccount === "function" && typeof window.jianji.listQianchuanPlans === "function";
  const binding = JSON.stringify([product, anchor, directory?.current.advertiserId]);
  const plans = catalog?.binding === binding ? catalog.plans : undefined;
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.product !== product || detail.anchor !== anchor) return;
      setDirectory(undefined); setCatalog(undefined); setForceRefresh(true); setRevision(value => value + 1);
    };
    window.addEventListener(QIANCHUAN_ACCOUNT_CHANGED, changed);
    return () => window.removeEventListener(QIANCHUAN_ACCOUNT_CHANGED, changed);
  }, [product, anchor]);
  useEffect(() => {
    setLoading(false); setError("");
    if (!supported || !directory || directory.revision !== revision) return;
    let active = true;
    const current = directory.current.advertiserId;
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: anchor, displayCache: true, accountSource: "current-browser", includeAccount: true,
      expectedCurrentAdvertiserId: current, ...(forceRefresh || directory.refresh ? { refresh: true } : {}) });
    setLoading(true);
    void request.promise.then(value => {
      if (!active) return;
      if (Array.isArray(value)) throw new Error("账户信息缺失");
      const next = "cache" in value ? QianchuanPlanDisplaySchema.parse(value) : QianchuanPlanCatalogSchema.parse(value);
      if (next.account?.advertiserId !== current) throw new Error("子账户已变化");
      setCatalog(previous => "cache" in next && next.cache.source === "cache" && next.cache.refreshFailed && previous?.binding === binding ? previous : { binding, plans: next.plans });
    }).catch(() => {
      if (active) setError("读取计划失败，请检查所选子账户的网页后刷新。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, anchor, supported, directory, revision, forceRefresh, binding]);
  if (!supported) return <p role="alert">子账户与计划接口尚未加载，请等待当前任务结束后重新打开简辑。</p>;
  return <div className="qc-overview-catalog">
    <QianchuanSubaccountSelect account={account} disabled={loading || switching} idPrefix="qianchuan-overview" refreshKey={revision} forceRefresh={forceRefresh}
      onAccountRead={(current, cache) => setDirectory(current ? { current, revision, refresh: cache?.source === "live" } : undefined)}
      onSwitching={value => { setSwitching(value); if (value) { setDirectory(undefined); setCatalog(undefined); } }} />
    <div className="qc-section-heading"><p className="qc-help">{plans ? `共 ${plans.length} 个计划` : "选择子账户后查看计划"}</p>
      <button type="button" className="button secondary" disabled={loading || switching || !directory} onClick={() => { setForceRefresh(true); setRevision(value => value + 1); }}>刷新子账户与计划</button></div>
    {error && <p role="alert">{error}</p>}
    {(loading || switching) && <p role="status">{switching ? "正在切换子账户…" : "正在读取计划…"}</p>}
    {plans && (plans.length ? <div className="qianchuan-query-table"><table><thead><tr><th>关联商品</th><th>计划</th><th>计划 ID</th></tr></thead><tbody>
      {plans.map(plan => <tr key={plan.adId}><td>{plan.productNames?.join("、") ?? "商品信息未读取"}</td><td>{plan.name}</td><td>{plan.adId}</td></tr>)}
    </tbody></table></div> : <p className="qc-help">该子账户没有可用计划。</p>)}
  </div>;
}

export function QianchuanOverview({ state, onNavigate, active = true }: { state: DesktopState; onNavigate(page: QianchuanPage): void; active?: boolean }) {
  const accounts = state.douyinUpload?.accounts ?? [];
  const [product, setProduct] = useState<string>(accounts.find(account => account.available)?.product ?? "");
  const account = accounts.find(item => item.product === product) ?? accounts.find(item => item.available) ?? accounts[0];
  const tasks = state.douyinUpload?.tasks.filter(task => task.project_id === state.project.id && task.state !== "DISCARDED") ?? [];
  const unknown = tasks.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED").length;
  return <section className="qianchuan-console qc-overview" aria-label="千川投放概览">
    <div className="qc-overview-summary">
      <div><span>登录账号</span><strong>{accounts.length}</strong><small>已保存的浏览器账号</small></div>
      <div><span>本项目任务</span><strong>{tasks.length}</strong><small>当前项目的上传任务</small></div>
      <div><span>本项目上传</span><strong>{tasks.filter(qianchuanUploaded).length}<small> / {tasks.length}</small></strong><small>已上传 / 全部任务</small></div>
      <div><span>上传结果待核查</span><strong>{unknown}</strong><small>结果未知的任务不可重传</small></div>
    </div>
    <section className="qc-card">
      <div className="qc-section-heading"><div><h2>账户与保存计划</h2><p className="qc-help">按登录账号查看子账户、计划及关联商品</p></div><button type="button" className="button secondary" onClick={() => onNavigate("accounts")}>管理账号与计划</button></div>
      {account ? <>
        <label className="qc-overview-account">登录账号<select aria-label="概览登录账号" value={account.product} onChange={event => setProduct(event.target.value)}>
          {accounts.map(item => <option key={item.product} value={item.product}>{qianchuanAccountName(item)} · {item.advertiserId}</option>)}
        </select></label>
        {active && (account.available ? <QianchuanOverviewPlans key={JSON.stringify([account.product, account.advertiserId, account.browserPort, account.egress])} account={account} /> : <p className="qc-help">该登录账号配置需要检查，请先管理账号与计划。</p>)}
      </> : <p className="qc-help">还没有账户配置。先添加账号与计划，再安排上传或查询数据。</p>}
    </section>
    <div className="qc-overview-links"><button type="button" onClick={() => onNavigate("reports")}><strong>查询计划与数据 →</strong><span>预算、ROI、素材表现与历史报表</span></button><button type="button" onClick={() => onNavigate("uploads")}><strong>查看上传任务 →</strong><span>{unknown ? `${unknown} 条结果未知，请核查原页面` : state.douyinUpload?.message || "查看本项目的上传进度与记录"}</span></button></div>
  </section>;
}
