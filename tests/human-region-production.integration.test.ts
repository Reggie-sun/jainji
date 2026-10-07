import { randomUUID } from "node:crypto";
import { mkdtemp, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { ApplicationService } from "../src/main/application";
import { AgentController } from "../src/main/agent-controller";
import { CoverReviewController } from "../src/main/cover-review-controller";
import { CoverReviewEvidence } from "../src/main/cover-review-evidence";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { EditTemplateSchema, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { encodeRgbaPng, type StickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";
import { verifyHumanRegionTemplate, assertHumanRegionIntent } from "../src/main/human-region-render";
import { TemplateCompiler } from "../src/main/compiler";
import { createHumanRegionCover } from "../src/main/human-region-cover";
import type { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";

it.each([0, 0.4])("takes human region at %s through local preparation, approval, immutable export and replay", async (origin) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-human-region-production-")), root = path.join(directory, "review");
  const sourcePath = path.join(directory, "source.mp4"), assetPath = path.join(directory, "art.png");
  const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin), fontResolver = { resolve: async () => null };
  const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=24", "-f", "lavfi", "-i", "sine=f=440", "-t", "1", "-c:v", "libx264", "-c:a", "aac", sourcePath]).promise;
  expect(generated.code, generated.stderr).toBe(0);
  const pixels = Buffer.alloc(40 * 40 * 4);
  // Rounded opaque artwork with transparent corners, unlike a white rectangle fallback.
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.hypot(x - 19.5, y - 19.5) < 19) pixels.set([240, 30, 40, 255], (y * 40 + x) * 4);
  await writeFile(assetPath, encodeRgbaPng(pixels, 40, 40));
  const assetFingerprint = await fingerprintFile(assetPath), stickerId = `uploaded-${assetFingerprint.slice(7)}`;
  const assets = { [stickerId]: { assetPath, assetFingerprint } } as StickerAssets;
  const service = new ApplicationService(ffmpeg, fontResolver);
  const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "human fixture", durationMs: 1000,
    width: 160, height: 120, rotation: 0, sizeBytes: (await stat(sourcePath)).size, importedAt: now(), probeStatus: "ready" };
  service.currentProject.mediaItems.push(media);
  service.setCoverSticker({ ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "assisted", assistedArtwork: "human-region-v1" });
  await service.saveProject(path.join(directory, "fixture.jianji"));
  const jobStore = new JobStore(path.join(directory, "jobs"));
  const queue = new ExportQueue({ ffmpeg, fontResolver, jobStore, executionLimits: { analysis: 1, exports: 1, threads: 2 } });
  const agent = new AgentController(service, queue, ffmpeg, () => {}, assets);
  const plan = vi.spyOn(agent.provider, "plan"), shortlist = vi.spyOn(agent.provider, "shortlist");
  const controller = new CoverReviewController(service, agent, queue, { root,
    extract: (m, d, signal) => new CoverReviewEvidence(path.join(root, d.projectId), ffmpeg).extract(m, d.id, d.revision, signal),
    verify: (id, evidence) => new CoverReviewEvidence(path.join(root, id), ffmpeg).verify(evidence),
    analyze: async () => { throw Error("must not analyze"); }, changed: () => {} });
  const current = () => service.currentProject.reviewDrafts![0];
  await controller.create([media.id]);
  await expect(controller.analyze(current().id, current().revision)).rejects.toThrow("不调用自动识别");
  const identity = { id: randomUUID(), label: "人工目标", semantics: "sticker" as const, origin: "human" as const };
  const segment = { id: randomUUID(), identityId: identity.id, origin: "human" as const, track: { startMs: 250, endMs: 750,
    keyframes: [{ timeMs: 250, rectangle: { x: origin, y: origin, width: .1, height: .1 } }] } };
  const ref = () => ({ projectId: current().projectId, draftId: current().id, expectedRevision: current().revision, mediaId: media.id });
  await controller.edit({ ...ref(), type: "put_segment", identity, segment });
  await controller.edit({ ...ref(), type: "confirm_geometry" });
  const input = { ruleId: "clean" as const, brief: "", mediaIds: [media.id], multiplier: 2, outputDirectory: directory,
    exportSettings: { resolutionMode: "source" as const, frameRateMode: "source" as const, quality: "balanced" as const },
    decorations: { mode: "manual" as const, sticker: "none", fontFamily: "Noto Sans CJK SC", displayText: { enabled: false, x: .5, y: .1 } } };
  await controller.prepare(current().id, current().revision, input, new Set([directory]));
  expect(plan).not.toHaveBeenCalled(); expect(shortlist).not.toHaveBeenCalled();
  expect(current().status).toBe("awaiting_approval"); expect(current().frozen).toHaveLength(2);
  expect(queue.snapshot().batches).toHaveLength(0);
  const template = EditTemplateSchema.parse(JSON.parse(current().frozen[0].templateJson));
  const layer = template.layers.find(l => l.type === "sticker" && l.cover?.humanRegion)!;
  expect(layer.type === "sticker" && layer.cover?.opaqueBackground).toBeUndefined();
  const preset = { ...DEFAULT_PRESET, ...input.exportSettings };
  const revised = structuredClone(current()); revised.revision++;
  expect(() => assertHumanRegionIntent(revised, template, media.id)).toThrow("修订");
  await expect(queue.verifyHumanRegions(template, { ...media, fingerprint: "sha256:" + "0".repeat(64) }, preset)).rejects.toThrow();
  await expect(queue.verifyHumanRegions(template, media, { ...preset, resolutionMode: "720p" })).rejects.toThrow();
  const compiled = await new TemplateCompiler().compile(template, media, preset, { ffmpegPath: ffmpegBin, fontResolver, textFilePath: id => path.join(directory, id) });
  expect(compiled.binaryFiles).toHaveLength(1);
  expect(compiled.args.join(" ")).toContain("gte(t,0.25)*lt(t,0.75)");
  await expect(queue.createBatch({ projectId: current().projectId, template, mediaIds: [media.id], mediaItems: [media], preset, outputDirectory: directory })).rejects.toThrow("已批准");
  await expect(controller.approve(current().id, current().revision, input, new Set([directory]))).rejects.toThrow("全部版本");
  await controller.viewed(current().id, current().revision, media.id, 1);
  await expect(controller.approve(current().id, current().revision, input, new Set([directory]))).rejects.toThrow("全部版本");
  await controller.viewed(current().id, current().revision, media.id, 2);
  await controller.approve(current().id, current().revision, input, new Set([directory]));
  for (const { batch } of queue.snapshot().batches) await queue.start(batch.id);
  await vi.waitFor(() => expect(queue.snapshot().batches.map(s => s.batch.tasks[0].status)).toEqual(["completed", "completed"]), { timeout: 20_000 });
  const output = queue.snapshot().batches[0].batch.tasks[0].outputPath!;
  expect((await ffmpeg.probe(output)).streams?.some(s => s.codec_type === "audio")).toBe(true);
  // Real decoded output proves the declared half-open time range and absence of a rectangle fill.
  const rgb = async (time: string) => { const file = path.join(directory, `${time}.rgb`); const result = await runCommand(ffmpegBin, ["-v", "error", "-ss", time, "-i", output, "-frames:v", "1", "-vf", `crop=1:1:${Math.round((origin + .05) * 160)}:${Math.round((origin + .05) * 120)}:exact=1,format=rgb24`, "-f", "rawvideo", file]).promise; expect(result.code).toBe(0); return readFile(file); };
  const before = await rgb("0.1"), during = await rgb("0.5"), after = await rgb("0.9");
  expect(before[2]).toBeGreaterThan(before[0] + 100); expect(during[0]).toBeGreaterThan(during[2] + 100); expect(after[2]).toBeGreaterThan(after[0] + 100);
  await controller.approve(current().id, current().revision, input, new Set([directory]));
  expect(await jobStore.loadAll()).toHaveLength(2);
  if (layer.type !== "sticker") throw Error("missing sticker");
  const original = await readFile(layer.assetPath); await writeFile(layer.assetPath, "tampered");
  await expect(verifyHumanRegionTemplate(template, media, preset, ffmpeg)).rejects.toThrow();
  await writeFile(layer.assetPath, original);
  const lookup = vi.fn().mockResolvedValue({ status: "disputed", disputeIds: ["counterexample"] });
  await expect(verifyHumanRegionTemplate(template, media, preset, ffmpeg, { lookup } as unknown as SourceStickerKnowledgeStore)).rejects.toThrow("争议");
  expect(lookup).toHaveBeenCalled();

  // Recover a persisted interrupted export using only the frozen job, with no preparation/provider instance.
  const persisted = (await jobStore.loadAll())[0], priorOutput = persisted.batch.tasks[0].outputPath!;
  const frozenJson = JSON.stringify(persisted.batch.templateSnapshot);
  persisted.batch.tasks[0].status = "interrupted";
  await jobStore.save(persisted);
  const recovered = new ExportQueue({ ffmpeg, fontResolver, jobStore, executionLimits: { analysis: 1, exports: 1, threads: 2 } });
  await recovered.recover(); await recovered.retry([persisted.batch.tasks[0].id]);
  await vi.waitFor(() => expect(recovered.snapshot().batches.find(s => s.batch.id === persisted.batch.id)!.batch.tasks[0].status).toBe("completed"), { timeout: 20_000 });
  const replay = recovered.snapshot().batches.find(s => s.batch.id === persisted.batch.id)!;
  expect(JSON.stringify(replay.batch.templateSnapshot)).toBe(frozenJson);
  expect(replay.batch.tasks[0].outputPath).not.toBe(priorOutput);
  expect((await stat(priorOutput)).size).toBeGreaterThan(0);

  if (origin === .4) {
    const secondPath = path.join(directory, "second.png"), secondPixels = Buffer.from(pixels);
    for (let p = 0; p < secondPixels.length; p += 4) secondPixels[p + 1] = 180;
    await writeFile(secondPath, encodeRgbaPng(secondPixels, 40, 40));
    const secondHash = await fingerprintFile(secondPath), secondId = `uploaded-${secondHash.slice(7)}`;
    const draft = structuredClone(current()), intent = draft.media[0];
    const otherIdentity = { ...identity, id: randomUUID() }, otherSegment = structuredClone(segment);
    otherSegment.id = randomUUID(); otherSegment.identityId = otherIdentity.id;
    otherSegment.track.keyframes[0].rectangle.x = .65;
    intent.identities.push(otherIdentity); intent.segments.push(otherSegment);
    const local = { draft, media: [media], preset, tools: ffmpeg, directory: path.join(directory, "random"), random: true };
    const prepare = createHumanRegionCover({ ...local, assets: { ...assets, [secondId]: { assetPath: secondPath, assetFingerprint: secondHash } } });
    const one = await prepare(media, 1, "test", new AbortController().signal), two = await prepare(media, 2, "test", new AbortController().signal);
    expect(new Set(one.map(l => l.cover!.stickerId)).size).toBe(2);
    expect(two.map(l => l.cover!.stickerId)).toEqual(one.map(l => l.cover!.stickerId).reverse());
    await expect(createHumanRegionCover({ ...local, assets })(media, 1, "test", new AbortController().signal)).rejects.toThrow("没有贴纸");
    await expect(createHumanRegionCover({ ...local, assets })(media, 1, "test", AbortSignal.abort())).rejects.toThrow();
    intent.disposition = "no_cover";
    expect(await createHumanRegionCover({ ...local, draft, assets: {} as StickerAssets })(media, 1, "test", new AbortController().signal)).toEqual([]);
  }
}, 120_000);
