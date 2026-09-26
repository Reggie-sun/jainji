import { z } from "zod";
import { EditTemplateSchema, ExportPresetSchema, type EditTemplate, type ExportPreset, type MediaItem } from "./domain.js";
import type { ExportQueue } from "./queue.js";
import { runCommand, type FfmpegAdapter } from "./ffmpeg.js";
import { computeCommonShapeCoverCandidates, type ShapeCoverCandidateRequest } from "./shape-cover-candidates.js";
import { decodeShapeCoverPng, rasterizeShapeCoverArtwork, readShapeCoverAsset } from "./shape-cover-alpha.js";
import { growOpaqueContour, checkOutputFrameCoverage } from "./shape-cover-pixel-gate.js";
import { readFrozenShapeCover, shapeCoverDigest, verifyFrozenShapeSources } from "./shape-cover-render.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { fingerprintFile } from "./paths.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import { superviseRenderedTemplate } from "./supervised-preview.js";
import { templateDigest } from "./supervisor-knowledge.js";
import { PreviewDecisionSchema, type PreviewReviewInput } from "./supervisor-protocol.js";
import { reviewDigest } from "./cover-review-approval.js";
import { unlink } from "node:fs/promises";

const Facet = z.enum(["SAFE", "UNSAFE", "UNKNOWN"]);
const SafetyPass = z.object({ action: z.literal("pass"), reason: z.string().trim().min(1).max(500),
  contentSafety: z.object({ face: Facet, hands: Facet, product: Facet, subtitles: Facet }).strict(),
  evidenceIds: z.array(z.string().min(1).max(120)).min(2).max(160),
}).strict();
declare const admissionBrand: unique symbol;
/** Authority is held privately, never reconstructed from serialized PASS fields. */
export interface ShapeCoverAdmission { readonly [admissionBrand]: true }
interface Binding {
  request: ShapeCoverCandidateRequest; candidateId: string; template: EditTemplate; media: MediaItem; preset: ExportPreset;
  sampleSha256: string; frameCount: number; evidenceDigests: string[];
  store: SourceStickerKnowledgeStore; ffmpeg: FfmpegAdapter;
  signal: AbortSignal;
}
const issued = new WeakMap<ShapeCoverAdmission, Binding>();
function unsafe(reason: string): never { throw new Error(`UNSAFE: ${reason}`); }
const digestJson = reviewDigest;

