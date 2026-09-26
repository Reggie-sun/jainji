import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { outputDimensions } from "../shared/export-settings.js";
import { FrozenShapeCoverBindingSchema, FrozenShapeCoverSchema, MAX_FROZEN_SHAPE_BYTES, type FrozenShapeCover } from "../shared/shape-cover.js";
import type { EditTemplate, ExportPreset, MediaItem, StickerLayer } from "./domain.js";
import { JianjiError } from "./errors.js";
import { readAdmittedShapeCoverTarget } from "./shape-cover-candidates.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

export const shapeCoverDigest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function shapeCoverBindingDigest(binding: unknown): string {
  // Schema parsing fixes key order and excludes the digest itself.
  const { bindingSha256: _digest, ...body } = FrozenShapeCoverSchema.parse(binding);
  return shapeCoverDigest(Buffer.from(JSON.stringify(FrozenShapeCoverBindingSchema.parse(body))));
}

export function assertShapeCoverExportReady(template: EditTemplate): void {
  if (template.layers.some(layer => layer.type === "sticker" && layer.cover?.shapeMatched)) {
    throw new JianjiError("UNSAFE: 形状覆盖尚未取得逐帧输出与独立内容安全准入。", "input_invalid", "input", false);
  }
}

export async function verifyFrozenShapeSources(template: EditTemplate, media: MediaItem, store?: SourceStickerKnowledgeStore, signal?: AbortSignal): Promise<void> {
  for (const layer of template.layers) {
    if (layer.type !== "sticker" || !layer.cover?.shapeMatched) continue;
    signal?.throwIfAborted();
    if (!store) throw new Error("UNSAFE: frozen shape preview requires canonical source knowledge");
    const binding = layer.cover.shapeMatched;
    try {
      const admitted = await readAdmittedShapeCoverTarget({ id: binding.intendedTargetId, sourcePath: media.sourcePath, source: binding.source,
        revisionId: binding.sourceRevisionId, targetId: binding.targetId, segmentId: binding.segmentId, range: binding.range,
        placements: [{ outputSettingId: binding.outputSettingId, rectangle: binding.placement }] }, store);
      if (admitted.factsDigest !== binding.factsDigest || admitted.mask.sha256 !== binding.maskSha256) throw new Error("Source facts changed");
    } catch {
      signal?.throwIfAborted();
      throw new Error("UNSAFE: frozen source mask is no longer admitted");
    }
  }
  signal?.throwIfAborted();
}

/** Read a verified immutable compiler input; FFmpeg must consume its task copy. */
export async function readFrozenShapeCover(layer: StickerLayer, media: MediaItem, preset: ExportPreset): Promise<Buffer> {
  const binding: FrozenShapeCover = FrozenShapeCoverSchema.parse(layer.cover?.shapeMatched);
  const { source, settings, projection } = binding;
  const size = outputDimensions(media, preset);
  if (binding.bindingSha256 !== shapeCoverBindingDigest(binding)
    || media.fingerprint !== source.fingerprint || media.sizeBytes !== source.byteLength || media.width !== source.width || media.height !== source.height
    || media.rotation !== source.rotation || media.durationMs !== source.durationMs
    || settings.resolutionMode !== preset.resolutionMode || settings.frameRateMode !== preset.frameRateMode || settings.quality !== preset.quality
    || projection.width !== size.width || projection.height !== size.height || layer.assetFingerprint !== `sha256:${binding.pngSha256}`) throw new Error("UNSAFE: frozen shape binding mismatch");
  const file = await open(layer.assetPath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 33 || info.size > MAX_FROZEN_SHAPE_BYTES) throw new Error("UNSAFE: invalid frozen shape PNG");
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const frozen = bytes.subarray(0, bytesRead);
    if (bytesRead !== info.size || shapeCoverDigest(frozen) !== binding.pngSha256
      || !frozen.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || frozen.toString("ascii", 12, 16) !== "IHDR"
      || frozen.readUInt32BE(16) !== size.width || frozen.readUInt32BE(20) !== size.height) throw new Error("UNSAFE: frozen shape bytes mismatch");
    return frozen;
  } finally { await file.close(); }
}
