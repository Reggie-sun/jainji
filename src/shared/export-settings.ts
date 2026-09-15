import { z } from "zod";

export const ExportSettingsSchema = z.object({
  resolutionMode: z.enum(["source", "1080p", "720p"]),
  frameRateMode: z.enum(["source", "30"]),
  quality: z.enum(["high", "balanced", "small"]),
}).strict();
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export function outputDimensions(media: { width: number; height: number }, preset: Pick<ExportSettings, "resolutionMode">): { width: number; height: number } {
  const portrait = media.height > media.width;
  if (preset.resolutionMode === "1080p") return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  if (preset.resolutionMode === "720p") return portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  return { width: media.width, height: media.height };
}
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionMode: "720p", frameRateMode: "source", quality: "balanced",
};
