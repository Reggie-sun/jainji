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
  { id: "violet-pop", name: "紫电撞色", description: "亮紫字 · 深紫边 · 青色投影", color: rgba(222, 155, 255), strokeColor: rgba(53, 24, 83), strokeWidthRatio: 0.0035, shadow: { color: rgba(88, 239, 222), xRatio: 0.004, yRatio: 0.004 } },
  { id: "lemon-ink", name: "柠檬黑标", description: "亮黄字 · 黑色底牌", color: rgba(255, 235, 76), strokeColor: rgba(255, 235, 76), strokeWidthRatio: 0, backgroundColor: rgba(29, 31, 29), backgroundPaddingRatio: 0.008 },
  { id: "rose-milk", name: "玫瑰奶糖", description: "玫红字 · 奶白粗边 · 粉色投影", color: rgba(176, 38, 91), strokeColor: rgba(255, 248, 242), strokeWidthRatio: 0.004, shadow: { color: rgba(230, 141, 168), xRatio: 0.002, yRatio: 0.004 } },
  { id: "navy-label", name: "海军蓝签", description: "米白字 · 深蓝底牌", color: rgba(255, 245, 219), strokeColor: rgba(255, 245, 219), strokeWidthRatio: 0, backgroundColor: rgba(28, 49, 83), backgroundPaddingRatio: 0.009 },
  { id: "jade-label", name: "翡翠金签", description: "淡金字 · 墨绿底牌", color: rgba(255, 228, 157), strokeColor: rgba(255, 228, 157), strokeWidthRatio: 0, backgroundColor: rgba(18, 82, 65), backgroundPaddingRatio: 0.008 },
  { id: "cocoa", name: "可可奶霜", description: "奶咖字 · 可可边 · 深棕投影", color: rgba(255, 227, 190), strokeColor: rgba(91, 54, 39), strokeWidthRatio: 0.003, shadow: { color: rgba(52, 33, 28), xRatio: 0.002, yRatio: 0.004 } },
  { id: "tangerine", name: "元气橘子", description: "亮橙字 · 深棕边 · 奶黄投影", color: rgba(255, 150, 45), strokeColor: rgba(88, 39, 25), strokeWidthRatio: 0.0035, shadow: { color: rgba(255, 227, 130), xRatio: 0.004, yRatio: 0.004 } },
  { id: "silver", name: "冷银立体", description: "银灰字 · 炭黑边 · 灰色投影", color: rgba(231, 237, 244), strokeColor: rgba(37, 44, 55), strokeWidthRatio: 0.0025, shadow: { color: rgba(109, 127, 151), xRatio: 0.003, yRatio: 0.004 } },
  { id: "blue-lemon", name: "蓝黄波普", description: "宝蓝字 · 柠檬黄边 · 深蓝投影", color: rgba(33, 74, 182), strokeColor: rgba(255, 235, 91), strokeWidthRatio: 0.004, shadow: { color: rgba(22, 35, 81), xRatio: 0.003, yRatio: 0.004 } },
  { id: "peach", name: "蜜桃乌龙", description: "蜜桃字 · 茶棕边 · 奶白投影", color: rgba(255, 189, 161), strokeColor: rgba(108, 58, 47), strokeWidthRatio: 0.003, shadow: { color: rgba(255, 247, 224), xRatio: 0.003, yRatio: 0.003 } },
  { id: "lavender-label", name: "薰衣草签", description: "深紫字 · 淡紫底牌", color: rgba(64, 39, 99), strokeColor: rgba(64, 39, 99), strokeWidthRatio: 0, backgroundColor: rgba(228, 213, 251), backgroundPaddingRatio: 0.009 },
  { id: "forest", name: "森系奶绿", description: "墨绿字 · 奶油粗边 · 苔绿投影", color: rgba(36, 84, 58), strokeColor: rgba(250, 245, 213), strokeWidthRatio: 0.004, shadow: { color: rgba(130, 158, 102), xRatio: 0.002, yRatio: 0.004 } },
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
export function priceFontSizeRatio(width: number, height: number, text = ""): number {
  const longestLine = Math.max(1, ...text.split("\n").map((line) => [...line].length));
  return Math.min(0.08 * width / height, 0.14, 0.78 * width / height / longestLine);
}
