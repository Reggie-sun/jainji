import { z } from "zod";
import { encodeShapeCoverPng, type ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { assertOwnedDiscoveryEvidence, discoveryHash, type DiscoveryEvidence } from "./source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "./shape-cover-stationary-discovery.js";
import type { ModelMessage } from "./api-transport.js";

export const VISION_PACKET_LIMITS = Object.freeze({ candidates: 3, images: 12, imageBytes: 8 * 1024 ** 2, totalBytes: 32 * 1024 ** 2 });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const Integer = z.number().int().nonnegative().safe();
const Box = z.object({ x: Integer, y: Integer, width: Integer.positive(), height: Integer.positive() }).strict();
const Component = z.object({ candidateId: Id, gridBox: Box, sourceBox: Box, signals: z.object({
  stablePixels: Integer, meanMaxChannelStd: z.number().finite().nonnegative(), edgePixels: Integer,
  meanAdjacentPersistence: z.number().finite().min(0).max(1), sampledScreenCoordinateConsistency: z.number().finite().min(0).max(1),
}).strict() }).strict();
const Image = z.object({ sourceKey: Digest, ordinal: Integer, pts: z.number().int().safe(), pixelSha256: Digest,
  crop: Box, candidateIds: z.array(Id).max(3), kind: z.enum(["CONTEXT", "CROP", "ORIGINAL", "COVERED"]),
  imageSha256: Digest, byteLength: Integer.positive(),
}).strict();
const Manifest = z.object({ version: z.literal("shape-cover-vision-packet/v1"), kind: z.enum(["CANDIDATE", "PREVIEW"]),
  sourceKey: Digest, sourceWidth: Integer.positive(), sourceHeight: Integer.positive(), timeBase: z.string().regex(/^\d+\/\d+$/),
  candidates: z.array(Component).min(1).max(3), images: z.array(Image).min(2).max(12),
}).strict();
export type VisionComponent = z.infer<typeof Component>;
export type VisionImageInput = Omit<z.infer<typeof Image>, "imageSha256" | "byteLength"> & { png: Buffer };
export interface VisionPacket {
  readonly manifest: Readonly<z.infer<typeof Manifest>>;
  readonly packetDigest: string;
  content(): Exclude<ModelMessage["content"], string>;
  verifyFresh(): Promise<void>;
}

/** Development input composer, no mask, proof, or publication authority. */
export function createVisionPacket(input: Omit<z.infer<typeof Manifest>, "version" | "images">,
  images: readonly VisionImageInput[], verifyFresh: () => Promise<void>): VisionPacket {
  if (images.length > VISION_PACKET_LIMITS.images || images.some(i => i.png.length > VISION_PACKET_LIMITS.imageBytes) ||
      images.reduce((n, i) => n + i.png.length, 0) > VISION_PACKET_LIMITS.totalBytes) throw Error("VISION_IMAGE_BUDGET");
  const urls = images.map(i => {
    if (i.png.length < 24 || i.png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        i.png.readUInt32BE(16) !== i.crop.width || i.png.readUInt32BE(20) !== i.crop.height) throw Error("VISION_IMAGE_MAPPING");
    return `data:image/png;base64,${i.png.toString("base64")}`;
  });
  const manifest = Manifest.parse({ ...input, version: "shape-cover-vision-packet/v1", images: images.map(({ png, ...binding }) =>
    ({ ...binding, imageSha256: discoveryHash(png), byteLength: png.length })) });
  const ids = manifest.candidates.map(c => c.candidateId);
  if (new Set(ids).size !== ids.length) throw Error("VISION_CANDIDATE_MISMATCH");
  for (const b of [...manifest.candidates.map(c => c.sourceBox), ...manifest.images.map(i => i.crop)]) {
    if (b.x + b.width > manifest.sourceWidth || b.y + b.height > manifest.sourceHeight) throw Error("VISION_IMAGE_MAPPING");
  }
  for (const image of manifest.images) {
    if (image.sourceKey !== manifest.sourceKey || new Set(image.candidateIds).size !== image.candidateIds.length ||
        image.candidateIds.some(id => !ids.includes(id))) throw Error("VISION_SOURCE_BINDING");
    if (image.kind !== "CROP" && (image.crop.x || image.crop.y || image.crop.width !== manifest.sourceWidth || image.crop.height !== manifest.sourceHeight)) throw Error("VISION_CONTEXT_MAPPING");
  }
  if (manifest.kind === "CANDIDATE") {
    const context = manifest.images.filter(i => i.kind === "CONTEXT");
    if (context.length < 1 || context.length > 3 || manifest.images.some(i => !["CONTEXT", "CROP"].includes(i.kind))) throw Error("VISION_CONTEXT_REQUIRED");
    for (const id of ids) {
      const crops = manifest.images.filter(i => i.kind === "CROP" && i.candidateIds.includes(id));
      if (crops.length < 3 || crops.length > 6 || new Set(crops.map(i => i.ordinal)).size !== crops.length) throw Error("VISION_TEMPORAL_CROPS_REQUIRED");
      const box = manifest.candidates.find(c => c.candidateId === id)!.sourceBox;
      if (crops.some(i => JSON.stringify(i.crop) !== JSON.stringify(box))) throw Error("VISION_CROP_MAPPING");
    }
  } else {
    const originals = manifest.images.filter(i => i.kind === "ORIGINAL"), covered = manifest.images.filter(i => i.kind === "COVERED");
    if (originals.length < 3 || originals.length !== covered.length || originals.length * 2 !== manifest.images.length ||
        new Set(originals.map(i => i.ordinal)).size !== originals.length || new Set(covered.map(i => i.ordinal)).size !== covered.length ||
        originals.some(o => !covered.some(c => c.ordinal === o.ordinal && c.pts === o.pts))) throw Error("VISION_PREVIEW_PAIRS_REQUIRED");
  }
  const serialized = JSON.stringify(manifest), packetDigest = discoveryHash(serialized);
  // Retain immutable serialized metadata and image strings, never caller buffers or local paths.
  return Object.freeze({ get manifest() { return JSON.parse(serialized) as z.infer<typeof Manifest>; }, packetDigest,
    verifyFresh, content: () => [{ type: "text" as const, text: JSON.stringify({ ...JSON.parse(serialized), packetDigest }) },
      ...urls.flatMap((url, i) => [{ type: "text" as const, text: `imageIndex=${i}` }, { type: "image_url" as const, image_url: { url, detail: "high" } }])] });
}

export async function buildVisionCandidatePacket(evidence: DiscoveryEvidence, candidateIds: readonly string[], tools: ShapeCoverMediaTools): Promise<VisionPacket> {
  assertOwnedDiscoveryEvidence(evidence);
  const signal = tools.signal ?? new AbortController().signal;
  signal.throwIfAborted(); await evidence.verifyFresh();
  const r = evidence.receipt;
  if (r.frames.length < 3 || r.frames.length > 32 || (r.frameCount >= 16 && r.frames.length < 16)) throw Error("VISION_OBSERVATION_BUDGET");
  if (candidateIds.length < 1 || candidateIds.length > 3 || new Set(candidateIds).size !== candidateIds.length) throw Error("VISION_CANDIDATE_BUDGET");
  const result = await discoverStationaryTargets(evidence, signal);
  const candidates = candidateIds.map(candidateId => {
    const component = result.components.find(c => c.id === candidateId);
    if (!component) throw Error("VISION_CANDIDATE_MISMATCH");
    return { candidateId, gridBox: component.gridBox, sourceBox: component.sourceBox, signals: component.signals };
  });
  const images: VisionImageInput[] = [];
  for (const index of [0, Math.floor((r.frames.length - 1) / 2), r.frames.length - 1]) {
    signal.throwIfAborted();
    const rgba = await evidence.readFrame(index), frame = r.frames[index];
    if (rgba.length !== frame.byteLength || discoveryHash(rgba) !== frame.pixelSha256) throw Error("VISION_SOURCE_BINDING");
    const binding = { sourceKey: r.sourceKey, ordinal: frame.index, pts: frame.pts, pixelSha256: frame.pixelSha256 };
    const full = { x: 0, y: 0, width: r.source.width, height: r.source.height };
    images.push({ ...binding, kind: "CONTEXT", candidateIds: [...candidateIds], crop: full, png: await encodeShapeCoverPng(rgba, full, tools) });
    for (const candidate of candidates) {
      const b = candidate.sourceBox, crop = Buffer.alloc(b.width * b.height * 4);
      for (let y = 0; y < b.height; y++) rgba.copy(crop, y * b.width * 4, ((b.y + y) * r.source.width + b.x) * 4, ((b.y + y) * r.source.width + b.x + b.width) * 4);
      images.push({ ...binding, kind: "CROP", candidateIds: [candidate.candidateId], crop: b, png: await encodeShapeCoverPng(crop, b, tools) });
    }
  }
  signal.throwIfAborted(); await evidence.verifyFresh();
  return createVisionPacket({ kind: "CANDIDATE", sourceKey: r.sourceKey, sourceWidth: r.source.width, sourceHeight: r.source.height,
    timeBase: r.source.timeBase, candidates }, images, async () => { assertOwnedDiscoveryEvidence(evidence); await evidence.verifyFresh(); });
}
