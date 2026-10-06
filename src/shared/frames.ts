import { z } from "zod";

export const BUILTIN_FRAMES = [
  { id: "frame-stars", label: "星星黄边框" },
  { id: "frame-hearts", label: "爱心粉边框" },
  { id: "frame-confetti", label: "彩点蓝边框" },
  { id: "frame-strawberries", label: "草莓奶油边框" },
  { id: "frame-daisies", label: "雏菊花园边框" },
  { id: "frame-clovers", label: "四叶草绿边框" },
  { id: "frame-clouds", label: "晴空云朵边框" },
  { id: "frame-moons", label: "月亮夜空边框" },
  { id: "frame-butterflies", label: "蝴蝶紫边框" },
  { id: "frame-bubbles", label: "海蓝泡泡边框" },
  { id: "frame-rainbows", label: "糖果彩虹边框" },
  { id: "frame-film", label: "复古胶片边框" },
  { id: "frame-geometric", label: "几何橙边框" },
] as const;

export function isUploadedFrameId(id: string): boolean {
  return /^uploaded-frame-[a-f0-9]{64}$/.test(id);
}

export function isFrameId(id: string): boolean {
  return BUILTIN_FRAMES.some((frame) => frame.id === id) || isUploadedFrameId(id);
}

export const FrameIdSchema = z.string().refine(isFrameId);

export const FrameSettingsSchema = z.discriminatedUnion("mode", [
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
