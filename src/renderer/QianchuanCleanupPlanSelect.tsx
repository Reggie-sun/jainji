import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanCatalogSchema, QianchuanPlanDisplaySchema, QianchuanPlanListSchema, type QianchuanCatalogCacheInfo, type QianchuanCurrentAccount, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";
import { retainQianchuanCatalogAfterFailure } from "./qianchuan-catalog-status";
import { QianchuanSubaccountSelect, QIANCHUAN_ACCOUNT_CHANGED } from "./QianchuanSubaccountSelect";

export function QianchuanCleanupPlanSelect({ account, value, onChange, disabled, onAccountRead }: {
  account: QianchuanAccountSummary; value?: QianchuanPlanOption[];
  onChange(value?: QianchuanPlanOption[]): void; disabled: boolean;
  onAccountRead?(value?: QianchuanCurrentAccount): void;
}) {
  const [planCatalog, setPlanCatalog] = useState<{ binding: string; plans: QianchuanPlanOption[]; cache?: QianchuanCatalogCacheInfo }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [directory, setDirectory] = useState<{ anchor: string; current: QianchuanCurrentAccount }>();
  const [switching, setSwitching] = useState(false);
  const supported = typeof window.jianji.listQianchuanSubaccounts === "function" && typeof window.jianji.switchQianchuanSubaccount === "function";
  const current = directory?.anchor === account.advertiserId ? directory.current : undefined;
  const targetId = supported ? current?.advertiserId : account.advertiserId;
  const binding = JSON.stringify([account.product, account.advertiserId, targetId]);
  const scopedCatalog = planCatalog?.binding === binding ? planCatalog : undefined;
  const plans = scopedCatalog?.plans ?? [];
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const { product, advertiserId, available } = account;
  const report = useRef(onAccountRead); report.current = onAccountRead;
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.product !== product || detail?.anchor !== advertiserId) return;
      change.current(undefined); setDirectory(undefined); report.current?.(undefined); setRevision(value => value + 1);
    };
    window.addEventListener(QIANCHUAN_ACCOUNT_CHANGED, refresh);
    return () => window.removeEventListener(QIANCHUAN_ACCOUNT_CHANGED, refresh);
  }, [product, advertiserId]);
  useEffect(() => {
    let active = true;
    const previousCatalog = planCatalog?.binding === binding ? planCatalog : undefined;
    const mismatched = targetId && selected.current?.some(plan => plan.advertiserId !== targetId);
    const previous = mismatched ? undefined : selected.current;
    if (mismatched) change.current(undefined);
    setError(""); setLoading(false);
    if (!available || supported && !current) return;
    if (typeof window.jianji.listQianchuanPlans !== "function") {
      setError("计划读取接口尚未加载，请等待当前任务结束后重新打开简辑。"); return;
    }
    setLoading(true);
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId, displayCache: true, ...(revision ? { refresh: true } : {}),
      ...(supported ? { accountSource: "current-browser", includeAccount: true, expectedCurrentAdvertiserId: targetId } : {}) });
    void request.promise.then(result => {
      if (!active) return;
      const catalog = Array.isArray(result) ? undefined : "cache" in result ? QianchuanPlanDisplaySchema.parse(result) : QianchuanPlanCatalogSchema.parse(result);
      const next = catalog?.plans ?? QianchuanPlanListSchema.parse(result);
      if (next.some(plan => plan.advertiserId !== targetId) || supported && catalog?.account?.advertiserId !== targetId) throw new Error("计划列表不属于所选子账户，请刷新子账户和计划。");
      const cache = catalog && "cache" in catalog ? catalog.cache : undefined;
      if (cache?.source === "cache" && cache.refreshFailed && previousCatalog) {
        setPlanCatalog({ ...previousCatalog, cache });
        return;
      }
      setPlanCatalog({ binding, plans: next, ...(cache ? { cache } : {}) });
      if (previous === undefined) change.current(next);
      else if (!cache?.refreshFailed) change.current(next.filter(plan => previous.some(item => item.adId === plan.adId)));
    }).catch(cause => {
      if (!active) return;
      if (previousCatalog) setPlanCatalog({ ...previousCatalog, cache: retainQianchuanCatalogAfterFailure(previousCatalog.cache) });
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "读取计划失败，请检查所选 Chrome 的登录状态。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, advertiserId, available, revision, binding, supported]);
  const chosen = plans.filter(plan => value?.some(item => item.advertiserId === targetId && item.adId === plan.adId));
  return <div className="qianchuan-cleanup-plan-select">
    {supported && <QianchuanSubaccountSelect account={account} disabled={disabled || switching} idPrefix={`cleanup-${product}`} refreshKey={revision} forceRefresh={revision > 0}
      onAccountRead={next => { setDirectory(next ? { anchor: advertiserId, current: next } : undefined); report.current?.(next); }}
      onSwitching={next => { setSwitching(next); if (next) { change.current(undefined); setDirectory(undefined); report.current?.(undefined); } }} />}
    <div className="qianchuan-cleanup-label"><span>已选 {chosen.length} / {plans.length} 个计划</span><div className="qianchuan-cleanup-buttons">
      <button type="button" className="qianchuan-cleanup-link" aria-label="全选清理计划" disabled={disabled || loading || !plans.length} onClick={() => onChange(chosen.length === plans.length ? [] : plans)}>{chosen.length === plans.length && plans.length ? "取消全选" : "全选"}</button>
      <button type="button" className="qianchuan-cleanup-link" disabled={disabled || loading || !available} onClick={() => setRevision(current => current + 1)}>刷新计划</button>
    </div></div>
    {plans.map(plan => <label className="qianchuan-cleanup-plan-option" key={plan.adId}>
      <input type="checkbox" aria-label={`清理计划 ${plan.adId}`} disabled={disabled || loading || switching} checked={chosen.some(item => item.adId === plan.adId)}
        onChange={event => onChange(event.target.checked ? plans.filter(item => item.adId === plan.adId || chosen.some(selected => selected.adId === item.adId)) : chosen.filter(item => item.adId !== plan.adId))} />
      <span><strong>{plan.productNames?.join("、") ?? plan.name}</strong><small>{plan.productNames ? `${plan.name} · ` : ""}ID {plan.adId}</small></span>
    </label>)}
    {error ? <p role="alert">{error}</p> : loading ? <small role="status">正在读取清理计划…</small> : !plans.length ? <p role="status">该账号没有可用计划。</p> : null}
  </div>;
}
