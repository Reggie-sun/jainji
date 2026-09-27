import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admitReviewedSourceMask } from "../src/main/source-mask-admission";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { computeCommonShapeCoverCandidates, type ShapeCoverCandidateRequest } from "../src/main/shape-cover-candidates";
import * as alphaMedia from "../src/main/shape-cover-alpha";
import type { ExportSettings } from "../src/shared/export-settings";
import { freezeShapeCoverCandidate } from "../src/main/shape-cover-freeze";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, EditTemplateSchema, now, type MediaItem, type StickerLayer } from "../src/main/domain";
import { decodeSourceMask, projectSourceMask, checkOutputFrameCoverage } from "../src/main/shape-cover-pixel-gate";
import { shapeCoverDigest } from "../src/main/shape-cover-render";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { ArtifactVerifier } from "../src/main/artifact";
import { admitShapeCoverSample, type ShapeCoverReviewInput, type ShapeCoverAdmission } from "../src/main/shape-cover-admission";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import { resolveFont } from "../src/main/ffmpeg";
import * as agentFrames from "../src/main/agent-frames";
import { prepareAgentTemplate } from "../src/main/agent-template-preparation";
import type { StickerAssets } from "../src/main/builtin-stickers";
import { getRule } from "../src/shared/agent";
import { ShapeCoverArtifactStore } from "../src/main/shape-cover-artifacts";
import * as artifactIo from "../src/main/shape-cover-artifact-io";

