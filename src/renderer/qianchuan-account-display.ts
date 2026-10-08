import { qianchuanAccountName, type QianchuanAccountSummary } from "../shared/qianchuan-account";

/** Frozen targets resolve their display metadata by advertiser ID, never by a reused product slot. */
export function qianchuanTargetName(advertiserId: string, accounts: readonly QianchuanAccountSummary[], fallback = "账号"): string {
  const account = accounts.find(item => item.advertiserId === advertiserId);
  return account ? qianchuanAccountName(account) : fallback;
}
