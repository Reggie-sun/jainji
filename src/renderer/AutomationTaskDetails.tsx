import type { AutomationTask } from "../shared/automation";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import { qianchuanTargetName } from "./qianchuan-account-display";

export function AutomationTaskDetails({ task, accounts = [], tasks = [] }: {
  task: AutomationTask; accounts?: QianchuanAccountSummary[]; tasks?: AutomationTask[];
}) {
  const { request } = task;
  const source = tasks.find(value => value.id === request.uploadFrom);
  const production = request.production ?? source?.request.production;
  const steps = [request.cleanup && "计划素材清理", request.production && "制作", request.upload && "上传并确认批次"].filter(Boolean);
  const uploadTargets = production?.entries.flatMap(entry => entry.douyinUpload?.plan ? [{ product: entry.douyinUpload.accountProduct,
    expectedAdvertiserId: entry.douyinUpload.plan.advertiserId, plans: [entry.douyinUpload.plan] }] : []) ?? [];
  const uniqueTargets = uploadTargets.filter((target, index) => uploadTargets.findIndex(value =>
    value.expectedAdvertiserId === target.expectedAdvertiserId && value.plans[0].adId === target.plans[0].adId) === index);
  return <div className="automation-task-details">
    <p><strong>执行内容：</strong>{steps.join(" → ")}</p>
    {request.cleanup && <div className="automation-task-scope">
      <p><strong>清理条件：</strong>{request.cleanup.planMaterialRule === "ZERO_IMPRESSIONS_15D" ? "" : "审核不通过、生态审核不通过、审核通过可优化"}{request.cleanup.planMaterialRule === "AUDIT_AND_ZERO_IMPRESSIONS_15D" ? "；" : ""}{request.cleanup.planMaterialRule ? "近 15 天零展示（加入计划满 15 天）" : ""}</p>
      <p className="automation-runtime-note">仅删除所选计划内符合条件的素材，不清空账号视频库。</p>
      <AutomationTargets targets={request.cleanup.accounts} accounts={accounts} />
    </div>}
    {request.production && <div className="automation-task-scope">
      <p><strong>制作范围：</strong>{request.production.entries.length} 个模板，共 {request.production.entries.reduce((sum, entry) => sum + entry.requestedCount, 0)} 条{!request.upload ? "；不自动上传" : ""}</p>
      <details><summary>保存时的模板与素材信息</summary><p className="automation-saved-summary">{task.summary}</p></details>
    </div>}
    {request.uploadFrom && <p><strong>制作来源：</strong>{source?.request.name ?? task.summary}<small className="automation-source-id">任务 ID：{request.uploadFrom}</small></p>}
    {!!uniqueTargets.length && <div className="automation-task-scope">
      <p><strong>{request.upload ? "上传范围：" : "预留上传目标："}</strong></p>
      <AutomationTargets targets={uniqueTargets} accounts={accounts} />
    </div>}
  </div>;
}

function AutomationTargets({ targets, accounts }: { targets: QianchuanLibraryClear["accounts"]; accounts: QianchuanAccountSummary[] }) {
  return <ul className="automation-targets">{targets.map(target => <li key={`${target.expectedAdvertiserId}:${target.plans?.map(plan => plan.adId).join(",") ?? target.expectedAdId}`}>
    <strong>{qianchuanTargetName(target.expectedAdvertiserId, accounts, target.product)}</strong><small>账户 {target.expectedAdvertiserId}</small>
    {(target.plans ?? (target.plan ? [target.plan] : [])).map(plan => <span key={plan.adId}>{plan.name}<small>计划 {plan.adId}</small></span>)}
    {!target.plans && !target.plan && target.expectedAdId && <span>计划 {target.expectedAdId}<small>保存时未记录计划名称</small></span>}
  </li>)}</ul>;
}

export function AutomationTimeConflict({ names }: { names: string[] }) {
  return names.length ? <p className="automation-time-conflict" role="status">同一时间还启用了{names.map(name => `“${name}”`).join("、")}。执行重叠可能导致任务跳过；请错开时间或暂停其中一个。</p> : null;
}
