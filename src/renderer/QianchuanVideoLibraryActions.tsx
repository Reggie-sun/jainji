import { useState } from "react";
import { qianchuanProductName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library";

export function QianchuanVideoLibraryActions({ accounts, busy }: { accounts: QianchuanAccountSummary[]; busy: boolean }) {
  const [selected, setSelected] = useState<QianchuanAccountSummary[]>();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<QianchuanLibraryResult[]>([]);
  const [error, setError] = useState("");
  const configured = accounts.filter(account => account.available);
  const disabled = busy || running;
  const choose = (items: QianchuanAccountSummary[]) => { setSelected(items); setError(""); setResults([]); };
  const clear = async () => {
    if (!selected || disabled) return;
    setRunning(true); setError("");
    try {
      const result = await window.jianji.clearQianchuanVideoLibraries({ confirmation: "DELETE_ALL_VIDEOS", accounts: selected.map(account => ({ product: account.product, expectedAdvertiserId: account.advertiserId })) });
      setResults(result); setSelected(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "视频库删除未完成。"); }
    finally { setRunning(false); }
  };
  return <div aria-label="千川视频库清空">
    <p>视频库清理 <small>删除各账号素材库中的全部视频。</small></p>
    <div className="douyin-upload-actions">
      <button className="button primary compact" type="button" disabled={disabled || !configured.length} onClick={() => choose(configured)}>并行清空全部账号{configured.length > 0 ? `（${configured.length}）` : ""}</button>
      <small>同时清空已配置账号，各账号复用自己的视频库页面。</small>
    </div>
    <div className="douyin-upload-actions">
      {configured.map(account => <button className="button secondary compact" key={account.product} type="button" disabled={disabled} onClick={() => choose([account])}>清空{qianchuanProductName(account.product, accounts)}视频库</button>)}
    </div>
    {selected && <div role="group" aria-label="确认清空视频库">
      <p>将永久删除以下账户素材库中的全部视频：</p>
      {selected.map(account => <p key={account.product}>{qianchuanProductName(account.product, accounts)} · 账户 {account.advertiserId}</p>)}
      <p>已使用视频的在投创意和计划不受影响。本地视频和原上传记录保留，不备份视频。</p>
      <button className="button secondary compact" type="button" disabled={disabled} onClick={() => void clear()}>{selected.length > 1 ? "确认并行清空" : "确认删除全部视频"}</button>
      <button className="button secondary compact" type="button" disabled={disabled} onClick={() => setSelected(undefined)}>取消清空</button>
    </div>}
    {running && <p role="status">{selected && selected.length > 1 ? "正在并行清空各账号视频库" : "正在清空视频库"}，请保持 Chrome 打开。</p>}
    {error && <p role="alert">{error}</p>}
    {results.map(result => <p key={result.product} role={result.state === "BLOCKED" ? "alert" : "status"}>{qianchuanProductName(result.product, accounts)} · 账户 {result.advertiserId} · {result.message}</p>)}
  </div>;
}
