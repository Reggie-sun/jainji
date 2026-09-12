import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CORNER_SAFE_POLICY, cornerSafeStickerIssues } from "../shared/layout-policy.js";
import { isAbsolutePath } from "./platform.js";
import { DEFAULT_EXPORT_FORMAT, ExportFormatSchema } from "../shared/export-format.js";

export { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults.js";

export const SCHEMA_VERSION = 1;

const AbsolutePath = z.string().min(1).refine(isAbsolutePath, "must be an absolute path");
const Unit = z.number().finite().min(0).max(1);
const NonNegativeInt = z.number().int().min(0);
const DateTime = z.string().datetime({ offset: true });

export const ErrorCodeSchema = z.enum([
  "input_invalid",
  "missing_video_track",
  "codec_unsupported",
  "resource_missing",
  "font_missing",
  "sticker_missing",
  "disk_space",
  "permission_denied",
  "encoder_missing",
  "ffmpeg_failed",
  "probe_failed",
  "artifact_invalid",
  "artifact_missing",
  "cancelled",
  "interrupted",
  "schema_invalid",
  "future_schema",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ProbeStatusSchema = z.enum(["ready", "invalid"]);
export type ProbeStatus = z.infer<typeof ProbeStatusSchema>;

export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof RotationSchema>;

export const MediaItemSchema = z.object({
  id: z.string().uuid(),
  sourcePath: AbsolutePath,
  displayName: z.string().min(1),
  fingerprint: z.string().min(1),
  sizeBytes: NonNegativeInt,
  durationMs: NonNegativeInt,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotation: RotationSchema,
  probeStatus: ProbeStatusSchema,
  errorCode: ErrorCodeSchema.optional(),
  errorMessage: z.string().max(2_000).optional(),
  importedAt: DateTime,
}).strict();
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const ColorSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: Unit,
}).strict();
export type Color = z.infer<typeof ColorSchema>;

const LayerBase = {
  id: z.string().uuid(),
  x: Unit,
  y: Unit,
  width: Unit,
  opacity: Unit,
  zIndex: z.number().int().min(-10_000).max(10_000),
  visible: z.boolean(),
};

export const TextLayerSchema = z.object({
  ...LayerBase,
  type: z.literal("text"),
  content: z.string().min(1).max(500),
  fontFamily: z.string().min(1).max(200),
  fontSizeRatio: z.number().finite().gt(0).lte(0.5),
  color: ColorSchema,
  strokeColor: ColorSchema,
  strokeWidthRatio: z.number().finite().min(0).lte(0.05),
  backgroundColor: ColorSchema.optional(),
  backgroundPaddingRatio: z.number().finite().min(0).lte(0.05).optional(),
}).strict();
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const StickerLayerSchema = z.object({
  ...LayerBase,
  type: z.literal("sticker"),
  assetPath: AbsolutePath,
  assetFingerprint: z.string().min(1),
  rotationDeg: z.number().finite().min(-360).max(360),
}).strict();
export type StickerLayer = z.infer<typeof StickerLayerSchema>;

export const LayerSchema = z.discriminatedUnion("type", [TextLayerSchema, StickerLayerSchema]);
export type Layer = z.infer<typeof LayerSchema>;

export const FilterPresetSchema = z.enum(["none", "warm", "cool", "mono", "vivid"]);
export type FilterPreset = z.infer<typeof FilterPresetSchema>;
export const FilterConfigSchema = z.object({
  presetId: FilterPresetSchema,
  intensity: Unit,
}).strict();
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

export const EditTemplateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  version: z.number().int().positive(),
  layers: z.array(LayerSchema).max(100),
  filter: FilterConfigSchema,
  layoutPolicy: z.literal(CORNER_SAFE_POLICY.id).optional(),
  createdAt: DateTime,
  updatedAt: DateTime,
}).strict().superRefine((template, ctx) => {
  const ids = new Set<string>();
  template.layers.forEach((layer, index) => {
    if (ids.has(layer.id)) ctx.addIssue({ code: "custom", path: ["layers", index, "id"], message: "layer id must be unique" });
    ids.add(layer.id);
    if (layer.x + layer.width > 1) ctx.addIssue({ code: "custom", path: ["layers", index, "width"], message: "layer exceeds the right edge" });
    if (layer.y >= 1) ctx.addIssue({ code: "custom", path: ["layers", index, "y"], message: "layer must start inside the frame" });
    if (template.layoutPolicy === CORNER_SAFE_POLICY.id && layer.type === "sticker") {
      for (const message of cornerSafeStickerIssues(layer)) ctx.addIssue({ code: "custom", path: ["layers", index], message });
    }
  });
  if (template.layoutPolicy === CORNER_SAFE_POLICY.id) {
    const areaProxy = template.layers
      .filter((layer) => layer.type === "sticker" && layer.visible)
      .reduce((total, layer) => total + layer.width * layer.width, 0);
    if (areaProxy - CORNER_SAFE_POLICY.maxTotalStickerAreaProxy > 1e-9) {
      ctx.addIssue({ code: "custom", path: ["layers"], message: "贴纸总面积估算不得超过画面的 8%" });
    }
  }
});
export type EditTemplate = z.infer<typeof EditTemplateSchema>;

