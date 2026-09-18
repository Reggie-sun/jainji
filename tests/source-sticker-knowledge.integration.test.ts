import { copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { AgentController } from "../src/main/agent-controller";
import { FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import type { PreviewReviewInput } from "../src/main/supervisor-protocol";

it("warm reuse permits a new output size and style but requires a newly bound rendered preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-warm-style-"));
  const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe"), file = path.join(root, "source.mp4");
  expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:r=24", "-t", "1", "-c:v", "libx264", file]).promise).code).toBe(0);
  const service = new ApplicationService(ffmpeg, { resolve: resolveFont }); await service.addMedia([file]);
  const store = await SourceStickerKnowledgeStore.open(root), assets = await ensureBuiltinStickerAssets(path.join(root, "stickers"));
  const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(root, "jobs")), fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
  const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, undefined, undefined, undefined, undefined, store);
  try {
    for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://unused.invalid/v1" });
    let warm = false;
    vi.spyOn(controller.provider, "shortlist").mockResolvedValue(["heart", "sparkle"]);
    vi.spyOn(controller.provider, "plan").mockImplementation(async () => ({ summary: "fixed creative fixture", captions: [], filter: "none", intensity: 0, priceStyle: warm ? "gold" : "classic",
      stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: warm ? "sparkle" : "heart", width: 0.08, rotationDeg: 0 })) }));
    const detection = vi.spyOn(controller.visionProvider, "detectCovers").mockImplementation(async images => images.map(image => ({ timeMs: image.timeMs, targets: [] })));
    const recognition = vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async input => JSON.stringify({ action: "resolve", reason: "fixture", frames: input.proposal }));
    const preview = vi.spyOn(controller.reviewerProvider, "supervisePreview").mockResolvedValue(JSON.stringify({ action: "pass", reason: "new preview" }));
    const outputDirectory = path.join(root, "output");
    for (const mode of ["source", "720p"] as const) {
      warm = mode === "720p";
      await controller.start({ mediaIds: [service.currentProject.mediaItems[0].id], ruleId: "clean", brief: "", outputDirectory,
        decorations: { mode: "agent", productPrice: "固定手动文字", sticker: "none", fontFamily: "Noto Sans CJK SC" },
        exportSettings: { resolutionMode: mode, frameRateMode: "source", quality: "balanced" } }, new Set([outputDirectory]));
      await vi.waitFor(() => { expect(controller.busy).toBe(false); expect(controller.snapshot()?.items[0].status).toBe("exporting"); expect(queue.snapshot().batches.every(({ batch }) => batch.tasks[0].status === "completed")).toBe(true); }, { timeout: 30_000 });
    }
    const records = await store.listOutcomes(service.currentProject.id);
    expect(records.map(row => row.lookup)).toEqual(["absent", "hit"]);
    expect(records[0].revisionId).toBe(records[1].revisionId);
    expect(records[0].templateDigest).not.toBe(records[1].templateDigest);
    expect(records[0].previewEvidenceDigests).not.toEqual(records[1].previewEvidenceDigests);
    expect(detection).toHaveBeenCalledOnce(); expect(recognition).toHaveBeenCalledOnce(); expect(preview).toHaveBeenCalledTimes(2);
    const batches = queue.snapshot().batches.map(entry => entry.batch);
    expect(batches.map(batch => batch.preset.resolutionMode)).toEqual(["source", "720p"]);
    expect(batches.map(batch => batch.templateSnapshot.layers.find(layer => layer.type === "sticker")?.assetFingerprint)).toEqual([assets.heart.assetFingerprint, assets.sparkle.assetFingerprint]);
  } finally { await controller.cancel(); await store.close(); await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
}, 60_000);

