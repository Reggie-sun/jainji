import type { ModelMessage } from "./api-transport.js";
import { createDefaultTemplate, EditTemplateSchema, ExportPresetSchema, type ExportPreset, type MediaItem } from "./domain.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import type { ExportQueue } from "./queue.js";
import type { FrozenShapeCoverResult } from "./shape-cover-freeze.js";
import { readFrozenShapeCover } from "./shape-cover-render.js";
import { fingerprintFile } from "./paths.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import { templateDigest } from "./supervisor-knowledge.js";
import { reviewDigest } from "./cover-review-approval.js";

declare const selectionBrand: unique symbol;
/** Run-local image data only; never source or publication authority. */
export interface ShapeCoverSelectionImages { readonly [selectionBrand]: true }
type Content = Exclude<ModelMessage["content"], string>;
const images = new WeakMap<ShapeCoverSelectionImages, { candidateId: string; content: Content }>();
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

/** Use the existing compiler/queue and paired evidence owner, including actual expanded PNGs. */
export async function prepareShapeCoverSelectionImages(input: {
  candidateId: string; frozen: Extract<FrozenShapeCoverResult, { status: "PASS" }>;
  media: readonly MediaItem[]; preset: ExportPreset; queue: Pick<ExportQueue, "renderPreview" | "verifyShapePreview">;
  ffmpeg: FfmpegAdapter; directory: string; signal: AbortSignal;
}): Promise<ShapeCoverSelectionImages> {
  const content: Content = [];
  const preset = ExportPresetSchema.parse(input.preset);
  for (const media of input.media) {
    input.signal.throwIfAborted();
    const cells = input.frozen.layers.filter(cell => cell.layer.cover!.shapeMatched!.source.fingerprint === media.fingerprint);
    if (!cells.length || cells.some(cell => cell.layer.cover!.shapeMatched!.candidateId !== input.candidateId)) throw new Error("UNSAFE: selection target/candidate mismatch");
    const template = EditTemplateSchema.parse({ ...createDefaultTemplate(), layers: cells.map(cell => structuredClone(cell.layer)) });
    const sample = await input.queue.renderPreview({ template, media, preset, cacheDirectory: input.directory, signal: input.signal });
    await input.queue.verifyShapePreview(sample, template, media, preset);
    const sampleFingerprint = await fingerprintFile(sample);
    const collector = new SupervisorEvidence(input.ffmpeg, media);
    try {
      for (const cell of cells) {
        const binding = cell.layer.cover!.shapeMatched!;
        await readFrozenShapeCover(cell.layer, media, preset);
        const { projection: p, placement: r, radiusPx, range } = binding;
        const margin = radiusPx + 24;
        const left = Math.max(0, (r.x - margin - p.padLeft) / p.scaledWidth);
        const top = Math.max(0, (r.y - margin - p.padTop) / p.scaledHeight);
        const right = Math.min(1, (r.x + r.width + margin - p.padLeft) / p.scaledWidth);
        const bottom = Math.min(1, (r.y + r.height + margin - p.padTop) / p.scaledHeight);
        if (right <= left || bottom <= top) throw new Error("UNSAFE: selection crop outside source");
        const span = range.endMs - range.startMs;
        const times = [...new Set([range.startMs, range.startMs + span / 2, range.endMs - Math.min(50, span / 4)])];
        const evidence = await collector.inspect(times.map(timeMs => ({ timeMs, crop: { x: left, y: top, width: right - left, height: bottom - top } })), input.signal, sample);
        collector.capture(evidence, { candidateId: input.candidateId, factsDigest: binding.factsDigest,
          templateDigest: templateDigest(template), outputSettingsDigest: reviewDigest(preset) });
        for (const frame of evidence) {
          if (!frame.previewUrl || !frame.fullSourceUrl || !frame.fullPreviewUrl || frame.previewTimeMs === undefined
            || frame.previewTimeMs < range.startMs || frame.previewTimeMs >= range.endMs) throw new Error("UNSAFE: selection paired image missing or inactive");
          content.push({ type: "text", text: JSON.stringify({ candidateId: input.candidateId, intendedTargetId: cell.intendedTargetId,
            outputSettingId: cell.outputSettingId, sourceFingerprint: binding.source.fingerprint, sourceRevisionId: binding.sourceRevisionId,
            targetId: binding.targetId, range, placement: r, radiusPx, pngSha256: binding.pngSha256, bindingSha256: binding.bindingSha256,
            sourceTimeMs: frame.timeMs, previewTimeMs: frame.previewTimeMs, sampleFingerprint,
            imageOrder: ["original-full", "candidate-full", "original-detail", "candidate-detail"],
          }) });
          for (const url of [frame.fullSourceUrl, frame.fullPreviewUrl, frame.sourceUrl, frame.previewUrl]) content.push({ type: "image_url", image_url: { url, detail: "high" } });
        }
        if (Buffer.byteLength(JSON.stringify(content)) > MAX_PAYLOAD_BYTES) throw new Error("UNSAFE: selection image payload exceeds resource limit");
      }
      if (await fingerprintFile(sample) !== sampleFingerprint) throw new Error("UNSAFE: selection sample changed");
      for (const cell of cells) await readFrozenShapeCover(cell.layer, media, preset);
    } finally { await collector.dispose(); }
  }
  input.signal.throwIfAborted();
  if (!content.length) throw new Error("UNSAFE: selection images missing");
  const handle = Object.freeze({}) as ShapeCoverSelectionImages;
  images.set(handle, { candidateId: input.candidateId, content });
  return handle;
}

/** Reject JSON/clones, missing images and mismatched directories before any model request. */
export function shapeCoverSelectionContent(handles: readonly ShapeCoverSelectionImages[], candidateIds: readonly string[]): Content {
  if (!candidateIds.length || new Set(candidateIds).size !== candidateIds.length || handles.length !== candidateIds.length) throw new Error("UNSAFE: selection image directory mismatch");
  const content: Content = [], seen = new Set<string>();
  for (const handle of handles) {
    const owned = images.get(handle);
    if (!owned || seen.has(owned.candidateId) || !candidateIds.includes(owned.candidateId)) throw new Error("UNSAFE: selection image identity mismatch");
    seen.add(owned.candidateId);
    content.push(...structuredClone(owned.content));
  }
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_PAYLOAD_BYTES) throw new Error("UNSAFE: selection image payload exceeds resource limit");
  return content;
}
