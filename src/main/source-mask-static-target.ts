import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { SourceIdentitySchema } from "../shared/source-sticker-knowledge.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertOwnedDiscoveryEvidence, discoveryHash as hash, verifyDiscoveryFramehash,
  type DiscoveryEvidence, type DiscoveryBinding } from "./source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "./shape-cover-stationary-discovery.js";
import { FULL_CENSUS_LIMITS, type FullDecodeClock } from "./source-fact-census-clock.js";
import { probeSourceDecodeClock, streamSourceFactCommand, type FullSourceCensusInput } from "./source-fact-census.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { fingerprintFile } from "./paths.js";

export const STATIC_MASK_LIMITS = Object.freeze({ wallMs: 300_000, roiSide: 512, padding: 12,
  workingBytes: 512 * 1024 ** 2, receiptBytes: 16 * 1024 ** 2 });
export function staticIncomplete(why: string): never { throw Error(`INCOMPLETE: static mask ${why}`); }
export const StaticRangeSchema = z.object({ startFrame: z.number().int().nonnegative().safe(), endFrame: z.number().int().positive().safe() }).strict();
const candidateIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ targetId: z.string().uuid(),
  confirmedBy: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(300),
  decision: z.literal("CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY"), range: StaticRangeSchema }).strict();
// Compatibility is confined to fresh API selections, never a serialized v1 receipt.
const confirmationSchema = z.union([identitySchema.extend({ candidateIds: z.array(candidateIdSchema).min(1).max(128)
  .refine(ids => new Set(ids).size === ids.length, "duplicate candidate IDs") }).strict(),
identitySchema.extend({ candidateId: candidateIdSchema }).strict()]);
export type StaticConfirmationInput = z.infer<typeof confirmationSchema>;
type Box = { x: number; y: number; width: number; height: number };
export interface ConfirmedStaticTarget {
  readonly receipt: Readonly<z.infer<typeof identitySchema> & { method: "confirmed-static-target-development/v2"; authority: "none"; eligible: false;
    sourceKey: string; discoveryDigest: string; resultDigest: string; confirmedCandidateIds: readonly string[];
    confirmedComponentDigests: readonly string[]; confirmedSourceBoxes: readonly Readonly<Box>[];
    targetEnvelopeBox: Readonly<Box>; confirmationDigest: string }>;
}
const confirmed = new WeakMap<ConfirmedStaticTarget, DiscoveryEvidence>();

