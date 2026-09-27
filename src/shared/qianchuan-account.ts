import { z } from "zod";

export const QIANCHUAN_PRODUCTS = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"] as const;
export const QianchuanProductSchema = z.enum(QIANCHUAN_PRODUCTS);
export type QianchuanProduct = z.infer<typeof QianchuanProductSchema>;
const accountId = z.string().regex(/^(?:|[1-9][0-9]{0,19})$/, "ID 必须是带引号的十进制字符串，未填写时保留空字符串。");
const endpoint = z.string().max(64).refine(value => {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 65535);
}, "CDP 地址必须为 http://127.0.0.1:端口，端口范围为 1–65535。");

export const QianchuanAccountSchema = z.object({
  product: QianchuanProductSchema, cdpEndpoint: endpoint, advertiserId: accountId, adId: accountId,
}).strict().refine(value => !value.adId || Boolean(value.advertiserId), "填写计划 ID 前必须填写广告账户 ID。");
export type QianchuanAccount = z.infer<typeof QianchuanAccountSchema>;
export const QianchuanAccountConfigSchema = z.object({
  version: z.literal(1), accounts: z.array(QianchuanAccountSchema).length(QIANCHUAN_PRODUCTS.length),
}).strict().superRefine((value, ctx) => {
  const products = new Set<string>();
  const ports = new Set<string>();
  const accounts = new Set<string>();
  for (const account of value.accounts) {
    if (products.has(account.product) || ports.has(account.cdpEndpoint) || (account.advertiserId && accounts.has(account.advertiserId))) {
      ctx.addIssue({ code: "custom", message: "产品、CDP 端口与非空广告账户 ID 不能重复。" });
    }
    products.add(account.product); ports.add(account.cdpEndpoint);
    if (account.advertiserId) accounts.add(account.advertiserId);
  }
});

export interface QianchuanAccountSummary {
  product: QianchuanProduct;
  advertiserId: string;
  adId: string;
  available: boolean;
}

/** The diagnostic CLI and main process share this strict mapping owner. */
export function parseAccountConfig(value: unknown): QianchuanAccount[] {
  return QianchuanAccountConfigSchema.parse(value).accounts;
}
export function accountAvailable(account: QianchuanAccount): boolean { return Boolean(account.advertiserId && account.adId); }
export function accountSummary(account: QianchuanAccount): QianchuanAccountSummary {
  return { product: account.product, advertiserId: account.advertiserId, adId: account.adId, available: accountAvailable(account) };
}
export function accountPageUrl(value: QianchuanAccount): string {
  const account = QianchuanAccountSchema.parse(value);
  if (!accountAvailable(account)) throw new Error(`${account.product}：先填写 advertiserId 和 adId，不能猜测账户或计划。`);
  const url = new URL("https://qianchuan.jinritemai.com/uni-prom");
  url.searchParams.set("aavid", account.advertiserId);
  url.searchParams.set("adId", account.adId);
  return url.href;
}
