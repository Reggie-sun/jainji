import { qianchuanProductName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library";

export function cleanupDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function QianchuanCleanupResults({ title, results, accounts, message }: {
  title: string; results: QianchuanLibraryResult[]; accounts: QianchuanAccountSummary[]; message?: string;
}) {
  const blocked = results.filter(result => result.state === "BLOCKED");
  return <div className="qianchuan-cleanup-results">
    <div className="qianchuan-cleanup-result-summary" role="status"><strong>{title}</strong><span>{results.length ? `${results.length - blocked.length} 个完成${blocked.length ? ` · ${blocked.length} 个未完成` : ""}` : message}</span></div>
    {!!blocked.length && <p className="qianchuan-cleanup-error" role="alert">{blocked.map(result => qianchuanProductName(result.product, accounts)).join("、")}未完成，请查看原因。</p>}
    {!!results.length && <details><summary>查看各账号结果</summary>
      {message && <p>{message}</p>}
      <ul>{results.map(result => <li key={result.product}><strong>{qianchuanProductName(result.product, accounts)}</strong><span>{result.message}</span></li>)}</ul>
    </details>}
  </div>;
}
