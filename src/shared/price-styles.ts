import { z } from "zod";

const rgba = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
type PriceColor = ReturnType<typeof rgba>;
export interface PriceStyle {
  id: string;
  name: string;
  description: string;
  color: PriceColor;
  strokeColor: PriceColor;
  strokeWidthRatio: number;
  shadow?: { color: PriceColor; xRatio: number; yRatio: number };
  backgroundColor?: PriceColor;
  backgroundPaddingRatio?: number;
}

// Ratios use frame height, just like the persisted text layer and FFmpeg compiler.
export const PRICE_STYLES = [
  { id: "classic", name: "经典红白", description: "红字 · 奶白细边", color: rgba(223, 48, 62), strokeColor: rgba(255, 248, 237), strokeWidthRatio: 0.0025 },
  { id: "comic", name: "漫画撞色", description: "亮黄 · 粗边立体投影", color: rgba(255, 223, 65), strokeColor: rgba(48, 29, 65), strokeWidthRatio: 0.004, shadow: { color: rgba(232, 70, 120), xRatio: 0.004, yRatio: 0.005 } },
  { id: "gold", name: "鎏金立体", description: "暖金 · 深棕立体投影", color: rgba(255, 215, 111), strokeColor: rgba(83, 49, 24), strokeWidthRatio: 0.0025, shadow: { color: rgba(132, 83, 31), xRatio: 0.002, yRatio: 0.004 } },
  { id: "cherry", name: "樱桃奶油", description: "奶白 · 樱桃红粗边", color: rgba(255, 249, 229), strokeColor: rgba(191, 35, 70), strokeWidthRatio: 0.004, shadow: { color: rgba(107, 22, 45), xRatio: 0.002, yRatio: 0.003 } },
  { id: "mint", name: "薄荷汽水", description: "薄荷绿 · 墨绿描边", color: rgba(163, 255, 221), strokeColor: rgba(24, 81, 73), strokeWidthRatio: 0.003, shadow: { color: rgba(32, 136, 113), xRatio: 0.002, yRatio: 0.003 } },
  { id: "ice", name: "冰蓝电光", description: "冰白 · 蓝紫撞色投影", color: rgba(224, 253, 255), strokeColor: rgba(47, 81, 187), strokeWidthRatio: 0.003, shadow: { color: rgba(140, 60, 203), xRatio: 0.003, yRatio: 0.004 } },
  { id: "ink", name: "黑白醒目", description: "纯白 · 黑色粗描边", color: rgba(255, 255, 255), strokeColor: rgba(25, 28, 32), strokeWidthRatio: 0.004 },
  { id: "label", name: "橙红价签", description: "奶白字 · 橙红底牌", color: rgba(255, 251, 235), strokeColor: rgba(255, 251, 235), strokeWidthRatio: 0, backgroundColor: rgba(208, 48, 32), backgroundPaddingRatio: 0.009 },
] as const satisfies readonly PriceStyle[];

export const PriceStyleIdSchema = z.enum(PRICE_STYLES.map((style) => style.id) as [typeof PRICE_STYLES[number]["id"], ...typeof PRICE_STYLES[number]["id"][]]);
export type PriceStyleId = z.infer<typeof PriceStyleIdSchema>;
export function getPriceStyle(id: PriceStyleId = "classic"): PriceStyle {
  return PRICE_STYLES.find((style) => style.id === id)!;
}
export function priceStyleAppearance(style: PriceStyle) {
  return { color: style.color, strokeColor: style.strokeColor, strokeWidthRatio: style.strokeWidthRatio, shadow: style.shadow, backgroundColor: style.backgroundColor, backgroundPaddingRatio: style.backgroundPaddingRatio };
}
export const PRICE_LINE_HEIGHT = 1.4;
export function priceFontSizeRatio(width: number, height: number): number {
  return Math.min(0.08 * width / height, 0.14);
}
