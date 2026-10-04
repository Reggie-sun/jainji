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

import { STATIC_COMPONENT_GEOMETRY_CONFIG, STATIC_GEOMETRY_CONFIG, StaticGeometryArtifactSchema, Frame, Reference, Box, Digest, KERNELS } from "./source-mask-static-geometry-v2.js";
export { STATIC_COMPONENT_GEOMETRY_CONFIG, STATIC_GEOMETRY_CONFIG, StaticGeometryArtifactSchema } from "./source-mask-static-geometry-v2.js";
export type StaticGeometryFrame = z.infer<typeof Frame>;
type ComponentData = { candidateId: string; componentDigest: string; sourceBox: z.infer<typeof Box>;
  reference: z.infer<typeof Reference> | null; unobservableReason: "COMPONENT_GEOMETRY_UNOBSERVABLE" | null; frames: StaticGeometryFrame[] };
type GeometryData = { components: ComponentData[]; references: (z.infer<typeof Reference> | null)[];
  reference: z.infer<typeof Reference> | null; frames: StaticGeometryFrame[] };
export interface OwnedStaticGeometryEvidence { readonly receipt: Readonly<z.infer<typeof StaticGeometryArtifactSchema>["receipt"]> }
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
  const methodPaths = [...Object.keys(KERNELS), "scripts/shape-cover-static-geometry-worker.py", "src/main/source-mask-static-geometry.ts", "src/main/source-mask-static-geometry-v1.ts", "scripts/shape-cover-static-geometry-components.py", "src/main/source-mask-static-geometry-v2.ts"];
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
    const manifest = { method: "cpu-static-geometry/v2", sourcePath, ffmpegPath, roi: evidence.roi,
      components: target.confirmedCandidateIds.map((candidateId, i) => ({ candidateId, componentDigest: target.confirmedComponentDigests[i], sourceBox: target.confirmedSourceBoxes[i] })), bindings: candidate.receipt.frames,
      sampleOrdinals: candidate.receipt.sampleOrdinals, timeBase: input.source.timeBase,
      historicalRgbOrdinals: candidate.receipt.anomalies.map(a => a.index), remainingSeconds: Math.max(0.001, (evidence.deadline - Date.now()) / 1000) };
    const file = path.join(directory, "input.json"); await writeFile(file, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    const output = JSON.parse((await worker(pythonPath, ["-B", path.resolve("scripts/shape-cover-static-geometry-worker.py"), file], signal, evidence.deadline)).toString("utf8"));
    if (JSON.stringify(output.config) !== JSON.stringify(STATIC_COMPONENT_GEOMETRY_CONFIG) || output.dependencies.numpy !== "2.2.6" || output.dependencies.opencv !== "4.12.0") staticIncomplete("geometry config/runtime version changed");
    const components = z.array(z.object({ candidateId: Digest, componentDigest: Digest, sourceBox: Box,
      reference: Reference.nullable(), unobservableReason: z.literal("COMPONENT_GEOMETRY_UNOBSERVABLE").nullable(), frames: z.array(Frame).max(20000) }).strict()).min(1).max(128).parse(output.components);
    data = { components, references: components.map(c => c.reference), reference: components[0].reference, frames: components[0].frames };
  } finally { await rm(directory, { recursive: true, force: true }); }
  if (data.components.length !== target.confirmedCandidateIds.length) staticIncomplete("missing/extra component geometry");
  for (const [i, component] of data.components.entries()) {
    if (component.candidateId !== target.confirmedCandidateIds[i] || component.componentDigest !== target.confirmedComponentDigests[i]
      || JSON.stringify(component.sourceBox) !== JSON.stringify(target.confirmedSourceBoxes[i])) staticIncomplete("component geometry identity mismatch");
    if (component.unobservableReason) {
      if (component.reference !== null || component.frames.length) staticIncomplete("unobservable component carries evidence");
      continue;
    }
    const reference = component.reference, box = component.sourceBox;
    if (!reference || JSON.stringify(reference.box) !== JSON.stringify({ ...box, x: box.x - evidence.roi.x, y: box.y - evidence.roi.y })
      || JSON.stringify(reference.extent) !== JSON.stringify([evidence.roi.width, evidence.roi.height])
      || reference.sampleCount !== candidate.receipt.sampleOrdinals.length
      || reference.landmarks.some(l => l.sourceX < box.x || l.sourceX >= box.x + box.width || l.sourceY < box.y || l.sourceY >= box.y + box.height)) staticIncomplete("component reference outside sourceBox");
    for (const [j, f] of component.frames.entries()) {
      const expected = candidate.receipt.frames[j], clock = evidence.clock.frames[target.range.startFrame + j];
      if (!expected || ["index", "pts", "endPts", "byteLength", "pixelSha256"].some(k => f[k as keyof typeof f] !== expected[k as keyof typeof expected])
        || f.index !== clock.index || f.pts !== clock.pts || f.endPts !== clock.endPts || f.endPts <= f.pts
        || JSON.stringify(f.globalOffset) !== JSON.stringify(f.globalAlignment.offset) || JSON.stringify(f.reasons) !== JSON.stringify(frameReasons(f))
        || f.state !== (f.reasons.length ? "GEOMETRY_CONTRADICTION_OR_UNRESOLVED" : "STATIC_GEOMETRY_OBSERVED")
        || new Set(f.cells.map(c => c.cell)).size !== f.cells.length) staticIncomplete("geometry full frame binding/decision mismatch");
    }
    if (component.frames.length !== candidate.receipt.frames.length) staticIncomplete("geometry missing component full range");
  }
  await verifyFresh();
  const ranges = (indices: readonly number[]) => {
    const result: { startFrame: number; endFrame: number }[] = [];
    for (const index of indices) { const last = result.at(-1); if (last?.endFrame === index) last.endFrame++; else result.push({ startFrame: index, endFrame: index + 1 }); }
    return result;
  };
  const summary = (frames: StaticGeometryFrame[]) => {
    if (!frames.length) return null;
    const minimum = (f: (v: StaticGeometryFrame) => number) => frames.reduce((a, v) => Math.min(a, f(v)), Infinity);
    const maximum = (f: (v: StaticGeometryFrame) => number) => frames.reduce((a, v) => Math.max(a, f(v)), -Infinity);
    return { maximumGlobalOffset: maximum(f => Math.max(...f.globalOffset.map(Math.abs))),
      minimumGlobalCorrelation: minimum(f => f.globalAlignment.correlation), minimumDistinctPeakGap: minimum(f => f.globalAlignment.distinctPeakGap ?? 0),
      maximumLostLandmarkFraction: maximum(f => f.lostLandmarkFraction), gradientEnergyRatio: [minimum(f => f.gradientEnergyRatio), maximum(f => f.gradientEnergyRatio)],
      minimumLocalCorrelation: minimum(f => Math.min(...f.cells.map(c => c.correlation))), maximumLocalOffset: maximum(f => Math.max(...f.cells.flatMap(c => c.offset.map(Math.abs)))) };
  };
  const components = data.components.map(c => {
    const issueFrames = c.unobservableReason ? candidate.receipt.frames.map(f => f.index) : c.frames.filter(f => f.reasons.length).map(f => f.index);
    return { candidateId: c.candidateId, componentDigest: c.componentDigest, sourceBox: c.sourceBox,
      method: "component-local-persistent-gradients/v2" as const, referencePadding: 0 as const,
      referenceDigest: hash(JSON.stringify(c.reference)), metricsDigest: hash(JSON.stringify(c.frames)), frameCount: candidate.receipt.frames.length,
      status: c.unobservableReason ? "COMPONENT_GEOMETRY_UNOBSERVABLE" as const : issueFrames.length ? "GEOMETRY_CONTRADICTION_OR_UNRESOLVED" as const : "SUPPORTED" as const,
      issueFrames, issueRanges: ranges(issueFrames), summary: summary(c.frames) };
  });
  const issues = [...new Set(components.flatMap(c => c.issueFrames))].sort((a, b) => a - b), bindings = candidate.receipt.frames;
  const body = { method: "cpu-static-geometry/v2" as const, kernelMethod: STATIC_GEOMETRY_CONFIG.method, authority: "none" as const, eligible: false as const,
    sourceKey: target.sourceKey, confirmationDigest: target.confirmationDigest, targetId: target.targetId, range: target.range,
    evidenceDigest: evidence.evidenceDigest, clockDigest: discovery.receipt.clockDigest, bindingDigest: hash(JSON.stringify(bindings)),
    configDigest: hash(JSON.stringify(STATIC_COMPONENT_GEOMETRY_CONFIG)), referenceDigest: hash(JSON.stringify(data.references)),
    frameMetricsDigest: hash(JSON.stringify(components.map(c => c.metricsDigest))), components,
    frameCount: bindings.length, firstPts: bindings[0].pts, lastPts: bindings.at(-1)!.pts, endPts: bindings.at(-1)!.endPts,
    status: components.every(c => c.status === "SUPPORTED") ? "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" as const : "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED" as const,
    issueFrames: issues, issueRanges: ranges(issues), summary: summary(data.components.flatMap(c => c.frames)),
    methodSources, runtime: { pythonFingerprint, numpy: "2.2.6" as const, opencv: "4.12.0" as const } };
  const { geometryDigest: _placeholder, ...canonicalBody } = StaticGeometryArtifactSchema.shape.receipt.parse({ ...body, geometryDigest: "0".repeat(64) });
  const receipt = { ...canonicalBody, geometryDigest: hash(JSON.stringify(canonicalBody)) };
  const geometry = freezeAI({ receipt });
  owners.set(geometry, Object.freeze({ evidence, candidate, data: freezeAI(data), inputBinding, verifyFresh, checkFresh })); return geometry;
}