it.each([false, true])("reuses or explicitly refreshes same-byte copies across projects/restart, with frozen retries (refresh=%s)", async (refresh) => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-warm-knowledge-"));
  const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe"), file = path.join(root, "source.mp4"), copy = path.join(root, "renamed.mp4");
  expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:r=24", "-f", "lavfi", "-i", "sine=f=440", "-t", "1", "-c:v", "libx264", "-c:a", "aac", file]).promise).code).toBe(0);
  await copyFile(file, copy);
  const assets = await ensureBuiltinStickerAssets(path.join(root, "stickers"));
  let store = await SourceStickerKnowledgeStore.open(root);
  const controllers: AgentController[] = [], queues: ExportQueue[] = [];
  const counts = { detection: 0, recognition: 0, creative: 0, preview: 0 };
  try {
    const revisions: string[] = [], projects: string[] = [], mediaIds: string[] = [];
    for (const warm of [false, true]) {
      const service = new ApplicationService(ffmpeg, { resolve: resolveFont }); await service.addMedia(warm ? [copy, file] : [file]);
      projects.push(service.currentProject.id); mediaIds.push(service.currentProject.mediaItems[0].id);
      const jobs = new JobStore(path.join(root, warm ? "warm-jobs" : "cold-jobs"));
      const queue = new ExportQueue({ ffmpeg, jobStore: jobs, fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } }); queues.push(queue);
      const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, undefined, undefined, undefined, undefined, store); controllers.push(controller);
      for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "same-fixture-model", baseUrl: "https://unused.invalid/v1" });
      vi.spyOn(controller.provider, "shortlist").mockResolvedValue(["heart"]);
      vi.spyOn(controller.provider, "selectCoverSticker").mockResolvedValue("heart");
      vi.spyOn(controller.provider, "plan").mockImplementation(async () => { counts.creative++; return { summary: "fixture", captions: [], filter: warm ? "warm" : "none", intensity: warm ? 0.2 : 0,
        stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })), priceStyle: "classic" }; });
      const rectangle = { x: 0.85, y: 0.9, width: 0.1, height: 0.08 };
      vi.spyOn(controller.visionProvider, "detectCovers").mockImplementation(async images => { counts.detection++; return images.map(image => ({ timeMs: image.timeMs, targets: [{ id: "a", rectangle }] })); });
      vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async input => { counts.recognition++; return JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }); });
      vi.spyOn(controller.reviewerProvider, "supervisePreview").mockImplementation(async input => { counts.preview++; expect(input.knowledge?.facts.targets).toHaveLength(1); return JSON.stringify({ action: "pass", reason: "new preview checked" }); });
      const outputDirectory = path.join(root, warm ? "warm-output" : "cold-output");
      const input = { ruleId: "clean" as const, brief: "", mediaIds: service.currentProject.mediaItems.map(item => item.id), outputDirectory,
        ...(warm && refresh ? { sourceStickerRefresh: { projectId: service.currentProject.id, mediaIds: [service.currentProject.mediaItems[1].id] } } : {}),
        decorations: { mode: "agent" as const, productPrice: warm ? "第二批\n手动文字" : "第一批", displayMode: "full" as const, sticker: "none", fontFamily: "Noto Sans CJK SC" }, exportSettings: { resolutionMode: "source" as const, frameRateMode: "source" as const, quality: "balanced" as const } };
      if (warm) {
        controller.visionProvider.clear();
        await expect(controller.start(input, new Set([outputDirectory]))).rejects.toThrow("视觉识别模型");
        expect(counts).toEqual({ detection: 1, recognition: 1, creative: 1, preview: 1 });
        controller.visionProvider.configure({ apiKey: "fixture", model: "changed-model", baseUrl: "https://unused.invalid/v1" });
      }
      await controller.start(input, new Set([outputDirectory]));
      await vi.waitFor(() => { expect(controller.busy).toBe(false); expect(controller.snapshot()?.items.every(item => !item.error)).toBe(true); expect(queue.snapshot().batches).toHaveLength(warm ? 2 : 1); expect(queue.snapshot().batches.every(({ batch }) => batch.tasks.every(task => task.status === "completed"))).toBe(true); }, { timeout: 30_000 });
      const batch = queue.snapshot().batches[0].batch;
      const outcomes = await store.listOutcomes(service.currentProject.id);
      expect(outcomes).toHaveLength(warm ? 2 : 1);
      expect(outcomes[0]).toMatchObject({ result: "queued", lookup: warm ? refresh ? "refresh" : "hit" : "absent", stage: "enqueue", quality: "not-evaluated",
        requests: { executor: !warm || refresh ? 1 : 0, recognitionSupervisor: !warm || refresh ? 1 : 0, previewSupervisor: 1, creative: 2 }, modelVerdict: "passed" });
      expect(outcomes[0].revisionId).toBe(batch.templateSnapshot.sourceStickerKnowledge!.revisionId);
      expect(outcomes[0].previewEvidenceDigests?.length).toBeGreaterThan(0);
      expect(await store.listOutcomes()).toHaveLength(warm ? 3 : 1);
      revisions.push(batch.templateSnapshot.sourceStickerKnowledge!.revisionId);
      expect(batch.templateSnapshot.productPrice).toBe(input.decorations.productPrice);
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && layer.cover)).toHaveLength(0);
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && !layer.cover)).toHaveLength(3);
      if (warm) {
        expect(counts).toEqual({ detection: refresh ? 2 : 1, recognition: refresh ? 2 : 1, creative: 3, preview: 3 });
        expect(controller.snapshot()?.items.map(item => item.sourceKnowledge?.origin)).toEqual([refresh ? "refresh" : "warm", "run"]);
        expect(controller.snapshot()?.items.map(item => item.sourceKnowledge?.recognitionRequests)).toEqual([refresh ? 2 : 0, 0]);
        const frozen = structuredClone(batch.templateSnapshot);
        expect((await store.collect(0)).removed).toHaveLength(1); await store.close();
        await queue.shutdown();
        // Simulate a persisted interrupted task, then use only the existing queue retry.
        const saved = (await jobs.load(batch.id)).state;
        saved.batch.tasks[0].status = "interrupted"; saved.batch.status = "active";
        await jobs.save(saved);
        const recovered = new ExportQueue({ ffmpeg, jobStore: jobs, fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } }); queues.push(recovered);
        await recovered.recover(); await recovered.retry([batch.tasks[0].id]);
        await vi.waitFor(() => expect(recovered.snapshot().batches.find(entry => entry.batch.id === batch.id)!.batch.tasks[0].status).toBe("completed"), { timeout: 30_000 });
        expect(recovered.snapshot().batches.find(entry => entry.batch.id === batch.id)!.batch.templateSnapshot).toEqual(frozen);
        expect(counts).toEqual({ detection: refresh ? 2 : 1, recognition: refresh ? 2 : 1, creative: 3, preview: 3 });
      } else { await store.close(); store = await SourceStickerKnowledgeStore.open(root); }
    }
    expect(new Set(projects).size).toBe(2); expect(new Set(mediaIds).size).toBe(2); expect(new Set(revisions).size).toBe(refresh ? 2 : 1);
  } finally { for (const controller of controllers) await controller.cancel(); await store.close(); for (const queue of queues) await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
}, 60_000);