const available = ["ffmpeg", "ffprobe"].every(binary => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
const roots: string[] = [], stores: SourceStickerKnowledgeStore[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const settings: ExportSettings = { resolutionMode: "source", frameRateMode: "source", quality: "balanced" };
const placement = { x: 6, y: 6, width: 32, height: 32 };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe.skipIf(!available)("frozen shape pixels through the original compiler and queue", () => {
  const mediaTools = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin };
  async function frozenFixture(fps = 30, frameRateMode: "source" | "30" = "source") {
    const value = await fixture(64, fps);
    value.request.outputSettings[0].settings.frameRateMode = frameRateMode;
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 3; y < 31; y++) for (let x = 3; x < 31; x++) {
      const i = (y * 32 + x) * 4;
      pixels[i] = 255;
      pixels[i + 3] = x === 3 || y === 3 || x === 30 || y === 30 ? 128 : 255;
    }
    const assetPath = path.join(value.root, "contour.png");
    expect(spawnSync(ffmpegBin, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "32x32", "-i", "pipe:0", "-frames:v", "1", "-threads", "1", assetPath], { input: pixels }).status).toBe(0);
    const fingerprint = sha(await readFile(assetPath));
    value.request.candidates = [{ id: `uploaded-${fingerprint}`, asset: { assetPath, assetFingerprint: `sha256:${fingerprint}` } }];
    const frozen = await freezeShapeCoverCandidate(value.request, value.request.candidates[0].id, value.store, path.join(value.root, "frozen"), mediaTools);
    expect(frozen, JSON.stringify(frozen)).toMatchObject({ status: "PASS", verification: "geometry-only", contentSafety: "NOT_EVALUATED" });
    if (frozen.status !== "PASS") throw new Error("fixture freeze failed");
    const layer = frozen.layers[0].layer;
    const target = value.request.intendedTargets[0];
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: target.sourcePath, displayName: "source", fingerprint: target.source.fingerprint,
      sizeBytes: target.source.byteLength, durationMs: target.source.durationMs, width: target.source.width, height: target.source.height,
      rotation: target.source.rotation, probeStatus: "ready", importedAt: now() };
    const template = { ...createDefaultTemplate(), layers: [layer], decorationDisplayMode: "first-3s" as const };
    const preset = { ...DEFAULT_PRESET, ...settings, frameRateMode };
    return { ...value, frozen, layer, target, media, template, preset };
  }

  const safeReview = async (input: ShapeCoverReviewInput) => JSON.stringify({ action: "pass", reason: "synthetic independent fixture review",
    contentSafety: { face: "SAFE", hands: "SAFE", product: "SAFE", subtitles: "SAFE" },
    evidenceIds: [...new Set(input.evidence.flatMap(image => [image.sourceEvidenceId!, image.previewEvidenceId!, ...image.fullSourceEvidenceId ? [image.fullSourceEvidenceId] : []]))] });
  async function admissionFixture(review = safeReview, fps = 30, frameRateMode: "source" | "30" = "source") {
    const value = await frozenFixture(fps, frameRateMode);
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
    const verifier = new ArtifactVerifier(ffmpeg);
    const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(value.root, "jobs")), sourceKnowledgeStore: value.store,
      artifactVerifier: verifier, fontResolver: { resolve: async () => null }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
    const controller = new AbortController();
    const input = { ...value, queue, ffmpeg, candidateId: value.request.candidates[0].id, cacheDirectory: path.join(value.root, "admission-preview"),
      reviewer: { identity: "simulated-independent-fixture", role: "independent-content-safety" as const, review }, signal: controller.signal };
    return { ...value, queue, input, controller, verifier };
  }

  async function custodyFixture() {
    const review = vi.fn(safeReview), value = await admissionFixture(review);
    const admitted = await admitShapeCoverSample(value.input);
    if (admitted.status !== "PASS") throw new Error(admitted.reason);
    const projectId = crypto.randomUUID(), key = { runId: crypto.randomUUID(), mediaId: value.media.id, version: 1 };
    const outputDirectory = path.join(value.root, "custody-outputs"); await mkdir(outputDirectory);
    const options = { root: path.join(value.root, "custody"), projectId, jobStore: new JobStore(path.join(value.root, "jobs")) };
    const custody = new ShapeCoverArtifactStore(options);
    const publish = { key, request: value.request, template: value.template, media: value.media, preset: value.preset, outputDirectory,
      samplePath: admitted.previewPath, admission: admitted.admission, signal: value.controller.signal, queue: value.queue };
    const directory = path.join(options.root, projectId, `${key.runId}-${key.mediaId}-${key.version}`);
    return { ...value, admitted, review, options, custody, publish, directory };
  }

  it("retains complete data without authority and publishes a concurrent identical key only once", async () => {
    const value = await custodyFixture();
    const { custody, publish, queue, options, review, input, admitted, directory } = value;
    try {
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      const [first, second] = await Promise.all([custody.publish(publish), custody.publish(publish)]);
      expect(second).toEqual(first);
      expect(await new ShapeCoverArtifactStore(options).publish(publish)).toEqual(first);
      expect(dispatch).toHaveBeenCalledOnce();
      const before = await custody.load(publish.key);
      expect(before.authority).toBe("none");
      expect("admission" in before).toBe(false);
      expect(before.request.intendedTargets).toEqual(publish.request.intendedTargets);
      expect(before.request.outputSettings).toEqual(publish.request.outputSettings);
      expect(await readFile(before.request.candidates[0].asset.assetPath)).toEqual(await readFile(publish.request.candidates[0].asset.assetPath));
      const layer = before.template.layers[0];
      if (layer.type !== "sticker") throw new Error("missing shape layer");
      expect(await readFile(layer.assetPath)).toEqual(await readFile(input.layer.assetPath));
      expect(await readFile(first.outputPath)).toEqual(await readFile(admitted.previewPath));
      const { verifyShapeCoverAdmission } = await import("../src/main/shape-cover-admission");
      await expect(verifyShapeCoverAdmission(admitted.admission, before.template, before.media, before.preset, before.samplePath)).rejects.toThrow("UNSAFE");
      await expect(queue.createBatch({ template: before.template, mediaIds: [before.media.id], mediaItems: [before.media], preset: before.preset, outputDirectory: publish.outputDirectory })).rejects.toThrow("UNSAFE");
      await rm(input.layer.assetPath);
      await rm(publish.request.candidates[0].asset.assetPath);
      await rm(input.cacheDirectory, { recursive: true, force: true });
      const ffmpeg = vi.spyOn(input.ffmpeg, "run");
      const reopened = new ShapeCoverArtifactStore(options);
      expect(await reopened.completed(publish.key)).toEqual(first);
      expect(await reopened.load(publish.key)).toEqual(before);
      expect(ffmpeg).not.toHaveBeenCalled();
      expect(review).toHaveBeenCalledOnce();
      expect(await readdir(publish.outputDirectory)).toEqual([path.basename(first.outputPath)]);
      expect(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))).toMatchObject({ schemaVersion: 1, authority: "none" });
    } finally { await queue.shutdown(); }
  }, 30_000);

  it.each(["before-side-effect", "lost-return"])("keeps an unknown %s publication permanently closed", async failure => {
    const { custody, publish, queue, options, review } = await custodyFixture();
    try {
      const original = queue.publishApprovedSample.bind(queue);
      const dispatch = vi.spyOn(queue, "publishApprovedSample").mockImplementation(async input => {
        if (failure === "lost-return") await original(input);
        throw new Error("simulated publication failure");
      });
      await expect(custody.publish(publish)).rejects.toThrow("simulated publication failure");
      await expect(custody.publish(publish)).rejects.toThrow();
      await expect(new ShapeCoverArtifactStore(options).publish(publish)).rejects.toThrow();
      await expect(new ShapeCoverArtifactStore(options).completed(publish.key)).rejects.toThrow();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(review).toHaveBeenCalledOnce();
      expect(await readdir(publish.outputDirectory)).toHaveLength(failure === "lost-return" ? 1 : 0);
      expect((await custody.load(publish.key)).authority).toBe("none");
    } finally { await queue.shutdown(); }
  }, 30_000);

  it("arbitrates independent stores and refuses a changed binding at the same key", async () => {
    const { custody, publish, queue, options } = await custodyFixture();
    try {
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      const results = await Promise.allSettled([custody.publish(publish), new ShapeCoverArtifactStore(options).publish(publish)]);
      expect(results.some(result => result.status === "fulfilled")).toBe(true);
      const first = await custody.completed(publish.key);
      expect(dispatch).toHaveBeenCalledOnce();
      await expect(custody.publish({ ...publish, outputDirectory: path.join(path.dirname(publish.outputDirectory), "different-output") })).rejects.toThrow("different content");
      expect(dispatch).toHaveBeenCalledOnce();
      expect(await readdir(publish.outputDirectory)).toEqual([path.basename(first.outputPath)]);
    } finally { await queue.shutdown(); }
  }, 30_000);

  it("refuses publication when the permanent intent cannot be durably synced", async () => {
    const { custody, publish, queue, directory } = await custodyFixture();
    try {
      const original = artifactIo.writeArtifactJson;
      vi.spyOn(artifactIo, "writeArtifactJson").mockImplementation(async (file, value) => {
        await original(file, value);
        if (path.basename(file) === "publication-intent.json") throw new Error("simulated intent sync failure");
      });
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      await expect(custody.publish(publish)).rejects.toThrow("intent sync failure");
      expect(await readdir(directory)).toContain("publication-intent.json");
      await expect(custody.publish(publish)).rejects.toThrow();
      expect(dispatch).not.toHaveBeenCalled();
      expect(await readdir(publish.outputDirectory)).toEqual([]);
    } finally { await queue.shutdown(); }
  }, 30_000);

  it.each(["request", "media-key", "production-key", "cancelled", "root-symlink"])("refuses custody %s before queue publication", async failure => {
    const { custody, publish, queue, options, controller, root, input } = await custodyFixture();
    try {
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      if (failure === "request") publish.request = { ...publish.request, intendedTargets: [] };
      if (failure === "media-key") publish.key = { ...publish.key, mediaId: crypto.randomUUID() };
      if (failure === "production-key") {
        // Issue a valid handle for a production-selected template, then use the wrong archive version.
        const layer = publish.template.layers[0];
        if (layer.type !== "sticker" || !layer.cover) throw new Error("missing layer");
        publish.template = { ...publish.template, layers: [{ ...layer, cover: { ...layer.cover, selection: { runId: publish.key.runId, round: 2 } } }] };
        const fresh = await admitShapeCoverSample({ ...input, template: publish.template, cacheDirectory: path.join(root, "fresh-preview") });
        if (fresh.status !== "PASS") throw new Error(fresh.reason);
        publish.admission = fresh.admission; publish.samplePath = fresh.previewPath;
      }
      if (failure === "cancelled") controller.abort();
      if (failure === "root-symlink") await symlink(root, options.root);
      await expect(custody.publish(publish)).rejects.toThrow();
      expect(dispatch).not.toHaveBeenCalled();
      expect(await readdir(publish.outputDirectory)).toEqual([]);
    } finally { await queue.shutdown(); }
  }, 30_000);

  it("preserves the barrier and snapshot on cancellation after durable publication intent", async () => {
    const { custody, publish, queue, directory, controller } = await custodyFixture();
    try {
      const original = artifactIo.writeArtifactJson;
      vi.spyOn(artifactIo, "writeArtifactJson").mockImplementation(async (file, value) => {
        await original(file, value);
        if (path.basename(file) === "publication-intent.json") controller.abort();
      });
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      await expect(custody.publish(publish)).rejects.toThrow();
      expect(await readdir(directory)).toContain("publication-intent.json");
      expect((await custody.load(publish.key)).authority).toBe("none");
      await expect(custody.completed(publish.key)).rejects.toThrow();
      expect(dispatch).not.toHaveBeenCalled();
    } finally { await queue.shutdown(); }
  }, 30_000);

  it.each(["missing-asset", "tampered-asset", "tampered-layer", "missing-sample", "symlink-asset", "version", "authority", "traversal", "oversized-manifest", "missing-intent", "missing-intent-and-receipt", "missing-receipt", "tampered-receipt", "changed-output", "queue-fact"])("refuses persisted %s without repeating publication", async failure => {
    const { custody, publish, queue, options, directory } = await custodyFixture();
    try {
      const dispatch = vi.spyOn(queue, "publishApprovedSample");
      const first = await custody.publish(publish);
      const manifestPath = path.join(directory, "manifest.json"), receiptPath = path.join(directory, "publication-receipt.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const assetPath = path.join(directory, manifest.files[0].name);
      if (failure === "missing-asset") await rm(assetPath);
      if (failure === "tampered-asset") await writeFile(assetPath, "tampered");
      if (failure === "tampered-layer") await writeFile(path.join(directory, manifest.files.find((file: { kind: string }) => file.kind === "layer").name), "tampered layer");
      if (failure === "missing-sample") await rm(path.join(directory, `sample.${publish.preset.container}`));
      if (failure === "symlink-asset") { await rm(assetPath); await symlink(publish.request.candidates[0].asset.assetPath, assetPath); }
      if (failure === "version") manifest.schemaVersion = 2;
      if (failure === "authority") manifest.authority = "PASS";
      if (failure === "traversal") manifest.files[0].name = "../outside.png";
      if (["version", "authority", "traversal"].includes(failure)) await writeFile(manifestPath, JSON.stringify(manifest));
      if (failure === "oversized-manifest") await writeFile(manifestPath, Buffer.alloc(artifactIo.SHAPE_ARTIFACT_METADATA_BYTES + 1, 32));
      if (failure === "missing-receipt") await rm(receiptPath);
      if (failure.startsWith("missing-intent")) await rm(path.join(directory, "publication-intent.json"));
      if (failure === "missing-intent-and-receipt") await rm(receiptPath);
      if (failure === "tampered-receipt") await writeFile(receiptPath, "{}");
      if (failure === "changed-output") await writeFile(first.outputPath, "tampered output");
      if (failure === "queue-fact") {
        const state = queue.snapshot().batches[0]; state.batch.projectId = crypto.randomUUID();
        await options.jobStore.save(state);
      }
      const reopened = new ShapeCoverArtifactStore(options);
      await expect(reopened.completed(publish.key)).rejects.toThrow();
      await expect(reopened.publish(publish)).rejects.toThrow();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(await readdir(publish.outputDirectory)).toEqual([path.basename(first.outputPath)]);
    } finally { await queue.shutdown(); }
  }, 30_000);

  it("fills only the actual occupied corner intervals instead of treating the transparent shape canvas as four corners", async () => {
    const { layer, media, request } = await frozenFixture();
    const id = request.candidates[0].id;
    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
    const template = prepareAgentTemplate({ plan: { summary: "simulated corners", captions: [], filter: "none", intensity: 0, priceStyle: "classic",
      stickers: corners.map(corner => ({ corner, sticker: id, width: 0.08, rotationDeg: 0 })) }, ruleId: "clean", source: media, resolutionMode: "source",
      stickerAssets: { [id]: request.candidates[0].asset } as StickerAssets, catalog: { fonts: [], stickers: [{ id, label: "fixture" }] },
      decorations: { mode: "agent", sticker: "template", fontFamily: "Noto Sans CJK SC", productPrice: "手动展示" }, shapeCoverLayers: [layer], runId: crypto.randomUUID(), version: 1 });
    const stickers = template.layers.filter((layer): layer is StickerLayer => layer.type === "sticker" && !layer.cover);
    expect(stickers).toHaveLength(4);
    expect(stickers[0]).toMatchObject({ activeRanges: [{ startMs: 2000, endMs: 3000 }] });
    expect(stickers.slice(1).every(layer => !layer.activeRanges)).toBe(true);
    expect(template.layers.filter(layer => layer.type === "sticker" && layer.cover)).toEqual([layer]);
  });

  it("admits measured output frames and independently checked paired evidence, then publishes only the same sample bytes", async () => {
    const { root, queue, input, controller, verifier } = await admissionFixture();
    const result = await admitShapeCoverSample(input);
    expect(result).toMatchObject({ status: "PASS", frameCount: 90, contentSafety: "PASS" });
    if (result.status !== "PASS") throw new Error(result.reason);
    const outputDirectory = path.join(root, "approved"); await mkdir(outputDirectory);
    const publish = { template: input.template, media: input.media, preset: input.preset, samplePath: result.previewPath, outputDirectory };
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: {} as ShapeCoverAdmission })).rejects.toThrow("UNSAFE");
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: structuredClone(result.admission) })).rejects.toThrow("UNSAFE");
    await expect(queue.publishApprovedSample({ ...publish, preset: { ...input.preset, quality: "high" }, shapeAdmission: result.admission })).rejects.toThrow("UNSAFE");
    const admitted = await queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission });
    expect((await readFile(admitted.outputPath)).equals(await readFile(result.previewPath))).toBe(true);
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("completed");
    const verify = verifier.verify.bind(verifier);
    const corruptCopy = vi.spyOn(verifier, "verify").mockImplementationOnce(async (...args) => {
      const artifact = await verify(...args);
      await writeFile(args[0], await readFile(input.media.sourcePath));
      return artifact;
    });
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission })).rejects.toThrow("UNSAFE");
    corruptCopy.mockRestore();
    expect(await readdir(outputDirectory)).toEqual([path.basename(admitted.outputPath)]);
    await expect(queue.createBatch({ template: input.template, mediaIds: [input.media.id], mediaItems: [input.media], preset: input.preset, outputDirectory })).rejects.toThrow("UNSAFE");
    const original = await readFile(result.previewPath); await writeFile(result.previewPath, "tampered sample");
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission })).rejects.toThrow("UNSAFE");
    await writeFile(result.previewPath, original);
    const assetPath = input.request.candidates[0].asset.assetPath, asset = await readFile(assetPath);
    await writeFile(assetPath, "changed artwork");
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission })).rejects.toThrow("UNSAFE");
    await writeFile(assetPath, asset);
    const png = await readFile(input.layer.assetPath); await writeFile(input.layer.assetPath, "changed frozen PNG");
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission })).rejects.toThrow("UNSAFE");
    await writeFile(input.layer.assetPath, png);
    controller.abort();
    await expect(queue.publishApprovedSample({ ...publish, shapeAdmission: result.admission })).rejects.toThrow();
    await queue.shutdown();
  }, 30_000);

  it.each(["face", "hands", "product", "subtitles", "unknown", "bare-pass", "stale-evidence"])("rejects geometry PASS with independent safety failure: %s", async concern => {
    const review = async (input: ShapeCoverReviewInput) => {
      const pass = JSON.parse(await safeReview(input));
      if (concern === "bare-pass") return JSON.stringify({ action: "pass", reason: "not evidence" });
      if (concern === "stale-evidence") pass.evidenceIds = ["old-source", "old-preview"];
      else pass.contentSafety[concern === "unknown" ? "face" : concern] = concern === "unknown" ? "UNKNOWN" : "UNSAFE";
      return JSON.stringify(pass);
    };
    const checked = vi.fn(review);
    const { queue, input } = await admissionFixture(checked);
    expect(await admitShapeCoverSample(input)).toMatchObject({ status: "UNSAFE" });
    expect(checked).toHaveBeenCalledOnce();
    expect(queue.snapshot().batches).toEqual([]);
    await queue.shutdown();
  }, 30_000);

  it("does not restore publication authority from JSON or an admission module loaded after issuance", async () => {
    const review = vi.fn(safeReview);
    const { queue, input } = await admissionFixture(review);
    try {
      const admitted = await admitShapeCoverSample(input);
      expect(admitted).toMatchObject({ status: "PASS" });
      if (admitted.status !== "PASS") throw new Error(admitted.reason);
      const encoded = JSON.parse(JSON.stringify(admitted));
      const ffmpeg = vi.spyOn(input.ffmpeg, "run");
      const { verifyShapeCoverAdmission: currentVerify } = await import("../src/main/shape-cover-admission");
      await expect(currentVerify(encoded.admission, input.template, input.media, input.preset, admitted.previewPath)).rejects.toThrow("UNSAFE");
      vi.resetModules();
      const { verifyShapeCoverAdmission: freshVerify } = await import("../src/main/shape-cover-admission");
      await expect(freshVerify(admitted.admission, input.template, input.media, input.preset, admitted.previewPath)).rejects.toThrow("UNSAFE");
      expect(review).toHaveBeenCalledOnce();
      expect(ffmpeg).not.toHaveBeenCalled();
      expect(queue.snapshot().batches).toEqual([]);
    } finally { await queue.shutdown(); }
  }, 30_000);

  it.each(["completed", "validating", "running", "verifying"] as const)("recovers persisted shape %s without restoring authority or replacing a published file", async phase => {
    const review = vi.fn(safeReview);
    const { root, queue, input } = await admissionFixture(review);
    let recovered: ExportQueue | undefined;
    try {
      const admitted = await admitShapeCoverSample(input);
      if (admitted.status !== "PASS") throw new Error(admitted.reason);
      const outputDirectory = path.join(root, "recover-outputs"); await mkdir(outputDirectory);
      const published = await queue.publishApprovedSample({ template: input.template, media: input.media, preset: input.preset,
        samplePath: admitted.previewPath, outputDirectory, shapeAdmission: admitted.admission });
      const bytes = await readFile(published.outputPath);
      const jobStore = new JobStore(path.join(root, "jobs"));
      if (phase !== "completed") {
        // Project the durable pre-completion windows; this is not an OS crash/fsync test.
        const state = queue.snapshot().batches[0];
        state.batch.status = "active";
        Object.assign(state.batch.tasks[0], { status: phase, progress: 0.5, outputArtifact: undefined, finishedAt: undefined });
        await jobStore.save(state);
      }
      await queue.shutdown();
      await rm(input.layer.assetPath);
      await rm(input.cacheDirectory, { recursive: true, force: true });
      const ffmpeg = vi.spyOn(input.ffmpeg, "run");
      recovered = new ExportQueue({ ffmpeg: input.ffmpeg, jobStore, sourceKnowledgeStore: input.store,
        fontResolver: { resolve: async () => null }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
      await recovered.recover();
      const task = () => recovered!.snapshot().batches[0].batch.tasks[0];
      expect(task().status).toBe(phase === "completed" ? "completed" : "interrupted");
      expect(ffmpeg).not.toHaveBeenCalled();
      await recovered.retry([published.taskId]);
      if (phase === "completed") expect(task()).toMatchObject({ status: "completed", outputPath: published.outputPath, attempt: 1 });
      else expect(task()).toMatchObject({ status: "failed", errorCode: "input_invalid", attempt: 2 });
      expect(await readFile(published.outputPath)).toEqual(bytes);
      expect(await readdir(outputDirectory)).toEqual([path.basename(published.outputPath)]);
      expect(ffmpeg).not.toHaveBeenCalled();
      expect(review).toHaveBeenCalledOnce();
    } finally { await queue.shutdown(); await recovered?.shutdown(); }
  }, 30_000);

  it("rejects missing targets, forged queue samples, rebindings and cancellation before issuing authority", async () => {
    const { queue, input } = await admissionFixture();
    const missing = { ...input, template: { ...input.template, layers: [] } };
    expect(await admitShapeCoverSample(missing)).toMatchObject({ status: "UNSAFE" });
    const fake = path.join(input.root, "not-a-queue-render.mp4"); await writeFile(fake, await readFile(input.media.sourcePath));
    const render = vi.spyOn(queue, "renderPreview").mockResolvedValueOnce(fake);
    expect(await admitShapeCoverSample(input)).toMatchObject({ status: "UNSAFE", reason: expect.stringContaining("not rendered by this queue") });
    render.mockRestore();
    const controller = new AbortController(); controller.abort();
    expect(await admitShapeCoverSample({ ...input, signal: controller.signal })).toMatchObject({ status: "UNSAFE", reason: "cancelled" });
    const source = await readFile(input.media.sourcePath); await writeFile(input.media.sourcePath, "changed source");
    expect(await admitShapeCoverSample(input)).toMatchObject({ status: "UNSAFE" });
    await writeFile(input.media.sourcePath, source);
    const head = input.request.intendedTargets[0];
    head.revisionId = "old-revision";
    expect(await admitShapeCoverSample(input)).toMatchObject({ status: "UNSAFE" });
    await queue.shutdown();
  }, 30_000);

  it("proves all converted output PTS and refuses a truncated real queue sample before content review", async () => {
    const review = vi.fn(safeReview);
    const { queue, input } = await admissionFixture(review, 24, "30");
    const pass = await admitShapeCoverSample(input);
    expect(pass).toMatchObject({ status: "PASS", frameCount: 90 });
    const run = input.ffmpeg.run.bind(input.ffmpeg);
    vi.spyOn(input.ffmpeg, "run").mockImplementation((args, progress) => {
      if (!args.includes("-filter_complex")) return run(args, progress);
      const modified = [...args]; modified[modified.indexOf("-t") + 1] = "1";
      return run(modified, progress);
    });
    review.mockClear();
    expect(await admitShapeCoverSample(input)).toMatchObject({ status: "UNSAFE", reason: expect.stringContaining("timeline") });
    expect(review).not.toHaveBeenCalled();
    await queue.shutdown();
  }, 30_000);

  it("round-trips the real contour PNG and renders its exact pixels and interval through queue preview", async () => {
    const { root, store, request, frozen, layer, target, media, template, preset } = await frozenFixture();
    expect(frozen.layers).toHaveLength(2);
    const binding = layer.cover!.shapeMatched!;
    expect(binding.radiusPx).toBe(2);
    const png = await readFile(layer.assetPath);
    const rgba = await alphaMedia.decodeShapeCoverPng(png, binding.projection, mediaTools);
    expect(shapeCoverDigest(rgba)).toBe(binding.rgbaSha256);
    expect(rgba[3]).toBe(0);
    expect([...rgba.subarray((9 * 64 + 9) * 4, (9 * 64 + 9) * 4 + 4)]).toEqual([255, 127, 127, 255]);
    const head = (await store.readHead(target.source))!;
    const mask = head.revision.candidate.facts.targets[0].segments[0].mask!;
    const oldFinal = projectSourceMask(decodeSourceMask(mask, target.source)!, target.source, binding.projection)!;
    expect(oldFinal.every((marked, i) => !marked || rgba[i * 4 + 3] === 255)).toBe(true);
    // Frozen pixels remain independent of the original catalog file.
    await unlink(request.candidates[0].asset.assetPath);
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
    const jobStore = new JobStore(path.join(root, "jobs"));
    const compiler = new TemplateCompiler();
    const compiledSpy = vi.spyOn(compiler, "compile");
    const queue = new ExportQueue({ ffmpeg, jobStore, compiler, sourceKnowledgeStore: store, fontResolver: { resolve: async () => null }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
    const cacheDirectory = path.join(root, "previews");
    const preview = await queue.renderPreview({ template, media, preset, cacheDirectory, signal: new AbortController().signal });
    const compiled = await compiledSpy.mock.results[0].value;
    expect(compiled.binaryFiles[0].content.equals(png)).toBe(true);
    expect(compiled.args).not.toContain(layer.assetPath);
    const graph = compiled.args[compiled.args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("overlay=0:0:enable='gte(t,0)*lt(t,2)'");
    expect(graph).not.toMatch(/\b(scale|crop|pad|fade)=/);
    expect((await readdir(cacheDirectory)).filter(file => !file.endsWith(".mp4"))).toEqual([]);
    expect(queue.snapshot().batches).toEqual([]);
    expect(await jobStore.loadAll()).toEqual([]);
    const decoded = spawnSync(ffmpegBin, ["-v", "error", "-threads", "1", "-i", preview, "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
    expect(decoded.status, decoded.stderr.toString()).toBe(0);
    const pts = spawnSync(ffprobeBin, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", preview]);
    expect(pts.status).toBe(0);
    const times = JSON.parse(pts.stdout.toString()).frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time) * 1000);
    expect(checkOutputFrameCoverage(times, [binding.range], [layer.cover!.motion!])).toEqual({ status: "PASS" });
    expect(times.length).toBe(90);
    for (const [frame, time] of times.entries()) {
      const offset = frame * 64 * 64 * 3;
      for (let i = 0; i < oldFinal.length; i++) if (oldFinal[i] && time < 2000) expect(decoded.stdout[offset + i * 3], `frame=${frame}, pixel=${i}`).toBeGreaterThan(180);
      const center = offset + (13 * 64 + 13) * 3;
      if (time >= 2000) expect(decoded.stdout[center]).toBeLessThan(30);
      expect(decoded.stdout[offset]).toBeGreaterThan(230);
    }
  });

  it("rejects binding/resource tampering and keeps already compiled bytes immutable", async () => {
    const { root, layer, media, template, preset } = await frozenFixture();
    const compiler = new TemplateCompiler();
    const options = { ffmpegPath: ffmpegBin, fontResolver: { resolve: async () => null }, textFilePath: (id: string) => path.join(root, `${id}.txt`), threads: 1 };
    const compiled = await compiler.compile(template, media, preset, options);
    const png = await readFile(layer.assetPath);
    expect(compiled.binaryFiles![0].content.equals(png)).toBe(true);
    await writeFile(layer.assetPath, "changed after compile");
    expect(compiled.binaryFiles![0].content.equals(png)).toBe(true);
    await expect(compiler.compile(template, media, preset, options)).rejects.toThrow("UNSAFE");
    await writeFile(layer.assetPath, png);
    await expect(compiler.compile(template, { ...media, fingerprint: "changed" }, preset, options)).rejects.toThrow("UNSAFE");
    await expect(compiler.compile(template, media, { ...preset, frameRateMode: "30" }, options)).rejects.toThrow("UNSAFE");
    for (const mutate of [
      (copy: typeof template) => { copy.layers[0].x = 0.01; },
      (copy: typeof template) => { copy.layers[0].cover!.opaqueBackground = true; },
      (copy: typeof template) => { copy.layers[0].cover!.motion!.endMs = 2100; },
      (copy: typeof template) => { copy.layers[0].visible = false; },
    ]) { const copy = structuredClone(template); mutate(copy); expect(EditTemplateSchema.safeParse(copy).success).toBe(false); }
    const changed = structuredClone(template); changed.layers[0].cover!.shapeMatched!.radiusPx++;
    await expect(compiler.compile(changed, media, preset, options)).rejects.toThrow("UNSAFE");
    const fakeSafety = structuredClone(template) as any; fakeSafety.layers[0].cover.shapeMatched.contentSafety = "PASS";
    expect(EditTemplateSchema.safeParse(fakeSafety).success).toBe(false);
  });

  it("preserves half-open timing when actual 24fps source pixels are converted to padded 720p/30fps", async () => {
    const { root, store, request } = await fixture(128, 24);
    request.candidates = [request.candidates[2]];
    request.outputSettings.push({ id: "720", settings: { ...settings, resolutionMode: "720p", frameRateMode: "30" } });
    for (const target of request.intendedTargets) {
      target.range = { startMs: 517, endMs: 2034 };
      target.placements.push({ outputSettingId: "720", rectangle: { x: 314, y: 34, width: 210, height: 210 } });
    }
    const frozen = await freezeShapeCoverCandidate(request, request.candidates[0].id, store, path.join(root, "frozen"), mediaTools);
    expect(frozen, JSON.stringify(frozen)).toMatchObject({ status: "PASS" });
    if (frozen.status !== "PASS") throw new Error("freeze failed");
    expect(frozen.layers).toHaveLength(4);
    const target = request.intendedTargets[0];
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: target.sourcePath, displayName: "24fps", fingerprint: target.source.fingerprint,
      sizeBytes: target.source.byteLength, durationMs: target.source.durationMs, width: 128, height: 128, rotation: 0, probeStatus: "ready", importedAt: now() };
    const queue = new ExportQueue({ ffmpeg: new FfmpegAdapter(ffmpegBin, ffprobeBin), jobStore: new JobStore(path.join(root, "jobs")), sourceKnowledgeStore: store,
      fontResolver: { resolve: async () => null }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
    const head = (await store.readHead(target.source))!;
    const sourceMask = decodeSourceMask(head.revision.candidate.facts.targets[0].segments[0].mask!, target.source)!;
    for (const cell of frozen.layers.filter(item => item.intendedTargetId === target.id)) {
      const binding = cell.layer.cover!.shapeMatched!, size = binding.projection;
      const oldFinal = projectSourceMask(sourceMask, target.source, size)!;
      let left = size.width, right = 0, top = size.height, bottom = 0;
      for (let i = 0; i < oldFinal.length; i++) if (oldFinal[i]) {
        const x = i % size.width, y = Math.floor(i / size.width);
        left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      }
      const preview = await queue.renderPreview({ template: { ...createDefaultTemplate(), layers: [cell.layer] }, media,
        preset: { ...DEFAULT_PRESET, ...binding.settings }, cacheDirectory: path.join(root, "previews"), signal: new AbortController().signal });
      const pts = spawnSync(ffprobeBin, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", preview]);
      expect(pts.status).toBe(0);
      const times: number[] = JSON.parse(pts.stdout.toString()).frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time) * 1000);
      expect(times).toHaveLength(binding.settings.frameRateMode === "30" ? 90 : 72);
      expect(checkOutputFrameCoverage(times, [target.range], [cell.layer.cover!.motion!])).toEqual({ status: "PASS" });
      const width = right - left, height = bottom - top;
      const rgb = spawnSync(ffmpegBin, ["-v", "error", "-threads", "1", "-i", preview, "-vf", `crop=${width}:${height}:${left}:${top}:exact=1`,
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
      expect(rgb.status, rgb.stderr.toString()).toBe(0);
      expect(rgb.stdout.length).toBe(times.length * width * height * 3);
      for (const [frame, time] of times.entries()) {
        const offset = frame * width * height * 3;
        if (time >= binding.range.startMs && time < binding.range.endMs) for (let i = 0; i < width * height; i++) expect(rgb.stdout[offset + i * 3], `setting=${cell.outputSettingId}, frame=${frame}, pixel=${i}`).toBeGreaterThan(180);
        else expect(rgb.stdout[offset + (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3]).toBeLessThan(30);
      }
    }
  });

  it.each(["failure", "cancel", "write-failure"])("cleans task PNG copies after preview %s", async outcome => {
    const { root, store, layer, media, template, preset } = await frozenFixture();
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
    const controller = new AbortController();
    const cancel = vi.fn(async () => undefined);
    let copy: Buffer | undefined;
    vi.spyOn(ffmpeg, "run").mockImplementation(args => ({
      process: {} as any, cancel, promise: (async () => {
        const copiedPath = args[args.lastIndexOf("-i") + 1];
        copy = await readFile(copiedPath);
        if (outcome === "cancel") controller.abort();
        return { code: 1, stdout: "", stderr: "fixture failure" };
      })(),
    }));
    const compiler = new TemplateCompiler();
    if (outcome === "write-failure") {
      const compile = compiler.compile.bind(compiler);
      vi.spyOn(compiler, "compile").mockImplementation(async (...args) => {
        const result = await compile(...args);
        result.binaryFiles![0].path = path.join(root, "missing-directory", "shape.png");
        return result;
      });
    }
    const queue = new ExportQueue({ ffmpeg, compiler, jobStore: new JobStore(path.join(root, "jobs")), sourceKnowledgeStore: store, fontResolver: { resolve: async () => null } });
    const cacheDirectory = path.join(root, "previews");
    await expect(queue.renderPreview({ template, media, preset, cacheDirectory, signal: controller.signal })).rejects.toThrow();
    if (outcome !== "write-failure") expect(copy?.equals(await readFile(layer.assetPath))).toBe(true);
    else expect(copy).toBeUndefined();
    expect(await readdir(cacheDirectory)).toEqual([]);
    expect(cancel).toHaveBeenCalledTimes(outcome === "cancel" ? 1 : 0);
  });

  it("blocks enqueue, sample publication, approval replay and recovered execution until safety admission", async () => {
    const { root, media, template, preset } = await frozenFixture();
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin), jobStore = new JobStore(path.join(root, "jobs"));
    const run = vi.spyOn(ffmpeg, "run");
    const queue = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
    const input = { template, mediaIds: [media.id], mediaItems: [media], preset, outputDirectory: path.join(root, "exports") };
    await expect(queue.createBatch(input)).rejects.toThrow("UNSAFE");
    await expect(queue.createBatch({ ...input, submission: { submissionId: crypto.randomUUID(), mediaId: media.id, version: 1, bindingDigest: "0".repeat(64) } })).rejects.toThrow("UNSAFE");
    await expect(queue.publishApprovedSample({ template, media, preset, samplePath: path.join(root, "fake.mp4"), outputDirectory: input.outputDirectory })).rejects.toThrow("UNSAFE");
    expect(await jobStore.loadAll()).toEqual([]);
    // Simulate a persisted task created by an older/experimental writer.
    const legacy = await queue.createBatch({ ...input, template: createDefaultTemplate() });
    const state = queue.snapshot().batches[0];
    state.batch.templateSnapshot = template;
    await jobStore.save(state);
    const recovered = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
    await recovered.recover();
    recovered.setMediaLookup(() => media);
    await recovered.retry([legacy.tasks[0].id]);
    expect(recovered.snapshot().batches[0].batch.tasks[0]).toMatchObject({ status: "failed", errorCode: "input_invalid" });
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(input.outputDirectory)).toEqual([]);
  });

  it("requires current canonical knowledge both before and after preview rendering", async () => {
    const { root, store, media, template, preset } = await frozenFixture();
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin), jobStore = new JobStore(path.join(root, "jobs"));
    const run = vi.spyOn(ffmpeg, "run");
    const input = { template, media, preset, cacheDirectory: path.join(root, "previews"), signal: new AbortController().signal };
    const missing = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
    await expect(missing.renderPreview(input)).rejects.toThrow("UNSAFE");
    const queue = new ExportQueue({ ffmpeg, jobStore, sourceKnowledgeStore: store, fontResolver: { resolve: async () => null } });
    const readHead = store.readHead.bind(store);
    const spy = vi.spyOn(store, "readHead").mockImplementation(async source => {
      const head = (await readHead(source))!;
      return { ...head, revision: { ...head.revision, id: "new-head" } };
    });
    await expect(queue.renderPreview(input)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    let calls = 0;
    spy.mockImplementation(async source => {
      const head = (await readHead(source))!;
      return ++calls === 1 ? head : { ...head, revision: { ...head.revision, id: "new-head" } };
    });
    await expect(queue.renderPreview(input)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    expect(await readdir(input.cacheDirectory)).toEqual([]);
    expect(await jobStore.loadAll()).toEqual([]);
  });

  it("cleans only its own published operation on late cancellation", async () => {
    const { root, store, request } = await fixture();
    request.candidates = [request.candidates[2]];
    const destination = path.join(root, "frozen");
    await mkdir(destination); await writeFile(path.join(destination, "keep.txt"), "other owner");
    const readAsset = alphaMedia.readShapeCoverAsset;
    let calls = 0;
    const controller = new AbortController();
    vi.spyOn(alphaMedia, "readShapeCoverAsset").mockImplementation(async (...args) => {
      const bytes = await readAsset(...args);
      if (++calls === 4) controller.abort();
      return bytes;
    });
    expect(await freezeShapeCoverCandidate(request, request.candidates[0].id, store, destination, { ...mediaTools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", layers: [] });
    expect(calls).toBe(4);
    expect(await readdir(destination)).toEqual(["keep.txt"]);
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("other owner");
  });

  it("returns no layers on stale masks, wrong selection, changed PNG round-trip or cancellation", async () => {
    const { root, store, request } = await fixture();
    const destination = path.join(root, "frozen");
    expect(await freezeShapeCoverCandidate(request, request.candidates[0].id, store, destination, mediaTools)).toMatchObject({ status: "UNSAFE", layers: [] });
    const decode = alphaMedia.decodeShapeCoverPng;
    const spy = vi.spyOn(alphaMedia, "decodeShapeCoverPng").mockImplementation(async (...args) => { const rgba = await decode(...args); rgba[0] ^= 1; return rgba; });
    expect(await freezeShapeCoverCandidate(request, request.candidates[2].id, store, destination, mediaTools)).toMatchObject({ status: "UNSAFE", layers: [] });
    spy.mockRestore();
    const controller = new AbortController();
    const encode = alphaMedia.encodeShapeCoverPng;
    vi.spyOn(alphaMedia, "encodeShapeCoverPng").mockImplementation(async (...args) => { const png = await encode(...args); controller.abort(); return png; });
    expect(await freezeShapeCoverCandidate(request, request.candidates[2].id, store, destination, { ...mediaTools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", layers: [] });
    expect(await readdir(root)).not.toContain("frozen");
    request.intendedTargets[1].revisionId = "stale";
    expect(await freezeShapeCoverCandidate(request, request.candidates[2].id, store, destination, mediaTools)).toMatchObject({ status: "UNSAFE", layers: [] });
  });
});

async function fixture(sourceSize = 64, fps = 30) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-common-shape-")); roots.push(root);
  const store = await SourceStickerKnowledgeStore.open(root); stores.push(store);
  const targets: ShapeCoverCandidateRequest["intendedTargets"] = [];
  const sheet = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
  for (const [index, x] of [10, 26].entries()) {
    const sourcePath = path.join(root, `source-${index}.mp4`);
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", `color=c=white:s=${sourceSize}x${sourceSize}:r=${fps}:d=3`,
      "-vf", `drawbox=x=${x}:y=10:w=8:h=8:color=black:t=fill`, "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", sourcePath]).status).toBe(0);
    const sourceBytes = await readFile(sourcePath), packedMask = Buffer.alloc(8, 255);
    const probe = { status: "CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW", reason: null, sourceSha256: sha(sourceBytes), sourceBytes: sourceBytes.length,
      decodedSize: [sourceSize, sourceSize], roi: [0, 0, sourceSize, sourceSize], fps, frameRange: [0, 60], decodedFrames: 60, sampleFrames: [0, 2, 4, 58],
      method: "temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1",
      temporalCore: { checkedFrames: 60, worst: { meanMaxChannelDifference: 0 }, limit: 40 },
      mask: { bboxHalfOpen: [x, 10, x + 8, 18], size: [8, 8], markedPixels: 64, packedFormat: "bitpack-lsb-row-major-v1", packedBytes: 8, packedSha256: sha(packedMask) },
      edgeSheet: { frames: Array.from({ length: 60 }, (_, i) => i), sha256: sha(sheet) } };
    const probeReport = Buffer.from(JSON.stringify(probe));
    const reviewReceipt = Buffer.from(JSON.stringify({ version: 1, decision: "PASS", reviewer: "test-human", at: "2026-09-27T00:00:00Z",
      sourceSha256: probe.sourceSha256, maskSha256: sha(packedMask), probeSha256: sha(probeReport), contactSheetSha256: sha(sheet),
      frameRange: [0, 60], reviewedFrames: 60, edge: "conservative", temporal: "stable", presence: "verified" }));
    const { source, revision } = await admitReviewedSourceMask({ sourcePath, store, packedMask, probeReport, reviewReceipt, contactSheet: sheet, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
    targets.push({ id: `intended-${index}`, sourcePath, source, revisionId: revision.id, targetId: "static-sticker", segmentId: "static-segment",
      range: { startMs: 0, endMs: 2000 }, placements: [{ outputSettingId: "source", rectangle: { ...placement } }] });
  }
  const candidates: ShapeCoverCandidateRequest["candidates"] = [];
  for (const kind of ["left", "right", "full", "partial", "empty"] as const) {
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      pixels[i] = 255;
      pixels[i + 3] = kind === "empty" ? 0 : kind === "partial" ? 128 : kind === "left" && x >= 16 || kind === "right" && x < 16 ? 0 : 255;
    }
    const assetPath = path.join(root, `${kind}.png`);
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "32x32", "-i", "pipe:0", "-frames:v", "1", "-threads", "1", assetPath], { input: pixels }).status).toBe(0);
    const fingerprint = sha(await readFile(assetPath));
    candidates.push({ id: `uploaded-${fingerprint}`, asset: { assetPath, assetFingerprint: `sha256:${fingerprint}` } });
  }
  return { root, store, request: { intendedTargets: targets, outputSettings: [{ id: "source", settings }], candidates } satisfies ShapeCoverCandidateRequest };
}
const tools = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" };

describe.skipIf(!available)("M4-B4 original production entry", () => {
  async function productionFixture() {
    const value = await fixture();
    value.request.candidates = value.request.candidates.slice(0, 3);
    const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
    const font = await resolveFont("Noto Sans CJK SC");
    if (!font) throw new Error("real FFmpeg text fixture requires font");
    const service = new ApplicationService(ffmpeg, { resolve: async () => font });
    const media: MediaItem[] = value.request.intendedTargets.map(target => ({ id: crypto.randomUUID(), sourcePath: target.sourcePath, displayName: target.id,
      fingerprint: target.source.fingerprint, sizeBytes: target.source.byteLength, width: target.source.width, height: target.source.height,
      rotation: target.source.rotation, durationMs: target.source.durationMs, probeStatus: "ready", importedAt: now() }));
    service.currentProject.mediaItems.push(...media);
    service.currentProject.coverSticker = { enabled: true, trackingMode: "agent", stickerIds: [], rectangle: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } };
    const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(value.root, "production-jobs")), sourceKnowledgeStore: value.store,
      fontResolver: { resolve: async () => font }, executionLimits: { analysis: 2, exports: 2, threads: 1 } });
    const assets = Object.fromEntries(value.request.candidates.map(candidate => [candidate.id, candidate.asset])) as StickerAssets;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, undefined, undefined, undefined, undefined, value.store);
    controller.provider.configure({ apiKey: "unused-mock-only", model: "simulated-creative", baseUrl: "https://example.test/v1" });
    controller.reviewerProvider.configure({ apiKey: "unused-mock-only", model: "simulated-independent", baseUrl: "https://example.test/v1" });
    const frames = vi.spyOn(agentFrames, "extractAgentFrames").mockResolvedValue([]);
    const rule = getRule("clean");
    const plan = vi.spyOn(controller.provider, "plan").mockResolvedValue({ summary: "mock creative", captions: [], filter: rule.filters[0], intensity: rule.minIntensity });
    const shortlist = vi.spyOn(controller.provider, "shortlist").mockImplementation(async (_rule, _brief, _frames, _signal, catalog) => {
      expect(catalog!.stickers.map(sticker => sticker.id)).toEqual([value.request.candidates[2].id]);
      return [catalog!.stickers[0].id];
    });
    const safe = async (context: ShapeCoverReviewInput) => JSON.stringify({ action: "pass", reason: "simulated independent production fixture",
      contentSafety: { face: "SAFE", hands: "SAFE", product: "SAFE", subtitles: "SAFE" },
      evidenceIds: [...new Set(context.evidence.flatMap(image => [image.sourceEvidenceId!, image.previewEvidenceId!, ...image.fullSourceEvidenceId ? [image.fullSourceEvidenceId] : []]))] });
    const review = vi.spyOn(controller.reviewerProvider, "superviseShapePreview").mockImplementation(safe);
    const createBatch = vi.spyOn(queue, "createBatch");
    const publish = vi.spyOn(queue, "publishApprovedSample");
    const outputDirectory = path.join(value.root, "production-outputs"); await mkdir(outputDirectory);
    const input = { ruleId: "clean" as const, brief: "", mediaIds: media.map(item => item.id), outputDirectory, exportSettings: { ...settings },
      decorations: { mode: "manual" as const, productPrice: "手动展示", sticker: "none", fontFamily: "Noto Sans CJK SC" } };
    const start = async (multiplier = 1) => {
      await controller.startShapeMatched({ ...input, multiplier }, new Set([outputDirectory]), value.request);
      await vi.waitFor(() => expect(controller.busy).toBe(false), { timeout: 60_000, interval: 50 });
    };
    return { ...value, ffmpeg, service, media, queue, controller, frames, plan, shortlist, review, safe, createBatch, publish, input, start };
  }

  it("intersects the whole round before selection, independently admits every version and publishes the same bytes", async () => {
    const value = await productionFixture();
    try {
      await value.start(2);
      expect(value.controller.snapshot()?.items.map(item => item.status), JSON.stringify(value.controller.snapshot())).toEqual(["exporting", "exporting", "exporting", "exporting"]);
      expect(value.shortlist).toHaveBeenCalledTimes(2);
      expect(value.review).toHaveBeenCalledTimes(4);
      expect(value.createBatch).not.toHaveBeenCalled();
      expect(value.publish).toHaveBeenCalledTimes(4);
      const batches = value.queue.snapshot().batches;
      expect(batches).toHaveLength(4);
      expect(new Set(value.publish.mock.calls.map(([input]) => input.shapeAdmission)).size).toBe(4);
      for (const { batch } of batches) {
        const task = batch.tasks[0]; expect(task.status).toBe("completed");
        const run = value.controller.snapshot()!, item = run.items.find(item => item.taskId === task.id)!;
        const samplePath = await value.controller.previewPath(run.id, item.id);
        expect(await readFile(task.outputPath!)).toEqual(await readFile(samplePath));
        expect(batch.templateSnapshot.layers.filter(layer => layer.type === "text").map(layer => layer.content)).toEqual(["手动展示"]);
        const shape = batch.templateSnapshot.layers.find(layer => layer.type === "sticker" && layer.cover?.shapeMatched);
        expect(shape).toMatchObject({ cover: { stickerId: value.request.candidates[2].id, selection: { runId: run.id, round: item.version }, shapeMatched: { contentSafety: "NOT_EVALUATED" } } });
        await expect(value.queue.createBatch({ template: batch.templateSnapshot, mediaIds: batch.mediaIds, mediaItems: value.media, preset: batch.preset, outputDirectory: value.input.outputDirectory })).rejects.toThrow("UNSAFE");
      }
    } finally { await value.controller.cancel(); await value.queue.shutdown(); }
  }, 60_000);

  it.each(["missing-target", "missing-mask", "empty-common", "setting", "range", "asset"])("rejects %s before any creative or reviewer invocation", async fault => {
    const value = await productionFixture();
    try {
      if (fault === "missing-target") value.request.intendedTargets.pop();
      if (fault === "missing-mask") value.request.intendedTargets[1].segmentId = "missing";
      if (fault === "empty-common") value.request.candidates.pop();
      if (fault === "setting") value.request.outputSettings[0].settings.quality = "high";
      if (fault === "range") value.request.intendedTargets[1].range.endMs = 1000;
      if (fault === "asset") value.request.candidates[0].asset = { ...value.request.candidates[0].asset, assetPath: path.join(value.root, "foreign.png") };
      if (fault === "asset") await expect(value.start()).rejects.toThrow("UNSAFE");
      else { await value.start(); expect(value.controller.snapshot()?.items.every(item => item.status === "failed" && item.error?.includes("UNSAFE"))).toBe(true); }
      expect(value.frames).not.toHaveBeenCalled(); expect(value.shortlist).not.toHaveBeenCalled();
      expect(value.plan).not.toHaveBeenCalled(); expect(value.review).not.toHaveBeenCalled(); expect(value.publish).not.toHaveBeenCalled();
    } finally { await value.controller.cancel(); await value.queue.shutdown(); }
  }, 30_000);

  it.each(["selection", "source-drift", "unknown", "cancel"])("does not publish a version after %s", async fault => {
    const value = await productionFixture();
    try {
      if (fault === "selection") value.shortlist.mockResolvedValue([value.request.candidates[0].id]);
      if (fault === "source-drift") value.shortlist.mockImplementation(async () => {
        await writeFile(value.media[0].sourcePath, "changed source"); return [value.request.candidates[2].id];
      });
      if (fault === "unknown") value.review.mockImplementation(async context => {
        const result = JSON.parse(await value.safe(context)); result.contentSafety.hands = "UNKNOWN"; return JSON.stringify(result);
      });
      if (fault === "cancel") value.review.mockImplementation(async context => { void value.controller.cancel(); return value.safe(context); });
      await value.start();
      expect(value.controller.snapshot()?.items.every(item => fault === "cancel" ? item.status === "cancelled" : item.status === "failed")).toBe(true);
      if (fault === "unknown" || fault === "cancel") expect(value.review).toHaveBeenCalled();
      expect(value.publish).not.toHaveBeenCalled(); expect(value.createBatch).not.toHaveBeenCalled(); expect(value.queue.snapshot().batches).toEqual([]);
    } finally { await value.controller.cancel(); await value.queue.shutdown(); }
  }, 60_000);
});

describe.skipIf(!available)("whole-round shape candidate geometry", () => {
  it("uses real alpha and intersects every intended target rather than the first", async () => {
    const { store, request } = await fixture();
    const first = await computeCommonShapeCoverCandidates({ ...request, intendedTargets: request.intendedTargets.slice(0, 1) }, store, tools);
    expect(first.commonSafeCandidateIds, JSON.stringify(first)).toContain(request.candidates[0].id);
    const round = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(round).toMatchObject({ status: "PASS", verification: "geometry-only", contentSafety: "NOT_EVALUATED", commonSafeCandidateIds: [request.candidates[2].id] });
    expect(round.evaluations).toHaveLength(10);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[0].id).map(cell => cell.verdict.status)).toEqual(["PASS", "UNSAFE"]);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[1].id).map(cell => cell.verdict.status)).toEqual(["UNSAFE", "PASS"]);
    expect(round.evaluations.filter(cell => cell.candidateId === request.candidates[3].id || cell.candidateId === request.candidates[4].id).every(cell => cell.verdict.status === "UNSAFE")).toBe(true);
    expect(round.evaluations[0]).toMatchObject({ sourceRevisionId: request.intendedTargets[0].revisionId, outputSettingId: "source", placement, rasterVersion: "ffmpeg-bicubic-contain-rgba-v1" });
    expect(round.evaluations[0].alphaSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns UNSAFE for an empty intersection even though each target has a candidate", async () => {
    const { store, request } = await fixture();
    const result = await computeCommonShapeCoverCandidates({ ...request, candidates: request.candidates.slice(0, 2) }, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", reason: "no-common-candidate", commonSafeCandidateIds: [] });
    expect(result.evaluations.filter(cell => cell.verdict.status === "PASS")).toHaveLength(2);
  });

  it.each(["target", "segment", "range", "revision", "identity", "placement"])("rejects a missing or mismatched intended %s before enumerating assets", async change => {
    const { store, request } = await fixture();
    const target = request.intendedTargets[1];
    if (change === "target") target.targetId = "missing";
    if (change === "segment") target.segmentId = "missing";
    if (change === "range") target.range.endMs = 2500;
    if (change === "revision") target.revisionId = "stale";
    if (change === "identity") target.source = { ...target.source, interpretationVersion: 2 };
    if (change === "placement") target.placements = [];
    const opened = vi.spyOn(store, "verifySource");
    const assetRead = vi.spyOn(alphaMedia, "readShapeCoverAsset");
    const result = await computeCommonShapeCoverCandidates({ ...request, candidates: [{ id: request.candidates[2].id, asset: { ...request.candidates[2].asset, assetPath: "must-not-be-read.png" } }] }, store, tools);
    expect(result.status).toBe("UNSAFE");
    expect(result.commonSafeCandidateIds).toEqual([]);
    expect(result.evaluations).toEqual([]);
    expect(assetRead).not.toHaveBeenCalled();
    if (change !== "placement") expect(opened).toHaveBeenCalled();
  });

  it("rejects changed source bytes and stored review evidence", async () => {
    const { root, store, request } = await fixture();
    const first = request.intendedTargets[0];
    const original = await readFile(first.sourcePath);
    await writeFile(first.sourcePath, "changed source");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).status).toBe("UNSAFE");
    await writeFile(first.sourcePath, original);
    const key = (await store.readHead(first.source))!.revision.sourceKey;
    const events = path.join(store.directory, "sources", key, "events");
    const [event] = await readdir(events), evidenceDir = path.join(events, event, "evidence");
    const [blob] = await readdir(evidenceDir); await writeFile(path.join(evidenceDir, blob), "changed evidence");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).evaluations).toEqual([]);
    expect(await readdir(root)).toContain("source-0.mp4");
  });

  it("binds every output setting and does not reuse a source-size PASS at 720p", async () => {
    const { store, request } = await fixture(128);
    request.candidates = [request.candidates[2]];
    request.outputSettings.push({ id: "720", settings: { ...settings, resolutionMode: "720p", frameRateMode: "30" } });
    for (const target of request.intendedTargets) target.placements.push({ outputSettingId: "720", rectangle: { ...placement } });
    const result = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", reason: "no-common-candidate", commonSafeCandidateIds: [] });
    expect(result.evaluations.filter(cell => cell.outputSettingId === "source").every(cell => cell.verdict.status === "PASS")).toBe(true);
    expect(result.evaluations.filter(cell => cell.outputSettingId === "720").every(cell => cell.verdict.status === "UNSAFE" && cell.verdict.reason === "no-shape-match")).toBe(true);
    expect(result.evaluations.find(cell => cell.outputSettingId === "720")?.projection).toMatchObject({ width: 1280, height: 720, scaledWidth: 720, scaledHeight: 720, padLeft: 280, padTop: 0 });
    for (const target of request.intendedTargets) target.placements[1].rectangle = { x: 314, y: 34, width: 210, height: 210 };
    const corrected = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(corrected).toMatchObject({ status: "PASS", commonSafeCandidateIds: [request.candidates[0].id] });
    expect(corrected.evaluations).toHaveLength(4);
    expect(corrected.evaluations.every(cell => cell.verdict.status === "PASS" && cell.verdict.uncoveredPixels === 0)).toBe(true);
  });

  it("rejects corrupt assets, duplicate IDs, invalid geometry and cancellation", async () => {
    const { store, request } = await fixture();
    request.candidates = [request.candidates[2]];
    await writeFile(request.candidates[0].asset.assetPath, "changed asset");
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).commonSafeCandidateIds).toEqual([]);
    expect((await computeCommonShapeCoverCandidates({ ...request, intendedTargets: [request.intendedTargets[0], request.intendedTargets[0]] }, store, tools)).evaluations).toEqual([]);
    request.intendedTargets[0].placements[0].rectangle.x = -1;
    expect((await computeCommonShapeCoverCandidates(request, store, tools)).evaluations).toEqual([]);
    const controller = new AbortController(); controller.abort();
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });

  it("fences a changed head, source, asset or cancellation during evaluation", async () => {
    const { store, request } = await fixture();
    request.candidates = [request.candidates[2]];
    const readHead = store.readHead.bind(store);
    let calls = 0;
    const spy = vi.spyOn(store, "readHead").mockImplementation(async source => {
      const head = await readHead(source);
      return ++calls > request.intendedTargets.length && head ? { ...head, revision: { ...head.revision, id: "new-revision" } } : head;
    });
    const stale = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(stale.evaluations.every(cell => cell.verdict.status === "PASS")).toBe(true);
    expect(stale).toMatchObject({ status: "UNSAFE", reason: "round-invalid-or-stale", commonSafeCandidateIds: [] });
    spy.mockRestore();
    const rasterize = alphaMedia.rasterizeShapeCoverAlpha;
    const originalSource = await readFile(request.intendedTargets[0].sourcePath);
    const sourceSpy = vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args);
      await writeFile(request.intendedTargets[0].sourcePath, "changed during evaluation");
      return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, tools)).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    sourceSpy.mockRestore(); await writeFile(request.intendedTargets[0].sourcePath, originalSource);
    const originalAsset = await readFile(request.candidates[0].asset.assetPath);
    const rasterSpy = vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args);
      await writeFile(request.candidates[0].asset.assetPath, "changed after frozen read");
      return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, tools)).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    rasterSpy.mockRestore(); await writeFile(request.candidates[0].asset.assetPath, originalAsset);
    const controller = new AbortController();
    vi.spyOn(alphaMedia, "rasterizeShapeCoverAlpha").mockImplementation(async (...args) => {
      const result = await rasterize(...args); controller.abort(); return result;
    });
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, signal: controller.signal })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });

  it("rejects actual animated pixels and cannot turn a decode/tool failure into a rectangle", async () => {
    const { root, store, request } = await fixture();
    const assetPath = path.join(root, "animated.gif");
    expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc=s=32x32:r=2:d=1", "-frames:v", "2", "-threads", "1", assetPath]).status).toBe(0);
    request.candidates = [{ id: "heart", asset: { assetPath, assetFingerprint: `sha256:${sha(await readFile(assetPath))}` } }];
    const result = await computeCommonShapeCoverCandidates(request, store, tools);
    expect(result).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
    expect(result.evaluations.every(cell => cell.verdict.status === "UNSAFE" && cell.verdict.reason === "asset-unusable")).toBe(true);
    expect(await computeCommonShapeCoverCandidates(request, store, { ...tools, ffprobePath: path.join(root, "missing-ffprobe") })).toMatchObject({ status: "UNSAFE", commonSafeCandidateIds: [] });
  });
});
