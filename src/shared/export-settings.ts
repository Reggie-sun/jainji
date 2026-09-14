import { z } from "zod";

export const ExportSettingsSchema = z.object({
  resolutionMode: z.enum(["source", "1080p", "720p"]),
  frameRateMode: z.enum(["source", "30"]),
  quality: z.enum(["high", "balanced", "small"]),
}).strict();
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionMode: "720p", frameRateMode: "source", quality: "balanced",
};
