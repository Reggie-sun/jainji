import { useState } from "react";
import type { QianchuanLibraryResult, QianchuanPlanRecovery } from "../shared/qianchuan-video-library";

export function QianchuanCleanupRecovery({ result, disabled, onResolve }: {
  result: QianchuanLibraryResult; disabled: boolean; onResolve(input: QianchuanPlanRecovery): Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = result.pendingPlanDeletion!;
  return <details className="qianchuan-cleanup-confirm"><summary>待核查素材明细（{pending.ids.length} 条）</summary>
    <p>账户 {result.advertiserId} · 计划 ID {pending.adId}</p>
    <p>上次删除结果仍然未知。请在千川对应账号的该计划内，按以下 ID 核查并处理；当前筛选列表没有显示素材，不能证明删除成功。</p>
    {pending.zeroWindow && <p>上次统计窗口：{pending.zeroWindow.startTime} 至 {pending.zeroWindow.endTime}</p>}
    <textarea aria-label="待核查素材 ID" readOnly rows={5} value={pending.ids.join("\n")} style={{ width: "100%", boxSizing: "border-box" }} />
    <p>结束旧记录只解除本地待核查状态，不执行删除。原始记录与未知结果保留；这些 ID 今后仍禁止自动重复删除。新清理需要重新发起。</p>
    <label><input type="checkbox" disabled={disabled || confirming} checked={checked} onChange={event => setChecked(event.target.checked)} />我已在千川核查并处理以上全部素材</label>
    {!confirming ? <button type="button" className="button secondary" disabled={disabled || !checked} onClick={() => setConfirming(true)}>结束这次旧清理记录</button> : <div role="group" aria-label="确认结束旧清理记录">
      <p>确认结束账户 {result.advertiserId}、计划 {pending.adId} 的这次记录？此操作不代表平台删除成功。</p>
      <button type="button" className="button secondary" disabled={disabled} onClick={() => setConfirming(false)}>返回核查</button>
      <button type="button" className="button secondary" disabled={disabled || !checked} onClick={() => void onResolve({ product: result.product, advertiserId: result.advertiserId,
        adId: pending.adId, attempt: pending.attempt, digest: pending.digest, confirmation: "MANUALLY_HANDLED_PLAN_DELETION" })}>确认结束旧记录</button>
    </div>}
  </details>;
}
