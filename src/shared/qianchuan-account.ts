import { z } from "zod";

export const QIANCHUAN_PRODUCTS = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"] as const;
export const QianchuanProductSchema = z.enum(QIANCHUAN_PRODUCTS);
export type QianchuanProduct = z.infer<typeof QianchuanProductSchema>;
export const QianchuanProductNameSchema = z.string().trim().min(1, "请填写产品名称。").max(40, "产品名称最多 40 个字符。").regex(/^[^\u0000-\u001f\u007f]+$/, "产品名称不能包含换行或控制字符。");
const accountId = z.string().regex(/^(?:|[1-9][0-9]{0,19})$/, "ID 必须是带引号的十进制字符串，未填写时保留空字符串。");
const endpoint = z.string().max(64).refine(value => {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 65535);
}, "CDP 地址必须为 http://127.0.0.1:端口，端口范围为 1–65535。");

export const QianchuanAccountSchema = z.object({
  product: QianchuanProductSchema, productName: QianchuanProductNameSchema.optional(), cdpEndpoint: endpoint, advertiserId: accountId, adId: accountId,
}).strict().refine(value => !value.adId || Boolean(value.advertiserId), "填写计划 ID 前必须填写广告账户 ID。");
export type QianchuanAccount = z.infer<typeof QianchuanAccountSchema>;
const uniqueBindings = (value: { accounts: QianchuanAccount[] }, ctx: z.RefinementCtx) => {
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
  const names = QIANCHUAN_PRODUCTS.map(product => qianchuanProductName(product, value.accounts));
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "产品名称不能重复，请使用不同名称区分账号。" });
};
export const QianchuanAccountConfigSchema = z.object({
  version: z.literal(1), accounts: z.array(QianchuanAccountSchema).length(QIANCHUAN_PRODUCTS.length),
}).strict().superRefine(uniqueBindings);
// Internal settings can be filled one product at a time; the six-account import stays strict.
export const QianchuanAccountSettingsSchema = z.object({
  version: z.literal(1), accounts: z.array(QianchuanAccountSchema).max(QIANCHUAN_PRODUCTS.length),
}).strict().superRefine(uniqueBindings);
export const QianchuanAccountSetupSchema = z.object({
  product: QianchuanProductSchema, productName: QianchuanProductNameSchema.optional(), planUrl: z.string().trim().min(1).max(16384),
}).strict();
export type QianchuanAccountSetup = z.infer<typeof QianchuanAccountSetupSchema>;
export const QianchuanBrowserControlSchema = z.object({
  product: QianchuanProductSchema, action: z.enum(["close", "restart"]),
  expectedAdvertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
}).strict();
export type QianchuanBrowserControl = z.infer<typeof QianchuanBrowserControlSchema>;

export function parseQianchuanPlanUrl(input: string): { advertiserId: string; adId: string } {
  const message = "请粘贴含账户和计划 ID 的千川计划链接。";
  if (typeof input !== "string" || input.length > 16384) throw new Error(message);
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error(message); }
  if (url.origin !== "https://qianchuan.jinritemai.com" || url.pathname !== "/uni-prom" || url.username || url.password) throw new Error(message);
  const advertiserIds = url.searchParams.getAll("aavid"), adIds = url.searchParams.getAll("adId");
  const validId = (value: string | undefined) => Boolean(value && /^[1-9][0-9]{0,19}$/.test(value));
  if (advertiserIds.length !== 1 || adIds.length !== 1 || !validId(advertiserIds[0]) || !validId(adIds[0])) throw new Error(message);
  return { advertiserId: advertiserIds[0], adId: adIds[0] };
}

export interface QianchuanAccountSummary {
  product: QianchuanProduct;
  productName?: string;
  browserProfileName?: string;
  advertiserId: string;
  adId: string;
  available: boolean;
  browserPort?: number;
}

/** Names are presentation only; the original product remains the stable account slot. */
export function qianchuanProductName(product: QianchuanProduct, accounts: readonly { product: QianchuanProduct; productName?: string }[]): string {
  return accounts.find(account => account.product === product)?.productName ?? product;
}

/** Chrome labels never participate in product-name matching or persisted account identity. */
export function qianchuanAccountName(account: QianchuanAccountSummary): string {
  return account.browserProfileName ?? account.productName ?? account.product;
}

/** The diagnostic CLI and main process share this strict mapping owner. */
export function parseAccountConfig(value: unknown): QianchuanAccount[] {
  return QianchuanAccountConfigSchema.parse(value).accounts;
}
export function accountAvailable(account: QianchuanAccount): boolean { return Boolean(account.advertiserId && account.adId); }
export function accountSummary(account: QianchuanAccount): QianchuanAccountSummary {
  return { product: account.product, ...(account.productName !== undefined ? { productName: account.productName } : {}), advertiserId: account.advertiserId, adId: account.adId, available: accountAvailable(account), browserPort: Number(new URL(account.cdpEndpoint).port) };
}
export function accountPageUrl(value: QianchuanAccount): string {
  const account = QianchuanAccountSchema.parse(value);
  if (!accountAvailable(account)) throw new Error(`${account.product}：先填写 advertiserId 和 adId，不能猜测账户或计划。`);
  const url = new URL("https://qianchuan.jinritemai.com/uni-prom");
  url.searchParams.set("aavid", account.advertiserId);
  url.searchParams.set("adId", account.adId);
  url.hash = "umg=1";
  return url.href;
}
