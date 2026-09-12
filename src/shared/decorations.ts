import { z } from "zod";
import { DEFAULT_TEXT_FONT_FAMILY } from "./defaults.js";
import { LIBRARY_FONTS, LIBRARY_STICKERS } from "./asset-library.js";
import { BUNDLED_STICKERS } from "./bundled-stickers.js";

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
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(12).refine((text) => !/[\u0000-\u001f\u007f]/.test(text)), fontFamily: z.string().refine((family) => fontFamilies.has(family), "unknown font") }).strict(),
]);
export type CornerDecoration = z.infer<typeof CornerDecorationSchema>;
export const PRODUCT_PRICE_MAX_LENGTH = 12;
export const PRODUCT_PRICE_HELP = "请填写金额或金额＋数量单位，例如19.90、19.9元30贴；最多12字，金额最多两位小数，不能包含产品名。";
export const ProductPriceSchema = z.string().trim().max(PRODUCT_PRICE_MAX_LENGTH).regex(/^(?:\d{1,6}(?:\.\d{1,2})?(?:元(?:[1-9]\d{0,5}(?:贴|片|个|件|包|袋|盒|瓶|罐|支|条|卷|枚|只|双|对|套|组|份|张|本|杯|克|千克|斤|公斤|毫升|升))?)?)?$/, PRODUCT_PRICE_HELP);
export const RequiredProductPriceSchema = ProductPriceSchema.min(1, "请手动填写产品价格，Agent 不能代填或改写。");
export function formatProductPrice(price: string): string {
  const value = RequiredProductPriceSchema.parse(price);
  return value.includes("元") ? value : `¥ ${value}`;
}
export const DecorationSchema = z.preprocess((input) => {
  if (input && typeof input === "object" && "mode" in input && input.mode === "agent") {
    return { ...input, sticker: "template", fontFamily: DEFAULT_TEXT_FONT_FAMILY, corners: undefined };
  }
  return input;
}, z.object({
  productPrice: ProductPriceSchema.optional(),
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
