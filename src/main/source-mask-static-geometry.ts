import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { fingerprintFile } from "./paths.js";
import { assertStaticTargetEvidence, assertConfirmedStaticTarget, staticIncomplete, type StaticTargetEvidence } from "./source-mask-static-target.js";
import { readStaticMaskCandidate, type StaticMaskCandidate } from "./source-mask-static-extraction.js";
import type { FullSourceCensusInput } from "./source-fact-census.js";

/** Exact M2-C v2 parameters; the owned method wraps, never retunes, its CPU kernel. */
export const STATIC_GEOMETRY_CONFIG = freezeAI({ method: "cpu-static-geometry-development/v2", gaussianSigma: 0.6,
  minimumGradient: 8, sampleDirectionCosine: 0.9, sampleConsensus: 0.9, sampleStrengthRatio: [0.5, 2], grid: [3, 3],
  landmarksPerCell: 48, minimumLandmarksPerCell: 8, minimumCells: 6, minimumSpatialSpan: 0.5,
  searchRadius: 4, localSearchRadius: 2, subpixelStep: 0.25, maximumOffset: 0.5, maximumLocalOffset: 0.75,
  minimumCorrelation: 0.9, minimumCellCorrelation: 0.8, ambiguityDistance: 1.5, ambiguityCorrelationGap: 0.02,
  landmarkPresenceRatio: 0.35, maximumLostFraction: 0.15, energyRatio: [0.45, 2.25], boxPadding: 3 });
const KERNELS = { "scripts/shape-cover-static-geometry.py": "d8860f2ff885424e579314fb039f71a6a6116226ba85a92705257c1e71465266",
  "scripts/shape-cover-static-anomalies.py": "888dc35506a69236e544515b876bed8d548ea8fe492ba330fad0be660d9d82e0" };
const NumberValue = z.number().finite(), Offset = z.tuple([NumberValue, NumberValue]);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Fit = z.object({ offset: Offset, correlation: NumberValue.min(-1).max(1), zeroCorrelation: NumberValue.min(-1).max(1),
  distinctPeakGap: NumberValue.nullable(), boundary: z.boolean(), ambiguous: z.boolean() }).strict();
const Frame = z.object({ index: z.number().int().nonnegative(), pts: z.number().int().safe(), endPts: z.number().int().safe(),
  byteLength: z.number().int().positive(), pixelSha256: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["STATIC_GEOMETRY_OBSERVED", "GEOMETRY_CONTRADICTION_OR_UNRESOLVED"]),
  reasons: z.array(z.string()).max(6), globalOffset: Offset, globalAlignment: Fit, gradientEnergyRatio: NumberValue.nonnegative(),
  lostLandmarkFraction: NumberValue.min(0).max(1), cells: z.array(Fit.extend({ cell: z.number().int().min(0).max(8), landmarks: z.number().int().min(8).max(48) }).strict()).min(6).max(9), oldRgbAnomaly: z.boolean() }).strict();
const Reference = z.object({ extent: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  box: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  sampleCount: z.number().int().min(3).max(96), landmarks: z.array(z.object({ sourceX: z.number().int(), sourceY: z.number().int(),
    cell: z.number().int().min(0).max(8), gradient: Offset }).strict()).min(48).max(432),
  origin: z.literal("PERSISTENT_GRADIENT_LANDMARKS_NOT_MASK_OR_REQUIRED_PIXELS") }).strict();