/** Recompute the whole round; prove that each local target consumes the exact frozen raster. */
async function checkRaster(binding: Omit<Binding, "sampleSha256" | "frameCount" | "evidenceDigests">, signal?: AbortSignal): Promise<void> {
  signal ??= binding.signal;
  signal.throwIfAborted();
  const { request, candidateId, template, media, preset, store, ffmpeg } = binding;
  const tools = { ffmpegPath: ffmpeg.ffmpegPath, ffprobePath: ffmpeg.ffprobePath, signal };
  const round = await computeCommonShapeCoverCandidates(request, store, tools);
  if (round.status !== "PASS" || !round.commonSafeCandidateIds.includes(candidateId)) unsafe("round no longer common-safe");
  const candidate = request.candidates.find(value => value.id === candidateId)!;
  const bytes = await readShapeCoverAsset(candidate.asset, tools);
  const local = round.evaluations.filter(cell => cell.candidateId === candidateId && cell.source.fingerprint === media.fingerprint
    && JSON.stringify(cell.settings) === JSON.stringify({ resolutionMode: preset.resolutionMode, frameRateMode: preset.frameRateMode, quality: preset.quality }));
  const layers = template.layers.filter(layer => layer.type === "sticker" && layer.cover?.shapeMatched);
  if (!local.length || local.length !== layers.length) unsafe("intended target/output set mismatch");
  const used = new Set<string>();
  for (const layer of layers) {
    if (layer.type !== "sticker" || !layer.cover?.shapeMatched) unsafe("missing frozen shape");
    const frozen = layer.cover.shapeMatched;
    const cell = local.find(value => value.intendedTargetId === frozen.intendedTargetId && value.outputSettingId === frozen.outputSettingId);
    const key = `${frozen.intendedTargetId}:${frozen.outputSettingId}`;
    if (!cell || used.has(key) || cell.verdict.status !== "PASS") unsafe("missing or duplicate intended target");
    used.add(key);
    for (const field of ["source", "sourceRevisionId", "factsDigest", "targetId", "segmentId", "maskSha256", "range", "placement", "projection", "settings", "assetFingerprint"] as const) {
      const value = field === "assetFingerprint" ? frozen.candidateAssetFingerprint : frozen[field];
      if (digestJson(value) !== digestJson(cell[field])) unsafe(`frozen matrix binding changed: ${field}`);
    }
    if (frozen.candidateId !== candidateId || frozen.radiusPx !== cell.verdict.radiusPx || frozen.candidateAlphaSha256 !== cell.alphaSha256 || frozen.rasterVersion !== cell.rasterVersion) unsafe("frozen contour binding changed");
    const png = await readFrozenShapeCover(layer, media, preset);
    const rgba = await decodeShapeCoverPng(png, frozen.projection, tools);
    const raster = await rasterizeShapeCoverArtwork(bytes, frozen.projection, frozen.placement, tools);
    const grown = growOpaqueContour(raster.alpha, frozen.projection, frozen.radiusPx)!;
    const alpha = new Uint8Array(grown.length);
    for (let i = 0; i < grown.length; i++) {
      alpha[i] = rgba[i * 4 + 3];
      for (let channel = 0; channel < 4; channel++) {
        const original = raster.rgba[i * 4 + channel];
        const expected = !grown[i] ? original : channel === 3 ? 255 : Math.round((original * raster.alpha[i] + 255 * (255 - raster.alpha[i])) / 255);
        if (rgba[i * 4 + channel] !== expected) unsafe("frozen final pixels changed");
      }
    }
    if (shapeCoverDigest(rgba) !== frozen.rgbaSha256 || shapeCoverDigest(alpha) !== frozen.finalAlphaSha256) unsafe("frozen raster digest mismatch");
  }
  await verifyFrozenShapeSources(template, media, store, signal);
  signal?.throwIfAborted();
}

/** Bounded probe of every actual decoded output frame, never caller-supplied timestamps. */
async function decodedFrames(samplePath: string, ffmpeg: FfmpegAdapter, signal: AbortSignal) {
  const command = runCommand(ffmpeg.ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_streams",
    "-show_entries", "stream=width,height,duration:frame=best_effort_timestamp_time,width,height", "-of", "json", samplePath]);
  let oversized = false, timedOut = false, size = 0;
  command.process.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { oversized = true; command.process.kill("SIGKILL"); } });
  const abort = () => { command.process.kill("SIGKILL"); };
  const timer = setTimeout(() => { timedOut = true; abort(); }, 20_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const result = await command.promise;
    signal.throwIfAborted();
    if (result.code !== 0 || oversized || timedOut) unsafe("output frame evidence unavailable");
    const Frame = z.object({ best_effort_timestamp_time: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });
    return z.object({ streams: z.array(z.object({ width: z.number(), height: z.number(), duration: z.string() })).length(1), frames: z.array(Frame).min(2).max(36_000) }).parse(JSON.parse(result.stdout));
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

async function outputTimes(samplePath: string, binding: Omit<Binding, "sampleSha256" | "frameCount" | "evidenceDigests">, signal: AbortSignal): Promise<number[]> {
    const probe = await decodedFrames(samplePath, binding.ffmpeg, signal);
    const shapes = binding.template.layers.flatMap(layer => layer.type === "sticker" && layer.cover?.shapeMatched ? [layer.cover.shapeMatched] : []);
    const times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time) * 1000);
    const output = shapes[0].projection;
    if (probe.frames.some(frame => frame.width !== output.width || frame.height !== output.height)
      || probe.streams[0].width !== output.width || probe.streams[0].height !== output.height
      || Math.abs(Number(probe.streams[0].duration) * 1000 - binding.media.durationMs) > 1
      || times[0] !== 0 || times.some((time, i) => !Number.isFinite(time) || time < 0 || time >= binding.media.durationMs || (i > 0 && time <= times[i - 1]))) unsafe("invalid output timeline or dimensions");
    let expected: number[];
    if (binding.preset.frameRateMode === "30") expected = Array.from({ length: Math.round(binding.media.durationMs * 30 / 1000) }, (_, i) => i * 1000 / 30);
    else {
      const source = await decodedFrames(binding.media.sourcePath, binding.ffmpeg, signal);
      const origin = Number(source.frames[0].best_effort_timestamp_time) * 1000;
      expected = source.frames.map(frame => Number(frame.best_effort_timestamp_time) * 1000 - origin);
    }
    if (times.length !== expected.length || times.some((time, i) => !Number.isFinite(expected[i]) || Math.abs(time - expected[i]) > 0.001)) unsafe("output clock not completely proven");
    for (const shape of shapes) {
      const ranges = binding.template.layers.flatMap(layer => layer.type === "sticker" && layer.cover?.shapeMatched?.bindingSha256 === shape.bindingSha256 && layer.cover.motion ? [layer.cover.motion] : []);
      if (checkOutputFrameCoverage(times, [shape.range], ranges).status !== "PASS"
        || !times.some(time => time >= shape.range.startMs && time < shape.range.endMs)) unsafe("unproven shape output interval");
    }
    return times;
}

