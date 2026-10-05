import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SourceIdentitySchema } from "../shared/source-sticker-knowledge.js";
import { ExportSettingsSchema, outputDimensions } from "../shared/export-settings.js";
import { TemplateCompiler, type CompiledCommand } from "./compiler.js";
import { EditTemplateSchema, type MediaItem } from "./domain.js";
import { discoveryHash as hash } from "./source-fact-discovery-evidence.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { fingerprintFile, publishWithoutReplacement } from "./paths.js";
import { probeSourceDecodeClock, streamSourceFactCommand, type FullSourceCensusInput } from "./source-fact-census.js";
import { readExactSourceFrames } from "./source-fact-exact-frames.js";
import { AutoContourBitmapSchema } from "./source-mask-auto-extraction.js";
import { decodeSourceMask, projectSourceMask, checkOutputFrameCoverage } from "./shape-cover-pixel-gate.js";
import { readShapeCoverAsset, decodeShapeCoverPng, encodeShapeCoverPng } from "./shape-cover-alpha.js";
import { createVisionPacket, type VisionImageInput } from "./shape-cover-vision-packet.js";
import { ShapeCoverVisionSession, type VisionRoute, type VisionRole } from "./shape-cover-vision-router.js";
import type { HybridFrozenOverlay } from "./shape-cover-hybrid-h3.js";

export interface HybridPreviewInput {
  readonly overlay: Readonly<HybridFrozenOverlay>;
  readonly uncoveredPixels: 0;
  verifyFresh(): Promise<void>;
}
const owners = new WeakMap<HybridPreviewInput, { png: Buffer; input: FullSourceCensusInput }>();

/** Archived geometry is diagnostic input only; this never reconstructs H3 or export authority. */
export async function openHybridPreviewInput(archive: unknown, input: FullSourceCensusInput): Promise<HybridPreviewInput> {
  const o = structuredClone(archive) as HybridFrozenOverlay;
  if (!o || o.version !== "HybridCornerFrozenOverlay/v1" || o.authority !== "none" || o.productState !== "PRODUCT_DISABLED" ||
      o.verification !== "geometry-only" || o.contentSafety !== "NOT_EVALUATED" || o.motion?.status !== "STATIC_SUPPORTED") throw Error("H4_ARCHIVE_BINDING");
  const { bindingDigest, pngPath, ...body } = o;
  if (hash(JSON.stringify(body)) !== bindingDigest) throw Error("H4_ARCHIVE_BINDING");
  SourceIdentitySchema.parse(o.source); ExportSettingsSchema.parse(o.settings); AutoContourBitmapSchema.parse(o.mask);
  const dimensions = outputDimensions(o.source, o.settings);
  if (dimensions.width !== o.projection.width || dimensions.height !== o.projection.height) throw Error("H4_PROJECTION_BINDING");
  if (sourceKey(o.source) !== sourceKey(input.source) || o.source.rotation !== 0 || o.settings.frameRateMode !== "source" ||
      o.range.startFrame !== 0 || o.range.startMs !== 0 || o.range.endMs !== o.source.durationMs ||
      o.coverage.uncoveredPixels !== 0 || o.coverage.coverageFraction !== 1) throw Error("H4_SOURCE_BINDING");
  const tools = { ...input.ffmpeg, signal: input.signal };
  const png = await readShapeCoverAsset({ assetPath: pngPath, assetFingerprint: `sha256:${o.pngSha256}` }, tools);
  const rgba = await decodeShapeCoverPng(png, o.projection, tools);
  if (hash(rgba) !== o.rgbaSha256) throw Error("H4_RASTER_BINDING");
  const alpha = Uint8Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3]);
  if (hash(alpha) !== o.finalAlphaSha256) throw Error("H4_RASTER_BINDING");
  const mask = decodeSourceMask({ ...o.mask, kind: "static-binary-v1" }, o.source);
  const projected = mask && projectSourceMask(mask, o.source, o.projection);
  if (!projected) throw Error("H4_MASK_BINDING");
  let oldPixels = 0, uncovered = 0;
  for (let i = 0; i < projected.length; i++) if (projected[i]) { oldPixels++; if (alpha[i] !== 255) uncovered++; }
  if (uncovered || oldPixels !== o.coverage.oldPixels) throw Error("H4_COVERAGE_UNSAFE");
  const frozen = JSON.stringify(o), originalInput = { ...input, source: structuredClone(input.source), ffmpeg: { ...input.ffmpeg } };
  const verifyFresh = async () => {
    input.signal.throwIfAborted();
    if (sourceKey(await identifySource(originalInput.sourcePath, originalInput.source, { signal: input.signal })) !== sourceKey(o.source)) throw Error("H4_SOURCE_CHANGED");
    await readShapeCoverAsset({ assetPath: pngPath, assetFingerprint: `sha256:${o.pngSha256}` }, tools);
  };
  await verifyFresh();
  const result = Object.freeze({ get overlay() { return JSON.parse(frozen) as HybridFrozenOverlay; }, uncoveredPixels: 0 as const, verifyFresh });
  owners.set(result, { png: Buffer.from(png), input: originalInput }); return result;
}

