import type { QianchuanAccountSummary, QianchuanProduct } from "./qianchuan-account.js";

export type BatchUploadAccount = { accountProduct: QianchuanProduct; error?: never } | { error: string; accountProduct?: never };

/** Resolve a saved template to one configured display name; never guess a target. */
export function resolveBatchUploadAccount(name: string, accounts: readonly QianchuanAccountSummary[]): BatchUploadAccount {
  const matches = accounts.filter(account => (account.productName ?? account.product) === name.trim());
  if (!name.trim() || !matches.length) return { error: "未找到同名千川商品账号，请在账号设置中核对商品名称，或关闭本项上传。" };
  if (matches.length !== 1) return { error: "同名千川商品账号不唯一，请在账号设置中区分商品名称，或关闭本项上传。" };
  if (!matches[0].available) return { error: "对应千川商品账号配置不可用，请先保存有效计划链接，或关闭本项上传。" };
  return { accountProduct: matches[0].product };
}
