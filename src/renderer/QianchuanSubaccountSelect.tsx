import { useEffect, useRef, useState } from "react";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection";
import { QianchuanSubaccountCatalogSchema, type QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts";

export const QIANCHUAN_ACCOUNT_CHANGED = "jianji:qianchuan-account-changed";

function subaccountError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  return message && message.length < 180 && !/\w+:\/\/|Call log:|[\r\n]/.test(message) ? message : fallback;
}

export function QianchuanSubaccountSelect({ account, disabled, idPrefix, refreshKey, onAccountRead, onSwitching }: {
  account?: QianchuanAccountSummary; disabled: boolean; idPrefix: string; refreshKey: number;
  onAccountRead(value?: QianchuanCurrentAccount): void; onSwitching(value: boolean): void;
}) {
  const [catalog, setCatalog] = useState<QianchuanSubaccountCatalog>();
  const [loading, setLoading] = useState(false), [switching, setSwitching] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), report = useRef(onSwitching); report.current = onSwitching;
  const accountRead = useRef(onAccountRead); accountRead.current = onAccountRead;
  const product = account?.product, anchor = account?.advertiserId;
  const available = account?.available === true;
  const supported = typeof window !== "undefined" && typeof window.jianji.listQianchuanSubaccounts === "function" && typeof window.jianji.switchQianchuanSubaccount === "function";
  useEffect(() => {
    const operation = ++generation.current;
    setCatalog(undefined); setError(""); setLoading(false);
    accountRead.current(undefined);
    if (!supported || !product || !anchor || !available) return;
    setLoading(true);
    void window.jianji.listQianchuanSubaccounts({ product, expectedAdvertiserId: anchor }).then(value => {
      if (generation.current !== operation) return;
      const next = QianchuanSubaccountCatalogSchema.parse(value);
      setCatalog(next);
      accountRead.current(next.current);
    }).catch(cause => { if (generation.current === operation) setError(subaccountError(cause, "读取子账户失败，请检查网页后刷新。")); })
      .finally(() => { if (generation.current === operation) setLoading(false); });
    return () => { generation.current++; };
  }, [product, anchor, available, supported, revision, refreshKey]);
  const select = async (advertiserId: string) => {
    if (!catalog || !product || !anchor || disabled || switching || !catalog.accounts.some(value => value.advertiserId === advertiserId) || advertiserId === catalog.current.advertiserId) return;
    const operation = generation.current;
    setSwitching(true); setError(""); report.current(true);
    try {
      const changed = await window.jianji.switchQianchuanSubaccount({ product, expectedAdvertiserId: anchor, expectedCurrentAdvertiserId: catalog.current.advertiserId, advertiserId });
      if (generation.current !== operation) return;
      if (changed.advertiserId !== advertiserId) throw new Error("账户未能核对");
      setCatalog(undefined);
      window.dispatchEvent(new CustomEvent(QIANCHUAN_ACCOUNT_CHANGED, { detail: { product, anchor } }));
    } catch (cause) {
      if (generation.current !== operation) return;
      setCatalog(undefined);
      setError(subaccountError(cause, "切换结果未能核对，请刷新子账户；未自动重试。"));
    } finally { setSwitching(false); report.current(false); }
  };
  if (!supported) return null;
  return <div className="qianchuan-subaccount-select" style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 28px", gap: 4, minWidth: 0 }}>
    <label htmlFor={`${idPrefix}-subaccount`} style={{ gridColumn: "1 / -1" }}>子账户</label>
    <select id={`${idPrefix}-subaccount`} aria-label="子账户" value={catalog?.current.advertiserId ?? ""} disabled={disabled || loading || switching || !catalog} title={catalog ? `${catalog.current.name} · ${catalog.current.advertiserId}` : error}
      onChange={event => void select(event.target.value)}>
      {!catalog && <option value="">{switching ? "正在切换…" : loading ? "正在读取子账户…" : error ? "读取失败" : "等待网页账户核对"}</option>}
      {catalog?.accounts.map(child => <option key={child.advertiserId} value={child.advertiserId}>{child.name} · {child.advertiserId}</option>)}
    </select>
    <button type="button" className="text-button" aria-label="刷新子账户" title="刷新子账户" disabled={disabled || loading || switching || !available} onClick={() => setRevision(value => value + 1)}>↻</button>
    {error && <small className="batch-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</small>}
  </div>;
}
