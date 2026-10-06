import { z } from "zod";

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
  z.object({ mode: z.literal("random") }).strict(),
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