export const StaticGeometryArtifactSchema = z.object({ type: z.literal("owned-static-geometry/v1"),
  receipt: z.object({ method: z.literal("cpu-static-geometry/v1"), kernelMethod: z.literal("cpu-static-geometry-development/v2"), authority: z.literal("none"), eligible: z.literal(false),
    sourceKey: z.string().regex(/^[a-f0-9]{64}$/), confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/), targetId: z.string().uuid(),
    range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict(),
    evidenceDigest: Digest, clockDigest: Digest, bindingDigest: Digest, configDigest: Digest, referenceDigest: Digest, frameMetricsDigest: Digest,
    frameCount: z.number().int().positive().max(20000), firstPts: z.number().int().safe(), lastPts: z.number().int().safe(), endPts: z.number().int().safe(),
    status: z.enum(["DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED", "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED"]), issueFrames: z.array(z.number().int()).max(20000),
    issueRanges: z.array(z.object({ startFrame: z.number().int(), endFrame: z.number().int() }).strict()).max(20000),
    summary: z.object({ maximumGlobalOffset: NumberValue, minimumGlobalCorrelation: NumberValue, minimumDistinctPeakGap: NumberValue,
      maximumLostLandmarkFraction: NumberValue, gradientEnergyRatio: z.tuple([NumberValue, NumberValue]), minimumLocalCorrelation: NumberValue, maximumLocalOffset: NumberValue }).strict(),
    methodSources: z.record(z.string(), Digest).refine(v => Object.keys(v).length === 4
      && ["scripts/shape-cover-static-geometry-worker.py", "src/main/source-mask-static-geometry.ts"].every(p => p in v)
      && Object.entries(KERNELS).every(([p, d]) => v[p] === d)),
    runtime: z.object({ pythonFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), numpy: z.literal("2.2.6"), opencv: z.literal("4.12.0") }).strict(),
    geometryDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(), reference: Reference,
}).strict();
export type StaticGeometryFrame = z.infer<typeof Frame>;
type GeometryData = { reference: z.infer<typeof Reference>; frames: StaticGeometryFrame[] };
export interface OwnedStaticGeometryEvidence {
  readonly receipt: Readonly<{ method: "cpu-static-geometry/v1"; kernelMethod: string; authority: "none"; eligible: false;
    sourceKey: string; confirmationDigest: string; targetId: string; range: Readonly<{ startFrame: number; endFrame: number }>;
    evidenceDigest: string; clockDigest: string; bindingDigest: string; configDigest: string; referenceDigest: string;
    frameMetricsDigest: string; frameCount: number; firstPts: number; lastPts: number; endPts: number;
    status: "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" | "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED";
    issueFrames: readonly number[]; issueRanges: readonly { startFrame: number; endFrame: number }[];
    summary: Readonly<{ maximumGlobalOffset: number; minimumGlobalCorrelation: number; minimumDistinctPeakGap: number;
      maximumLostLandmarkFraction: number; gradientEnergyRatio: readonly number[]; minimumLocalCorrelation: number; maximumLocalOffset: number }>;
    methodSources: Readonly<Record<string, string>>; runtime: Readonly<{ pythonFingerprint: string; numpy: string; opencv: string }>;
    geometryDigest: string }>;
}
const owners = new WeakMap<OwnedStaticGeometryEvidence, { evidence: StaticTargetEvidence; candidate: StaticMaskCandidate;
  data: GeometryData; inputBinding: Readonly<{ sourcePath: string; ffmpegPath: string; ffprobePath: string }>;
  verifyFresh: () => Promise<void>; checkFresh: () => void }>();
export function readOwnedStaticGeometry(geometry: OwnedStaticGeometryEvidence) {
  const owner = owners.get(geometry); if (!owner) staticIncomplete("unowned geometry evidence");
  assertStaticTargetEvidence(owner.evidence); readStaticMaskCandidate(owner.candidate); return owner;
}

