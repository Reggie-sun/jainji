import { createHash } from "node:crypto";
import { z } from "zod";
import { AIDeclarationSchema, freezeAI, type AIDeclaration } from "./source-fact-ai-contract.js";
import { assertOwnedReviewEvidence, type FullCanvasReviewEvidence } from "./source-fact-review-evidence.js";
import { FULL_CENSUS_LIMITS } from "./source-fact-census-clock.js";
import { decodeSourceMask } from "./shape-cover-pixel-gate.js";
import { buildStationaryShapeEnvelope, type StationaryShapeEnvelope } from "./shape-cover-stationary-envelope.js";
import type { FullSourceCensus } from "./source-fact-census.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().safe();
export const AutoContourBindingSchema = z.object({ index: integer, pts: z.number().int().safe(), endPts: z.number().int().safe(),
  byteLength: z.number().int().positive().safe(), pixelSha256: digest }).strict();
export const AutoContourBitmapSchema = z.object({
  bbox: z.object({ x: integer, y: integer, width: z.number().int().positive().max(512), height: z.number().int().positive().max(512) }).strict(),
  encoding: z.literal("bitpack-lsb-row-major-v1"), dataBase64: z.string().max(43692), sha256: digest,
  markedPixels: z.number().int().positive().max(262144),
}).strict();
export type AutoContourBitmap = z.infer<typeof AutoContourBitmapSchema>;
export type AutoContourBinding = z.infer<typeof AutoContourBindingSchema>;
export const AutoContourConfigSchema = z.object({
  version: z.literal("auto-contour-extractor-development/v1"),
  method: z.enum(["per-frame-exterior-difference/v1", "temporal-stable-exterior-difference/v1"]),
  support: z.literal("controlled-uniform-exterior-development/v1"),
  edgeThreshold: z.literal(0), roiMapping: z.literal("source-integer-1-to-1/v1"),
}).strict();
export type AutoContourConfig = z.infer<typeof AutoContourConfigSchema>;
export const AUTO_CONTOUR_CONFIG: Readonly<AutoContourConfig> = Object.freeze({ version: "auto-contour-extractor-development/v1",
  method: "per-frame-exterior-difference/v1", support: "controlled-uniform-exterior-development/v1", edgeThreshold: 0, roiMapping: "source-integer-1-to-1/v1" });
export const AUTO_CONTOUR_LIMITS = Object.freeze({ receiptBytes: 64 * 1024 ** 2, wallMs: FULL_CENSUS_LIMITS.wallMs, targets: 128 });
const boundDeclaration = z.object({ binding: AutoContourBindingSchema, declaration: AIDeclarationSchema }).strict();
export interface AutoContourInput {
  evidence: FullCanvasReviewEvidence;
  declarations: readonly { binding: AutoContourBinding; declaration: AIDeclaration }[];
  config: Readonly<AutoContourConfig>;
  range?: { startFrame: number; endFrame: number };
  signal: AbortSignal;
}
export interface AutoContourFrame {
  readonly targetId: string;
  readonly binding: Readonly<AutoContourBinding>;
  readonly extractorVersion: string;
  readonly configDigest: string;
  readonly declarationDigest: string;
  readonly state: "VISIBLE" | "NOT_VISIBLE" | "UNKNOWN";
  readonly mask: Readonly<AutoContourBitmap> | null;
  readonly reason: string | null;
}
export interface AutoContourCandidate {
  readonly receipt: Readonly<{
    method: "auto-source-contour-candidate/v1"; authority: "none"; eligible: false;
    status: "CANDIDATE" | "INCOMPLETE";
    maskReview: "NOT_EVALUATED"; motionReview: "NOT_EVALUATED"; semanticReview: "NOT_EVALUATED";
    source: FullSourceCensus["source"]; censusDigest: string;
    config: Readonly<AutoContourConfig>; configDigest: string; inputDigest: string;
    declarationOrigin: "UNQUALIFIED_ENGINEERING_DECLARATIONS";
    declarations: readonly Readonly<{ binding: Readonly<AutoContourBinding>; declaration: AIDeclaration }>[];
    range: Readonly<{ startFrame: number; endFrame: number }>;
    targets: readonly Readonly<{ targetId: string; description: string; category: "static" | "animated";
      anchor: Readonly<{ x: number; y: number }>; frames: readonly AutoContourFrame[] }>[];
    receiptDigest: string;
  }>;
}
const owned = new WeakMap<AutoContourCandidate, FullCanvasReviewEvidence>();
const started = new WeakMap<AutoContourCandidate, bigint>();
function unsafe(why: string): never { throw Error(`UNSAFE: automatic contour ${why}`); }

