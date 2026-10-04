import { useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary, type QianchuanProduct } from "../shared/qianchuan-account";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library";
import { QianchuanCleanupResults } from "./QianchuanCleanupResults";
import { QianchuanVideoLibrarySchedule } from "./QianchuanVideoLibrarySchedule";
import "./qianchuan-cleanup.css";

export function QianchuanVideoLibraryActions({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [products, setProducts] = useState<QianchuanProduct[]>();
  const [selected, setSelected] = useState<QianchuanAccountSummary[]>();
  const [planMaterials, setPlanMaterials] = useState(true);
  const [videoLibrary, setVideoLibrary] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<QianchuanLibraryResult[]>([]);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const chosen = configured.filter(account => products === undefined || products.includes(account.product));
  const disabled = busy || running;
  const clear = async () => {
    if (!selected || disabled) return;
    setRunning(true); setError(""); setResults([]);
    try {
      const result = await window.jianji.clearQianchuanVideoLibraries({ confirmation: planMaterials ? videoLibrary ? "DELETE_VIDEOS_AND_PLAN_MATERIALS" : "DELETE_PLAN_MATERIALS" : "DELETE_ALL_VIDEOS", accounts: selected.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId, ...(planMaterials ? { expectedAdId: account.adId } : {}) })) });
      setResults(result); setSelected(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "素材清理未完成。"); }
    finally { setRunning(false); }
  };
  return <div className="qianchuan-cleanup" aria-label="千川素材清理">
    <section className="qianchuan-cleanup-card" aria-label="立即清理素材">
      <div className="qianchuan-cleanup-heading"><h3>素材清理</h3><span>按账号清理千川素材</span></div>
      {!selected ? <>
        <div className="qianchuan-cleanup-label"><strong>选择账号</strong><button type="button" className="qianchuan-cleanup-link" disabled={disabled || !configured.length} onClick={() => setProducts(chosen.length === configured.length ? [] : undefined)}>{chosen.length === configured.length ? "取消全选" : "全选"}</button></div>
        <div className="qianchuan-cleanup-accounts">
          {configured.map(account => <label key={account.product}><input type="checkbox" disabled={disabled} checked={chosen.some(item => item.product === account.product)} onChange={event => setProducts(event.target.checked ? [...chosen.map(item => item.product), account.product] : chosen.filter(item => item.product !== account.product).map(item => item.product))} />{qianchuanProductName(account.product, accounts)}</label>)}
          {!configured.length && <p>请先配置千川账号。</p>}
        </div>
        <fieldset className="qianchuan-cleanup-options" disabled={disabled}><legend>清理内容</legend>
          <label><input type="checkbox" checked={planMaterials} onChange={event => setPlanMaterials(event.target.checked)} /><span><strong>计划内三类素材</strong><small>审核不通过、生态审核不通过、审核通过可优化。三类一起筛选，普通审核通过保留。</small></span></label>
          <label><input type="checkbox" checked={videoLibrary} onChange={event => setVideoLibrary(event.target.checked)} /><span><strong>视频库全部视频</strong><small>清空账号素材库；已使用视频的在投创意和计划不受影响。</small></span></label>
        </fieldset>
        <div className="qianchuan-cleanup-footer"><small>本地视频和上传记录保留。</small><button className="button primary" type="button" disabled={disabled || !chosen.length || (!planMaterials && !videoLibrary)} onClick={() => { setSelected(chosen); setError(""); }}>清理所选账号{chosen.length ? `（${chosen.length}）` : ""}</button></div>
      </> : <div className="qianchuan-cleanup-confirm" role="group" aria-label="确认素材清理">
        <h4>确认清理 {selected.length} 个账号？</h4>
        <p>将永久删除以下内容，不备份视频：</p>
        {planMaterials && <p><strong>计划内三类素材</strong> · 审核不通过、生态审核不通过、审核通过可优化。可能影响这些素材的投放。</p>}
        {videoLibrary && <p><strong>视频库全部视频</strong> · 清空账号素材库；已使用视频的在投创意和计划不受影响。</p>}
        <ul>{selected.map(account => <li key={account.product}><strong>{qianchuanProductName(account.product, accounts)}</strong><span>账户 {account.advertiserId}{planMaterials ? ` · 计划 ${account.adId}` : ""}</span></li>)}</ul>
        <p>本地视频和原上传记录保留。</p>
        <div className="qianchuan-cleanup-buttons"><button className="button secondary" type="button" disabled={running} onClick={() => setSelected(undefined)}>取消</button><button className="button qianchuan-cleanup-danger" type="button" disabled={disabled} onClick={() => void clear()}>{running ? "正在清理…" : `确认删除${planMaterials && videoLibrary ? "两类内容" : planMaterials ? "三类计划素材" : "全部库视频"}（${selected.length} 个账号）`}</button></div>
      </div>}
      {running && <p role="status">正在清理所选账号，请保持对应 Chrome 打开。</p>}
      {error && <p className="qianchuan-cleanup-error" role="alert">{error}</p>}
      {!!results.length && <QianchuanCleanupResults title="本次清理" results={results} accounts={accounts} />}
    </section>
    <QianchuanVideoLibrarySchedule accounts={accounts} busy={disabled || !!selected} />
  </div>;
}
