import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";

export function QianchuanPlanSelect({ account, value, onChange, disabled = false, idPrefix = "qianchuan" }: {
  account?: QianchuanAccountSummary; value?: QianchuanPlanOption;
  onChange(value?: QianchuanPlanOption): void; disabled?: boolean; idPrefix?: string;
}) {
  const [plans, setPlans] = useState<QianchuanPlanOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const product = account?.product, advertiserId = account?.advertiserId;
  const available = account?.available === true;
  useEffect(() => {
    let active = true;
    setPlans([]); setError(""); setLoading(false);
    if (selected.current && selected.current.advertiserId !== advertiserId) change.current(undefined);
    if (!product || !advertiserId || !available) return;
    if (revision === 0 && selected.current?.advertiserId === advertiserId) {
      // Restore this round's explicit choice; production admission revalidates the plan.
      setPlans([selected.current]);
      return;
    }
    if (typeof window.jianji.listQianchuanPlans !== "function") {
      setError("计划读取接口尚未加载，请等待当前任务结束后重新打开简辑。");
      return;
    }
    setLoading(true);
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId });
    void request.promise.then(result => {
      if (!active) return;
      const next = QianchuanPlanListSchema.parse(result);
      if (next.some(plan => plan.advertiserId !== advertiserId)) throw new Error("计划列表不属于所选账号，请重新读取。");
      setPlans(next);
      if (selected.current && !next.some(plan => plan.adId === selected.current?.adId)) change.current(undefined);
    }).catch(cause => {
      if (!active) return;
      change.current(undefined);
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "读取计划失败，请检查所选 Chrome 的登录状态。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, advertiserId, available, revision]);
  const chosen = value && value.advertiserId === advertiserId && plans.some(plan => plan.adId === value.adId) ? value.adId : "";
  return <div className="qianchuan-plan-select">
    <label htmlFor={`${idPrefix}-plan`}>上传计划</label>
    <select id={`${idPrefix}-plan`} aria-label="上传计划" value={chosen} disabled={disabled || loading || !plans.length}
      onChange={event => onChange(plans.find(plan => plan.adId === event.target.value))}>
      <option value="">{loading ? "正在读取 Chrome 账号的计划…" : "请选择上传计划"}</option>
      {plans.map(plan => <option key={plan.adId} value={plan.adId}>{plan.name} · {plan.adId}</option>)}
    </select>
    <button type="button" className="text-button" disabled={disabled || loading || !available} onClick={() => { onChange(undefined); setRevision(current => current + 1); }}>刷新计划</button>
    {loading ? <small role="status">只读取计划列表，不上传视频。</small> : error ? <p role="alert">{error}</p> : available && !plans.length ? <p role="status">该账号没有可用计划。</p> : available && !chosen ? <small>请明确选择计划后开始制作。</small> : null}
  </div>;
}
