import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertOwnedReviewEvidence, type FullCanvasReviewEvidence } from "./source-fact-review-evidence.js";

export const FULL_CANVAS_REVIEW_METHOD = "explicit-human-full-canvas/v1" as const;
export const EMPTY_FRAME_CONFIRMATION = "这一帧完整画布不存在任何旧贴纸。";
export const TARGET_SET_CONFIRMATION = "已枚举这一帧完整画布中所有可见旧贴纸。";
const TargetSchema = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(160), kind: z.enum(["static", "moving", "animated", "unresolved"]) }).strict();
const Base = { presentationId: z.string().uuid() };
export const FullCanvasReviewCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("TARGETS"), targets: z.array(TargetSchema).min(1).max(128), confirmation: z.literal(TARGET_SET_CONFIRMATION) }).strict(),
  z.object({ ...Base, type: z.literal("EMPTY"), confirmation: z.literal(EMPTY_FRAME_CONFIRMATION) }).strict(),
  z.object({ ...Base, type: z.literal("UNKNOWN"), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
type ReviewCommand = z.infer<typeof FullCanvasReviewCommandSchema>;
type FrameBinding = Readonly<{ evidenceId: string; ordinal: number; pts: number; endPts: number; pixelSha256: string; byteLength: number }>;
type ReviewRecord = Readonly<{ binding: FrameBinding; result: ReviewCommand; reviewedAt: string; presentation: "CLIENT_REPORTED_FULL_CANVAS" }>;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function unsafe(reason: string): never { throw new Error(`UNSAFE: semantic review ${reason}`); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Records human declarations. Neither client presentation claims nor JSON confer qualification. */
export function createFullCanvasReviewSession(evidence: FullCanvasReviewEvidence, reviewerId: string) {
  assertOwnedReviewEvidence(evidence);
  const reviewer = z.string().trim().min(1).max(160).parse(reviewerId);
  const id = randomUUID(); const createdAt = new Date().toISOString();
  const census = evidence.census;
  const records = new Map<number, ReviewRecord>();
  let pending: { id: string; binding: FrameBinding; acknowledged: boolean } | undefined;
  let busy = false; let sealed = false;
  const guard = () => { assertOwnedReviewEvidence(evidence); if (sealed) unsafe("session frozen"); if (busy) unsafe("operation already in progress"); };
  const begin = async (ordinal: number) => {
    guard(); busy = true; pending = undefined;
    try {
      const bytes = await evidence.readFrame(ordinal);
      const frame = census.frames[ordinal]!;
      const binding = freeze({ evidenceId: evidence.id, ordinal, pts: frame.pts, endPts: frame.endPts, pixelSha256: frame.pixelSha256, byteLength: frame.byteLength });
      pending = { id: randomUUID(), binding, acknowledged: false };
      return { presentationId: pending.id, binding, width: census.source.width, height: census.source.height, bytes };
    } finally { busy = false; }
  };
  const acknowledge = (input: unknown) => {
    guard();
    const value = z.object({ presentationId: z.string().uuid(), pixelSha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive() }).strict().parse(input);
    if (!pending || value.presentationId !== pending.id || value.pixelSha256 !== pending.binding.pixelSha256 || value.width !== census.source.width || value.height !== census.source.height) unsafe("presentation binding mismatch");
    pending.acknowledged = true;
  };
  const record = (input: unknown) => {
    guard();
    const result = FullCanvasReviewCommandSchema.parse(input);
    if (!pending || result.presentationId !== pending.id || !pending.acknowledged) unsafe("frame presentation was not acknowledged");
    if (result.type === "TARGETS") {
      if (new Set(result.targets.map(target => target.id)).size !== result.targets.length) unsafe("duplicate targets");
      for (const target of result.targets) for (const [ordinal, previous] of records) {
        if (ordinal === pending.binding.ordinal || previous.result.type !== "TARGETS") continue;
        const prior = previous.result.targets.find(item => item.id === target.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(target)) unsafe("target identity conflicts across frames");
      }
    }
    records.set(pending.binding.ordinal, freeze({ binding: pending.binding, result: structuredClone(result), reviewedAt: new Date().toISOString(), presentation: "CLIENT_REPORTED_FULL_CANVAS" as const }));
    pending = undefined;
  };
  const snapshot = () => freeze({ sessionId: id, sourceIdentity: census.source, censusDigest: census.censusDigest, reviewMethodVersion: FULL_CANVAS_REVIEW_METHOD,
    frameCount: census.horizon.frameCount, reviewerId: reviewer, createdAt, recordedOrdinals: [...records.keys()].sort((a, b) => a - b), frozen: sealed });
  const finish = async () => {
    guard(); busy = true;
    try {
      if (records.size !== census.horizon.frameCount) unsafe("every ordinal requires an explicit result");
      const ordered = census.frames.map(frame => records.get(frame.index) ?? unsafe("frame ordinal missing"));
      await evidence.verifyFresh();
      for (const frame of census.frames) await evidence.readFrame(frame.index);
      const unknownIntervals: { startFrame: number; endFrame: number; startPts: number; endPts: number }[] = [];
      for (const record of ordered) if (record.result.type === "UNKNOWN") {
        const last = unknownIntervals.at(-1); const frame = record.binding;
        if (last?.endFrame === frame.ordinal) { last.endFrame++; last.endPts = frame.endPts; }
        else unknownIntervals.push({ startFrame: frame.ordinal, endFrame: frame.ordinal + 1, startPts: frame.pts, endPts: frame.endPts });
      }
      const targets = new Map<string, z.infer<typeof TargetSchema>>();
      for (const item of ordered) if (item.result.type === "TARGETS") for (const target of item.result.targets) targets.set(target.id, target);
      const body = { schemaVersion: 1 as const, authority: "none" as const, eligible: false as const, semanticReview: "RECORDED_NOT_QUALIFIED" as const,
        methodQualification: "NOT_EVALUATED" as const, session: { ...snapshot(), frozen: true }, decode: census.decode, horizon: census.horizon, evidenceId: evidence.id,
        reviewedAt: new Date().toISOString(), results: ordered, declaredTargets: [...targets.values()].sort((a, b) => a.id.localeCompare(b.id)), unknownIntervals,
        unverifiedIntervals: [{ startFrame: 0, endFrame: census.horizon.frameCount, startPts: census.horizon.startPts, endPts: census.horizon.endPts }] };
      // Missing method qualification applies to the whole horizon independently of UNKNOWN.
      const receipt = freeze({ ...body, receiptDigest: sha(JSON.stringify(body)) });
      sealed = true; pending = undefined;
      return receipt;
    } finally { busy = false; }
  };
  return Object.freeze({ begin, acknowledge, record, snapshot, finish });
}
