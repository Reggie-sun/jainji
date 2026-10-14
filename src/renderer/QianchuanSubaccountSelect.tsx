import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanCatalogCacheInfo, QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts";
import { qianchuanCatalogStatus, retainQianchuanCatalogAfterFailure } from "./qianchuan-catalog-status";

export const QIANCHUAN_ACCOUNT_CHANGED = "jianji:qianchuan-account-changed";

function subaccountError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  return message && message.length < 180 && !/\w+:\/\/|Call log:|[\r\n]/.test(message) ? message : fallback;
}

export function QianchuanSubaccountSelect({ account, disabled, idPrefix, refreshKey, forceRefresh = false, onAccountRead, onSwitching }: {
  account?: QianchuanAccountSummary; disabled: boolean; idPrefix: string; refreshKey: number; forceRefresh?: boolean;
  onAccountRead(value?: QianchuanCurrentAccount, cache?: QianchuanCatalogCacheInfo): void; onSwitching(value: boolean): void;
}) {
  const [catalogState, setCatalogState] = useState<{ scope: string; catalog: QianchuanSubaccountCatalog }>();
  const [loading, setLoading] = useState(false), [switching, setSwitching] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const lastRevision = useRef(revision);
  const generation = useRef(0), report = useRef(onSwitching); report.current = onSwitching;
  const accountRead = useRef(onAccountRead); accountRead.current = onAccountRead;
  const product = account?.product, anchor = account?.advertiserId;
  const scope = JSON.stringify([product ?? null, anchor ?? null]);
  const scopedCatalog = catalogState?.scope === scope ? catalogState.catalog : undefined;
  const cache = scopedCatalog?.cache;
  const available = account?.available === true;
  const supported = typeof window !== "undefined" && typeof window.jianji.listQianchuanSubaccounts === "function" && typeof window.jianji.switchQianchuanSubaccount === "function";
  useEffect(() => {
    const operation = ++generation.current;
    const sameScope = catalogState?.scope === scope;
    const previousCatalog = sameScope ? catalogState.catalog : undefined;
    setError(""); setLoading(false);
    if (!sameScope) accountRead.current(undefined);
    if (!supported || !product || !anchor || !available) return;
    setLoading(true);
    const refresh = forceRefresh || revision !== lastRevision.current; lastRevision.current = revision;
    void window.jianji.listQianchuanSubaccounts({ product, expectedAdvertiserId: anchor, displayCache: true, ...(refresh ? { refresh: true } : {}) }).then(value => {
      if (generation.current !== operation) return;
      const next = QianchuanSubaccountCatalogSchema.parse(value);
      if (next.cache?.source === "cache" && next.cache.refreshFailed && previousCatalog) {
        setCatalogState({ scope, catalog: { ...previousCatalog, cache: next.cache } });
        accountRead.current(previousCatalog.current, next.cache);
        return;
      }
      setCatalogState({ scope, catalog: next });
      accountRead.current(next.current, next.cache);
    }).catch(cause => {
      if (generation.current !== operation) return;
      setError(subaccountError(cause, "读取子账户失败，请检查网页后刷新。"));
      if (sameScope && previousCatalog) {
        const retainedCache = retainQianchuanCatalogAfterFailure(previousCatalog.cache);
        setCatalogState(previous => previous?.scope === scope ? { ...previous, catalog: { ...previous.catalog, cache: retainedCache } } : previous);
        accountRead.current(previousCatalog.current, retainedCache);
      }
    })
      .finally(() => { if (generation.current === operation) setLoading(false); });
    return () => { generation.current++; };
  }, [product, anchor, available, supported, revision, refreshKey, forceRefresh]);
  const select = async (advertiserId: string) => {
    if (!scopedCatalog || !product || !anchor || disabled || switching || !scopedCatalog.accounts.some(value => value.advertiserId === advertiserId) || advertiserId === scopedCatalog.current.advertiserId) return;
    const operation = generation.current;
    setSwitching(true); setError(""); report.current(true);
    try {
      const changed = await window.jianji.switchQianchuanSubaccount({ product, expectedAdvertiserId: anchor, expectedCurrentAdvertiserId: scopedCatalog.current.advertiserId, advertiserId });
      if (generation.current !== operation) return;
      if (changed.advertiserId !== advertiserId) throw new Error("账户未能核对");
      setCatalogState(undefined);
      window.dispatchEvent(new CustomEvent(QIANCHUAN_ACCOUNT_CHANGED, { detail: { product, anchor } }));
    } catch (cause) {
      if (generation.current !== operation) return;
      setCatalogState(undefined);
      accountRead.current(undefined);
      setError(subaccountError(cause, "切换结果未能核对，请刷新子账户；未自动重试。"));
    } finally { setSwitching(false); report.current(false); }
  };
  if (!supported) return null;
  return <div className="qianchuan-subaccount-select" style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 28px", gap: 4, minWidth: 0 }}>
    <label htmlFor={`${idPrefix}-subaccount`} style={{ gridColumn: "1 / -1" }}>子账户</label>
    <select id={`${idPrefix}-subaccount`} aria-label="子账户" value={scopedCatalog?.current.advertiserId ?? ""} disabled={disabled || loading || switching || !available || !scopedCatalog} title={scopedCatalog ? `${scopedCatalog.current.name} · ${scopedCatalog.current.advertiserId}` : error}
      onChange={event => void select(event.target.value)}>
      {!scopedCatalog && <option value="">{switching ? "正在切换…" : loading ? "正在读取子账户…" : error ? "读取失败" : "等待网页账户核对"}</option>}
      {scopedCatalog?.accounts.map(child => <option key={child.advertiserId} value={child.advertiserId}>{child.name} · {child.advertiserId}</option>)}
    </select>
    <button type="button" className="text-button" aria-label="刷新子账户" title="刷新子账户" disabled={disabled || loading || switching || !available} onClick={() => setRevision(value => value + 1)}>↻</button>
    {qianchuanCatalogStatus(cache) && <small role="status" style={{ gridColumn: "1 / -1", overflowWrap: "anywhere" }}>{qianchuanCatalogStatus(cache)}</small>}
    {error && <small className="batch-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</small>}
  </div>;
}
