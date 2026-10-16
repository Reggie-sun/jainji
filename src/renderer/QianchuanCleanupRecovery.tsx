import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library";

export function QianchuanCleanupRecovery({ result }: { result: QianchuanLibraryResult }) {
  const pending = result.pendingPlanDeletion!;
  return <details className="qianchuan-cleanup-confirm"><summary>删除记录（{pending.ids.length} 条）</summary>
    <p>账户 {result.advertiserId} · 计划 ID {pending.adId}</p>
    <p>这次删除结果未确认，记录仅供查看。可以重新发起清理，软件会按千川当前列表和所选规则重新判断。</p>
    {pending.zeroWindow && <p>上次统计窗口：{pending.zeroWindow.startTime} 至 {pending.zeroWindow.endTime}</p>}
    <textarea aria-label="本次删除素材 ID" readOnly rows={5} value={pending.ids.join("\n")} style={{ width: "100%", boxSizing: "border-box" }} />
  </details>;
}
