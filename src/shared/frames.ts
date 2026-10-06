import { z } from "zod";

export const BUILTIN_FRAMES = [
  { id: "frame-stars", label: "星星黄边框" },
  { id: "frame-hearts", label: "爱心粉边框" },
  { id: "frame-confetti", label: "彩点蓝边框" },
] as const;

export function isUploadedFrameId(id: string): boolean {
  return /^uploaded-frame-[a-f0-9]{64}$/.test(id);
}

export function isFrameId(id: string): boolean {
  return BUILTIN_FRAMES.some((frame) => frame.id === id) || isUploadedFrameId(id);
}

export const FrameIdSchema = z.string().refine(isFrameId);

export interface FrameCatalogEntry {
  id: string;
  label: string;
  url: string;
  source: "builtin" | "uploaded";
}
