import { z } from "zod";
import { DEFAULT_TEXT_FONT_FAMILY } from "./defaults.js";

export const FONT_CHOICES = [DEFAULT_TEXT_FONT_FAMILY, "Noto Serif CJK SC", "AR PL UKai CN", "AR PL UMing CN", "Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "FangSong"] as const;
export const FONT_LABELS: Record<typeof FONT_CHOICES[number], string> = {
  "Noto Sans CJK SC": "思源黑体（Windows 使用微软雅黑）", "Noto Serif CJK SC": "思源宋体",
  "AR PL UKai CN": "文鼎楷体", "AR PL UMing CN": "文鼎明体",
  "Microsoft YaHei": "微软雅黑", SimHei: "黑体", SimSun: "宋体", KaiTi: "楷体", FangSong: "仿宋",
};
export const DecorationSchema = z.object({
  sticker: z.enum(["template", "none", "sparkle", "arrow", "heart", "burst"]).default("template"),
  fontFamily: z.enum(FONT_CHOICES).default(DEFAULT_TEXT_FONT_FAMILY),
}).strict();
export type DecorationOptions = z.infer<typeof DecorationSchema>;
export interface DecorationCatalog {
  fonts: string[];
  stickers: { id: "sparkle" | "arrow" | "heart" | "burst"; label: string; url: string }[];
}
