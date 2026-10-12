import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account";
import type { QianchuanCurrentAccount } from "../shared/qianchuan-plan-selection";

/** An active upload selector shows webpage identity; the saved slot remains its browser anchor. */
export function qianchuanUploadAccountLabel(account: QianchuanAccountSummary, current?: QianchuanCurrentAccount, currentBrowser = false): string {
  if (currentBrowser) return current ? `${current.name ?? "网页账户"} · ${current.advertiserId}` : `${qianchuanAccountName(account)} · 网页账户待核对`;
  return `${qianchuanAccountName(account)} · ${account.advertiserId || "未配置"}`;
}

/** Frozen targets resolve their display metadata by advertiser ID, never by a reused product slot. */
export function qianchuanTargetName(advertiserId: string, accounts: readonly QianchuanAccountSummary[], fallback = "账号"): string {
  const account = accounts.find(item => item.advertiserId === advertiserId);
  return account ? qianchuanAccountName(account) : fallback;
}