function ownerOf(preview: HybridPreviewInput) {
  const owner = owners.get(preview); if (!owner) throw Error("H4_PREVIEW_INPUT_BINDING"); return owner;
}

/** Add only the frozen full-canvas input to the canonical empty-template command. */
export function appendHybridPreviewOverlay(command: CompiledCommand, pngPath: string, range: HybridFrozenOverlay["range"]): string[] {
  const args = [...command.args], i = args.indexOf("-filter_complex");
  if (i < 0 || command.textFiles.length || command.binaryFiles?.length || !args[i + 1].endsWith(";[base0]null[vout]")) throw Error("H4_BASE_COMPILER_BINDING");
  args[i + 1] = args[i + 1].replace(";[base0]null[vout]", `;[1:v]format=rgba,setpts=PTS-STARTPTS[h4png];[base0][h4png]overlay=0:0:shortest=1:enable='gte(t,${range.startMs / 1000})*lt(t,${range.endMs / 1000})':format=auto[vout]`);
  args.splice(i, 0, "-loop", "1", "-i", pngPath);
  // Preview preserves encoded source audio packets, without a second audio encode.
  for (const flag of ["-b:a", "-ar"]) { const p = args.indexOf(flag); if (p >= 0) args.splice(p, 2); }
  args[args.indexOf("-c:a") + 1] = "copy";
  args[args.indexOf("-y")] = "-n";
  return args;
}

async function audioHash(file: string, input: FullSourceCensusInput): Promise<string> {
  let result = "";
  await streamSourceFactCommand(input.ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-i", file, "-map", "0:a?", "-vn", "-c:a", "copy", "-f", "streamhash", "-hash", "sha256", "pipe:1"],
    input.signal, Date.now() + 300000, chunk => { result += chunk.toString(); if (result.length > 16384) throw Error("H4_AUDIO_BUDGET"); });
  return result.trim();
}

