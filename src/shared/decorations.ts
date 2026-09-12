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
export const DecorationSchema = z.object({
  sticker: z.string().refine((id) => stickerIds.has(id), "unknown sticker").default("template"),
  fontFamily: z.string().refine((family) => fontFamilies.has(family), "unknown font").default(DEFAULT_TEXT_FONT_FAMILY),
}).strict();
export type DecorationOptions = z.infer<typeof DecorationSchema>;
export interface DecorationCatalog {
  fonts: string[];
  stickers: { id: string; label: string; url: string; animated: boolean; source: "builtin" | "downloaded" }[];
}