it("rebuilds version A after B corrects shared source facts without another creative request", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-revision-propagation-"));
  const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe"), file = path.join(root, "source.mp4");
  expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:r=24", "-t", "1", "-c:v", "libx264", file]).promise).code).toBe(0);
  const service = new ApplicationService(ffmpeg, { resolve: resolveFont }); await service.addMedia([file]);
  const store = await SourceStickerKnowledgeStore.open(root), assets = await ensureBuiltinStickerAssets(path.join(root, "stickers"));
  const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(root, "jobs")), fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
  const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, undefined, undefined, undefined, undefined, store);
  try {
    for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://unused.invalid/v1" });
    vi.spyOn(controller.provider, "shortlist").mockResolvedValue(["heart"]);
    const creative = vi.spyOn(controller.provider, "plan").mockResolvedValue({ summary: "original creative plan", captions: [], filter: "none", intensity: 0, priceStyle: "classic",
      stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) });
    const detection = vi.spyOn(controller.visionProvider, "detectCovers").mockImplementation(async images => images.map(image => ({ timeMs: image.timeMs, targets: [] })));
    vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async input => JSON.stringify({ action: "resolve", reason: "checked", frames: input.proposal }));
    const checks: PreviewReviewInput[] = [];
    vi.spyOn(controller.reviewerProvider, "supervisePreview").mockImplementation(async input => {
      expect(queue.snapshot().batches).toHaveLength(0); checks.push(input);
      if (checks.length !== 2) return JSON.stringify({ action: "pass", reason: "checked current source and output" });
      const facts = input.knowledge!.facts, evidenceIds = facts.observations.map(o => o.evidenceId), rectangle = { x: 0.85, y: 0.9, width: 0.1, height: 0.08 };
      const track = { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle }] };
      return JSON.stringify({ action: "revise", reason: "missing original corner", tracks: [{ targetId: "a", track }], sourceFacts: { ...facts,
        targets: [{ id: "a", segments: [{ id: "a0", track, interpolation: "linear", evidenceIds }] }], observations: evidenceIds.map(evidenceId => ({ evidenceId, targetId: "a", presence: "PRESENT", rectangle })) },
        issues: [{ id: "missing", scope: "source", kind: "missing_target", reason: "confirmed source contradiction", ranges: facts.reviewedRanges, evidenceIds }], resolvedIssueIds: ["missing"] });
    });
    const render = vi.spyOn(queue, "renderPreview"), outputDirectory = path.join(root, "output");
    await controller.start({ ruleId: "clean", brief: "", mediaIds: [service.currentProject.mediaItems[0].id], outputDirectory, multiplier: 2,
      decorations: { mode: "agent", productPrice: "原始手动文字", sticker: "none", fontFamily: "Noto Sans CJK SC" }, exportSettings: { resolutionMode: "source", frameRateMode: "source", quality: "balanced" } }, new Set([outputDirectory]));
    await vi.waitFor(() => { expect(controller.busy).toBe(false); expect(controller.snapshot()?.items.map(item => item.status)).toEqual(["exporting", "exporting"]); }, { timeout: 30_000 });
    expect(creative).toHaveBeenCalledTimes(2); expect(detection).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledTimes(4);
    expect(checks.map(input => [input.turn, input.revision])).toEqual([[1, 0], [1, 0], [2, 1], [2, 1]]);
    const templates = queue.snapshot().batches.map(({ batch }) => batch.templateSnapshot);
    expect(new Set(templates.map(t => t.sourceStickerKnowledge!.revisionId)).size).toBe(1);
    expect(templates.every(t => t.productPrice === "原始手动文字" && t.layers.filter(l => l.type === "sticker").length === 3)).toBe(true);
    const outcomes = await store.listOutcomes(service.currentProject.id);
    expect(outcomes.map(row => [row.requests.previewSupervisor, row.revisions, row.renders])).toEqual([[2, 1, 2], [2, 1, 2]]);
    expect(outcomes[1].sourceIssueReported).toBe(true);
  } finally { await controller.cancel(); await store.close(); await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
}, 60_000);