export const ExportPresetSchema = z.object({
  container: ExportFormatSchema,
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
  resolutionMode: z.enum(["source", "1080p", "720p"]),
  frameRateMode: z.enum(["source", "30"]),
  quality: z.enum(["high", "balanced", "small"]),
}).strict();
export type ExportPreset = z.infer<typeof ExportPresetSchema>;

export const ExportTaskStatusSchema = z.enum([
  "queued", "validating", "running", "verifying", "cancelling",
  "completed", "failed", "cancelled", "interrupted",
]);
export type ExportTaskStatus = z.infer<typeof ExportTaskStatusSchema>;

export const AttemptRecordSchema = z.object({
  attempt: z.number().int().positive(),
  status: ExportTaskStatusSchema,
  startedAt: DateTime.optional(),
  finishedAt: DateTime.optional(),
  outputPath: AbsolutePath.optional(),
  errorCode: ErrorCodeSchema.optional(),
  errorMessage: z.string().max(2_000).optional(),
}).strict();
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;

export const OutputArtifactSchema = z.object({
  taskId: z.string().uuid(),
  path: AbsolutePath,
  sizeBytes: NonNegativeInt,
  durationMs: NonNegativeInt,
  createdAt: DateTime,
}).strict();
export type OutputArtifact = z.infer<typeof OutputArtifactSchema>;

export const ExportTaskSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  mediaId: z.string().uuid(),
  status: ExportTaskStatusSchema,
  progress: Unit,
  attempt: z.number().int().min(0),
  outputPath: AbsolutePath.optional(),
  outputArtifact: OutputArtifactSchema.optional(),
  errorCode: ErrorCodeSchema.optional(),
  errorMessage: z.string().max(2_000).optional(),
  createdAt: DateTime,
  startedAt: DateTime.optional(),
  finishedAt: DateTime.optional(),
  attempts: z.array(AttemptRecordSchema),
}).strict();
export type ExportTask = z.infer<typeof ExportTaskSchema>;

export const ExportBatchStatusSchema = z.enum(["active", "completed", "completed_with_errors", "cancelled"]);
export type ExportBatchStatus = z.infer<typeof ExportBatchStatusSchema>;

export const ExportBatchSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  templateSnapshot: EditTemplateSchema,
  mediaIds: z.array(z.string().uuid()).min(1),
  mediaSnapshots: z.array(MediaItemSchema).min(1).max(1000).optional(),
  outputDirectory: AbsolutePath,
  preset: ExportPresetSchema,
  status: ExportBatchStatusSchema,
  estimatedBytes: NonNegativeInt,
  createdAt: DateTime,
  finishedAt: DateTime.optional(),
  tasks: z.array(ExportTaskSchema).min(1),
}).strict();
export type ExportBatch = z.infer<typeof ExportBatchSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  mediaItems: z.array(MediaItemSchema).max(1000),
  templates: z.array(EditTemplateSchema).max(100),
  activeTemplateId: z.string().uuid(),
  exportBatches: z.array(ExportBatchSchema).max(100),
  updatedAt: DateTime,
}).strict().superRefine((project, ctx) => {
  if (!project.templates.some((template) => template.id === project.activeTemplateId)) {
    ctx.addIssue({ code: "custom", path: ["activeTemplateId"], message: "active template does not exist" });
  }
});
export type Project = z.infer<typeof ProjectSchema>;

export const QueueStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  batch: ExportBatchSchema,
  updatedAt: DateTime,
}).strict();
export type QueueState = z.infer<typeof QueueStateSchema>;

export const DEFAULT_PRESET: ExportPreset = {
  container: DEFAULT_EXPORT_FORMAT,
  videoCodec: "h264",
  audioCodec: "aac",
  resolutionMode: "source",
  frameRateMode: "source",
  quality: "balanced",
};

export function now(): string {
  return new Date().toISOString();
}

export function createDefaultTemplate(name = "未命名模板"): EditTemplate {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: randomUUID(),
    name,
    version: 1,
    layers: [],
    filter: { presetId: "none", intensity: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createDefaultProject(name = "我的简辑项目"): Project {
  const template = createDefaultTemplate();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: randomUUID(),
    name,
    mediaItems: [],
    templates: [template],
    activeTemplateId: template.id,
    exportBatches: [],
    updatedAt: now(),
  };
}

export function deriveBatchStatus(tasks: readonly ExportTask[]): ExportBatchStatus {
  if (tasks.some((task) => !["completed", "failed", "cancelled", "interrupted"].includes(task.status))) return "active";
  if (tasks.every((task) => task.status === "cancelled")) return "cancelled";
  if (tasks.every((task) => task.status === "completed")) return "completed";
  return "completed_with_errors";
}

export function cloneTemplate(template: EditTemplate): EditTemplate {
  return structuredClone(template);
}

export function freezeTemplate(template: EditTemplate): Readonly<EditTemplate> {
  const value = structuredClone(template) as EditTemplate;
  const freeze = <T>(object: T): T => {
    if (object && typeof object === "object") {
      Object.freeze(object);
      for (const child of Object.values(object as Record<string, unknown>)) freeze(child);
    }
    return object;
  };
  return freeze(value);
}
