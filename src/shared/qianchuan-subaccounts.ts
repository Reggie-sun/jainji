import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";
import { QianchuanCurrentAccountSchema } from "./qianchuan-plan-selection.js";

const id = QianchuanCurrentAccountSchema.shape.advertiserId;
export const QianchuanSubaccountListRequestSchema = z.object({ product: QianchuanProductSchema, expectedAdvertiserId: id }).strict();
export const QianchuanSubaccountSwitchRequestSchema = QianchuanSubaccountListRequestSchema.extend({ expectedCurrentAdvertiserId: id, advertiserId: id }).strict();
export const QianchuanSubaccountCatalogSchema = z.object({ current: QianchuanCurrentAccountSchema,
  accounts: z.array(QianchuanCurrentAccountSchema.extend({ name: QianchuanCurrentAccountSchema.shape.name.unwrap() })).min(1).max(1000),
}).strict().superRefine((value, context) => {
  if (new Set(value.accounts.map(account => account.advertiserId)).size !== value.accounts.length || !value.accounts.some(account => account.advertiserId === value.current.advertiserId && account.name === value.current.name)) context.addIssue({ code: "custom", message: "子账户列表与网页当前账户无法核对。" });
});
export type QianchuanSubaccountListRequest = z.infer<typeof QianchuanSubaccountListRequestSchema>;
export type QianchuanSubaccountSwitchRequest = z.infer<typeof QianchuanSubaccountSwitchRequestSchema>;
export type QianchuanSubaccountCatalog = z.infer<typeof QianchuanSubaccountCatalogSchema>;
