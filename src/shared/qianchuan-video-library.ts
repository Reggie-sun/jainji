import { z } from "zod";
import { QianchuanProductSchema } from "./qianchuan-account.js";

export const QianchuanLibraryAccountSchema = z.object({
  product: QianchuanProductSchema,
  expectedAdvertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
}).strict();
export const QianchuanLibraryClearSchema = z.object({
  confirmation: z.literal("DELETE_ALL_VIDEOS"),
  accounts: z.array(QianchuanLibraryAccountSchema).min(1).max(6),
}).strict().refine(value => new Set(value.accounts.map(account => account.product)).size === value.accounts.length &&
  new Set(value.accounts.map(account => account.expectedAdvertiserId)).size === value.accounts.length, "删除账号不能重复。");
export type QianchuanLibraryClear = z.infer<typeof QianchuanLibraryClearSchema>;
export interface QianchuanLibraryResult {
  product: z.infer<typeof QianchuanProductSchema>;
  advertiserId: string;
  state: "CLEARED" | "BLOCKED";
  deletedCount: number;
  message: string;
}

export const VIDEO_LIBRARY_ROUTE = "/tools/creative-management/video-library";
export function videoLibraryUrl(advertiserId: string): string {
  if (!/^[1-9][0-9]{0,19}$/.test(advertiserId)) throw new Error("无效的千川账号。");
  return `https://qianchuan.jinritemai.com${VIDEO_LIBRARY_ROUTE}?aavid=${advertiserId}`;
}
