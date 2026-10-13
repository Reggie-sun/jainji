import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanListSchema, QianchuanPlanCatalogSchema, type QianchuanPlanOption, type QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";
import { QianchuanSubaccountSelect, QIANCHUAN_ACCOUNT_CHANGED } from "./QianchuanSubaccountSelect";

function planReadError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.replace(/\u001b\[[0-9;]*m/g, "").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  if (/connectOverCDP/.test(message) && /timeout/i.test(message)) return "连接账号 Chrome 超时，请检查浏览器后刷新计划。";
  if (/connectOverCDP|ws:\/\/|Call log:/.test(message) || !message || message.length > 180) return "读取计划失败，请检查所选 Chrome 后刷新计划。";
  return message;
}

export function QianchuanPlanSelect({ account, value, onChange, onAccountRead, disabled = false, idPrefix = "qianchuan", compact = false, purpose = "upload" }: {
  account?: QianchuanAccountSummary; value?: QianchuanPlanOption;
  onChange(value?: QianchuanPlanOption): void; disabled?: boolean; idPrefix?: string; compact?: boolean; purpose?: "upload" | "cleanup";
  onAccountRead?(account?: QianchuanCurrentAccount): void;
}) {
  const label = purpose === "cleanup" ? "清理计划" : "上传计划";
  const instruction = purpose === "cleanup" ? "请明确选择计划后清理。" : "请明确选择计划后开始制作。";
  const [plans, setPlans] = useState<QianchuanPlanOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [currentAccount, setCurrentAccount] = useState<QianchuanCurrentAccount>();
  const [switching, setSwitching] = useState(false);
  const [membershipRecovered, setMembershipRecovered] = useState(false);
  const accountRead = useRef(onAccountRead); accountRead.current = onAccountRead;
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const product = account?.product, advertiserId = account?.advertiserId;
  const available = account?.available === true;
  useEffect(() => {
    if (typeof window.jianji.onMembership !== "function") return;
    let unavailable = false;
    return window.jianji.onMembership(status => {
      const recovered = unavailable && status.state === "allowed";
      unavailable = status.state === "unavailable";
      if (recovered) setMembershipRecovered(true);
      else if (status.state !== "allowed") setMembershipRecovered(false);
    });
  }, []);
  useEffect(() => {
    if (membershipRecovered && !disabled && !switching) {
      setMembershipRecovered(false);
      setRevision(current => current + 1);
    }
  }, [membershipRecovered, disabled, switching]);
  useEffect(() => {
    if (purpose !== "upload") return;
    const refresh = () => { if (!disabled && !switching) setRevision(current => current + 1); };
    const accountChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.product === product && detail?.anchor === advertiserId) { change.current(undefined); setCurrentAccount(undefined); accountRead.current?.(undefined); setRevision(value => value + 1); }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(QIANCHUAN_ACCOUNT_CHANGED, accountChanged);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener(QIANCHUAN_ACCOUNT_CHANGED, accountChanged); };
  }, [purpose, disabled, switching, product, advertiserId]);
  useEffect(() => {
    let active = true;
    const reportAccount = accountRead.current;
    setPlans([]); setError(""); setLoading(false);
    setCurrentAccount(undefined); reportAccount?.(undefined);
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
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId, ...(revision ? { refresh: true } : {}), ...(purpose === "upload" ? { accountSource: "current-browser", includeAccount: true } : {}) });
    void request.promise.then(result => {
      if (!active) return;
      const catalog = Array.isArray(result) ? undefined : QianchuanPlanCatalogSchema.parse(result);
      const next = catalog?.plans ?? QianchuanPlanListSchema.parse(result);
      if (purpose === "cleanup" && next.some(plan => plan.advertiserId !== advertiserId)) throw new Error("计划列表不属于所选账号，请重新读取。");
      setPlans(next);
      if (purpose === "upload") {
        const current = catalog?.account ?? (next[0] ? { advertiserId: next[0].advertiserId } : undefined);
        setCurrentAccount(current); reportAccount?.(current);
      }
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
    <select id={`${idPrefix}-plan`} aria-label={label} title={identity || error || (loading ? "正在读取计划" : instruction)} value={chosen} disabled={disabled || loading || switching || !available || !plans.length}
      onChange={event => onChange(plans.find(plan => plan.adId === event.target.value))}>
      <option value="">{loading ? compact ? "正在准备…" : `正在准备${label}…` : error ? "读取失败，请重试" : !available ? "请先选择账号" : !plans.length ? "没有可用计划" : `请选择${label}`}</option>
      {plans.map(plan => <option key={plan.adId} value={plan.adId}>{plan.productNames?.length ? `${plan.productNames.join("、")} — ` : ""}{plan.name} · ID {plan.adId}</option>)}
    </select>
    <button type="button" className="text-button" aria-label="刷新计划" title="刷新计划" disabled={disabled || loading || switching || !available} onClick={() => { onChange(undefined); setRevision(current => current + 1); }}>{compact ? "↻" : "刷新计划"}</button>
    {!compact && chosenPlan && <div style={{ overflowWrap: "anywhere" }}><strong>{chosenPlan.productNames?.join("、") ?? "商品信息未读取"}</strong><p>计划名称：{chosenPlan.name}</p><small>计划 ID：{chosenPlan.adId}</small></div>}
    {error ? <p role="alert">{error}</p> : purpose === "upload" && available && (currentAccount || loading) ? <small role={loading ? "status" : undefined} style={{ gridColumn: "1 / -1", overflowWrap: "anywhere" }}>{loading ? "正在核对网页子账户…" : `${currentAccount!.name ?? "网页账户"} · 账户 ${currentAccount!.advertiserId}`}</small> : !compact && (loading ? <small role="status">{purpose === "cleanup" ? "只读取计划列表，不删除素材。" : "只读取计划列表，不上传视频。"}</small> : available && !plans.length ? <p role="status">该账号没有可用计划。</p> : available && !chosen ? <small>{instruction}</small> : null)}
    {purpose === "upload" && <QianchuanSubaccountSelect key={`${product}:${advertiserId}`} account={account} current={currentAccount} disabled={disabled || loading || switching} idPrefix={idPrefix}
      onSwitching={value => { setSwitching(value); if (value) { change.current(undefined); accountRead.current?.(undefined); } }} />}
  </div>;
}
