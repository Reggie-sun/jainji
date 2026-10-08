import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { qianchuanTargetName } from "./qianchuan-account-display";
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
  const partial = results.filter(result => result.state === "PARTIAL");
  return <div className="qianchuan-cleanup-results">
    <div className="qianchuan-cleanup-result-summary" role="status"><strong>{title}</strong><span>{results.length ? `${results.length - blocked.length - partial.length} 个完成${partial.length ? ` · ${partial.length} 个已跳过历史素材` : ""}${blocked.length ? ` · ${blocked.length} 个未完成` : ""}` : message}</span></div>
    {!!blocked.length && <p className="qianchuan-cleanup-error" role="alert">{blocked.map(result => `${qianchuanTargetName(result.advertiserId, accounts, result.product)}（账户 ${result.advertiserId}）`).join("、")}未完成，请查看原因。</p>}
    {!!partial.length && <p>{partial.map(result => `${qianchuanTargetName(result.advertiserId, accounts, result.product)}（账户 ${result.advertiserId}）`).join("、")}：其他候选已处理，历史未知素材已跳过，原记录保留待核查。</p>}
    {!!results.length && <details><summary>查看各账号结果</summary>
      {message && <p>{message}</p>}
      <ul>{results.map(result => <li key={result.product}><strong>{qianchuanTargetName(result.advertiserId, accounts, result.product)}</strong><span>账户 {result.advertiserId}</span><span>{result.message}</span>
        {result.pendingPlanDeletion && onResolve && <QianchuanCleanupRecovery key={`${result.pendingPlanDeletion.attempt}:${result.pendingPlanDeletion.digest}`} result={result}
          disabled={busy || !accounts.some(account => account.available && account.product === result.product && account.advertiserId === result.advertiserId)} onResolve={onResolve} />}
      </li>)}</ul>
    </details>}
  </div>;
}
