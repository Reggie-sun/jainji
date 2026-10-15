import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianchuanPlanListSchema, QianchuanPlanCatalogSchema, QianchuanPlanDisplaySchema, type QianchuanCatalogCacheInfo, type QianchuanPlanOption, type QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection";
import { acquireQianchuanPlans } from "./qianchuan-plan-requests";
import { QianchuanSubaccountSelect, QIANCHUAN_ACCOUNT_CHANGED } from "./QianchuanSubaccountSelect";
import { retainQianchuanCatalogAfterFailure } from "./qianchuan-catalog-status";

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
  const [planCatalog, setPlanCatalog] = useState<{ binding: string; plans: QianchuanPlanOption[]; account?: QianchuanCurrentAccount; cache?: QianchuanCatalogCacheInfo }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [directoryAccount, setDirectoryAccount] = useState<{ product: string; anchor: string; current: QianchuanCurrentAccount; cache?: QianchuanCatalogCacheInfo }>();
  const [switching, setSwitching] = useState(false);
  const [membershipRecovered, setMembershipRecovered] = useState(false);
  const accountRead = useRef(onAccountRead); accountRead.current = onAccountRead;
  const change = useRef(onChange); change.current = onChange;
  const selected = useRef(value); selected.current = value;
  const product = account?.product, advertiserId = account?.advertiserId;
  const available = account?.available === true;
  const directorySupported = purpose === "upload" && typeof window !== "undefined" && typeof window.jianji.listQianchuanSubaccounts === "function" && typeof window.jianji.switchQianchuanSubaccount === "function";
  const directoryCurrent = directoryAccount && directoryAccount.product === product && directoryAccount.anchor === advertiserId ? directoryAccount.current : undefined;
  const binding = JSON.stringify([purpose, product ?? null, advertiserId ?? null, directorySupported ? directoryCurrent?.advertiserId ?? null : "saved"]);
  const scopedCatalog = planCatalog?.binding === binding ? planCatalog : undefined;
  const plans = scopedCatalog?.plans ?? [];
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
      setForceRefresh(true);
      setRevision(current => current + 1);
    }
  }, [membershipRecovered, disabled, switching]);
  useEffect(() => {
    if (purpose !== "upload") return;
    const refresh = () => { if (!disabled && !switching) { setForceRefresh(false); setRevision(current => current + 1); } };
    const accountChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.product === product && detail?.anchor === advertiserId) { change.current(undefined); setDirectoryAccount(undefined); accountRead.current?.(undefined); setForceRefresh(true); setRevision(value => value + 1); }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(QIANCHUAN_ACCOUNT_CHANGED, accountChanged);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener(QIANCHUAN_ACCOUNT_CHANGED, accountChanged); };
  }, [purpose, disabled, switching, product, advertiserId]);
  useEffect(() => {
    let active = true;
    const reportAccount = accountRead.current;
    setError(""); setLoading(false);
    if (!directorySupported) reportAccount?.(undefined);
    const targetAdvertiserId = directorySupported ? directoryCurrent?.advertiserId : advertiserId;
    if (targetAdvertiserId && selected.current && selected.current.advertiserId !== targetAdvertiserId) change.current(undefined);
    if (!product || !advertiserId || !available) return;
    if (directorySupported && !directoryCurrent) return;
    if (typeof window.jianji.listQianchuanPlans !== "function") {
      setError("计划读取接口尚未加载，请等待当前任务结束后重新打开简辑。");
      return;
    }
    setLoading(true);
    const request = acquireQianchuanPlans({ product, expectedAdvertiserId: advertiserId, displayCache: true,
      ...(forceRefresh ? { refresh: true } : {}),
      ...(purpose === "upload" ? { accountSource: "current-browser", includeAccount: true, ...(directoryCurrent ? { expectedCurrentAdvertiserId: directoryCurrent.advertiserId } : {}) } : {}) });
    void request.promise.then(result => {
      if (!active) return;
      const catalog = Array.isArray(result) ? undefined : "cache" in result ? QianchuanPlanDisplaySchema.parse(result) : QianchuanPlanCatalogSchema.parse(result);
      const next = catalog?.plans ?? QianchuanPlanListSchema.parse(result);
      let current = catalog && "account" in catalog ? catalog.account : undefined;
      current ??= next[0] ? { advertiserId: next[0].advertiserId } : undefined;
      if (directorySupported) {
        current ??= directoryCurrent;
        if (!current || current.advertiserId !== directoryCurrent?.advertiserId || next.some(plan => plan.advertiserId !== directoryCurrent.advertiserId)) throw new Error("网页子账户已变化，请刷新子账户后重新选择计划。");
      }
      if (purpose === "cleanup" && next.some(plan => plan.advertiserId !== advertiserId)) throw new Error("计划列表不属于所选账号，请重新读取。");
      const cache = catalog && "cache" in catalog ? catalog.cache : undefined;
      setPlanCatalog({ binding, plans: next, ...(current ? { account: current } : {}), ...(cache ? { cache } : {}) });
      if (purpose === "upload") reportAccount?.(current);
      if (!cache?.refreshFailed && selected.current && !next.some(plan => plan.advertiserId === selected.current?.advertiserId && plan.adId === selected.current?.adId)) change.current(undefined);
    }).catch(cause => {
      if (!active) return;
      const failedCache = retainQianchuanCatalogAfterFailure(planCatalog?.binding === binding ? planCatalog.cache : undefined);
      setPlanCatalog(previous => previous?.binding === binding ? { ...previous, cache: failedCache } : previous);
      if (purpose === "upload") {
        const retainedAccount = directoryCurrent ?? (planCatalog?.binding === binding ? planCatalog.account : undefined) ?? (selected.current ? { advertiserId: selected.current.advertiserId } : undefined);
        if (directoryCurrent) setDirectoryAccount(previous => previous?.product === product && previous.anchor === advertiserId ? { ...previous, cache: retainQianchuanCatalogAfterFailure(previous.cache) } : previous);
        reportAccount?.(retainedAccount);
      }
      setError(planReadError(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [product, advertiserId, available, revision, forceRefresh, purpose, directorySupported, directoryCurrent?.advertiserId, directoryCurrent?.name]);
  const chosen = value && plans.some(plan => plan.advertiserId === value.advertiserId && plan.adId === value.adId) ? value.adId : "";
  const chosenPlan = plans.find(plan => plan.adId === chosen);
  const identity = chosenPlan && `${chosenPlan.name} · ID ${chosenPlan.adId}`;
  const displayedAccount = scopedCatalog?.account ?? directoryCurrent;
  const accountLabel = displayedAccount && (displayedAccount.name ? `${displayedAccount.name} · 账户 ${displayedAccount.advertiserId}` : `网页账户 · 账户 ${displayedAccount.advertiserId}`);
  return <div className={`qianchuan-plan-select${compact ? " compact" : ""}`} style={{ gridColumn: compact ? undefined : "1 / -1", minWidth: 0 }}>
    {purpose === "upload" && <QianchuanSubaccountSelect key={`${product}:${advertiserId}`} account={account} disabled={disabled || loading || switching} idPrefix={idPrefix} refreshKey={revision} forceRefresh={forceRefresh}
      onAccountRead={(current, cache) => { setDirectoryAccount(current && product && advertiserId ? { product, anchor: advertiserId, current, ...(cache ? { cache } : {}) } : undefined); accountRead.current?.(current); }}
      onSwitching={value => { setSwitching(value); if (value) { change.current(undefined); setDirectoryAccount(undefined); accountRead.current?.(undefined); } }} />}
    <label htmlFor={`${idPrefix}-plan`}>{label}</label>
    <select id={`${idPrefix}-plan`} aria-label={label} title={identity || error || (loading ? "正在读取计划" : instruction)} value={chosen} disabled={disabled || loading || switching || !available || !plans.length}
      onChange={event => onChange(plans.find(plan => plan.adId === event.target.value))}>
      <option value="">{loading ? compact ? "正在准备…" : `正在准备${label}…` : error ? "读取失败，请重试" : !available ? "请先选择账号" : directorySupported && !directoryCurrent ? "请先选择子账户" : !plans.length ? "没有可用计划" : `请选择${label}`}</option>
      {plans.map(plan => <option key={plan.adId} value={plan.adId}>{plan.productNames?.length ? `${plan.productNames.join("、")} — ` : ""}{plan.name} · ID {plan.adId}</option>)}
    </select>
    <button type="button" className="text-button" aria-label="刷新计划" title="刷新计划" disabled={disabled || loading || switching || !available} onClick={() => { setForceRefresh(true); setRevision(current => current + 1); }}>{compact ? "↻" : "刷新计划"}</button>
    {!compact && chosenPlan && <div style={{ overflowWrap: "anywhere" }}><strong>{chosenPlan.productNames?.join("、") ?? "商品信息未读取"}</strong><p>计划名称：{chosenPlan.name}</p><small>计划 ID：{chosenPlan.adId}</small></div>}
    {error ? <p role="alert">{error}</p> : !compact && (purpose === "upload" && available && accountLabel ? <small style={{ gridColumn: "1 / -1", overflowWrap: "anywhere" }}>{accountLabel}</small> : purpose === "upload" && available && loading ? <small role="status" style={{ gridColumn: "1 / -1" }}>正在读取网页账户目录…</small> : directorySupported && available && !directoryCurrent ? <small role="status">等待网页子账户目录。</small> : loading ? <small role="status">{purpose === "cleanup" ? "只读取计划列表，不删除素材。" : "只读取计划列表，不上传视频。"}</small> : available && !plans.length ? <p role="status">该账号没有可用计划。</p> : available && !chosen ? <small>{instruction}</small> : null)}
  </div>;
}
