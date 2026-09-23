import { z } from "zod";
import { DEFAULT_EXPORT_SETTINGS, ExportSettingsSchema } from "../shared/export-settings.js";
import { createHash, randomUUID } from "node:crypto";
import { CORNER_SAFE_POLICY, LEGACY_CORNER_SAFE_POLICY, cornerSafeStickerIssues, getCornerSafePolicy } from "../shared/layout-policy.js";
import { isAbsolutePath } from "./platform.js";
import { DEFAULT_EXPORT_FORMAT, ExportFormatSchema } from "../shared/export-format.js";
import { DecorationDisplayModeSchema, ProductPriceSchema, RequiredProductPriceSchema, formatProductPrice } from "../shared/decorations.js";
import { CoverStickerIdSchema, CoverStickerSchema, CoverTrackSchema, coverSettingsMediaIssue, MAX_MANUAL_COVERS } from "../shared/cover-sticker.js";
import { MAX_AUTOMATIC_COVER_TRACKS } from "../shared/automatic-cover.js";
import { CoverReviewDraftSchema } from "../shared/cover-review.js";
import { ProjectWorkspaceSchema } from "../shared/project-workspace.js";
import { SourceFactsSchema } from "../shared/source-sticker-knowledge.js";
import { CoverPlacementSchema } from "../shared/cover-placement.js";
import { JianjiError } from "./errors.js";

export { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults.js";

export const TEMPLATE_SCHEMA_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 3;
export const QUEUE_SCHEMA_VERSION = 2;
export const BATCH_SCHEMA_VERSION = 2;
// Legacy template format remains unchanged.
export const SCHEMA_VERSION = TEMPLATE_SCHEMA_VERSION;

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
  textAlign: z.enum(["left", "center"]).optional(),
  content: z.string().min(1).max(500),
  fontFamily: z.string().min(1).max(200),
  fontSizeRatio: z.number().finite().gt(0).lte(0.5),
  color: ColorSchema,
  strokeColor: ColorSchema,
  strokeWidthRatio: z.number().finite().min(0).lte(0.05),
  shadow: z.object({
    color: ColorSchema,
    xRatio: z.number().finite().min(-0.02).max(0.02),
    yRatio: z.number().finite().min(-0.02).max(0.02),
  }).strict().optional(),
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
  activeRanges: z.array(z.object({
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
  }).strict()).min(1).max(MAX_AUTOMATIC_COVER_TRACKS * 50 * 6 + 1).superRefine((ranges, ctx) => {
    if (ranges.some((range, index) => range.endMs <= range.startMs || (index > 0 && range.startMs < ranges[index - 1].endMs))) {
      ctx.addIssue({ code: "custom", message: "贴纸显示时段必须正向、有序且不重叠" });
    }
  }).optional(),
  cover: z.object({
    stickerId: CoverStickerIdSchema,
    height: z.number().finite().gt(0).max(1),
    motion: CoverTrackSchema.optional(),
    opaqueBackground: z.literal(true).optional(),
    automatic: z.literal(true).optional(),
    targetId: z.string().min(1).max(80).optional(),
    regionId: z.string().uuid().optional(),
    sharedSticker: z.literal(true).optional(),
    selection: z.object({ runId: z.string().uuid(), round: z.number().int().positive() }).strict().optional(),
  }).strict().optional(),
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
  layoutPolicy: z.enum([LEGACY_CORNER_SAFE_POLICY.id, CORNER_SAFE_POLICY.id]).optional(),
  productPriceDraft: ProductPriceSchema.optional(),
  decorationDisplayMode: DecorationDisplayModeSchema.optional(),
  // Absent on historical exports: their stickers retain the legacy shared timing.
  stickerDisplayMode: z.literal("full").optional(),
  // Approximate placement accepted by a rendered preview; not reusable source occupancy facts.
  coverPlacement: CoverPlacementSchema.optional(),
  sourceStickerKnowledge: z.object({
    sourceKey: z.string().regex(/^[a-f0-9]{64}$/), revisionId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
    factsDigest: z.string().regex(/^[a-f0-9]{64}$/), verification: z.literal("sampled"), persistence: z.enum(["saved", "not-saved"]),
    reviewedRanges: SourceFactsSchema.shape.reviewedRanges,
  }).strict().optional(),
  productPrice: RequiredProductPriceSchema.optional(),
  createdAt: DateTime,
  updatedAt: DateTime,
}).strict().superRefine((template, ctx) => {
  if (template.coverPlacement && template.sourceStickerKnowledge) ctx.addIssue({ code: "custom", message: "Cover placement cannot be represented as source knowledge" });
  const layoutPolicy = getCornerSafePolicy(template.layoutPolicy);
  const ids = new Set<string>();
  let coverCount = 0;
  const regionIds = new Set<string>();
  template.layers.forEach((layer, index) => {
    if (ids.has(layer.id)) ctx.addIssue({ code: "custom", path: ["layers", index, "id"], message: "layer id must be unique" });
    ids.add(layer.id);
    if (layer.x + layer.width > 1 + (layer.type === "sticker" && layer.cover ? 1e-9 : 0)) ctx.addIssue({ code: "custom", path: ["layers", index, "width"], message: "layer exceeds the right edge" });
    if (layer.y >= 1) ctx.addIssue({ code: "custom", path: ["layers", index, "y"], message: "layer must start inside the frame" });
    if (layer.type === "sticker" && layer.cover) {
      if (layer.activeRanges) ctx.addIssue({ code: "custom", path: ["layers", index, "activeRanges"], message: "覆盖层只能使用自身轨迹时段" });
      coverCount += 1;
      if (layer.cover.regionId) {
        if (regionIds.has(layer.cover.regionId)) ctx.addIssue({ code: "custom", path: ["layers", index, "cover", "regionId"], message: "覆盖框编号不得重复" });
        regionIds.add(layer.cover.regionId);
      }
      if ((layer.cover.automatic && (layer.cover.regionId || layer.cover.sharedSticker)) || (layer.cover.sharedSticker && !layer.cover.regionId)) ctx.addIssue({ code: "custom", path: ["layers", index, "cover"], message: "覆盖框选款标记必须属于手动覆盖框" });
      if (layer.width <= 0) ctx.addIssue({ code: "custom", path: ["layers", index, "width"], message: "覆盖贴纸宽度必须大于零" });
      if (layer.y + layer.cover.height > 1 + 1e-9) ctx.addIssue({ code: "custom", path: ["layers", index, "cover", "height"], message: "覆盖贴纸必须完整位于画面内" });
      if (layer.rotationDeg !== 0) ctx.addIssue({ code: "custom", path: ["layers", index, "rotationDeg"], message: "覆盖贴纸不支持旋转" });
      if (layer.opacity !== 1) ctx.addIssue({ code: "custom", path: ["layers", index, "opacity"], message: "覆盖贴纸必须完全不透明" });
      if (layer.cover.automatic && (!layer.cover.motion || !layer.cover.targetId)) ctx.addIssue({ code: "custom", path: ["layers", index, "cover"], message: "自动覆盖必须有识别目标与轨迹" });
    }
    if (layoutPolicy && layer.type === "sticker" && !layer.cover) {
      for (const message of cornerSafeStickerIssues(layer, layoutPolicy)) ctx.addIssue({ code: "custom", path: ["layers", index], message });
    }
  });
  if (coverCount > Math.max(MAX_MANUAL_COVERS, MAX_AUTOMATIC_COVER_TRACKS)) ctx.addIssue({ code: "custom", path: ["layers"], message: "覆盖图层数量超出上限" });
  if (coverCount > 1 && template.layers.some((layer) => layer.type === "sticker" && layer.cover && !layer.cover.automatic && !layer.cover.regionId)) ctx.addIssue({ code: "custom", path: ["layers"], message: "多个手动覆盖框必须各自指定编号" });
  if (layoutPolicy) {
    const areaProxy = template.layers
      .filter((layer) => layer.type === "sticker" && !layer.cover && layer.visible)
      .reduce((total, layer) => total + layer.width * layer.width, 0);
    if (areaProxy - layoutPolicy.maxTotalStickerAreaProxy > 1e-9) {
      ctx.addIssue({ code: "custom", path: ["layers"], message: `贴纸总面积估算不得超过画面的 ${Math.round(layoutPolicy.maxTotalStickerAreaProxy * 100)}%` });
    }
  }
});
export type EditTemplate = z.infer<typeof EditTemplateSchema>;

