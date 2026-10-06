import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";

export function QianchuanCleanupPlanSelect({ account, value, onChange, disabled }: {
  account: QianchuanAccountSummary; value?: QianchuanPlanOption[];
  onChange(value?: QianchuanPlanOption[]): void; disabled: boolean;
}) {
  const [plans, setPlans] = useState<QianchuanPlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const { product, advertiserId, available } = account;
  useEffect(() => {
    let active = true;
    const previous = revision === 0 && selected.current?.every(plan => plan.advertiserId === advertiserId) ? selected.current : undefined;
    change.current(undefined); setPlans([]); setError(""); setLoading(false);
    if (!available) return;
    if (typeof window.jianji.listQianchuanPlans !== "function") {
      setError("计划读取接口尚未加载，请等待当前任务结束后重新打开简辑。"); return;
    }
    setLoading(true);
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId, ...(revision ? { refresh: true } : {}) });
    void request.promise.then(result => {
      if (!active) return;
      const next = QianchuanPlanListSchema.parse(result);
      if (next.some(plan => plan.advertiserId !== advertiserId)) throw new Error("计划列表不属于所选账号，请重新读取。");
      setPlans(next);
      change.current(previous === undefined ? next : next.filter(plan => previous.some(item => item.adId === plan.adId)));
    }).catch(cause => {
      if (!active) return;
      change.current(undefined);
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "读取计划失败，请检查所选 Chrome 的登录状态。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, advertiserId, available, revision]);
  const chosen = plans.filter(plan => value?.some(item => item.advertiserId === advertiserId && item.adId === plan.adId));
  return <div className="qianchuan-cleanup-plan-select">
    <div className="qianchuan-cleanup-label"><span>已选 {chosen.length} / {plans.length} 个计划</span><div className="qianchuan-cleanup-buttons">
      <button type="button" className="qianchuan-cleanup-link" aria-label="全选清理计划" disabled={disabled || loading || !plans.length} onClick={() => onChange(chosen.length === plans.length ? [] : plans)}>{chosen.length === plans.length && plans.length ? "取消全选" : "全选"}</button>
      <button type="button" className="qianchuan-cleanup-link" disabled={disabled || loading || !available} onClick={() => { onChange(undefined); setRevision(current => current + 1); }}>刷新计划</button>
    </div></div>
    {plans.map(plan => <label className="qianchuan-cleanup-plan-option" key={plan.adId}>
      <input type="checkbox" aria-label={`清理计划 ${plan.adId}`} disabled={disabled || loading} checked={chosen.some(item => item.adId === plan.adId)}
        onChange={event => onChange(event.target.checked ? plans.filter(item => item.adId === plan.adId || chosen.some(selected => selected.adId === item.adId)) : chosen.filter(item => item.adId !== plan.adId))} />
      <span><strong>{plan.productNames?.join("、") ?? plan.name}</strong><small>{plan.productNames ? `${plan.name} · ` : ""}ID {plan.adId}</small></span>
    </label>)}
    {error ? <p role="alert">{error}</p> : loading ? <small role="status">正在读取清理计划…</small> : !plans.length ? <p role="status">该账号没有可用计划。</p> : null}
  </div>;
}