function frameReasons(f: StaticGeometryFrame): string[] {
  const c = STATIC_GEOMETRY_CONFIG, reasons: string[] = [], offset = (v: readonly number[]) => Math.max(...v.map(Math.abs));
  const fit = f.globalAlignment;
  if (fit.boundary || fit.ambiguous) reasons.push("SEARCH_BOUNDARY_OR_AMBIGUITY");
  if (offset(fit.offset) > c.maximumOffset) reasons.push("POSITION_DRIFT");
  if (f.lostLandmarkFraction > c.maximumLostFraction || f.gradientEnergyRatio < c.energyRatio[0]) reasons.push("LANDMARK_LOSS_OR_OCCLUSION");
  if (fit.correlation < c.minimumCorrelation || f.gradientEnergyRatio > c.energyRatio[1]) reasons.push("STRUCTURE_CHANGE_OR_UNRESOLVED");
  if (f.cells.some(v => offset(v.offset) > c.maximumLocalOffset || v.correlation < c.minimumCellCorrelation)) reasons.push("LOCAL_GEOMETRY_CHANGE");
  if (f.cells.some(v => v.boundary || v.ambiguous)) reasons.push("LOCAL_SEARCH_UNRESOLVED");
  for (const [v, radius] of [[fit, c.searchRadius], ...f.cells.map(v => [v, c.localSearchRadius] as const)] as const)
    if (v.boundary !== (offset(v.offset) >= radius) || v.ambiguous !== (v.distinctPeakGap === null || v.distinctPeakGap < c.ambiguityCorrelationGap)) staticIncomplete("geometry fit flags mismatch");
  return reasons;
}

async function worker(binary: string, args: string[], signal: AbortSignal, deadline: number): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", OPENBLAS_NUM_THREADS: "1" } });
    const chunks: Buffer[] = []; let length = 0, error: unknown, stderr = "";
    const stop = (why: unknown) => { error ??= why; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } } };
    const abort = () => stop(Error("INCOMPLETE: geometry cancelled"));
    const timer = setTimeout(() => stop(Error("INCOMPLETE: geometry wall budget exceeded")), Math.max(1, deadline - Date.now()));
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (b: Buffer) => { length += b.length; if (length > 64 * 1024 ** 2) stop(Error("INCOMPLETE: geometry output budget")); else chunks.push(b); });
    child.stderr.on("data", (b: Buffer) => { stderr = (stderr + b.toString("utf8")).slice(0, 4096); });
    child.on("error", e => { error = e; });
    child.on("close", code => { clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error || code !== 0) reject(error ?? Error(`INCOMPLETE: geometry worker failed: ${stderr.slice(0, 500)}`)); else resolve(Buffer.concat(chunks)); });
    if (signal.aborted) abort();
  });
}

