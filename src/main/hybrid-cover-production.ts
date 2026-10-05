import { randomUUID } from "node:crypto";
import { HybridCoverBindingSchema } from "../shared/hybrid-cover.js";
import { outputDimensions } from "../shared/export-settings.js";
import { EditTemplateSchema, StickerLayerSchema, type EditTemplate, type ExportPreset, type MediaItem, type StickerLayer } from "./domain.js";
import { openHybridPreviewInput, renderHybridPreview, buildHybridPreviewPacket, reviewHybridPreview } from "./shape-cover-hybrid-preview.js";
import type { HybridFrozenOverlay } from "./shape-cover-hybrid-h3.js";
import type { FullSourceCensusInput } from "./source-fact-census.js";
import type { VisionPacket } from "./shape-cover-vision-packet.js";
import type { VisionRole, VisionRoute } from "./shape-cover-vision-router.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { readShapeCoverAsset, decodeShapeCoverPng } from "./shape-cover-alpha.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";
import { identifySource } from "./source-sticker-knowledge-store.js";
import { FfmpegAdapter } from "./ffmpeg.js";
import { probeSourceDecodeClock, streamSourceFactCommand } from "./source-fact-census.js";
import { checkOutputFrameCoverage } from "./shape-cover-pixel-gate.js";

type Routes = Record<VisionRole, VisionRoute>;
type Approval = { layer: StickerLayer; overlay: HybridFrozenOverlay; verifyFresh(): Promise<void>; png: Buffer; tools: FullSourceCensusInput["ffmpeg"] };
const approved = new Map<string, Approval>();
const approvedTemplates = new Set<string>();
const unsafe = (reason: string): never => { throw Error(`UNSAFE: HYBRID_${reason}`); };

/** MediaCatalog describes the container; H2/H3/H4 bind the canonical video timeline. */
export async function hybridVideoMedia(media: MediaItem, tools: FullSourceCensusInput["ffmpeg"]): Promise<MediaItem> {
  const probe = await new FfmpegAdapter(tools.ffmpegPath, tools.ffprobePath).probe(media.sourcePath);
  const video = probe.streams?.find(s => s.codec_type === "video");
  const videoMs = Math.round(Number(video?.duration) * 1000);
  const containerMs = Math.round(Number(probe.format?.duration ?? video?.duration) * 1000);
  if (!Number.isSafeInteger(videoMs) || videoMs <= 0 || containerMs !== media.durationMs) return unsafe("MEDIA_DURATION_CHANGED");
  return { ...media, durationMs: videoMs };
}

/** H4 adapter owns issuance. A caller cannot grant production authority with a verdict or JSON. */
async function approve(overlay: HybridFrozenOverlay, input: FullSourceCensusInput, packet: VisionPacket, routes: Routes,
  verifyTechnical: () => Promise<void>): Promise<StickerLayer> {
  const preview = await openHybridPreviewInput(overlay, input);
  const verifyFresh = async () => { await preview.verifyFresh(); await verifyTechnical(); await packet.verifyFresh(); };
  await verifyFresh();
  if (packet.manifest.sourceKey !== sourceKey(overlay.source) || packet.manifest.kind !== "PREVIEW" ||
      JSON.stringify(packet.manifest.candidates.map(c => c.candidateId)) !== JSON.stringify(overlay.semanticTarget.candidateIds) ||
      packet.manifest.candidates.some((c, i) => JSON.stringify(c.sourceBox) !== JSON.stringify(overlay.maskConfirmation.sourceBoxes[i]))) unsafe("QA_BINDING");
  const qa = await reviewHybridPreview(packet, routes, input.signal);
  if (qa.receipts.some(r => r.status === "UNAVAILABLE" || r.status === "FAILED" && r.failureCode !== "VISION_INVALID_OUTPUT")) unsafe("QA_INFRASTRUCTURE");
  if (qa.verdict !== "PASS") unsafe("H4_NOT_PASS");
  await verifyFresh();
  const png = await readShapeCoverAsset({ assetPath: overlay.pngPath, assetFingerprint: `sha256:${overlay.pngSha256}` }, { ...input.ffmpeg, signal: input.signal });
  const binding = HybridCoverBindingSchema.parse({ version: "HybridApprovedCorner/v1", approvalId: randomUUID(),
    corner: overlay.semanticTarget.corner, bindingDigest: overlay.bindingDigest, pngSha256: overlay.pngSha256, qaPacketDigest: packet.packetDigest,
    source: overlay.source, settings: overlay.settings, projection: { width: overlay.projection.width, height: overlay.projection.height },
    placement: overlay.placement, range: overlay.range, coverage: overlay.coverage });
  const layer: StickerLayer = { id: randomUUID(), type: "sticker", assetPath: overlay.pngPath, assetFingerprint: `sha256:${overlay.pngSha256}`,
    x: 0, y: 0, width: 1, opacity: 1, rotationDeg: 0, zIndex: 100, visible: true,
    cover: { stickerId: overlay.selectedSticker.id, height: 1, hybridApproved: binding } };
  const parsed = StickerLayerSchema.parse(layer);
  approved.set(binding.approvalId, { layer: parsed, overlay: structuredClone(overlay), png: Buffer.from(png), verifyFresh, tools: input.ffmpeg });
  return structuredClone(parsed);
}