/** Serializable metadata never restores candidate ownership or source admission. */
export function assertOwnedAutomaticContours(candidate: AutoContourCandidate): FullCanvasReviewEvidence {
  const evidence = owned.get(candidate);
  if (!evidence) unsafe("candidate not owned");
  assertOwnedReviewEvidence(evidence);
  return evidence;
}

/** Process-local chronology for independently pre-frozen evaluations; never serialized authority. */
export function automaticContourStartedAt(candidate: AutoContourCandidate): bigint {
  assertOwnedAutomaticContours(candidate);
  return started.get(candidate)!;
}

function pending<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error("UNSAFE: automatic contour cancelled or wall budget exceeded"));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** Exact-color exterior is a declared DEVELOPMENT envelope, never a general segmentation proof. */
function segment(rgba: Buffer, size: { width: number; height: number }, box: AutoContourBitmap["bbox"]): { mask: AutoContourBitmap | null; reason: string | null } {
  const pixel = (x: number, y: number) => (y * size.width + x) * 4;
  const reference = pixel(box.x, box.y);
  const equal = (offset: number) => [0, 1, 2, 3].every(c => rgba[offset + c] === rgba[reference + c]);
  for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
    if ((x === box.x || y === box.y || x === box.x + box.width - 1 || y === box.y + box.height - 1) && !equal(pixel(x, y))) {
      return { mask: null, reason: "EXTERIOR_NOT_UNIFORM" };
    }
  }
  let left = box.x + box.width, top = box.y + box.height, right = -1, bottom = -1;
  const points: number[] = [];
  for (let y = box.y + 1; y < box.y + box.height - 1; y++) for (let x = box.x + 1; x < box.x + box.width - 1; x++) {
    if (equal(pixel(x, y))) continue;
    points.push(y * size.width + x); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (!points.length) return { mask: null, reason: "DECLARED_TARGET_NOT_SEPARABLE" };
  const width = right - left + 1, height = bottom - top + 1;
  const packed = Buffer.alloc(Math.ceil(width * height / 8));
  for (const p of points) { const bit = (Math.floor(p / size.width) - top) * width + p % size.width - left; packed[bit >> 3] |= 1 << (bit & 7); }
  const mask: AutoContourBitmap = { bbox: { x: left, y: top, width, height }, encoding: "bitpack-lsb-row-major-v1",
    dataBase64: packed.toString("base64"), sha256: hash(packed), markedPixels: points.length };
  if (!decodeSourceMask({ ...mask, kind: "static-binary-v1" }, size)) unsafe("invalid extracted bitmap");
  return { mask, reason: null };
}

