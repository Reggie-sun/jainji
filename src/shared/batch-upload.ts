import { z } from "zod";
import { QianchuanProductSchema, type QianchuanAccountSummary, type QianchuanProduct } from "./qianchuan-account.js";

export const TemplateAccountSelectionSchema = z.object({
  recentProjectId: z.string().uuid(), expectedProjectId: z.string().uuid(), accountProduct: QianchuanProductSchema,
  expectedAdvertiserId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict();
export type TemplateAccountSelection = z.infer<typeof TemplateAccountSelectionSchema>;
export const TemplateAccountBindingSchema = z.object({
  recentProjectId: z.string().uuid(), projectId: z.string().uuid(),
  accountProduct: QianchuanProductSchema, advertiserId: z.string().regex(/^[1-9]\d{0,19}$/),
}).strict();
export type TemplateAccountBinding = z.infer<typeof TemplateAccountBindingSchema>;
export const TemplateAccountSettingsSchema = z.object({
  version: z.literal(1), bindings: z.array(TemplateAccountBindingSchema).max(200),
}).strict().refine(value => new Set(value.bindings.map(binding => binding.recentProjectId)).size === value.bindings.length, "模板关联重复。");

export type BatchUploadAccount = { accountProduct: QianchuanProduct; error?: never } | { error: string; accountProduct?: never };

/** Explicit bindings take priority; unbound legacy templates may match one exact name. */
export function resolveBatchUploadAccount(name: string, accounts: readonly QianchuanAccountSummary[], binding?: Pick<TemplateAccountBinding, "accountProduct" | "advertiserId">): BatchUploadAccount {
  if (binding) {
    const account = accounts.find(account => account.product === binding.accountProduct);
    if (!account || !account.available) return { error: "已关联的千川账号不可用，请在本行重新选择账号或关闭上传。" };
    if (account.advertiserId !== binding.advertiserId) return { error: "已关联的广告账户已变化，请在本行重新选择账号。" };
    return { accountProduct: account.product };
  }
  const matches = accounts.filter(account => (account.productName ?? account.product) === name.trim());
  if (!name.trim() || !matches.length) return { error: "请选择此模板的上传账号；也可以关闭本项上传。" };
  if (matches.length !== 1) return { error: "同名千川商品账号不唯一，请在账号设置中区分商品名称，或关闭本项上传。" };
  if (!matches[0].available) return { error: "对应千川商品账号配置不可用，请先保存有效计划链接，或关闭本项上传。" };
  return { accountProduct: matches[0].product };
}