// Historical templates remain readable; execution must obey the current text rule.
export function assertPriceOnlyTemplate(template: EditTemplate): void {
  const text = template.layers.filter((layer) => layer.type === "text");
  if (text.length === 0 && template.productPrice === undefined) return;
  const price = RequiredProductPriceSchema.safeParse(template.productPrice);
  if (!price.success || text.length !== 1 || text[0].content !== formatProductPrice(price.data) ||
      text[0].textAlign !== "center" || text[0].x !== 0.1 || text[0].y !== 0.13 || text[0].width !== 0.8 || !text[0].visible) {
    throw new JianjiError("模板包含非手动价格文字或旧版文字布局，请手动填写价格并重新制作；不能重试旧文字方案。", "input_invalid", "input", false);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash everything an append clone must preserve: strips regenerated ids, the text layer content, and the root price. */
export function appendTemplateDigest(template: EditTemplate): string {
  const comparable = {
    ...template,
    id: undefined,
    productPrice: undefined,
    layers: template.layers.map((layer) => ({ ...layer, id: undefined, ...(layer.type === "text" ? { content: undefined } : {}) })),
  };
  return createHash("sha256").update(canonicalJson(comparable)).digest("hex");
}

export function cloneTemplateForAppend(template: EditTemplate, productPrice: string): EditTemplate {
  const price = RequiredProductPriceSchema.parse(productPrice);
  if (template.layers.filter((layer) => layer.type === "text").length !== 1) {
    throw new JianjiError("源批次不含可复用的展示文字层，无法追加制作。", "input_invalid", "input", false);
  }
  const before = appendTemplateDigest(template);
  const cloned = cloneTemplate(template);
  cloned.id = randomUUID();
  cloned.productPrice = price;
  for (const layer of cloned.layers) {
    layer.id = randomUUID();
    if (layer.type === "text") layer.content = formatProductPrice(price);
  }
  if (appendTemplateDigest(cloned) !== before) {
    throw new JianjiError("追加制作克隆校验失败：冻结方案在克隆中发生变化。", "input_invalid", "input", false);
  }
  return cloned;
}

export interface RandomStickerPoolEntry {
  id: string;
  assetPath: string;
  assetFingerprint: string;
}

/** Filters eligible for random selection in manual append production. */
export const RANDOM_FILTER_POOL: readonly FilterPreset[] = ["none", "warm", "cool", "vivid"];

const RANDOM_FILTER_INTENSITY: Record<FilterPreset, { min: number; max: number }> = {
  none: { min: 0, max: 0 },
  warm: { min: 0.2, max: 0.55 },
  cool: { min: 0.2, max: 0.5 },
  mono: { min: 0.8, max: 1 },
  vivid: { min: 0.25, max: 0.6 },
};

/** Digest for random clone: allows sticker asset and filter changes, verifies geometry frozen. */
export function randomTemplateDigest(template: EditTemplate): string {
  const comparable = {
    ...template,
    id: undefined,
    productPrice: undefined,
    filter: undefined,
    layers: template.layers.map((layer) => {
      if (layer.type === "text") return { ...layer, id: undefined, content: undefined };
      const { id: _layerId, assetPath: _path, assetFingerprint: _fingerprint, ...stickerRest } = layer;
      if (stickerRest.cover) {
        const { stickerId: _stickerId, ...coverRest } = stickerRest.cover;
        return { ...stickerRest, cover: coverRest };
      }
      return stickerRest;
    }),
  };
  return createHash("sha256").update(canonicalJson(comparable)).digest("hex");
}

/** Balanced sticker picker: shuffles the pool once, rotates through it, tracks per-template exclusions. */
export class BalancedStickerPicker {
  private readonly shuffled: RandomStickerPoolEntry[];
  private cursor = 0;

  constructor(pool: readonly RandomStickerPoolEntry[]) {
    if (pool.length === 0) throw new JianjiError("没有可用的贴纸资源。", "input_invalid", "input", false);
    this.shuffled = [...pool];
    for (let index = this.shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [this.shuffled[index], this.shuffled[swapIndex]] = [this.shuffled[swapIndex], this.shuffled[index]];
    }
  }

  pick(excluded: ReadonlySet<string>): RandomStickerPoolEntry {
    for (let attempt = 0; attempt < this.shuffled.length * 2; attempt += 1) {
      const entry = this.shuffled[this.cursor % this.shuffled.length];
      this.cursor += 1;
      if (!excluded.has(entry.id)) return entry;
    }
    return this.shuffled[this.cursor % this.shuffled.length];
  }
}

export function cloneTemplateForRandom(template: EditTemplate, productPrice: string, picker: BalancedStickerPicker): EditTemplate {
  const price = RequiredProductPriceSchema.parse(productPrice);
  if (template.layers.filter((layer) => layer.type === "text").length !== 1) {
    throw new JianjiError("源批次不含可复用的展示文字层，无法追加制作。", "input_invalid", "input", false);
  }
  const before = randomTemplateDigest(template);
  const cloned = cloneTemplate(template);
  cloned.id = randomUUID();
  cloned.productPrice = price;
  const preset = RANDOM_FILTER_POOL[Math.floor(Math.random() * RANDOM_FILTER_POOL.length)];
  const intensityRange = RANDOM_FILTER_INTENSITY[preset];
  cloned.filter = { presetId: preset, intensity: intensityRange.min + Math.random() * (intensityRange.max - intensityRange.min) };
  const usedStickers = new Set<string>();
  const sharedRegionStickers = new Map<string, RandomStickerPoolEntry>();
  for (const layer of cloned.layers) {
    if (layer.type === "sticker" && layer.cover?.regionId && layer.cover.sharedSticker && !sharedRegionStickers.has(layer.cover.regionId)) {
      const picked = picker.pick(usedStickers);
      sharedRegionStickers.set(layer.cover.regionId, picked);
      usedStickers.add(picked.id);
    }
  }
  for (const layer of cloned.layers) {
    layer.id = randomUUID();
    if (layer.type === "text") {
      layer.content = formatProductPrice(price);
      continue;
    }
    let picked: RandomStickerPoolEntry;
    if (layer.cover?.regionId && layer.cover.sharedSticker) {
      picked = sharedRegionStickers.get(layer.cover.regionId)!;
    } else {
      picked = picker.pick(usedStickers);
      usedStickers.add(picked.id);
    }
    layer.assetPath = picked.assetPath;
    layer.assetFingerprint = picked.assetFingerprint;
    if (layer.cover) layer.cover.stickerId = picked.id;
  }
  if (randomTemplateDigest(cloned) !== before) {
    throw new JianjiError("随机克隆校验失败：布局几何在克隆中发生变化。", "input_invalid", "input", false);
  }
  return cloned;
}

export const ExportPresetSchema = ExportSettingsSchema.extend({
  container: ExportFormatSchema,
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
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
  schemaVersion: z.literal(BATCH_SCHEMA_VERSION),
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  submission: z.object({ submissionId: z.string().uuid(), mediaId: z.string().uuid(), version: z.number().int().positive(), bindingDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
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

export const LatestProductionSchema = z.object({
  id: z.string().uuid(),
  items: z.array(z.object({
    id: z.string().uuid(),
    mediaId: z.string().uuid(),
    version: z.number().int().positive(),
    name: z.string().min(1),
    status: z.enum(["waiting", "analyzing", "prepared", "exporting", "failed", "cancelled"]),
    taskId: z.string().uuid().optional(),
    error: z.string().optional(),
  }).strict()).max(1000),
}).strict();

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  mediaItems: z.array(MediaItemSchema).max(1000),
  templates: z.array(EditTemplateSchema).max(100),
  activeTemplateId: z.string().uuid(),
  exportBatches: z.array(ExportBatchSchema),
  latestProduction: LatestProductionSchema.optional(),
  coverSticker: CoverStickerSchema.optional(),
  reviewDrafts: z.array(CoverReviewDraftSchema).optional(),
  workspaceDraft: ProjectWorkspaceSchema.optional(),
  updatedAt: DateTime,
}).strict().superRefine((project, ctx) => {
  const trackIssue = coverSettingsMediaIssue(project.coverSticker, project.mediaItems);
  if (trackIssue) ctx.addIssue({ code: "custom", path: ["coverSticker", "tracks"], message: trackIssue });
  if (!project.templates.some((template) => template.id === project.activeTemplateId)) {
    ctx.addIssue({ code: "custom", path: ["activeTemplateId"], message: "active template does not exist" });
  }
  if (project.workspaceDraft?.outputDirectory && !isAbsolutePath(project.workspaceDraft.outputDirectory)) {
    ctx.addIssue({ code: "custom", path: ["workspaceDraft", "outputDirectory"], message: "must be an absolute path" });
  }
});
export type Project = z.infer<typeof ProjectSchema>;

export const QueueStateSchema = z.object({
  schemaVersion: z.literal(QUEUE_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  batch: ExportBatchSchema,
  updatedAt: DateTime,
}).strict();
export type QueueState = z.infer<typeof QueueStateSchema>;

export const DEFAULT_PRESET: ExportPreset = {
  container: DEFAULT_EXPORT_FORMAT,
  videoCodec: "h264",
  audioCodec: "aac",
  ...DEFAULT_EXPORT_SETTINGS,
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
    schemaVersion: PROJECT_SCHEMA_VERSION,
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
