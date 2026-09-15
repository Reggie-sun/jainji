import { z } from "zod";
import { DEFAULT_TEXT_FONT_FAMILY } from "./defaults.js";
import { LIBRARY_FONTS, LIBRARY_STICKERS } from "./asset-library.js";
import { BUNDLED_STICKERS } from "./bundled-stickers.js";
import { PriceStyleIdSchema } from "./price-styles.js";

export const FONT_CHOICES = [DEFAULT_TEXT_FONT_FAMILY, "Noto Serif CJK SC", "AR PL UKai CN", "AR PL UMing CN", "Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "FangSong"] as const;
export const FONT_LABELS: Record<typeof FONT_CHOICES[number], string> = {
  "Noto Sans CJK SC": "思源黑体（Windows 使用微软雅黑）", "Noto Serif CJK SC": "思源宋体",
  "AR PL UKai CN": "文鼎楷体", "AR PL UMing CN": "文鼎明体",
  "Microsoft YaHei": "微软雅黑", SimHei: "黑体", SimSun: "宋体", KaiTi: "楷体", FangSong: "仿宋",
};
const stickerIds = new Set(["template", "none", "sparkle", "arrow", "heart", "burst", ...BUNDLED_STICKERS.map((entry) => entry.id), ...LIBRARY_STICKERS.map((entry) => entry.id)]);
const fontFamilies = new Set<string>([...FONT_CHOICES, ...LIBRARY_FONTS.map((entry) => entry.family!)]);
export const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Corner = typeof CORNERS[number];
export const CORNER_LABELS: Record<Corner, string> = { "top-left": "左上角", "top-right": "右上角", "bottom-left": "左下角", "bottom-right": "右下角" };
const CornerDecorationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("sticker"), sticker: z.string().refine((id) => stickerIds.has(id) && id !== "none" && id !== "template", "unknown sticker") }).strict(),
]);
export type CornerDecoration = z.infer<typeof CornerDecorationSchema>;
export const PRODUCT_PRICE_MAX_LENGTH = 25;
export const PRODUCT_PRICE_HELP = "请手动填写价格，按 Enter 换行，最多2行、每行12字。支持19.9元30贴、9.9元到手5卷、19.9元拍一发三；金额最多两位小数，不能包含产品名。";
const priceLine = /^\d{1,6}(?:\.\d{1,2})?(?:元(?:(?:到手)?[1-9]\d{0,5}(?:贴|片|个|件|包|袋|盒|瓶|罐|支|条|卷|枚|只|双|对|套|组|份|张|本|杯|克|千克|斤|公斤|毫升|升)|拍(?:[1-9]\d{0,5}|[一二三四五六七八九十])发(?:[1-9]\d{0,5}|[一二三四五六七八九十]))?)?$/;
export const ProductPriceSchema = z.string().trim().transform((value) => value.replace(/\r\n/g, "\n")).pipe(z.string().max(PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP).refine((value) => {
  const lines = value.split("\n");
  return value === "" || (lines.length <= 2 && lines.every((line) => line.length <= 12 && priceLine.test(line)));
}, PRODUCT_PRICE_HELP));
export const RequiredProductPriceSchema = ProductPriceSchema.refine((value) => value.length > 0, "请手动填写产品价格，Agent 不能代填或改写。");
export function formatProductPrice(price: string): string {
  const value = RequiredProductPriceSchema.parse(price);
  return value.split("\n").map((line) => line.includes("元") ? line : `¥ ${line}`).join("\n");
}
export const DecorationSchema = z.preprocess((input) => {
  if (input && typeof input === "object" && "mode" in input && input.mode === "agent") {
    return { ...input, sticker: "template", fontFamily: DEFAULT_TEXT_FONT_FAMILY, corners: undefined };
  }
  return input;
}, z.object({
  productPrice: ProductPriceSchema.optional(),
  priceStyle: PriceStyleIdSchema.optional(),
  mode: z.enum(["manual", "agent"]).optional(),
  sticker: z.string().refine((id) => stickerIds.has(id), "unknown sticker").default("template"),
  fontFamily: z.string().refine((family) => fontFamilies.has(family), "unknown font").default(DEFAULT_TEXT_FONT_FAMILY),
  corners: z.object({ "top-left": CornerDecorationSchema.optional(), "top-right": CornerDecorationSchema.optional(), "bottom-left": CornerDecorationSchema.optional(), "bottom-right": CornerDecorationSchema.optional() }).strict().optional(),
}).strict());
export type DecorationOptions = z.infer<typeof DecorationSchema>;
export interface DecorationCatalog {
  fonts: string[];
  stickers: { id: string; label: string; url: string; animated: boolean; source: "builtin" | "downloaded" }[];
}
