import { z } from "zod";

export const EXPORT_FORMATS = ["mp4", "mov", "mkv"] as const;
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export const DEFAULT_EXPORT_FORMAT: ExportFormat = "mp4";