/** All requested D1 ordinals, all declared targets; no caller masks, human receipts, queue or knowledge writes. */
export async function extractAutomaticSourceContours(input: AutoContourInput): Promise<AutoContourCandidate> {
  const startedAt = process.hrtime.bigint();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const evidence = input.evidence; assertOwnedReviewEvidence(evidence);
    const config = AutoContourConfigSchema.parse(input.config), census = evidence.census, size = census.source;
    const range = z.object({ startFrame: integer, endFrame: integer }).strict().parse(input.range ?? { startFrame: 0, endFrame: census.horizon.frameCount });
    if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0
      || range.endFrame <= range.startFrame || range.endFrame > census.horizon.frameCount) unsafe("invalid range");
    if (size.width * size.height > 16777216 || input.declarations.length !== range.endFrame - range.startFrame) unsafe("incomplete ordinals or raster budget");
    // Schema parsing creates detached snapshots before the first asynchronous operation.
    const declarations: z.infer<typeof boundDeclaration>[] = [];
    let declarationBytes = 0;
    for (const raw of input.declarations) {
      const d = boundDeclaration.parse(raw);
      declarationBytes += Buffer.byteLength(JSON.stringify(d));
      if (declarationBytes > AUTO_CONTOUR_LIMITS.receiptBytes) unsafe("declaration byte budget exceeded");
      declarations.push(d);
    }
    const targets = new Map<string, { targetId: string; description: string; category: "static" | "animated"; anchor: { x: number; y: number }; frames: AutoContourFrame[] }>();
    for (const [offset, d] of declarations.entries()) {
      const index = range.startFrame + offset, original = census.frames[index];
      if (d.binding.index !== index || d.declaration.ordinal !== index || JSON.stringify(d.binding) !== JSON.stringify(AutoContourBindingSchema.parse(original))) unsafe("frame binding mismatch");
      if (d.declaration.type !== "TARGETS") continue;
      for (const t of d.declaration.targets) {
        if (t.category === "moving") unsafe("moving target unsupported");
        const b = t.bbox;
        if (b.width < 3 || b.height < 3 || b.width > 512 || b.height > 512 || b.x + b.width > size.width || b.y + b.height > size.height) unsafe("search ROI out of supported bounds");
        const previous = targets.get(t.id);
        if (previous && (previous.description !== t.description || previous.category !== t.category)) unsafe("target identity changed");
        // This origin is a mapping/declared anchor, expressly NOT an independent motion assessment.
        if (previous && (previous.anchor.x !== b.x || previous.anchor.y !== b.y)) unsafe("search origin changed; motion unresolved");
        if (!previous) targets.set(t.id, { targetId: t.id, description: t.description, category: t.category, anchor: { x: b.x, y: b.y }, frames: [] });
      }
    }
    if (targets.size > AUTO_CONTOUR_LIMITS.targets) unsafe("target budget exceeded");
    const configDigest = hash(JSON.stringify(config)), inputDigest = hash(JSON.stringify({ source: census.source, censusDigest: census.censusDigest, range, configDigest, declarations }));
    const budget = new AbortController(), signal = AbortSignal.any([input.signal, budget.signal]);
    timer = setTimeout(() => budget.abort(), AUTO_CONTOUR_LIMITS.wallMs);
    signal.throwIfAborted(); await pending(evidence.verifyFresh(), signal); signal.throwIfAborted();
    let receiptBytes = declarationBytes, incomplete = targets.size === 0;
    if (receiptBytes > AUTO_CONTOUR_LIMITS.receiptBytes) unsafe("receipt byte budget exceeded");
    const signatures = new Map<string, string>();
    for (const d of declarations) {
      signal.throwIfAborted(); assertOwnedReviewEvidence(evidence);
      const rgba = await pending(evidence.readFrame(d.binding.index), signal); signal.throwIfAborted();
      if (rgba.length !== d.binding.byteLength || hash(rgba) !== d.binding.pixelSha256) unsafe("original frame bytes changed");
      for (const target of targets.values()) {
        let mask: AutoContourBitmap | null = null, reason: string | null = null, state: AutoContourFrame["state"] = "NOT_VISIBLE";
        if (d.declaration.type === "UNKNOWN") { state = "UNKNOWN"; reason = "TARGET_DECLARATION_UNKNOWN"; }
        else if (d.declaration.type === "TARGETS") {
          const declared = d.declaration.targets.find(t => t.id === target.targetId);
          if (declared) { const result = segment(rgba, size, declared.bbox); mask = result.mask; reason = result.reason; state = mask ? "VISIBLE" : "UNKNOWN"; }
        }
        const signature = JSON.stringify({ state, mask });
        if (target.category === "static" && signatures.has(target.targetId) && signatures.get(target.targetId) !== signature) {
          state = "UNKNOWN"; reason = "STATIC_VISIBILITY_OR_CONTOUR_CHANGED"; mask = null;
        }
        signatures.set(target.targetId, signatures.get(target.targetId) ?? signature);
        const frame: AutoContourFrame = { targetId: target.targetId, binding: { ...d.binding }, extractorVersion: config.version,
          configDigest, declarationDigest: hash(JSON.stringify(d)), state, mask, reason };
        receiptBytes += Buffer.byteLength(JSON.stringify(frame));
        if (receiptBytes > AUTO_CONTOUR_LIMITS.receiptBytes) unsafe("receipt byte budget exceeded");
        if (state === "UNKNOWN") incomplete = true;
        target.frames.push(frame);
      }
    }
    // Temporal stability is an explicitly rejected development alternative on changing silhouettes.
    if (config.method === "temporal-stable-exterior-difference/v1") {
      for (const target of targets.values()) {
        const first = JSON.stringify({ state: target.frames[0].state, mask: target.frames[0].mask });
        if (target.frames.length < 3 || target.frames.some(f => JSON.stringify({ state: f.state, mask: f.mask }) !== first)) {
          incomplete = true;
          target.frames = target.frames.map(f => ({ ...f, state: "UNKNOWN", mask: null, reason: "TEMPORAL_STABILITY_CONTRADICTION" }));
        }
      }
    }
    await pending(evidence.verifyFresh(), signal); signal.throwIfAborted(); assertOwnedReviewEvidence(evidence);
    const body = { method: "auto-source-contour-candidate/v1" as const, authority: "none" as const, eligible: false as const,
      status: incomplete ? "INCOMPLETE" as const : "CANDIDATE" as const, maskReview: "NOT_EVALUATED" as const,
      motionReview: "NOT_EVALUATED" as const, semanticReview: "NOT_EVALUATED" as const, source: census.source,
      censusDigest: census.censusDigest, config, configDigest, inputDigest,
      declarationOrigin: "UNQUALIFIED_ENGINEERING_DECLARATIONS" as const, declarations, range, targets: [...targets.values()] };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) + 100 > AUTO_CONTOUR_LIMITS.receiptBytes) unsafe("receipt byte budget exceeded");
    const candidate = freezeAI({ receipt: { ...body, receiptDigest: hash(serialized) } });
    owned.set(candidate, evidence); started.set(candidate, startedAt); return candidate;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNSAFE:")) throw error;
    return unsafe(input.signal.aborted ? "cancelled" : "input, evidence or extraction could not be verified");
  } finally { if (timer) clearTimeout(timer); }
}

/** Reuse the existing non-authoritative union owner; UNKNOWN cannot be converted to geometry. */
export async function buildAutomaticContourEnvelope(candidate: AutoContourCandidate, targetId: string, signal: AbortSignal): Promise<StationaryShapeEnvelope> {
  const evidence = assertOwnedAutomaticContours(candidate), receipt = candidate.receipt;
  if (receipt.status !== "CANDIDATE") unsafe("incomplete candidate");
  const target = receipt.targets.find(t => t.targetId === targetId);
  if (!target || target.frames.some(f => f.state === "UNKNOWN")) unsafe("missing or unknown target");
  return buildStationaryShapeEnvelope({ evidence, targetId, motion: target.category === "static" ? "static" : "stationary-animation", anchor: { ...target.anchor },
    range: { ...receipt.range }, maskProviderId: receipt.config.method, signal,
    declareFrame: async ({ binding }) => {
      const f = target.frames[binding.index - receipt.range.startFrame];
      return { ...f.binding, targetId, anchor: target.anchor, state: f.state, mask: f.mask };
    } });
}
