import { z } from "zod";
import { MAX_AGENT_OUTPUTS } from "./agent.js";

export const MAX_FISSION_OUTPUTS = MAX_AGENT_OUTPUTS;
export const FissionSettingsSchema = z.object({
  speed: z.number().finite().min(0.97).max(1.0756),
  inset: z.union([z.literal(0), z.literal(4), z.literal(8)]),
  contrast: z.number().finite().min(0.985).max(1.025),
  saturation: z.number().finite().min(0.965).max(1.035),
  brightness: z.number().finite().min(-0.006).max(0.006),
  gamma: z.number().finite().min(0.99).max(1.014),
}).strict();
export type FissionSettings = z.infer<typeof FissionSettingsSchema>;

export const FissionStartSchema = z.object({
  projectId: z.string().uuid(),
  mediaIds: z.array(z.string().uuid()).min(1).max(MAX_FISSION_OUTPUTS).refine(ids => new Set(ids).size === ids.length, "素材不能重复。"),
  total: z.number().int().min(1).max(MAX_FISSION_OUTPUTS),
  outputDirectory: z.string().min(1).max(4096),
}).strict();
export type FissionStart = z.infer<typeof FissionStartSchema>;

export function fissionAllocation(sourceCount: number, total: number): number[] {
  z.number().int().min(1).max(MAX_FISSION_OUTPUTS).parse(sourceCount);
  FissionStartSchema.shape.total.parse(total);
  return Array.from({ length: sourceCount }, (_, i) => Math.floor(total / sourceCount) + (i < total % sourceCount ? 1 : 0));
}

/** Frozen local recipe used by the original lightweight fission delivery. */
export function fissionVariant(version: number): FissionSettings {
  z.number().int().min(0).max(MAX_FISSION_OUTPUTS - 1).parse(version);
  const rounded = (n: number) => Number(n.toFixed(4));
  return FissionSettingsSchema.parse({
    speed: rounded(0.97 + ((version * 13) % 34) * 0.0032),
    inset: [0, 4, 8][version % 3],
    contrast: rounded(0.985 + ((version * 7) % 9) * 0.005),
    saturation: rounded(0.965 + ((version * 5) % 11) * 0.007),
    brightness: rounded(-0.006 + ((version * 3) % 7) * 0.002),
    gamma: rounded(0.99 + ((version * 5) % 7) * 0.004),
  });
}
