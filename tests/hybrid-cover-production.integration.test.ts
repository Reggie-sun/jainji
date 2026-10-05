import { expect, it } from "vitest";
import { mkdtemp, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { discoveryHash as hash } from "../src/main/source-fact-discovery-evidence.js";
import { encodeShapeCoverPng, decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";
import { decodeSourceMask, projectSourceMask } from "../src/main/shape-cover-pixel-gate.js";
import { approveHybridOverlay, hybridTemplate, readApprovedHybridCover, assertHybridTemplateReady, hybridVideoMedia } from "../src/main/hybrid-cover-production.js";
import { MediaCatalog } from "../src/main/media.js";
import type { HybridFrozenOverlay } from "../src/main/shape-cover-hybrid-h3.js";
import type { VisionRoute, VisionRole } from "../src/main/shape-cover-vision-router.js";
import { FfmpegAdapter } from "../src/main/ffmpeg.js";
import { ExportQueue } from "../src/main/queue.js";
import { JobStore } from "../src/main/store.js";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain.js";
import { TemplateCompiler } from "../src/main/compiler.js";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin.js";

it("binds video time separately from the imported container duration without accepting metadata drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "hybrid-video-clock-")), ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
  try {
    const file = join(root, "dual-clock.mp4");
    const encoded = spawnSync(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x160:r=6:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.013",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-n", file], { timeout: 20000 });
    expect(encoded.status, encoded.stderr.toString()).toBe(0);
    const [media] = await new MediaCatalog(ffmpeg).probePaths([file]);
    expect(media.durationMs).toBeGreaterThan(2000);
    expect((await hybridVideoMedia(media, ffmpeg)).durationMs).toBe(2000);
    await expect(hybridVideoMedia({ ...media, durationMs: media.durationMs + 1 }, ffmpeg)).rejects.toThrow("MEDIA_DURATION_CHANGED");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it("H4 approved partial corner uses exact frozen bytes in the original compiler/queue and rejects tamper before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "hybrid-product-")), signal = AbortSignal.timeout(120000);
  const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin), sourcePath = join(root, "source.mp4");
  try {
    const encoded = spawnSync(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x160:r=6:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-video_track_timescale", "6000", "-n", sourcePath], { timeout: 20000 });
    expect(encoded.status, encoded.stderr.toString()).toBe(0);
    const source = await identifySource(sourcePath, { width: 160, height: 160, rotation: 0, durationMs: 2000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    const bits = Buffer.alloc(13, 255); bits[12] = 15;
    const mask = { bbox: { x: 140, y: 0, width: 10, height: 10 }, encoding: "bitpack-lsb-row-major-v1" as const, dataBase64: bits.toString("base64"), sha256: hash(bits), markedPixels: 100 };
    const projection = { width: 160, height: 160, scaledWidth: 160, scaledHeight: 160, padLeft: 0, padTop: 0 };
    const projected = projectSourceMask(decodeSourceMask({ ...mask, kind: "static-binary-v1" }, source)!, source, projection)!;
    const rgba = Buffer.alloc(160 * 160 * 4);
    for (let p = 0; p < projected.length; p++) if (projected[p]) rgba.set([255, 0, 0, 255], p * 4);
    const png = await encodeShapeCoverPng(rgba, source, ffmpeg), pngPath = join(root, "frozen.png"); await writeFile(pngPath, png);
    const settings = { resolutionMode: "source" as const, frameRateMode: "source" as const, quality: "balanced" as const };
    const body = { version: "HybridCornerFrozenOverlay/v1", verification: "geometry-only", contentSafety: "NOT_EVALUATED", authority: "none", productState: "PRODUCT_DISABLED",
      source, settings, mask, motion: { status: "STATIC_SUPPORTED", samples: [0, 2, 4, 7, 9, 11].map(index => ({ index, stationaryMatch: 1 })) },
      range: { startFrame: 0, endFrame: 12, startMs: 0, endMs: 2000 }, projection, placement: { x: 140, y: 0, width: 10, height: 10 },
      semanticTarget: { corner: "TOP_RIGHT", candidateIds: ["fixture_logo"] }, selectedSticker: { id: "heart" },
      maskConfirmation: { sourceBoxes: [mask.bbox] }, coverage: { oldPixels: projected.reduce((n, p) => n + p, 0), uncoveredPixels: 0, coverageFraction: 1 },
      rgbaSha256: hash(rgba), finalAlphaSha256: hash(Uint8Array.from({ length: 25600 }, (_, i) => rgba[i * 4 + 3])), pngSha256: hash(png) };
    const overlay = { ...body, bindingDigest: hash(JSON.stringify(body)), pngPath } as unknown as HybridFrozenOverlay;
    const calls: string[] = [], route = (role: VisionRole): VisionRoute => ({ provider: "fixture", model: role, imageCapability: "AVAILABLE", verifyFresh: async () => {},
      complete: async messages => {
        calls.push(role);
        const content = messages[1].content as { text: string }[], packet = JSON.parse(content[0].text);
        return JSON.stringify({ packetDigest: packet.packetDigest, oldOverlayResidual: "PASS", unintendedOcclusion: "PASS", unnaturalPlacement: "PASS", temporalMismatch: "PASS", riskFlags: [], shortReason: "fixture independent QA" });
      } });
    const routes = { LUNA: route("LUNA"), SOL: route("SOL"), MINIMAX: route("MINIMAX") };
    const layer = await approveHybridOverlay(overlay, { sourcePath, source, ffmpeg, signal }, routes, root);
    expect(calls).toEqual(["MINIMAX"]);
    const template = hybridTemplate([layer], createDefaultTemplate()), preset = { ...DEFAULT_PRESET, ...settings };
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "fixture.mp4", fingerprint: source.fingerprint, sizeBytes: source.byteLength,
      durationMs: 2000, width: 160, height: 160, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    expect(await readApprovedHybridCover(structuredClone(layer), media, preset)).toEqual(png);
    const copyPath = join(root, "source-copy.mp4");
    await writeFile(copyPath, await readFile(sourcePath));
    expect(await readApprovedHybridCover(layer, { ...media, sourcePath: copyPath }, preset)).toEqual(png);
    await appendFile(copyPath, Buffer.from([1]));
    await expect(readApprovedHybridCover(layer, { ...media, sourcePath: copyPath }, preset)).rejects.toThrow("SOURCE_CHANGED");
    await expect(readApprovedHybridCover(layer, { ...media, fingerprint: "changed" }, preset)).rejects.toThrow("OUTPUT_BINDING");
    await expect(readApprovedHybridCover(layer, media, { ...preset, quality: "high" })).rejects.toThrow("OUTPUT_BINDING");
    for (const altered of [{ ...layer, x: 0.1 }, { ...layer, opacity: 0.5 }, { ...layer, visible: false },
      { ...layer, cover: { ...layer.cover!, opaqueBackground: true as const } },
      { ...layer, cover: { ...layer.cover!, hybridApproved: { ...layer.cover!.hybridApproved!, approvalId: crypto.randomUUID() } } }]) {
      expect(() => assertHybridTemplateReady({ ...template, layers: [altered] })).toThrow("APPROVAL_BINDING");
    }
    const compiler = new TemplateCompiler(), compiled = await compiler.compile(template, media, preset, { ffmpegPath: ffmpegBin, fontResolver: { resolve: async () => null }, textFilePath: id => join(root, id), threads: 2 });
    expect(compiled.binaryFiles?.[0].content).toEqual(png);
    expect(compiled.args[compiled.args.indexOf("-filter_complex") + 1]).toContain("overlay=0:0:enable='gte(t,0)*lt(t,2)'");
    expect(compiled.args.join(" ")).not.toContain("color=white");
    const queue = new ExportQueue({ jobStore: new JobStore(join(root, "jobs")), ffmpeg, fontResolver: { resolve: async () => null }, videoEncoder: { status: "ready", encoder: "libx264" } as any });
    queue.setMediaLookup(() => media);
    const batch = await queue.createBatch({ template, mediaIds: [media.id], mediaItems: [media], outputDirectory: join(root, "output"), preset });
    await queue.start(batch.id);
    const task = queue.snapshot().batches.find(s => s.batch.id === batch.id)!.batch.tasks[0];
    expect(task.status, task.errorMessage).toBe("completed"); expect(task.outputArtifact?.durationMs).toBeCloseTo(2000, -1);
    const frame = spawnSync(ffmpegBin, ["-v", "error", "-i", task.outputPath!, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], { maxBuffer: 4 * 1024 ** 2 });
    const output = await decodeShapeCoverPng(frame.stdout, source, ffmpeg), p = (4 * 160 + 144) * 4;
    expect(output[p]).toBeGreaterThan(220); expect(output[p + 2]).toBeLessThan(30); expect(output[(80 * 160 + 80) * 4 + 2]).toBeGreaterThan(220);
    // Mutation during encode must be detected by queue's post-render guard, before final publication.
    const run = ffmpeg.run.bind(ffmpeg);
    ffmpeg.run = (args, progress) => {
      const running = run(args, progress);
      return { ...running, promise: running.promise.then(async result => { await appendFile(pngPath, Buffer.from([1])); return result; }) };
    };
    const second = await queue.createBatch({ template, mediaIds: [media.id], mediaItems: [media], outputDirectory: join(root, "output"), preset });
    await queue.start(second.id);
    expect(queue.snapshot().batches.find(s => s.batch.id === second.id)!.batch.tasks[0]).toMatchObject({ status: "failed" });
    expect(queue.snapshot().batches.find(s => s.batch.id === second.id)!.batch.tasks[0].outputArtifact).toBeUndefined();
    await writeFile(pngPath, png);
    // The task's encoding copy is itself a frozen artifact, not just its original PNG.
    ffmpeg.run = (args, progress) => {
      const running = run(args, progress);
      const copy = args.find(p => p.endsWith(`shape-${layer.id}.png.txt`))!;
      return { ...running, promise: running.promise.then(async result => { await appendFile(copy, Buffer.from([1])); return result; }) };
    };
    const third = await queue.createBatch({ template, mediaIds: [media.id], mediaItems: [media], outputDirectory: join(root, "output"), preset });
    await queue.start(third.id);
    expect(queue.snapshot().batches.find(s => s.batch.id === third.id)!.batch.tasks[0]).toMatchObject({ status: "failed" });
    expect(queue.snapshot().batches.find(s => s.batch.id === third.id)!.batch.tasks[0].outputArtifact).toBeUndefined();
    await appendFile(sourcePath, Buffer.from([1]));
    await expect(readApprovedHybridCover(layer, media, preset)).rejects.toThrow("H4_SOURCE_CHANGED");
    expect(calls).toEqual(["MINIMAX"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
