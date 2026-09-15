import { z } from "zod";

export const CoverStickerIdSchema = z.string().regex(/^uploaded-[a-f0-9]{64}$/, "请选择自己上传的贴纸");
export const CoverRectangleSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.01).max(1),
  height: z.number().finite().min(0.01).max(1),
}).strict().refine((rect) => rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9, "覆盖框必须完整位于画面内");
export const CoverStickerSchema = z.object({
  enabled: z.boolean(),
  stickerIds: z.array(CoverStickerIdSchema).max(50),
  rectangle: CoverRectangleSchema,
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.stickerIds.length) ctx.addIssue({ code: "custom", path: ["stickerIds"], message: "请至少选择一张自己的贴纸" });
  if (new Set(value.stickerIds).size !== value.stickerIds.length) ctx.addIssue({ code: "custom", path: ["stickerIds"], message: "覆盖候选不得重复" });
});
export type CoverSticker = z.infer<typeof CoverStickerSchema>;
export type CoverRectangle = z.infer<typeof CoverRectangleSchema>;
export const DEFAULT_COVER_STICKER: CoverSticker = { enabled: false, stickerIds: [], rectangle: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 } };