/** One explicit logical identity/range decision; M1 boxes are read from owned evidence only. */
export async function confirmStaticDiscoveryTarget(evidence: DiscoveryEvidence, selection: StaticConfirmationInput, signal: AbortSignal): Promise<ConfirmedStaticTarget> {
  assertOwnedDiscoveryEvidence(evidence);
  const parsed = confirmationSchema.parse(selection);
  const ids = ("candidateIds" in parsed ? [...parsed.candidateIds] : [parsed.candidateId]).sort();
  const input = identitySchema.parse({ targetId: parsed.targetId, confirmedBy: parsed.confirmedBy, description: parsed.description,
    decision: parsed.decision, range: parsed.range });
  const result = await discoverStationaryTargets(evidence, signal);
  const candidates = ids.map(id => result.components.find(c => c.id === id && c.state === "CANDIDATE"));
  if (candidates.some(c => !c) || input.range.endFrame <= input.range.startFrame || input.range.endFrame > evidence.receipt.frameCount) staticIncomplete("missing candidate or invalid confirmed range");
  const boxes = candidates.map(c => c!.sourceBox);
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const targetEnvelopeBox = { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
  signal.throwIfAborted(); await evidence.verifyFresh();
  const body = { ...input, method: "confirmed-static-target-development/v2" as const, authority: "none" as const, eligible: false as const,
    sourceKey: evidence.receipt.sourceKey, discoveryDigest: evidence.receipt.evidenceDigest, resultDigest: result.resultDigest,
    confirmedCandidateIds: ids, confirmedComponentDigests: candidates.map(c => hash(JSON.stringify(c))),
    confirmedSourceBoxes: boxes, targetEnvelopeBox };
  const target = freezeAI({ receipt: { ...body, confirmationDigest: hash(JSON.stringify(body)) } });
  confirmed.set(target, evidence); return target;
}
export function assertConfirmedStaticTarget(target: ConfirmedStaticTarget): DiscoveryEvidence {
  const evidence = confirmed.get(target);
  if (!evidence) staticIncomplete("unowned target confirmation");
  assertOwnedDiscoveryEvidence(evidence); return evidence;
}

export interface StaticTargetEvidence {
  readonly target: ConfirmedStaticTarget;
  readonly clock: Readonly<FullDecodeClock>;
  readonly roi: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly evidenceDigest: string;
  readonly deadline: number;
  readonly metrics: Readonly<{ prepareMs: number; scratchBytes: 0; workingBytes: number }>;
  readRepresentativeRoi(sampleIndex: number): Promise<Buffer>;
  verifyFresh(): Promise<void>;
  streamRange(consume: (rgba: Buffer, binding: Readonly<DiscoveryBinding>) => void, signal: AbortSignal): Promise<readonly Readonly<DiscoveryBinding>[]>;
  close(): Promise<void>;
}
const evidenceOwners = new WeakSet<StaticTargetEvidence>();
export function assertStaticTargetEvidence(evidence: StaticTargetEvidence): void {
  if (!evidenceOwners.has(evidence)) staticIncomplete("unowned or closed target evidence");
  assertConfirmedStaticTarget(evidence.target);
}

/** Original-grid ROI-only stream with independent FFmpeg hash/PTS pipe; no persistent full-frame spool. */
export async function prepareStaticTargetEvidence(input: FullSourceCensusInput, target: ConfirmedStaticTarget,
  limits: { wallMs?: number; workingBytes?: number } = {}): Promise<StaticTargetEvidence> {
  const discovery = assertConfirmedStaticTarget(target), started = performance.now();
  const source = SourceIdentitySchema.parse(input.source), range = target.receipt.range;
  if (sourceKey(source) !== target.receipt.sourceKey) staticIncomplete("confirmation source mismatch");
  const wallMs = limits.wallMs ?? STATIC_MASK_LIMITS.wallMs, workingLimit = limits.workingBytes ?? STATIC_MASK_LIMITS.workingBytes;
  for (const [value, maximum] of [[wallMs, STATIC_MASK_LIMITS.wallMs], [workingLimit, STATIC_MASK_LIMITS.workingBytes]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) staticIncomplete("invalid or enlarged budget");
  }
  const deadline = Math.min(discovery.deadline, Date.now() + wallMs), budget = new AbortController();
  const signal = AbortSignal.any([input.signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), Math.max(1, deadline - Date.now()));
  let closed = false, streaming = false, evidence: StaticTargetEvidence | undefined;
  const close = async () => { closed = true; budget.abort(); clearTimeout(timer); if (evidence) evidenceOwners.delete(evidence); };
  try {
    const sourcePath = await realpath(input.sourcePath), engines = { ffmpegPath: await realpath(input.ffmpeg.ffmpegPath), ffprobePath: await realpath(input.ffmpeg.ffprobePath) };
    const paths = [sourcePath, engines.ffmpegPath, engines.ffprobePath], generations = await Promise.all(paths.map(p => stat(p, { bigint: true })));
    if (generations.some(s => !s.isFile())) staticIncomplete("non-file source or engine");
    const check = () => {
      if (closed) staticIncomplete("closed evidence");
      assertConfirmedStaticTarget(target); signal.throwIfAborted();
      if (Date.now() >= deadline) staticIncomplete("wall budget exceeded");
    };
    const verifyFresh = async () => {
      check(); await discovery.verifyFresh();
      for (let i = 0; i < paths.length; i++) {
        const current = await stat(paths[i], { bigint: true });
        for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) if (current[key] !== generations[i][key]) staticIncomplete("source or engine generation changed");
      }
      if (sourceKey(await identifySource(sourcePath, source, { signal, maxBytes: FULL_CENSUS_LIMITS.sourceBytes })) !== target.receipt.sourceKey) staticIncomplete("source changed");
      for (const [path, expected] of [[engines.ffmpegPath, discovery.receipt.decode.ffmpegFingerprint], [engines.ffprobePath, discovery.receipt.decode.ffprobeFingerprint]]) {
        if (await fingerprintFile(path, { signal, maxBytes: FULL_CENSUS_LIMITS.engineBytes }) !== expected) staticIncomplete("engine changed");
      }
      check();
    };
    await verifyFresh();
    const clock = await probeSourceDecodeClock(sourcePath, source, engines, signal, deadline);
    if (hash(JSON.stringify(clock)) !== discovery.receipt.clockDigest) staticIncomplete("clock mismatch");
    const box = target.receipt.targetEnvelopeBox, padding = STATIC_MASK_LIMITS.padding;
    const x = Math.max(0, box.x - padding), y = Math.max(0, box.y - padding);
    const roi = { x, y, width: Math.min(source.width, box.x + box.width + padding) - x, height: Math.min(source.height, box.y + box.height + padding) - y };
    const bytes = roi.width * roi.height * 4, workingBytes = bytes * 40 + clock.frames.length * 256;
    if (Math.max(roi.width, roi.height) > STATIC_MASK_LIMITS.roiSide || workingBytes > workingLimit) staticIncomplete("ROI working-set budget exceeded");
    const readRepresentativeRoi = async (sampleIndex: number) => {
      check(); const full = await discovery.readFrame(sampleIndex), original = discovery.receipt.frames[sampleIndex];
      if (original.index < range.startFrame || original.index >= range.endFrame) staticIncomplete("representative outside confirmed range");
      const rgba = Buffer.alloc(bytes);
      for (let row = 0; row < roi.height; row++) full.copy(rgba, row * roi.width * 4, ((row + y) * source.width + x) * 4, ((row + y) * source.width + x + roi.width) * 4);
      check(); return rgba;
    };
    const streamRange = async (consume: (rgba: Buffer, binding: Readonly<DiscoveryBinding>) => void, requestedSignal: AbortSignal) => {
      if (streaming) staticIncomplete("concurrent target decode");
      streaming = true;
      try {
        const active = AbortSignal.any([signal, requestedSignal]); active.throwIfAborted(); await verifyFresh();
        const frames: DiscoveryBinding[] = [], frame = Buffer.alloc(bytes); let fill = 0, text = "";
        const output = (name: string, format: string, pipe: string) => ["-map", `[${name}]`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux",
          "-c:v", "rawvideo", "-pix_fmt", "rgba", "-threads", "1", "-f", format, ...(format === "framehash" ? ["-hash", "sha256"] : []), pipe];
        await streamSourceFactCommand(engines.ffmpegPath, ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode",
          "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", sourcePath, "-filter_complex_threads", "1",
          "-filter_complex", `[0:${clock.streamIndex}]select='between(n,${range.startFrame},${range.endFrame - 1})',format=rgba,crop=${roi.width}:${roi.height}:${x}:${y}:exact=1,split=2[pixels][binding]`,
          ...output("pixels", "rawvideo", "pipe:1"), ...output("binding", "framehash", "pipe:3")], active, deadline, chunk => {
          check(); active.throwIfAborted(); let offset = 0;
          while (offset < chunk.length) {
            const n = Math.min(chunk.length - offset, bytes - fill); chunk.copy(frame, fill, offset, offset + n); fill += n; offset += n;
            if (fill === bytes) {
              const index = range.startFrame + frames.length;
              if (index >= range.endFrame) staticIncomplete("extra target frame");
              const binding = { ...clock.frames[index], byteLength: bytes, pixelSha256: hash(frame) };
              frames.push(binding); consume(frame, Object.freeze(binding)); fill = 0; active.throwIfAborted();
            }
          }
        }, chunk => { text += chunk.toString("utf8"); if (Buffer.byteLength(text) > STATIC_MASK_LIMITS.receiptBytes) staticIncomplete("binding byte budget exceeded"); });
        if (fill || frames.length !== range.endFrame - range.startFrame) staticIncomplete("missing target frame or tail");
        verifyDiscoveryFramehash(text, frames, source.timeBase);
        active.throwIfAborted(); await verifyFresh(); active.throwIfAborted();
        return freezeAI(frames);
      } finally { streaming = false; }
    };
    await verifyFresh();
    evidence = Object.freeze({ target, clock: freezeAI(clock), roi: freezeAI(roi), deadline,
      evidenceDigest: hash(JSON.stringify({ confirmation: target.receipt.confirmationDigest, clock: discovery.receipt.clockDigest, roi, decode: discovery.receipt.decode })),
      metrics: Object.freeze({ prepareMs: performance.now() - started, scratchBytes: 0 as const, workingBytes }), readRepresentativeRoi, verifyFresh, streamRange, close });
    evidenceOwners.add(evidence); return evidence;
  } catch (error) { await close(); throw error; }
}