/** Normal H3→H4 product preparation. Geometry and preview algorithms remain canonical. */
export async function approveHybridOverlay(overlay: HybridFrozenOverlay, input: FullSourceCensusInput, routes: Routes, directory: string,
  verifySourceKnowledge: () => Promise<void> = async () => {}) {
  const preview = await openHybridPreviewInput(overlay, input), render = await renderHybridPreview(preview, directory);
  const packet = await buildHybridPreviewPacket(preview, render);
  return approve(overlay, input, packet, routes, async () => { await render.verifyFresh(); await verifySourceKnowledge(); });
}

/** Explicit main-only import of a parent-verified, hash-sealed H4 packet; no renderer/IPC entrance.
 * Routes replay the original receipts on this exact packet: no new selection, render or visual judgement. */
export async function importApprovedHybridOverlay(overlay: HybridFrozenOverlay, input: FullSourceCensusInput, packet: VisionPacket,
  routes: Routes, verifyTechnical: () => Promise<void>) {
  return approve(overlay, input, packet, routes, verifyTechnical);
}

function owner(layer: StickerLayer): Approval {
  const binding = HybridCoverBindingSchema.parse(layer.cover?.hybridApproved), a = approved.get(binding.approvalId);
  if (!a || JSON.stringify(a.layer) !== JSON.stringify(StickerLayerSchema.parse(layer))) return unsafe("APPROVAL_BINDING");
  return a;
}

export function assertHybridTemplateReady(template: EditTemplate): void {
  const hasHybrid = template.layers.some(layer => layer.type === "sticker" && layer.cover?.hybridApproved);
  for (const layer of template.layers) if (layer.type === "sticker" && layer.cover?.hybridApproved) owner(layer);
  if (hasHybrid && !approvedTemplates.has(hash(JSON.stringify(EditTemplateSchema.parse(template))))) unsafe("TEMPLATE_CHANGED");
}

