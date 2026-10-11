import { randomUUID } from "node:crypto";
import type { AutomationRequest, AutomationRun, AutomationTask } from "../shared/automation.js";
import type { QianchuanLibraryScheduleStatus } from "../shared/qianchuan-video-library-schedule.js";
import { automationDigest } from "./automation-files.js";
import type { AutomationScheduler } from "./automation-scheduler.js";
import type { QianchuanVideoLibrarySchedule } from "./qianchuan-video-library-schedule.js";

const bindings = (accounts: { product: string; expectedAdvertiserId: string }[]) => accounts.map(account => `${account.product}:${account.expectedAdvertiserId}`).sort();
function matches(task: AutomationTask, legacy: QianchuanLibraryScheduleStatus): boolean {
  const { request } = task, settings = legacy.settings, cleanup = request.cleanup;
  if (!cleanup || cleanup.confirmation !== "DELETE_PLAN_MATERIALS" || request.production || request.upload || request.uploadFrom ||
    request.enabled !== settings.enabled || request.time !== settings.time || automationDigest(bindings(cleanup.accounts)) !== automationDigest(bindings(settings.accounts))) return false;
  return !settings.includePlanMaterials || settings.accounts.every(old => {
    const target = cleanup.accounts.find(account => account.product === old.product)!;
    const ids = target.plans?.map(plan => plan.adId) ?? [target.expectedAdId];
    return ids.includes(old.expectedAdId) && (cleanup.planMaterialRule !== "ZERO_IMPRESSIONS_15D" || ids.length === 1);
  });
}
/** Transfer saved authorization locally. This function never performs cleanup. */
export async function migrateCleanupSchedules(scheduler: AutomationScheduler, legacy: QianchuanVideoLibrarySchedule,
  verify: (task: AutomationTask) => Promise<void>): Promise<void> {
  const saved = legacy.cleanupMigration();
  if (saved) {
    if (!saved.complete) {
      await verify(saved.task); await scheduler.installCleanupMigration(saved); await legacy.completeCleanupMigration();
    }
    legacy.useAutomationTask(() => scheduler.task(saved.task.id)?.request);
    return;
  }
  const status = legacy.snapshot();
  if (status.error) throw new Error(status.error);
  if (!status.settings.accounts.length) { legacy.useAutomationTask(() => undefined); return; }
  const candidates = scheduler.snapshot().tasks.filter(task => matches(task, status));
  if (candidates.length > 1) throw new Error("多个计划清理任务匹配旧设置，不能自动决定合并目标。");
  const source = candidates[0] ? scheduler.task(candidates[0].id) : undefined;
  if (source) await verify(source);
  const cleanup = source ? { ...source.request.cleanup!, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" as const,
    ...(status.settings.includePlanMaterials && source.request.cleanup!.planMaterialRule === "ZERO_IMPRESSIONS_15D" ? { planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D" as const } : {}) }
    : { confirmation: status.settings.includePlanMaterials ? "DELETE_VIDEOS_AND_PLAN_MATERIALS" as const : "DELETE_ALL_VIDEOS" as const, accounts: status.settings.accounts };
  const request: AutomationRequest = source ? { ...source.request, cleanup } : { name: "每日素材清理", time: status.settings.time,
    enabled: status.settings.enabled, cleanup, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" };
  let lastRun = source?.lastRun;
  if (status.lastRun && (!lastRun || status.lastRun.day > lastRun.day)) {
    lastRun = { id: randomUUID(), day: status.lastRun.day, startedAt: status.lastRun.startedAt, state: "SKIPPED",
      message: "合并前本日视频库清理已领取，合并任务不会补跑；原结果保留在合并前记录中。" } satisfies AutomationRun;
  }
  const task = await scheduler.prepareCleanupMigration(request, source, lastRun);
  const migration = { task, source, complete: false };
  await legacy.retireCleanup(migration);
  await scheduler.installCleanupMigration(migration);
  await legacy.completeCleanupMigration();
  legacy.useAutomationTask(() => scheduler.task(task.id)?.request);
}
