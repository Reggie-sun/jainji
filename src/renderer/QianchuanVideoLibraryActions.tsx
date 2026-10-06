import { useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { QianchuanCleanupResults } from "./QianchuanCleanupResults";
import { QianchuanPlanSelect } from "./QianchuanPlanSelect";
import { QianchuanVideoLibrarySchedule } from "./QianchuanVideoLibrarySchedule";
import "./qianchuan-cleanup.css";

export function QianchuanVideoLibraryActions({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [products, setProducts] = useState<QianchuanProduct[]>();
  const [selected, setSelected] = useState<QianchuanLibraryClear>();
  const [plans, setPlans] = useState<Partial<Record<QianchuanProduct, QianchuanPlanOption>>>({});
  const [planMaterials, setPlanMaterials] = useState(true);
  const [videoLibrary, setVideoLibrary] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<QianchuanLibraryResult[]>([]);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const chosen = configured.filter(account => products === undefined || products.includes(account.product));
  const disabled = busy || running;
  const chosenPlan = (account: QianchuanAccountSummary) => plans[account.product]?.advertiserId === account.advertiserId ? plans[account.product] : undefined;
  const plansReady = !planMaterials || chosen.every(account => chosenPlan(account));
  const selectionCurrent = !selected || selected.accounts.every(target => configured.some(account => account.product === target.product && account.advertiserId === target.expectedAdvertiserId));
  const selectedPlanMaterials = selected?.confirmation !== "DELETE_ALL_VIDEOS";
  const selectedVideoLibrary = selected?.confirmation !== "DELETE_PLAN_MATERIALS";
  const clear = async () => {
    if (!selected || disabled || !selectionCurrent) return;
    setRunning(true); setError(""); setResults([]);
    try {
      const result = await window.jianji.clearQianchuanVideoLibraries(selected);
      setResults(result); setSelected(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "素材清理未完成。"); }
    finally { setRunning(false); }
  };
  return <div className="qianchuan-cleanup" aria-label="千川素材清理">
    <section className="qianchuan-cleanup-card" aria-label="立即清理素材">
      <div className="qianchuan-cleanup-heading"><h3>素材清理</h3><span>按账号和所选计划清理千川素材</span></div>
      {!selected ? <>
        <div className="qianchuan-cleanup-label"><strong>选择账号</strong><button type="button" className="qianchuan-cleanup-link" disabled={disabled || !configured.length} onClick={() => setProducts(chosen.length === configured.length ? [] : undefined)}>{chosen.length === configured.length ? "取消全选" : "全选"}</button></div>
        <div className="qianchuan-cleanup-accounts">
          {configured.map(account => <label key={account.product}><input type="checkbox" disabled={disabled} checked={chosen.some(item => item.product === account.product)} onChange={event => setProducts(event.target.checked ? [...chosen.map(item => item.product), account.product] : chosen.filter(item => item.product !== account.product).map(item => item.product))} />{qianchuanProductName(account.product, accounts)}</label>)}
          {!configured.length && <p>请先配置千川账号。</p>}
        </div>
        {planMaterials && !!chosen.length && <div className="qianchuan-cleanup-plans">
          <strong>选择清理计划</strong><small>每个账号明确选择一个计划；同一账号的其他计划不清理。可换计划后再次清理。</small>
          {chosen.map(account => <div className="qianchuan-cleanup-plan" key={`${account.product}:${account.advertiserId}`}>
            <strong>{qianchuanProductName(account.product, accounts)} · 账户 {account.advertiserId}</strong>
            <QianchuanPlanSelect account={account} value={chosenPlan(account)} purpose="cleanup" disabled={disabled} idPrefix={`cleanup-${account.product}`}
              onChange={plan => setPlans(current => ({ ...current, [account.product]: plan }))} />
          </div>)}
        </div>}
        <fieldset className="qianchuan-cleanup-options" disabled={disabled}><legend>清理内容</legend>
          <label><input type="checkbox" checked={planMaterials} onChange={event => setPlanMaterials(event.target.checked)} /><span><strong>计划内三类素材</strong><small>审核不通过、生态审核不通过、审核通过可优化。三类一起筛选，普通审核通过保留。</small></span></label>
          <label><input type="checkbox" checked={videoLibrary} onChange={event => setVideoLibrary(event.target.checked)} /><span><strong>视频库全部视频</strong><small>清空整个账号素材库，不按计划筛选；已使用视频的在投创意和计划不受影响。</small></span></label>
        </fieldset>
        <div className="qianchuan-cleanup-footer"><small>{plansReady ? "本地视频和上传记录保留。" : "请为每个所选账号选择清理计划。"}</small><button className="button primary" type="button" disabled={disabled || !chosen.length || !plansReady || (!planMaterials && !videoLibrary)} onClick={() => {
          setSelected({ confirmation: planMaterials ? videoLibrary ? "DELETE_VIDEOS_AND_PLAN_MATERIALS" : "DELETE_PLAN_MATERIALS" : "DELETE_ALL_VIDEOS", accounts: chosen.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId, ...(planMaterials ? { expectedAdId: chosenPlan(account)!.adId, plan: chosenPlan(account)! } : {}) })) }); setError("");
        }}>清理所选{planMaterials ? "计划" : "账号"}{chosen.length ? `（${chosen.length}）` : ""}</button></div>
      </> : <div className="qianchuan-cleanup-confirm" role="group" aria-label="确认素材清理">
        <h4>确认清理 {selected.accounts.length} 个{selectedPlanMaterials ? "计划" : "账号"}？</h4>
        <p>将永久删除以下内容，不备份视频：</p>
        {selectedPlanMaterials && <p><strong>所选计划内三类素材</strong> · 审核不通过、生态审核不通过、审核通过可优化。可能影响这些素材的投放；其他计划不清理。</p>}
        {selectedVideoLibrary && <p><strong>视频库全部视频</strong> · 清空整个账号素材库，不按计划筛选；已使用视频的在投创意和计划不受影响。</p>}
        <ul>{selected.accounts.map(account => <li key={account.product}><strong>{qianchuanProductName(account.product, accounts)}</strong><span>账户 {account.expectedAdvertiserId}{selectedPlanMaterials ? ` · 计划 ${account.plan?.name} · ID ${account.expectedAdId}` : ""}</span></li>)}</ul>
        {!selectionCurrent && <p role="alert">账号设置已变化，请取消并重新选择清理范围。</p>}
        <p>本地视频和原上传记录保留。</p>
        <div className="qianchuan-cleanup-buttons"><button className="button secondary" type="button" disabled={running} onClick={() => setSelected(undefined)}>取消</button><button className="button qianchuan-cleanup-danger" type="button" disabled={disabled || !selectionCurrent} onClick={() => void clear()}>{running ? "正在清理…" : `确认删除${selectedPlanMaterials && selectedVideoLibrary ? "两类内容" : selectedPlanMaterials ? "三类计划素材" : "全部库视频"}（${selected.accounts.length} 个账号）`}</button></div>
      </div>}
      {running && <p role="status">正在清理所选账号，请保持对应 Chrome 打开。</p>}
      {error && <p className="qianchuan-cleanup-error" role="alert">{error}</p>}
      {!!results.length && <QianchuanCleanupResults title="本次清理" results={results} accounts={accounts} />}
    </section>
    <QianchuanVideoLibrarySchedule accounts={accounts} busy={disabled || !!selected} />
  </div>;
}
