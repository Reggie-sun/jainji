import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";

function planReadError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.replace(/\u001b\[[0-9;]*m/g, "").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  if (/connectOverCDP/.test(message) && /timeout/i.test(message)) return "连接账号 Chrome 超时，请检查浏览器后刷新计划。";
  if (/connectOverCDP|ws:\/\/|Call log:/.test(message) || !message || message.length > 180) return "读取计划失败，请检查所选 Chrome 后刷新计划。";
  return message;
}

export function QianchuanPlanSelect({ account, value, onChange, disabled = false, idPrefix = "qianchuan", compact = false, purpose = "upload" }: {
  account?: QianchuanAccountSummary; value?: QianchuanPlanOption;
  onChange(value?: QianchuanPlanOption): void; disabled?: boolean; idPrefix?: string; compact?: boolean; purpose?: "upload" | "cleanup";
}) {
  const label = purpose === "cleanup" ? "清理计划" : "上传计划";
  const instruction = purpose === "cleanup" ? "请明确选择计划后清理。" : "请明确选择计划后开始制作。";
  const [plans, setPlans] = useState<QianchuanPlanOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const product = account?.product, advertiserId = account?.advertiserId;
  const available = account?.available === true;
  useEffect(() => {
    if (purpose !== "upload") return;
    const refresh = () => { if (!disabled) setRevision(current => current + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [purpose, disabled]);
  useEffect(() => {
    let active = true;
    setPlans([]); setError(""); setLoading(false);
    if (purpose === "cleanup" && selected.current && selected.current.advertiserId !== advertiserId) change.current(undefined);
    if (!product || !advertiserId || !available) return;
    if (purpose === "cleanup" && revision === 0 && selected.current?.advertiserId === advertiserId) {
      // Restore this round's explicit choice; production admission revalidates the plan.
      setPlans([selected.current]);
      return;
    }
    if (typeof window.jianji.listQianchuanPlans !== "function") {
      setError("计划读取接口尚未加载，请等待当前任务结束后重新打开简辑。");
      return;
    }
    setLoading(true);
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId, ...(revision ? { refresh: true } : {}), ...(purpose === "upload" ? { accountSource: "current-browser" } : {}) });
    void request.promise.then(result => {
      if (!active) return;
      const next = QianchuanPlanListSchema.parse(result);
      if (purpose === "cleanup" && next.some(plan => plan.advertiserId !== advertiserId)) throw new Error("计划列表不属于所选账号，请重新读取。");
      setPlans(next);
      if (selected.current && !next.some(plan => plan.advertiserId === selected.current?.advertiserId && plan.adId === selected.current?.adId)) change.current(undefined);
    }).catch(cause => {
      if (!active) return;
      change.current(undefined);
      setError(planReadError(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, advertiserId, available, revision, purpose]);
  const chosen = value && plans.some(plan => plan.advertiserId === value.advertiserId && plan.adId === value.adId) ? value.adId : "";
  const chosenPlan = plans.find(plan => plan.adId === chosen);
  const identity = chosenPlan && `${chosenPlan.name} · ID ${chosenPlan.adId}`;
  return <div className={`qianchuan-plan-select${compact ? " compact" : ""}`} style={{ gridColumn: compact ? undefined : "1 / -1", minWidth: 0 }}>
    <label htmlFor={`${idPrefix}-plan`}>{label}</label>
    <select id={`${idPrefix}-plan`} aria-label={label} title={identity || error || (loading ? "正在读取计划" : instruction)} value={chosen} disabled={disabled || loading || !available || !plans.length}
      onChange={event => onChange(plans.find(plan => plan.adId === event.target.value))}>
      <option value="">{loading ? compact ? "正在准备…" : `正在准备${label}…` : error ? "读取失败，请重试" : !available ? "请先选择账号" : !plans.length ? "没有可用计划" : `请选择${label}`}</option>
      {plans.map(plan => <option key={plan.adId} value={plan.adId}>{plan.productNames?.length ? `${plan.productNames.join("、")} — ` : ""}{plan.name} · ID {plan.adId}</option>)}
    </select>
    <button type="button" className="text-button" aria-label="刷新计划" title="刷新计划" disabled={disabled || loading || !available} onClick={() => { onChange(undefined); setRevision(current => current + 1); }}>{compact ? "↻" : "刷新计划"}</button>
    {!compact && chosenPlan && <div style={{ overflowWrap: "anywhere" }}><strong>{chosenPlan.productNames?.join("、") ?? "商品信息未读取"}</strong><p>计划名称：{chosenPlan.name}</p><small>计划 ID：{chosenPlan.adId}</small></div>}
    {error ? <p role="alert">{error}</p> : purpose === "upload" && available && (plans.length > 0 || loading) ? <small role={loading ? "status" : undefined} style={{ gridColumn: "1 / -1", overflowWrap: "anywhere" }}>{loading ? "正在核对网页子账户…" : `账户 ${plans[0]!.advertiserId}`}</small> : !compact && (loading ? <small role="status">{purpose === "cleanup" ? "只读取计划列表，不删除素材。" : "只读取计划列表，不上传视频。"}</small> : available && !plans.length ? <p role="status">该账号没有可用计划。</p> : available && !chosen ? <small>{instruction}</small> : null)}
  </div>;
}
