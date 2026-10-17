import { z } from "zod";

/** Explicit frozen values; parsing historical presets never adds this object. */
export const VideoMicroAdjustmentsSchema = z.object({
  contrast: z.number().finite().min(0.998).max(1.002),
  saturation: z.number().finite().min(0.997).max(1.003),
  brightness: z.number().finite().min(-0.0006).max(0.0006),
  gamma: z.number().finite().min(0.999).max(1.001),
  temperatureKelvin: z.number().finite().min(6460).max(6540),
  tint: z.number().finite().min(-0.0004).max(0.0004),
  hueDegrees: z.number().finite().min(-0.08).max(0.08),
  exposureStops: z.number().finite().min(-0.003).max(0.003),
  shadows: z.number().finite().min(-0.0006).max(0.0006),
  highlights: z.number().finite().min(-0.0006).max(0.0006),
  blacks: z.number().finite().min(-0.0003).max(0.0003),
  whites: z.number().finite().min(-0.0003).max(0.0003),
  vibrance: z.number().finite().min(-0.002).max(0.002),
  sharpness: z.number().finite().min(0).max(0.045),
  grainStrength: z.number().int().min(0).max(2),
  grainSeed: z.number().int().min(0).max(2147483647),
  vignetteAngle: z.number().finite().min(0).max(0.08),
}).strict();
export type VideoMicroAdjustments = z.infer<typeof VideoMicroAdjustmentsSchema>;

export function videoMicroAdjustmentRecipe(version: number): VideoMicroAdjustments {
  z.number().int().min(0).max(2147483647).parse(version);
  const rounded = (value: number) => Number(value.toFixed(4));
  const centered = (factor: number, steps: number, amplitude: number) => rounded((((version * factor) % steps) / (steps - 1) * 2 - 1) * amplitude);
  return VideoMicroAdjustmentsSchema.parse({
    contrast: rounded(1 + centered(7, 9, 0.002)), saturation: rounded(1 + centered(5, 11, 0.003)),
    brightness: centered(3, 7, 0.0006), gamma: rounded(1 + centered(5, 7, 0.001)),
    temperatureKelvin: 6500 + centered(17, 9, 40), tint: centered(3, 9, 0.0004),
    hueDegrees: centered(5, 9, 0.08), exposureStops: centered(7, 11, 0.003),
    shadows: centered(5, 7, 0.0006), highlights: centered(3, 7, 0.0006),
    blacks: centered(2, 7, 0.0003), whites: centered(5, 7, 0.0003),
    vibrance: centered(7, 9, 0.002), sharpness: rounded(0.015 + ((version * 3) % 7) * 0.005),
    grainStrength: 1 + version % 2, grainSeed: (7919 + version * 104729) % 2147483647,
    vignetteAngle: rounded(0.04 + ((version * 5) % 9) * 0.005),
  });
}