/** Task-copy input: never scale, crop, expand, move or replace the approved PNG. */
export async function readApprovedHybridCover(layer: StickerLayer, media: MediaItem, preset: ExportPreset): Promise<Buffer> {
  const a = owner(layer), o = a.overlay, size = outputDimensions(media, preset);
  if (media.fingerprint !== o.source.fingerprint || media.sizeBytes !== o.source.byteLength || media.width !== o.source.width ||
      media.height !== o.source.height || media.rotation !== o.source.rotation ||
      preset.resolutionMode !== o.settings.resolutionMode || preset.frameRateMode !== o.settings.frameRateMode || preset.quality !== o.settings.quality ||
      size.width !== o.projection.width || size.height !== o.projection.height || preset.container !== "mp4") unsafe("OUTPUT_BINDING");
  await a.verifyFresh();
  // Same-byte imported copies still need their own production path checked before and after encode.
  if (sourceKey(await identifySource(media.sourcePath, o.source)) !== sourceKey(o.source)) unsafe("SOURCE_CHANGED");
  if ((await hybridVideoMedia(media, a.tools)).durationMs !== o.source.durationMs) unsafe("VIDEO_TIMELINE_CHANGED");
  const png = await readShapeCoverAsset({ assetPath: layer.assetPath, assetFingerprint: layer.assetFingerprint }, a.tools);
  if (hash(png) !== o.pngSha256 || !png.equals(a.png)) unsafe("PNG_CHANGED");
  return Buffer.from(png);
}

/** Source/PNG/packet/technical freshness and independently decoded coverage before encode and publish. */
export async function verifyApprovedHybridTemplate(template: EditTemplate, media: MediaItem, preset: ExportPreset,
  tools: FullSourceCensusInput["ffmpeg"], signal?: AbortSignal): Promise<void> {
  assertHybridTemplateReady(template);
  for (const layer of template.layers) {
    if (layer.type !== "sticker" || !layer.cover?.hybridApproved) continue;
    signal?.throwIfAborted();
    const a = owner(layer), png = await readApprovedHybridCover(layer, media, preset);
    const rgba = await decodeShapeCoverPng(png, a.overlay.projection, { ...tools, signal });
    if (hash(rgba) !== a.overlay.rgbaSha256) unsafe("RASTER_CHANGED");
    // openHybridPreviewInput also independently recomputes old-mask fully opaque coverage.
    await a.verifyFresh();
  }
}

/** Output PTS coverage is an export check, not a new source geometry/completeness proof. */
export async function verifyHybridOutput(template: EditTemplate, outputPath: string, tools: FullSourceCensusInput["ffmpeg"]): Promise<void> {
  const layers = template.layers.filter((l): l is StickerLayer => l.type === "sticker" && Boolean(l.cover?.hybridApproved));
  if (!layers.length) return;
  const o = owner(layers[0]).overlay, signal = AbortSignal.timeout(300000), adapter = new FfmpegAdapter(tools.ffmpegPath, tools.ffprobePath);
  const probe = await adapter.probe(outputPath), stream = probe.streams?.find(s => s.codec_type === "video") as
    { width?: number; height?: number; time_base?: string; start_pts?: number } | undefined;
  if (!stream?.time_base || stream.width !== o.projection.width || stream.height !== o.projection.height) return unsafe("OUTPUT_DIMENSIONS");
  const output = await identifySource(outputPath, { ...o.source, width: stream.width!, height: stream.height!, timeBase: stream.time_base, timeOriginPts: stream.start_pts ?? 0 });
  const clock = await probeSourceDecodeClock(outputPath, output, tools, signal, Date.now() + 300000);
  const [num, den] = output.timeBase.split("/").map(Number), times = clock.frames.map(f => (f.pts - clock.startPts) * num * 1000 / den);
  for (const layer of layers) {
    const range = owner(layer).overlay.range;
    if (clock.frames.length !== range.endFrame || checkOutputFrameCoverage(times, [range], [range]).status !== "PASS") unsafe("OUTPUT_CLOCK_COVERAGE");
  }
  await streamSourceFactCommand(tools.ffmpegPath, ["-v", "error", "-nostdin", "-xerror", "-i", outputPath, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"], signal, Date.now() + 300000, () => {});
}

export function hybridTemplate(layers: readonly StickerLayer[], base: EditTemplate): EditTemplate {
  for (const layer of layers) owner(layer);
  const template = EditTemplateSchema.parse({ ...base,
    filter: { presetId: "none", intensity: 0 }, layers: [...base.layers.filter(l => l.type === "text"), ...layers] });
  approvedTemplates.add(hash(JSON.stringify(template)));
  return template;
}
