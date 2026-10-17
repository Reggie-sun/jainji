import { z } from "zod";
import { MAX_AGENT_OUTPUTS } from "./agent.js";
import { VideoMicroAdjustmentsSchema, videoMicroAdjustmentRecipe } from "./video-micro-adjustments.js";
import { QianchuanUploadSelectionSchema } from "./douyin-upload.js";

export const MAX_FISSION_OUTPUTS = MAX_AGENT_OUTPUTS;
export const FissionSettingsSchema = z.object({
  speed: z.number().finite().min(0.97).max(1.0756),
  inset: z.union([z.literal(0), z.literal(4), z.literal(8)]),
  contrast: z.number().finite().min(0.985).max(1.025),
  saturation: z.number().finite().min(0.965).max(1.035),
  brightness: z.number().finite().min(-0.006).max(0.006),
  gamma: z.number().finite().min(0.99).max(1.014),
  ...VideoMicroAdjustmentsSchema.omit({ contrast: true, saturation: true, brightness: true, gamma: true }).partial().shape,
}).strict().superRefine((settings, ctx) => {
  if ((settings.grainStrength ?? 0) > 0 && settings.grainSeed === undefined) ctx.addIssue({ code: "custom", path: ["grainSeed"], message: "颗粒参数缺少冻结种子。" });
});
export type FissionSettings = z.infer<typeof FissionSettingsSchema>;

export const FissionStartSchema = z.object({
  projectId: z.string().uuid(),
  mediaIds: z.array(z.string().uuid()).min(1).max(MAX_FISSION_OUTPUTS).refine(ids => new Set(ids).size === ids.length, "素材不能重复。"),
  total: z.number().int().min(1).max(MAX_FISSION_OUTPUTS),
  outputDirectory: z.string().min(1).max(4096),
  douyinUpload: QianchuanUploadSelectionSchema.optional(),
}).strict();
export type FissionStart = z.infer<typeof FissionStartSchema>;

export function fissionAllocation(sourceCount: number, total: number): number[] {
  z.number().int().min(1).max(MAX_FISSION_OUTPUTS).parse(sourceCount);
  FissionStartSchema.shape.total.parse(total);
  return Array.from({ length: sourceCount }, (_, i) => Math.floor(total / sourceCount) + (i < total % sourceCount ? 1 : 0));
}

/** Deterministic micro-adjustments; previously frozen recipes are never regenerated. */
export function fissionVariant(version: number): FissionSettings {
  z.number().int().min(0).max(MAX_FISSION_OUTPUTS - 1).parse(version);
  const rounded = (n: number) => Number(n.toFixed(4));
  return FissionSettingsSchema.parse({
    speed: rounded(0.97 + ((version * 13) % 34) * 0.0032),
    inset: [0, 4, 8][version % 3],
    ...videoMicroAdjustmentRecipe(version),
  });
}
