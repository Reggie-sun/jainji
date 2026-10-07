import { useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { QianchuanCleanupResults } from "./QianchuanCleanupResults";
import { QianchuanCleanupPlanSelect } from "./QianchuanCleanupPlanSelect";
import { QianchuanVideoLibrarySchedule } from "./QianchuanVideoLibrarySchedule";
import "./qianchuan-cleanup.css";

export function QianchuanVideoLibraryActions({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [products, setProducts] = useState<QianchuanProduct[]>();
  const [selected, setSelected] = useState<QianchuanLibraryClear>();
  const [plans, setPlans] = useState<Partial<Record<QianchuanProduct, QianchuanPlanOption[]>>>({});
  const [auditMaterials, setAuditMaterials] = useState(true);
  const [videoLibrary, setVideoLibrary] = useState(false);
  const [zeroImpressions, setZeroImpressions] = useState(true);
  const planMaterials = auditMaterials || zeroImpressions;
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<QianchuanLibraryResult[]>([]);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const chosen = configured.filter(account => products === undefined || products.includes(account.product));
  const disabled = busy || running;
  const chosenPlans = (account: QianchuanAccountSummary) => plans[account.product]?.every(plan => plan.advertiserId === account.advertiserId) ? plans[account.product] : undefined;
  const planCount = chosen.reduce((count, account) => count + (chosenPlans(account)?.length ?? 0), 0);
  const plansReady = !planMaterials || chosen.every(account => chosenPlans(account)?.length);
  const selectionCurrent = !selected || selected.accounts.every(target => configured.some(account => account.product === target.product && account.advertiserId === target.expectedAdvertiserId));
  const selectedPlanMaterials = selected?.confirmation !== "DELETE_ALL_VIDEOS";
  const selectedVideoLibrary = selected?.confirmation !== "DELETE_PLAN_MATERIALS";
  const clear = async (request = selected) => {
    if (!request || disabled || !selectionCurrent) return;
    setRunning(true); setError(""); setResults([]);
    try {
      const result = await window.jianji.clearQianchuanVideoLibraries(request);
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
          <strong>选择清理计划</strong><small>默认选择各账号的所有计划，可取消不需要清理的计划。</small>
          {chosen.map(account => <div className="qianchuan-cleanup-plan" key={`${account.product}:${account.advertiserId}`}>
            <strong>{qianchuanProductName(account.product, accounts)} · 账户 {account.advertiserId}</strong>
            <QianchuanCleanupPlanSelect account={account} value={chosenPlans(account)} disabled={disabled}
              onChange={next => setPlans(current => ({ ...current, [account.product]: next }))} />
          </div>)}
        </div>}
        <fieldset className="qianchuan-cleanup-options" disabled={disabled}><legend>清理内容</legend>
          <p>计划素材仅清理“投放中”的素材，自动切换为100条/页，逐页核对所选规则。</p>
          <label><input type="checkbox" checked={auditMaterials} onChange={event => setAuditMaterials(event.target.checked)} /><span><strong>计划内三类素材</strong><small>审核不通过、生态审核不通过、审核通过可优化。按审核状态清理，不受零展示规则的48小时保护限制。</small></span></label>
          <label><input type="checkbox" checked={zeroImpressions} onChange={event => { setZeroImpressions(event.target.checked); if (event.target.checked) setVideoLibrary(false); }} /><span><strong>近7天零展示素材</strong><small>仅清理首次加入计划已满48小时的素材；可与三类审核素材同时选择，符合任一勾选规则即清理。</small></span></label>
          {planMaterials && zeroImpressions && <p>零展示规则自动删除所选计划中最近7个完整自然日（北京时间）整体展示次数为0、且首次加入计划已满48小时的素材。程序逐页核对并确认，无需逐批操作；日期或数据无法核对时停止。本地视频和上传记录保留。</p>}
          <label><input type="checkbox" checked={videoLibrary} disabled={planMaterials && zeroImpressions} onChange={event => setVideoLibrary(event.target.checked)} /><span><strong>视频库全部视频</strong><small>清空整个账号素材库，不按计划筛选；已使用视频的在投创意和计划不受影响。</small></span></label>
        </fieldset>
        <div className="qianchuan-cleanup-footer"><small>{plansReady ? "本地视频和上传记录保留。" : "请为每个所选账号选择清理计划。"}</small><button className="button primary" type="button" disabled={disabled || !chosen.length || !plansReady || (!planMaterials && !videoLibrary)} onClick={() => {
          const request: QianchuanLibraryClear = { confirmation: planMaterials ? videoLibrary ? "DELETE_VIDEOS_AND_PLAN_MATERIALS" : "DELETE_PLAN_MATERIALS" : "DELETE_ALL_VIDEOS", ...(planMaterials && zeroImpressions ? { planMaterialRule: auditMaterials ? "AUDIT_AND_ZERO_IMPRESSIONS_7D" as const : "ZERO_IMPRESSIONS_7D" as const } : {}), accounts: chosen.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId, ...(planMaterials ? { plans: chosenPlans(account)! } : {}) })) };
          if (request.planMaterialRule) void clear(request); else setSelected(request); setError("");
        }}>{planMaterials && zeroImpressions ? auditMaterials ? "自动删除所选两类素材" : "自动删除零展示素材" : `清理所选${planMaterials ? "计划" : "账号"}`}{(planMaterials ? planCount : chosen.length) ? `（${planMaterials ? planCount : chosen.length}）` : ""}</button></div>
      </> : <div className="qianchuan-cleanup-confirm" role="group" aria-label="确认素材清理">
        <h4>确认清理 {selected.accounts.length} 个账号{selectedPlanMaterials ? `、${selected.accounts.reduce((count, account) => count + (account.plans?.length ?? 0), 0)} 个计划` : ""}？</h4>
        <p>将永久删除以下内容，不备份视频：</p>
        {selectedPlanMaterials && <p><strong>所选计划内三类素材</strong> · 审核不通过、生态审核不通过、审核通过可优化。可能影响这些素材的投放；其他计划不清理。</p>}
        {selectedVideoLibrary && <p><strong>视频库全部视频</strong> · 清空整个账号素材库，不按计划筛选；已使用视频的在投创意和计划不受影响。</p>}
        <ul>{selected.accounts.map(account => <li key={account.product}><strong>{qianchuanProductName(account.product, accounts)}</strong><span>账户 {account.expectedAdvertiserId}</span>{selectedPlanMaterials && account.plans?.map(plan => <span key={plan.adId}>{plan.name} · ID {plan.adId}</span>)}</li>)}</ul>
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
