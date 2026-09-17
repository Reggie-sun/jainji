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
export function isUploadedStickerId(id: string): boolean { return /^uploaded-[a-f0-9]{64}$/.test(id); }
const isStickerId = (id: string): boolean => stickerIds.has(id) || isUploadedStickerId(id);
const fontFamilies = new Set<string>([...FONT_CHOICES, ...LIBRARY_FONTS.map((entry) => entry.family!)]);
export const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Corner = typeof CORNERS[number];
export const CORNER_LABELS: Record<Corner, string> = { "top-left": "左上角", "top-right": "右上角", "bottom-left": "左下角", "bottom-right": "右下角" };
const CornerDecorationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("sticker"), sticker: z.string().refine((id) => isStickerId(id) && id !== "none" && id !== "template", "unknown sticker") }).strict(),
]);
export type CornerDecoration = z.infer<typeof CornerDecorationSchema>;
export const PRODUCT_PRICE_MAX_LENGTH = 25;
export const PRODUCT_PRICE_HELP = "请手动填写展示文字，按 Enter 换行，最多2行、每行12字，不能有空白行。支持价格、数量、产品名或其他文字，不要求包含金额。Agent 不能代填或改写。";
export const ProductPriceSchema = z.string().trim().transform((value) => value.replace(/\r\n/g, "\n")).pipe(z.string().max(PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP).refine((value) => {
  const lines = value.split("\n");
  return value === "" || (lines.length <= 2 && lines.every((line) => line.length <= 12 && line.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(line)));
}, PRODUCT_PRICE_HELP));
export const RequiredProductPriceSchema = ProductPriceSchema.refine((value) => value.length > 0, "请手动填写产品价格，Agent 不能代填或改写。");
export function formatProductPrice(price: string): string {
  const value = RequiredProductPriceSchema.parse(price);
  return value.split("\n").map((line) => /^\d{1,6}(?:\.\d{1,2})?$/.test(line) ? `¥ ${line}` : line).join("\n");
}
export const DecorationDisplayModeSchema = z.enum(["full", "first-3s"]);
export type DecorationDisplayMode = z.infer<typeof DecorationDisplayModeSchema>;
export function decorationTimingContext(mode?: DecorationDisplayMode): string {
  return mode === "first-3s" ? "展示时段：手动展示文字 / 价格和全部新增贴纸仅在视频前 3 秒显示，最后 0.5 秒渐隐，3 秒时完全消失；不足 3 秒时在视频结尾前渐隐。原视频内容不变。" : "展示时段：手动展示文字 / 价格和贴纸全程显示，覆盖与四角补齐仍遵守各自有效时段。";
}
export const DecorationSchema = z.preprocess((input) => {
  if (input && typeof input === "object" && "mode" in input && input.mode === "agent") {
    return { ...input, sticker: "template", fontFamily: DEFAULT_TEXT_FONT_FAMILY, corners: undefined, priceStyle: undefined };
  }
  return input;
}, z.object({
  productPrice: ProductPriceSchema.optional(),
  displayMode: DecorationDisplayModeSchema.optional(),
  priceStyle: PriceStyleIdSchema.optional(),
  mode: z.enum(["manual", "agent"]).optional(),
  sticker: z.string().refine(isStickerId, "unknown sticker").default("template"),
  fontFamily: z.string().refine((family) => fontFamilies.has(family), "unknown font").default(DEFAULT_TEXT_FONT_FAMILY),
  corners: z.object({ "top-left": CornerDecorationSchema.optional(), "top-right": CornerDecorationSchema.optional(), "bottom-left": CornerDecorationSchema.optional(), "bottom-right": CornerDecorationSchema.optional() }).strict().optional(),
}).strict());
export type DecorationOptions = z.infer<typeof DecorationSchema>;
export const DecorationAppearanceSchema = DecorationSchema.transform(({ productPrice: _productPrice, ...appearance }) => appearance);
export type DecorationAppearance = z.infer<typeof DecorationAppearanceSchema>;
export interface DecorationCatalog {
  fonts: string[];
  stickers: { id: string; label: string; url: string; animated: boolean; source: "builtin" | "downloaded" | "uploaded" }[];
}
