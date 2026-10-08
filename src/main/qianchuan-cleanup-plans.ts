import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";

/** Execute only the confirmed scope, using the existing per-plan and library owners. */
export async function clearQianchuanAccountPlans(target: FrozenQianchuanAccount, selection: QianchuanLibraryClear["accounts"][number], confirmation: QianchuanLibraryClear["confirmation"], ports: {
  guard(): Promise<void>; signal: AbortSignal;
  readPlans(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<QianchuanPlanOption[]>;
  clearPlan(target: FrozenQianchuanAccount, guard: () => Promise<void>, signal: AbortSignal): Promise<QianchuanLibraryResult>;
  clearLibrary(target: FrozenQianchuanAccount, guard: () => Promise<void>, signal: AbortSignal): Promise<QianchuanLibraryResult>;
}): Promise<QianchuanLibraryResult> {
  const signal = selection.plans ? AbortSignal.any([ports.signal, AbortSignal.timeout(30 * 60_000)]) : ports.signal;
  const guard = async () => { signal.throwIfAborted(); await ports.guard(); signal.throwIfAborted(); };
  const result: QianchuanLibraryResult = { product: target.product, advertiserId: target.advertiserId, state: "CLEARED", deletedCount: 0, message: "" };
  const messages: string[] = [];
  const collect = (next: QianchuanLibraryResult, label?: string) => {
    result.deletedCount += next.deletedCount; result.state = next.state;
    if (next.pendingPlanDeletion) result.pendingPlanDeletion = next.pendingPlanDeletion;
    messages.push(`${label ? `${label}：` : ""}${next.message}`);
  };
  try {
    await guard();
    const plans = selection.plans ?? (selection.plan ? [selection.plan] : undefined);
    if (plans) {
      const current = QianchuanPlanListSchema.parse(await ports.readPlans(target, signal));
      await guard();
      if (current.some(plan => plan.advertiserId !== target.advertiserId) || plans.some(plan => !current.some(item => item.advertiserId === plan.advertiserId && item.adId === plan.adId))) {
        throw new Error("所选清理计划已失效，请刷新计划列表后重新选择，未删除素材。");
      }
    }
    if (confirmation !== "DELETE_ALL_VIDEOS") {
      for (const plan of plans ?? [undefined]) {
        await guard();
        collect(await ports.clearPlan(plan ? Object.freeze({ ...target, adId: plan.adId }) : target, guard, signal), plan ? `${plan.name} · ID ${plan.adId}` : undefined);
        if (result.state === "BLOCKED") break;
      }
    }
    if (result.state === "CLEARED" && confirmation !== "DELETE_PLAN_MATERIALS") {
      await guard(); collect(await ports.clearLibrary(target, guard, signal));
    }
  } catch (cause) {
    result.state = "BLOCKED";
    messages.push(cause instanceof Error ? cause.message : "该账号清理未完成，请核查原账号窗口。");
  }
  return { ...result, message: messages.join(" ") };
}