/** Only a live target/evidence/candidate can enter. The worker path and kernel are application controlled. */
export async function verifyStaticTargetGeometry(input: FullSourceCensusInput, evidence: StaticTargetEvidence,
  candidate: StaticMaskCandidate): Promise<OwnedStaticGeometryEvidence> {
  if (process.platform !== "linux") staticIncomplete("owned geometry runtime unavailable on this platform");
  assertStaticTargetEvidence(evidence); if (readStaticMaskCandidate(candidate).evidence !== evidence) staticIncomplete("geometry candidate/evidence mismatch");
  const discovery = assertConfirmedStaticTarget(evidence.target), target = evidence.target.receipt, signal = input.signal;
  const extracted = candidate.receipt;
  if (extracted.targetId !== target.targetId || extracted.confirmationDigest !== target.confirmationDigest
    || extracted.evidenceDigest !== evidence.evidenceDigest || JSON.stringify(extracted.range) !== JSON.stringify(target.range)) staticIncomplete("geometry target/range binding mismatch");
  const sourcePath = await realpath(input.sourcePath), ffmpegPath = await realpath(input.ffmpeg.ffmpegPath);
  let pythonPath: string | undefined;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    try { const p = await realpath(path.join(directory, "python3")); await access(p, constants.X_OK); if ((await stat(p)).isFile()) { pythonPath = p; break; } }
    catch { /* Missing executable search entries do not establish a runtime. */ }
  }
  if (!pythonPath) staticIncomplete("missing geometry Python runtime");
  const runtimePath = pythonPath;
  const pythonFingerprint = await fingerprintFile(pythonPath, { signal, maxBytes: 512 * 1024 ** 2 });
  const methodPaths = [...Object.keys(KERNELS), "scripts/shape-cover-static-geometry-worker.py", "src/main/source-mask-static-geometry.ts"];
  const methodSources = Object.fromEntries(await Promise.all(methodPaths.map(async p => [p, hash(await readFile(p))])));
  for (const [p, expected] of Object.entries(KERNELS)) if (methodSources[p] !== expected) staticIncomplete("frozen geometry kernel changed");
  const generation = await stat(pythonPath, { bigint: true });
  const inputBinding = Object.freeze({ sourcePath, ffmpegPath, ffprobePath: await realpath(input.ffmpeg.ffprobePath) });
  const fencePaths = [sourcePath, ffmpegPath, inputBinding.ffprobePath, runtimePath, ...methodPaths];
  const fenceGenerations = fencePaths.map(p => statSync(p, { bigint: true }));
  const checkFresh = () => {
    signal.throwIfAborted(); assertStaticTargetEvidence(evidence);
    if (Date.now() >= evidence.deadline) staticIncomplete("geometry wall budget exceeded");
    fencePaths.forEach((p, i) => {
      const current = statSync(p, { bigint: true }), expected = fenceGenerations[i];
      if (["ino", "dev", "size", "mtimeNs", "ctimeNs"].some(k => current[k as keyof typeof current] !== expected[k as keyof typeof expected])) staticIncomplete("geometry source/engine/runtime/method generation changed");
    });
  };
  const verifyFresh = async () => {
    signal.throwIfAborted(); assertStaticTargetEvidence(evidence); await evidence.verifyFresh();
    if (Date.now() >= evidence.deadline) staticIncomplete("geometry wall budget exceeded");
    if (sourceKey(input.source) !== target.sourceKey || sourceKey(await identifySource(sourcePath, input.source, { signal })) !== target.sourceKey
      || await fingerprintFile(ffmpegPath, { signal, maxBytes: 512 * 1024 ** 2 }) !== discovery.receipt.decode.ffmpegFingerprint) staticIncomplete("geometry source or engine mismatch");
    const current = await stat(runtimePath, { bigint: true });
    if (["ino", "dev", "size", "mtimeNs", "ctimeNs"].some(k => current[k as keyof typeof current] !== generation[k as keyof typeof generation])
      || await fingerprintFile(runtimePath, { signal, maxBytes: 512 * 1024 ** 2 }) !== pythonFingerprint) staticIncomplete("geometry runtime changed");
    for (const [p, expected] of Object.entries(methodSources)) if (hash(await readFile(p)) !== expected) staticIncomplete("geometry method changed");
    signal.throwIfAborted();
  };
  await verifyFresh();
  if (evidence.clock.streamIndex !== 0 || candidate.receipt.frames.length > 20000
    || candidate.receipt.frames.length !== target.range.endFrame - target.range.startFrame) staticIncomplete("geometry clock/range unsupported");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-owned-geometry-"));
  let data: GeometryData;
  try {
    const manifest = { sourcePath, ffmpegPath, roi: evidence.roi, envelope: target.targetEnvelopeBox, bindings: candidate.receipt.frames,
      sampleOrdinals: candidate.receipt.sampleOrdinals, timeBase: input.source.timeBase,
      historicalRgbOrdinals: candidate.receipt.anomalies.map(a => a.index), remainingSeconds: Math.max(0.001, (evidence.deadline - Date.now()) / 1000) };
    const file = path.join(directory, "input.json"); await writeFile(file, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    const output = JSON.parse((await worker(pythonPath, ["-B", path.resolve("scripts/shape-cover-static-geometry-worker.py"), file], signal, evidence.deadline)).toString("utf8"));
    if (JSON.stringify(output.config) !== JSON.stringify(STATIC_GEOMETRY_CONFIG) || output.dependencies.numpy !== "2.2.6" || output.dependencies.opencv !== "4.12.0") staticIncomplete("geometry config/runtime version changed");
    data = { reference: Reference.parse(output.reference), frames: z.array(Frame).min(1).max(20000).parse(output.frames) };
  } finally { await rm(directory, { recursive: true, force: true }); }
  for (const [i, f] of data.frames.entries()) {
    const expected = candidate.receipt.frames[i], clock = evidence.clock.frames[target.range.startFrame + i];
    if (!expected || ["index", "pts", "endPts", "byteLength", "pixelSha256"].some(k => f[k as keyof typeof f] !== expected[k as keyof typeof expected])
      || f.index !== clock.index || f.pts !== clock.pts || f.endPts !== clock.endPts || f.endPts <= f.pts
      || JSON.stringify(f.globalOffset) !== JSON.stringify(f.globalAlignment.offset) || JSON.stringify(f.reasons) !== JSON.stringify(frameReasons(f))
      || f.state !== (f.reasons.length ? "GEOMETRY_CONTRADICTION_OR_UNRESOLVED" : "STATIC_GEOMETRY_OBSERVED")
      || new Set(f.cells.map(c => c.cell)).size !== f.cells.length) staticIncomplete("geometry full frame binding/decision mismatch");
  }
  if (data.frames.length !== candidate.receipt.frames.length) staticIncomplete("geometry missing full range");
  await verifyFresh();
  const issues = data.frames.filter(f => f.reasons.length).map(f => f.index), issueRanges: { startFrame: number; endFrame: number }[] = [];
  for (const index of issues) { const last = issueRanges.at(-1); if (last?.endFrame === index) last.endFrame++; else issueRanges.push({ startFrame: index, endFrame: index + 1 }); }
  const minimum = (f: (v: StaticGeometryFrame) => number) => data.frames.reduce((a, v) => Math.min(a, f(v)), Infinity);
  const maximum = (f: (v: StaticGeometryFrame) => number) => data.frames.reduce((a, v) => Math.max(a, f(v)), -Infinity);
  const body = { method: "cpu-static-geometry/v1" as const, kernelMethod: STATIC_GEOMETRY_CONFIG.method, authority: "none" as const, eligible: false as const,
    sourceKey: target.sourceKey, confirmationDigest: target.confirmationDigest, targetId: target.targetId, range: target.range,
    evidenceDigest: evidence.evidenceDigest, clockDigest: discovery.receipt.clockDigest, bindingDigest: hash(JSON.stringify(candidate.receipt.frames)),
    configDigest: hash(JSON.stringify(STATIC_GEOMETRY_CONFIG)), referenceDigest: hash(JSON.stringify(data.reference)), frameMetricsDigest: hash(JSON.stringify(data.frames)),
    frameCount: data.frames.length, firstPts: data.frames[0].pts, lastPts: data.frames.at(-1)!.pts, endPts: data.frames.at(-1)!.endPts,
    status: issues.length ? "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED" as const : "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" as const,
    issueFrames: issues, issueRanges, summary: { maximumGlobalOffset: maximum(f => Math.max(...f.globalOffset.map(Math.abs))),
      minimumGlobalCorrelation: minimum(f => f.globalAlignment.correlation), minimumDistinctPeakGap: minimum(f => f.globalAlignment.distinctPeakGap ?? 0),
      maximumLostLandmarkFraction: maximum(f => f.lostLandmarkFraction), gradientEnergyRatio: [minimum(f => f.gradientEnergyRatio), maximum(f => f.gradientEnergyRatio)],
      minimumLocalCorrelation: minimum(f => Math.min(...f.cells.map(c => c.correlation))), maximumLocalOffset: maximum(f => Math.max(...f.cells.flatMap(c => c.offset.map(Math.abs)))) },
    methodSources, runtime: { pythonFingerprint, numpy: "2.2.6", opencv: "4.12.0" } };
  const geometry = freezeAI({ receipt: { ...body, geometryDigest: hash(JSON.stringify(body)) } });
  owners.set(geometry, Object.freeze({ evidence, candidate, data: freezeAI(data), inputBinding, verifyFresh, checkFresh })); return geometry;
}
