import { HumanRegionBindingSchema } from "../shared/human-region-cover.js";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import { outputDimensions } from "../shared/export-settings.js";
import { EditTemplateSchema, type EditTemplate, type ExportPreset, type MediaItem, type StickerLayer } from "./domain.js";
import { reviewDigest, assertApprovable } from "./cover-review-approval.js";
import { inspectArtifactFile } from "./shape-cover-artifact-io.js";
import { MAX_FROZEN_SHAPE_BYTES } from "../shared/shape-cover.js";
import { decodeShapeCoverPng, readShapeCoverAsset, type ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { shapeCoverDigest } from "./shape-cover-render.js";
import { projectHumanRectangle, opaqueRegionCovered } from "./human-region-geometry.js";
import { hybridMaskBounds } from "./shape-cover-hybrid-shape.js";
import { identifySource, sourceKey, type SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { FfmpegAdapter } from "./ffmpeg.js";
import type { HumanRegionIntent } from "./human-region-cover.js";

export const hasHumanRegions = (template: EditTemplate) => template.layers.some(l => l.type === "sticker" && l.cover?.humanRegion);

/** Compiler receives immutable full-canvas bytes; no white fill or geometric reconstruction. */
export async function readFrozenHumanRegion(layer: StickerLayer, media: MediaItem, preset: ExportPreset): Promise<Buffer> {
  const binding = HumanRegionBindingSchema.parse(layer.cover?.humanRegion), { bindingDigest, ...body } = binding;
  const size = outputDimensions(media, preset), source = binding.source;
  if (bindingDigest !== reviewDigest(body) || binding.mediaId !== media.id || source.fingerprint !== media.fingerprint || source.byteLength !== media.sizeBytes ||
    source.width !== media.width || source.height !== media.height || source.rotation !== media.rotation || source.durationMs !== Math.round(media.durationMs) ||
    binding.settings.resolutionMode !== preset.resolutionMode || binding.settings.frameRateMode !== preset.frameRateMode || binding.settings.quality !== preset.quality ||
    binding.container !== preset.container || binding.projection.width !== size.width || binding.projection.height !== size.height ||
    reviewDigest(projectHumanRectangle(binding.rectangle, source, binding.projection)) !== reviewDigest(binding.target) ||
    layer.assetFingerprint !== `sha256:${binding.pngSha256}`) throw Error("人工覆盖冻结绑定已失效，请重新准备预览。");
  const asset = await inspectArtifactFile(layer.assetPath, MAX_FROZEN_SHAPE_BYTES, undefined, undefined, true), png = asset.content;
  if (asset.fingerprint !== layer.assetFingerprint || png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
    png.toString("ascii", 12, 16) !== "IHDR" || png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height) throw Error("人工覆盖冻结 PNG 已变化。");
  return png;
}

/** Fresh bytes and coverage; intentionally makes no assertion that the human found every old sticker. */
export async function verifyHumanRegionTemplate(template: EditTemplate, media: MediaItem, preset: ExportPreset,
  tools: ShapeCoverMediaTools, store?: SourceStickerKnowledgeStore): Promise<void> {
  EditTemplateSchema.parse(template);
  for (const layer of template.layers) {
    if (layer.type !== "sticker" || !layer.cover?.humanRegion) continue;
    tools.signal?.throwIfAborted();
    const binding = layer.cover.humanRegion;
    if (sourceKey(await identifySource(media.sourcePath, binding.source)) !== sourceKey(binding.source)) throw Error("人工覆盖原素材已变化。");
    if (store) {
      const probe = await new FfmpegAdapter(tools.ffmpegPath, tools.ffprobePath).probe(media.sourcePath);
      const videoMs = Math.round(Number(probe.streams?.find(s => s.codec_type === "video")?.duration) * 1000);
      // Existing automatic knowledge can bind video duration rather than container duration.
      for (const durationMs of new Set([binding.source.durationMs, ...(Number.isSafeInteger(videoMs) && videoMs > 0 ? [videoMs] : [])])) {
        const existing = await store.lookup({ ...binding.source, durationMs }, [{ startMs: 0, endMs: durationMs }]);
        if (existing.status === "disputed" || existing.status === "unusable") throw Error("原源知识存在争议或完整性未知，人工覆盖已停止。");
      }
    }
    await readShapeCoverAsset(binding.artwork, tools);
    const rgba = await decodeShapeCoverPng(await readFrozenHumanRegion(layer, media, preset), binding.projection, tools);
    const alpha = new Uint8Array(rgba.length / 4);
    for (let p = 0; p < alpha.length; p++) alpha[p] = rgba[p * 4 + 3];
    if (shapeCoverDigest(rgba) !== binding.rgbaSha256 || !opaqueRegionCovered(alpha, binding.projection, binding.target) ||
      reviewDigest(hybridMaskBounds(alpha, binding.projection)) !== reviewDigest(binding.visualBounds)) throw Error("人工覆盖冻结像素未完整覆盖指定区域。");
  }
}

export function assertHumanRegionIntent(draft: HumanRegionIntent, template: EditTemplate, mediaId: string): void {
  const layers = template.layers.filter((l): l is StickerLayer => l.type === "sticker" && Boolean(l.cover?.humanRegion));
  if (!draft.assistedArtwork) { if (layers.length) throw Error("人工区域策略与草稿不符。"); return; }
  const media = draft.media.find(m => m.mediaId === mediaId);
  if (!media) throw Error("人工覆盖素材不属于草稿。");
  const segments = media.disposition === "no_cover" ? [] : media.segments;
  if (layers.length !== segments.length || template.layers.some(l => l.type === "sticker" && l.cover && !l.cover.humanRegion)) throw Error("人工覆盖目标集合不完整。");
  for (const segment of segments) {
    const b = layers.find(l => l.cover!.humanRegion!.segmentId === segment.id)?.cover?.humanRegion;
    if (!b || b.admission !== draft.admission || b.projectId !== draft.projectId || b.draftId !== draft.id || b.revision !== draft.revision || b.mediaId !== mediaId ||
      b.source.fingerprint !== media.sourceFingerprint || b.identityId !== segment.identityId || segment.origin !== "human" || segment.track.keyframes.length !== 1 ||
      !media.identities.some(i => i.id === segment.identityId && i.origin === "human") ||
      b.range.startMs !== segment.track.startMs || b.range.endMs !== segment.track.endMs || reviewDigest(b.rectangle) !== reviewDigest(segment.track.keyframes[0].rectangle)) throw Error("人工覆盖区域或修订已变化。");
  }
}

/** Checks the existing review approval, without issuing a second approval/token. Main-only queue input. */
export function assertHumanRegionSubmission(input: { template: EditTemplate; projectId?: string; reviewDraft?: CoverReviewDraft;
  manualIntent?: HumanRegionIntent; mediaIds?: string[];
  submission?: { submissionId: string; mediaId: string; version: number; bindingDigest: string } }): void {
  if (input.manualIntent) {
    if (input.reviewDraft || input.submission || input.manualIntent.admission !== "manual-production-v1" || input.manualIntent.projectId !== input.projectId || input.mediaIds?.length !== 1) throw Error("人工覆盖制作意图不匹配。");
    assertHumanRegionIntent(input.manualIntent, input.template, input.mediaIds[0]);
    return;
  }
  if (!hasHumanRegions(input.template) && !input.reviewDraft?.assistedArtwork) return;
  const draft = input.reviewDraft, submission = input.submission;
  if (!draft || draft.status !== "approved" || !submission || draft.projectId !== input.projectId || draft.approval?.submissionId !== submission.submissionId) throw Error("人工覆盖必须从已批准的全部版本审阅提交。");
  assertApprovable(draft);
  assertHumanRegionIntent(draft, input.template, submission.mediaId);
  const frozen = draft.frozen.find(v => v.mediaId === submission.mediaId && v.version === submission.version);
  if (!frozen || frozen.templateDigest !== reviewDigest(input.template) || frozen.bindingDigest !== submission.bindingDigest) throw Error("人工覆盖提交与批准版本不符。");
}