export async function renderHybridPreview(preview: HybridPreviewInput, directory: string) {
  const { png, input } = ownerOf(preview), o = preview.overlay;
  await preview.verifyFresh();
  const clock = await probeSourceDecodeClock(input.sourcePath, input.source, input.ffmpeg, input.signal, Date.now() + 300000);
  if (clock.frames.length !== o.range.endFrame) throw Error("H4_FRAME_RANGE_BINDING");
  const operation = path.resolve(directory, randomUUID()); await mkdir(operation, { recursive: true });
  const frozenPath = path.join(operation, "frozen.png"), partial = path.join(operation, "preview.partial.mp4");
  await writeFile(frozenPath, png, { flag: "wx", mode: 0o600 });
  const now = new Date().toISOString(), media: MediaItem = { id: randomUUID(), sourcePath: input.sourcePath, displayName: "Hybrid development preview",
    fingerprint: o.source.fingerprint, sizeBytes: o.source.byteLength, durationMs: o.source.durationMs, width: o.source.width,
    height: o.source.height, rotation: 0, probeStatus: "ready", importedAt: now };
  const template = EditTemplateSchema.parse({ schemaVersion: 1, id: randomUUID(), name: "H4 diagnostic", version: 1, layers: [],
    filter: { presetId: "none", intensity: 0 }, createdAt: now, updatedAt: now });
  const command = await new TemplateCompiler().compile(template, media, { container: "mp4", videoCodec: "h264", audioCodec: "aac", ...o.settings },
    { ffmpegPath: input.ffmpeg.ffmpegPath, fontResolver: { resolve: async () => null }, textFilePath: () => { throw Error("H4_UNEXPECTED_TEXT"); }, threads: 2 });
  const args = appendHybridPreviewOverlay(command, frozenPath, o.range);
  const [timeNum, timeDen] = o.source.timeBase.split("/").map(Number);
  if (timeNum !== 1) throw Error("H4_TIME_BASE_UNSUPPORTED");
  args.push("-enc_time_base", `1:${timeDen}`, "-video_track_timescale", String(timeDen));
  // Error-only bounded runner owns cancellation, close and stderr validation.
  args.splice(1, 0, "-v", "error", "-xerror");
  await streamSourceFactCommand(command.binary, [...args, partial], input.signal, Date.now() + 600000, () => {});
  await preview.verifyFresh();
  const outputSource = await identifySource(partial, { ...o.source, width: o.projection.width, height: o.projection.height });
  const outputClock = await probeSourceDecodeClock(partial, outputSource, input.ffmpeg, input.signal, Date.now() + 300000);
  if (outputClock.frames.length !== clock.frames.length || outputClock.frames.some((f, i) => f.pts - outputClock.startPts !== clock.frames[i].pts - clock.startPts ||
      f.endPts - outputClock.startPts !== clock.frames[i].endPts - clock.startPts)) throw Error("H4_PREVIEW_CLOCK_MISMATCH");
  const [num, den] = o.source.timeBase.split("/").map(Number), frameTimes = outputClock.frames.map(f => (f.pts - outputClock.startPts) * num * 1000 / den);
  if (checkOutputFrameCoverage(frameTimes, [o.range], [o.range]).status !== "PASS") throw Error("H4_PREVIEW_RANGE_UNSAFE");
  await streamSourceFactCommand(command.binary, ["-v", "error", "-nostdin", "-xerror", "-i", partial, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"],
    input.signal, Date.now() + 300000, () => {});
  const sourceAudio = await audioHash(input.sourcePath, input), previewAudio = await audioHash(partial, input);
  if (sourceAudio !== previewAudio) throw Error("H4_PREVIEW_AUDIO_MISMATCH");
  await preview.verifyFresh();
  const previewPath = await publishWithoutReplacement(partial, path.join(operation, "preview.mp4"), operation, input.sourcePath, [], "mp4");
  const previewFingerprint = await fingerprintFile(previewPath, { signal: input.signal });
  const technical = { version: "HybridRenderedPreview/v1", authority: "none", productState: "PRODUCT_DISABLED", previewPath, previewFingerprint,
    pngSha256: o.pngSha256, bindingDigest: o.bindingDigest, sourceKey: sourceKey(o.source), frames: outputClock.frames.length,
    durationMs: o.source.durationMs, dimensions: o.projection, audioPacketHash: previewAudio, uncoveredPixels: preview.uncoveredPixels, fullDecode: "PASS", clock: "PASS" };
  await writeFile(path.join(operation, "technical.json"), JSON.stringify(technical, null, 2), { flag: "wx", mode: 0o600 });
  return { technical, input: { ...input, sourcePath: previewPath, source: outputSource }, sourceClock: clock, previewClock: outputClock, operation,
    verifyFresh: async () => { await preview.verifyFresh(); if (await fingerprintFile(previewPath, { signal: input.signal }) !== previewFingerprint) throw Error("H4_PREVIEW_CHANGED"); } };
}

export function hybridPreviewOrdinals(o: HybridFrozenOverlay, count: number): number[] {
  const selected = new Set([0, Math.floor((count - 1) / 2), count - 1]);
  for (const sample of [...o.motion.samples].sort((a, b) => a.stationaryMatch - b.stationaryMatch || a.index - b.index)) {
    if (selected.size >= 6) break;
    if (sample.index >= 0 && sample.index < count) selected.add(sample.index);
  }
  return [...selected].sort((a, b) => a - b);
}

export async function buildHybridPreviewPacket(preview: HybridPreviewInput, render: Awaited<ReturnType<typeof renderHybridPreview>>) {
  const { input } = ownerOf(preview), o = preview.overlay, tools = { ...input.ffmpeg, signal: input.signal };
  await render.verifyFresh();
  const ordinals = hybridPreviewOrdinals(o, render.sourceClock.frames.length);
  const source = await readExactSourceFrames(input, render.sourceClock, ordinals), covered = await readExactSourceFrames(render.input, render.previewClock, ordinals);
  const images: VisionImageInput[] = [], crop = { x: 0, y: 0, width: o.source.width, height: o.source.height };
  // V1 paired packet maps source coordinates; resized sources need a future explicit mapping contract.
  if (o.projection.width !== crop.width || o.projection.height !== crop.height) throw Error("H4_PREVIEW_PACKET_MAPPING_UNSUPPORTED");
  for (const ordinal of ordinals) for (const [kind, frames] of [["ORIGINAL", source], ["COVERED", covered]] as const) {
    const binding = frames.bindings.find(b => b.index === ordinal)!;
    images.push({ sourceKey: sourceKey(o.source), ordinal, pts: render.sourceClock.frames[ordinal].pts, pixelSha256: binding.pixelSha256,
      crop, candidateIds: [...o.semanticTarget.candidateIds], kind, png: await encodeShapeCoverPng(frames.readFrame(ordinal), crop, tools) });
  }
  const candidates = o.semanticTarget.candidateIds.map((candidateId, i) => ({ candidateId, sourceBox: o.maskConfirmation.sourceBoxes[i] }));
  for (let i = 0; i < images.length; i++) await writeFile(path.join(render.operation, `frame-${images[i].ordinal}-${images[i].kind}.png`), images[i].png, { flag: "wx", mode: 0o600 });
  return createVisionPacket({ kind: "PREVIEW", sourceKey: sourceKey(o.source), sourceWidth: crop.width, sourceHeight: crop.height, timeBase: o.source.timeBase, candidates,
    reviewScope: "Evaluate ONLY the supplied confirmed corner replacement: compare its original logo with covered artwork in all paired full frames. Unchanged overlays in unconfirmed corners remain unresolved and are not part of this replacement. Check residual/edges, collateral product/person/important-text occlusion, unnatural size/position and temporal changes of this replacement. Candidate boxes are frozen H3 confirmation boxes in original source pixels, not masks or detector-grid facts. Photos and this immutable scope define the review. Never infer deterministic coverage or production approval." },
    images, async () => { await render.verifyFresh(); await source.verifyFresh(); await covered.verifyFresh(); });
}

/** Exact GPT model gate is H4-local; historical H1/H2 provider behavior stays unchanged. */
export async function reviewHybridPreview(packet: Awaited<ReturnType<typeof buildHybridPreviewPacket>>, routes: Record<VisionRole, VisionRoute>, signal: AbortSignal) {
  const sol = routes.SOL.model === "gpt-6.1-sol" ? routes.SOL : { provider: "chatgpt", model: "gpt-6.1-sol", imageCapability: "MODEL_IMAGE_CAPABILITY_UNAVAILABLE" as const,
    verifyFresh: async () => {}, complete: async () => { throw Error("MODEL_IMAGE_CAPABILITY_UNAVAILABLE"); } };
  const session = new ShapeCoverVisionSession(packet.manifest.sourceKey, { ...routes, SOL: sol });
  let result: Awaited<ReturnType<ShapeCoverVisionSession["reviewPreview"]>> | undefined, failure: string | undefined;
  try { result = await session.reviewPreview(packet, signal); } catch (error) {
    failure = error instanceof Error ? error.message : "H4_QA_FAILED";
    // Preserve an unparseable first answer as UNKNOWN and try the exact Sol
    // second opinion once. No MiniMax retry and no PASS from invalid output.
    if (failure === "VISION_INVALID_OUTPUT" && session.receipts.at(-1)?.role === "MINIMAX") {
      try { await session.request("SOL", packet, signal); }
      catch (second) { failure += `; SOL: ${second instanceof Error ? second.message : "H4_QA_FAILED"}`; }
    }
  }
  return { verdict: result?.verdict ?? "UNSAFE", result, failure, receipts: session.receipts, requestCounts: session.requestCounts, authority: "none", productState: "PRODUCT_DISABLED" };
}
