import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { assertOwnedReviewEvidence, type FullCanvasReviewEvidence } from "./source-fact-review-evidence.js";
import { FULL_CENSUS_LIMITS } from "./source-fact-census-clock.js";
import { decodeSourceMask } from "./shape-cover-pixel-gate.js";

export const STATIONARY_ENVELOPE_LIMITS = Object.freeze({ receiptBytes: 64 * 1024 ** 2, wallMs: FULL_CENSUS_LIMITS.wallMs });

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const point = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict();
const bitmap = z.object({
  bbox: point.extend({ width: z.number().int().positive().max(512), height: z.number().int().positive().max(512) }),
  encoding: z.literal("bitpack-lsb-row-major-v1"), dataBase64: z.string().max(43692), sha256: hash,
  markedPixels: z.number().int().positive().max(262144),
}).strict();
const frameDeclaration = z.object({
  targetId: z.string().min(1).max(160), index: z.number().int().nonnegative(), pts: z.number().int().safe(),
  endPts: z.number().int().safe(), byteLength: z.number().int().positive(), pixelSha256: hash, anchor: point,
}).strict();
const declaration = z.discriminatedUnion("state", [
  frameDeclaration.extend({ state: z.literal("VISIBLE"), mask: bitmap }),
  frameDeclaration.extend({ state: z.literal("NOT_VISIBLE"), mask: z.null() }),
]);
type FrameDeclaration = z.infer<typeof declaration>;
type FrameBinding = Pick<FrameDeclaration, "index" | "pts" | "endPts" | "byteLength" | "pixelSha256">;
export interface StationaryFrameInput { readonly binding: Readonly<FrameBinding>; readonly rgba: Buffer; readonly signal: AbortSignal }
export interface StationaryEnvelopeInput {
  evidence: FullCanvasReviewEvidence;
  targetId: string;
  motion: "static" | "stationary-animation" | "moving" | "unresolved";
  anchor: { x: number; y: number };
  range: { startFrame: number; endFrame: number };
  maskProviderId: string;
  signal: AbortSignal;
  declareFrame(frame: StationaryFrameInput): Promise<unknown>;
}
export interface StationaryShapeEnvelope {
  readonly receipt: Readonly<{
    method: "stationary-union/v1"; authority: "none"; eligible: false;
    semanticReview: "NOT_EVALUATED"; maskReview: "NOT_EVALUATED"; motionReview: "NOT_EVALUATED";
    source: Readonly<SourceIdentity>; censusDigest: string; targetId: string; maskProviderId: string;
    declaredMotion: "static" | "stationary-animation"; anchor: Readonly<{ x: number; y: number }>;
    range: Readonly<{ startFrame: number; endFrame: number; startPts: number; endPts: number }>;
    frames: readonly FrameDeclaration[];
    union: Readonly<z.infer<typeof bitmap> & { kind: "stationary-union-v1" }>;
    receiptDigest: string;
  }>;
}
const rasters = new WeakMap<StationaryShapeEnvelope, Uint8Array>();
function unsafe(why: string): never { throw new Error(`UNSAFE: stationary envelope ${why}`); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function pendingDeclaration(work: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("UNSAFE: stationary envelope cancelled or wall budget exceeded"));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** Complete geometry candidate only. Caller masks/motion never become reviewed source facts. */
export async function buildStationaryShapeEnvelope(input: StationaryEnvelopeInput): Promise<StationaryShapeEnvelope> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Capture all policy inputs before the first async boundary; callers cannot change the range mid-run.
    const evidence = input.evidence; assertOwnedReviewEvidence(evidence);
    const targetId = z.string().min(1).max(160).parse(input.targetId);
    const maskProviderId = z.string().min(1).max(160).parse(input.maskProviderId);
    const anchor = point.parse(input.anchor), range = { ...input.range }, motion = input.motion;
    const declareFrame = input.declareFrame;
    if (motion !== "static" && motion !== "stationary-animation") unsafe("unsupported motion");
    const census = evidence.census, source = census.source;
    if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0
      || range.endFrame <= range.startFrame || range.endFrame > census.horizon.frameCount) unsafe("invalid frame range");
    if (source.width * source.height > 16777216 || anchor.x >= source.width || anchor.y >= source.height) unsafe("anchor or raster bounds");
    const budget = new AbortController(), signal = AbortSignal.any([input.signal, budget.signal]);
    timer = setTimeout(() => budget.abort(), STATIONARY_ENVELOPE_LIMITS.wallMs);
    signal.throwIfAborted(); await evidence.verifyFresh(); signal.throwIfAborted();
    const union = new Uint8Array(source.width * source.height), frames: FrameDeclaration[] = [];
    let left = source.width, top = source.height, right = -1, bottom = -1, markedPixels = 0, receiptBytes = 0;
    let staticMask: string | undefined;
    for (let index = range.startFrame; index < range.endFrame; index++) {
      signal.throwIfAborted(); assertOwnedReviewEvidence(evidence);
      const binding = census.frames[index]!, rgba = await evidence.readFrame(index);
      signal.throwIfAborted();
      const candidate = declaration.parse(await pendingDeclaration(declareFrame({ binding, rgba, signal }), signal));
      signal.throwIfAborted();
      if (candidate.targetId !== targetId || candidate.index !== index || candidate.pts !== binding.pts
        || candidate.endPts !== binding.endPts || candidate.byteLength !== binding.byteLength || candidate.pixelSha256 !== binding.pixelSha256) unsafe("frame binding mismatch");
      if (candidate.anchor.x !== anchor.x || candidate.anchor.y !== anchor.y) unsafe("anchor changed; moving targets unsupported");
      receiptBytes += Buffer.byteLength(JSON.stringify(candidate)) + 1;
      if (receiptBytes > STATIONARY_ENVELOPE_LIMITS.receiptBytes) unsafe("receipt byte budget exceeded");
      if (candidate.state === "VISIBLE") {
        const signature = JSON.stringify(candidate.mask);
        if (motion === "static" && staticMask !== undefined && signature !== staticMask) unsafe("static mask changed");
        staticMask ??= signature;
        // Reuse the existing bitmap byte validator, without creation/review metadata or schema admission.
        const decoded = decodeSourceMask({ ...candidate.mask, kind: "static-binary-v1" }, source);
        if (!decoded) unsafe("invalid mask bytes or bounds");
        const box = candidate.mask.bbox;
        for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
          const offset = y * source.width + x;
          if (!decoded[offset] || union[offset]) continue;
          union[offset] = 1; markedPixels++;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      frames.push(candidate);
    }
    if (!markedPixels) unsafe("empty union");
    const width = right - left + 1, height = bottom - top + 1;
    if (width > 512 || height > 512) unsafe("union exceeds mask bounds");
    const packed = Buffer.alloc(Math.ceil(width * height / 8));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (union[(top + y) * source.width + left + x]) {
      const bit = y * width + x; packed[bit >> 3] |= 1 << (bit & 7);
    }
    await evidence.verifyFresh(); signal.throwIfAborted(); assertOwnedReviewEvidence(evidence);
    const body = {
      method: "stationary-union/v1" as const, authority: "none" as const, eligible: false as const,
      semanticReview: "NOT_EVALUATED" as const, maskReview: "NOT_EVALUATED" as const, motionReview: "NOT_EVALUATED" as const,
      source, censusDigest: census.censusDigest, targetId, maskProviderId, declaredMotion: motion, anchor,
      range: { ...range, startPts: census.frames[range.startFrame]!.pts, endPts: census.frames[range.endFrame - 1]!.endPts }, frames,
      union: { kind: "stationary-union-v1" as const, bbox: { x: left, y: top, width, height }, encoding: "bitpack-lsb-row-major-v1" as const,
        dataBase64: packed.toString("base64"), sha256: sha(packed), markedPixels },
    };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) + 100 > STATIONARY_ENVELOPE_LIMITS.receiptBytes) unsafe("receipt byte budget exceeded");
    const result = freeze({ receipt: { ...body, receiptDigest: sha(serialized) } });
    rasters.set(result, union); return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNSAFE:")) throw error;
    return unsafe(input.signal.aborted ? "cancelled" : "declaration, mask or evidence could not be verified");
  } finally { if (timer) clearTimeout(timer); }
}

/** Private byte copy, usable only as geometry; serializable receipts carry no authority. */
export function readStationaryEnvelopeMask(envelope: StationaryShapeEnvelope): Uint8Array {
  const raster = rasters.get(envelope);
  if (!raster) unsafe("not owned");
  return raster.slice();
}