export interface ShapeCoverReviewInput extends PreviewReviewInput {
  purpose: "shape-cover-content-safety";
  shapes: Array<{ targetId: string; range: { startMs: number; endMs: number }; placement: { x: number; y: number; width: number; height: number }; pngSha256: string }>;
}

/** The existing supervisor owns the bounded inspection loop; this adapter adds a strict independent safety verdict. */
export async function admitShapeCoverSample(input: {
  request: ShapeCoverCandidateRequest; candidateId: string; template: EditTemplate; media: MediaItem; preset: ExportPreset;
  queue: Pick<ExportQueue, "renderPreview" | "verifyShapePreview">; ffmpeg: FfmpegAdapter; store: SourceStickerKnowledgeStore; cacheDirectory: string;
  reviewer: { identity: string; role: "independent-content-safety"; review(input: ShapeCoverReviewInput, signal: AbortSignal): Promise<string> };
  signal: AbortSignal;
}): Promise<{ status: "PASS"; admission: ShapeCoverAdmission; previewPath: string; frameCount: number; contentSafety: "PASS" } | { status: "UNSAFE"; reason: string }> {
  let evidence: SupervisorEvidence | undefined;
  let ownedPreview: string | undefined;
  try {
    input.signal.throwIfAborted();
    if (input.reviewer.role !== "independent-content-safety" || !input.reviewer.identity.trim()) unsafe("independent reviewer unavailable");
    const binding = { request: structuredClone(input.request), candidateId: input.candidateId, template: EditTemplateSchema.parse(input.template),
      media: structuredClone(input.media), preset: ExportPresetSchema.parse(input.preset), store: input.store, ffmpeg: input.ffmpeg, signal: input.signal };
    await checkRaster(binding, input.signal);
    evidence = new SupervisorEvidence(input.ffmpeg, binding.media);
    const collector = evidence;
    let sampleSha256 = "", times: number[] = [], evidenceDigests: string[] = [];
    let initialInspection = true;
    const shapes = binding.template.layers.flatMap(layer => layer.type === "sticker" && layer.cover?.shapeMatched ? [layer.cover.shapeMatched] : []);
    const checked = await superviseRenderedTemplate({ template: binding.template, durationMs: binding.media.durationMs, tracks: [], coverEnabled: true,
      automaticCorners: false, signal: input.signal, onStage: () => undefined,
      render: async (template, signal) => {
        const sample = await input.queue.renderPreview({ template, media: binding.media, preset: binding.preset, cacheDirectory: input.cacheDirectory, signal });
        await input.queue.verifyShapePreview(sample, template, binding.media, binding.preset);
        ownedPreview = sample;
        sampleSha256 = await fingerprintFile(sample);
        times = await outputTimes(sample, binding, signal);
        return sample;
      },
      inspect: async (requests, signal, sample) => {
        if (await fingerprintFile(sample) !== sampleSha256) unsafe("sample changed during inspection");
        const wanted = [...requests];
        if (initialInspection) {
          initialInspection = false;
          for (const shape of shapes) {
            const active = times.filter(time => time >= shape.range.startMs && time < shape.range.endMs);
            for (const timeMs of [active[0], active.at(-1)!]) if (!wanted.some(request => request.timeMs === timeMs)) wanted.push({ timeMs });
          }
        }
        const images = [];
        for (let offset = 0; offset < wanted.length; offset += 8) images.push(...await collector.inspect(wanted.slice(offset, offset + 8), signal, sample));
        if (await fingerprintFile(sample) !== sampleSha256) unsafe("sample changed during inspection");
        return images;
      },
      rebuild: () => unsafe("frozen shape revisions require a new admission"),
      review: async (review, signal) => {
        const captured = collector.capture(review.evidence, { candidateId: "shape-safety", factsDigest: digestJson(shapes.map(shape => shape.factsDigest)),
          templateDigest: templateDigest(binding.template), outputSettingsDigest: digestJson(binding.preset) });
        if (captured.source.fingerprint !== binding.media.fingerprint || review.evidence.some(image => !image.previewEvidenceId)) unsafe("paired evidence unavailable");
        const raw = await input.reviewer.review({ ...review, purpose: "shape-cover-content-safety", shapes: shapes.map(({ targetId, range, placement, pngSha256 }) => ({ targetId, range, placement, pngSha256 })) }, signal);
        signal.throwIfAborted();
        const decision = JSON.parse(raw);
        if (decision.action !== "pass") {
          const parsed = PreviewDecisionSchema.parse(decision);
          if (parsed.action !== "inspect" && parsed.action !== "stop") unsafe("frozen shape cannot use bbox revisions");
          return JSON.stringify(parsed);
        }
        const pass = SafetyPass.parse(decision);
        const ids = new Set(captured.evidence.map(item => item.id));
        if (Object.values(pass.contentSafety).some(verdict => verdict !== "SAFE") || pass.evidenceIds.some(id => !ids.has(id))
          || new Set(pass.evidenceIds).size !== ids.size
          || shapes.some(shape => new Set(review.evidence.filter(image => image.previewTimeMs !== undefined && image.previewTimeMs >= shape.range.startMs && image.previewTimeMs < shape.range.endMs).map(image => image.previewTimeMs)).size < 2)
          || !pass.evidenceIds.some(id => captured.evidence.some(item => item.id === id && item.kind === "source"))
          || !pass.evidenceIds.some(id => captured.evidence.some(item => item.id === id && item.kind === "preview"))) unsafe("content safety failed or evidence unbound");
        evidenceDigests = captured.evidence.map(item => item.digest);
        return JSON.stringify({ action: "pass", reason: pass.reason });
      },
    });
    await checkRaster(binding, input.signal);
    if (await fingerprintFile(checked.previewPath) !== sampleSha256) unsafe("approved sample changed");
    input.signal.throwIfAborted();
    const admission = Object.freeze({}) as ShapeCoverAdmission;
    issued.set(admission, { ...binding, sampleSha256, frameCount: times.length, evidenceDigests });
    return { status: "PASS", admission, previewPath: checked.previewPath, frameCount: times.length, contentSafety: "PASS" };
  } catch (error) {
    if (ownedPreview) await unlink(ownedPreview).catch(() => undefined);
    return { status: "UNSAFE", reason: input.signal.aborted ? "cancelled" : error instanceof Error && error.message.startsWith("UNSAFE:") ? error.message : "coverage or independent safety evidence invalid" };
  } finally { await evidence?.dispose(); }
}

/** Only an issued handle and the exact approved sample bytes can cross the queue publication boundary. */
export async function verifyShapeCoverAdmission(admission: ShapeCoverAdmission | undefined, template: EditTemplate, media: MediaItem, preset: ExportPreset, samplePath: string): Promise<void> {
  const binding = admission && issued.get(admission);
  if (!binding || digestJson(template) !== digestJson(binding.template) || digestJson(media) !== digestJson(binding.media)
    || digestJson(preset) !== digestJson(binding.preset) || await fingerprintFile(samplePath) !== binding.sampleSha256) unsafe("missing or mismatched shape admission");
  await checkRaster(binding);
}
