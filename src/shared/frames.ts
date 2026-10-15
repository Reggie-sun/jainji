import { z } from "zod";

export const BUILTIN_WIDE_FRAMES = [
  { id: "frame-wide-cream", label: "奶油相纸叠层宽框" },
  { id: "frame-wide-obsidian", label: "曜石流金宽框" },
  { id: "frame-wide-blue", label: "雾蓝玻璃宽框" },
  { id: "frame-wide-sage", label: "鼠尾草礼盒宽框" },
  { id: "frame-wide-pearl", label: "珍珠贝光宽框" },
  { id: "frame-wide-rose", label: "玫瑰缎带宽框" },
  { id: "frame-wide-champagne", label: "香槟扇纹宽框" },
  { id: "frame-wide-kraft", label: "牛皮纸缝线宽框" },
  { id: "frame-wide-silver", label: "冰银切面宽框" },
  { id: "frame-wide-clay", label: "陶土拱纹宽框" },
  { id: "frame-wide-lavender", label: "浅紫流线宽框" },
  { id: "frame-wide-navy", label: "深蓝星芒宽框" },
] as const;

export function isWideFrameId(id: string): boolean {
  return BUILTIN_WIDE_FRAMES.some(frame => frame.id === id);
}

export const BUILTIN_FRAMES = [
  { id: "frame-stars", label: "香槟金双线" },
  { id: "frame-hearts", label: "豆沙粉细线" },
  { id: "frame-confetti", label: "雾蓝留白" },
  { id: "frame-strawberries", label: "奶油米相纸" },
  { id: "frame-daisies", label: "珍珠白柔光" },
  { id: "frame-clovers", label: "鼠尾草铜角" },
  { id: "frame-clouds", label: "亚麻暖白" },
  { id: "frame-moons", label: "深海蓝双线" },
  { id: "frame-butterflies", label: "石墨灰金线" },
  { id: "frame-bubbles", label: "钛银圆角" },
  { id: "frame-rainbows", label: "咖啡色细线" },
  { id: "frame-film", label: "曜石黑金角" },
  { id: "frame-geometric", label: "暖灰留白" },
  ...BUILTIN_WIDE_FRAMES,
] as const;

export function isUploadedFrameId(id: string): boolean {
  return /^uploaded-frame-[a-f0-9]{64}$/.test(id);
}

export function isFrameId(id: string): boolean {
  return BUILTIN_FRAMES.some((frame) => frame.id === id) || isUploadedFrameId(id);
}

export const FrameIdSchema = z.string().refine(isFrameId);

export const FrameSettingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("random"), pool: z.literal("wide").optional() }).strict(),
  z.object({ mode: z.literal("manual"), frameId: FrameIdSchema }).strict(),
]);
export type FrameSettings = z.infer<typeof FrameSettingsSchema>;

export function frameSettings(options?: { frameId?: string; frame?: FrameSettings; framesByMedia?: Record<string, FrameSettings> }, mediaId?: string): FrameSettings {
  return mediaId && options?.framesByMedia?.[mediaId] || options?.frame || (options?.frameId ? { mode: "manual", frameId: options.frameId } : { mode: "none" });
}

export interface FrameCatalogEntry {
  id: string;
  label: string;
  url: string;
  source: "builtin" | "uploaded";
}
