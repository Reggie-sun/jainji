import { qianchuanProductName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryResult, QianchuanPlanRecovery } from "../shared/qianchuan-video-library";
import { QianchuanCleanupRecovery } from "./QianchuanCleanupRecovery";

export function cleanupDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function QianchuanCleanupResults({ title, results, accounts, message, busy = false, onResolve }: {
  title: string; results: QianchuanLibraryResult[]; accounts: QianchuanAccountSummary[]; message?: string;
  busy?: boolean; onResolve?(input: QianchuanPlanRecovery): Promise<void>;
}) {
  const blocked = results.filter(result => result.state === "BLOCKED");
  return <div className="qianchuan-cleanup-results">
    <div className="qianchuan-cleanup-result-summary" role="status"><strong>{title}</strong><span>{results.length ? `${results.length - blocked.length} 个完成${blocked.length ? ` · ${blocked.length} 个未完成` : ""}` : message}</span></div>
    {!!blocked.length && <p className="qianchuan-cleanup-error" role="alert">{blocked.map(result => qianchuanProductName(result.product, accounts)).join("、")}未完成，请查看原因。</p>}
    {!!results.length && <details><summary>查看各账号结果</summary>
      {message && <p>{message}</p>}
      <ul>{results.map(result => <li key={result.product}><strong>{qianchuanProductName(result.product, accounts)}</strong><span>{result.message}</span>
        {result.pendingPlanDeletion && onResolve && <QianchuanCleanupRecovery key={`${result.pendingPlanDeletion.attempt}:${result.pendingPlanDeletion.digest}`} result={result}
          disabled={busy || !accounts.some(account => account.available && account.product === result.product && account.advertiserId === result.advertiserId)} onResolve={onResolve} />}
      </li>)}</ul>
    </details>}
  </div>;
}
