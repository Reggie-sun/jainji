import { mkdtemp, rm, access, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ApplicationService } from "../src/main/application";
import { AgentController } from "../src/main/agent-controller";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { fingerprintFile } from "../src/main/paths";
import type { PreviewReviewInput } from "../src/main/supervisor-protocol";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { AssetLibrary } from "../src/main/asset-library";
import { loadBundledStickerAssets } from "../src/main/bundled-stickers";

describe("automatic supervisor through real render and original queue", () => {
  it.each([{ coverEnabled: false, cancel: false, inspectWindows: false }, { coverEnabled: true, cancel: false, inspectWindows: false }, { coverEnabled: true, cancel: true, inspectWindows: false }, { coverEnabled: false, cancel: true, inspectWindows: false }, { coverEnabled: false, cancel: false, inspectWindows: true }])("checks actual renders before admission (cover=$coverEnabled, cancel=$cancel, multiwindow=$inspectWindows)", async ({ coverEnabled, cancel, inspectWindows }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervised-integration-"));
    const ffmpeg = new FfmpegAdapter("ffmpeg", "ffprobe");
    const source = path.join(directory, "source.mp4");
    const duration = inspectWindows ? 12 : 4, displayMode = inspectWindows ? "full" as const : "first-5s" as const;
    expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:r=24", "-f", "lavfi", "-i", "sine=f=440", "-vf", "drawbox=x=132:y=255:w=24:h=24:color=white:t=fill", "-t", String(duration), "-c:v", "libx264", "-c:a", "aac", source]).promise).code).toBe(0);
    const fingerprint = await fingerprintFile(source);
    const service = new ApplicationService(ffmpeg, { resolve: resolveFont });
    await service.addMedia([source]);
    const sourceDurationMs = service.currentProject.mediaItems[0].durationMs;
    const jobs = new JobStore(path.join(directory, "jobs"));
    const queue = new ExportQueue({ ffmpeg, jobStore: jobs, fontResolver: { resolve: resolveFont }, executionLimits: { analysis: 1, exports: 1, threads: 1 } });
    const assets = { ...await ensureBuiltinStickerAssets(path.join(directory, "stickers")), ...await loadBundledStickerAssets(path.resolve("resources/stickers/downloaded")) };
    const knowledge = await SourceStickerKnowledgeStore.open(directory);
    const library = coverEnabled ? new AssetLibrary(path.join(directory, "library"), async () => { throw new Error("No network allowed"); }) : undefined;
    const coverId = coverEnabled ? "fluent-afab45c605865ebd35da37d3d027730a800e17fb" : "heart";
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets, library, undefined, undefined, undefined, knowledge);
    if (coverEnabled) service.currentProject.coverSticker = { enabled: true, trackingMode: "agent", stickerIds: [], rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } };
    for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://unused.invalid/v1" });
    vi.spyOn(controller.provider, "shortlist").mockImplementation(async (_rule, _brief, _frames, _signal, catalog, _selection, purpose) => {
      expect(catalog.stickers.some(({ id }) => id === "local-limited-discount")).toBe(purpose === "cover");
      expect(catalog.stickers.some(({ id }) => id === "fluent-afab45c605865ebd35da37d3d027730a800e17fb")).toBe(purpose === "cover");
      return [purpose === "cover" ? coverId : "heart"];
    });
    vi.spyOn(controller.provider, "selectCoverSticker").mockResolvedValue(coverId);
    vi.spyOn(controller.provider, "plan").mockResolvedValue({ summary: "fixture", captions: [], filter: "none", intensity: 0,
      stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })), priceStyle: "classic" });
    const detect = vi.spyOn(controller.visionProvider, "detectCovers").mockImplementation(async images => images.map(image => ({ timeMs: image.timeMs, targets: [] })));
    const propose = vi.spyOn(controller.visionProvider, "proposeCoverPlacement").mockResolvedValue(JSON.stringify({ action: "propose", reason: "先检查样片再调整", tracks: [] }));
    const recognition = vi.spyOn(controller.reviewerProvider, "superviseRecognition").mockImplementation(async input => JSON.stringify(inspectWindows && input.turn < 3
      ? { action: "inspect", reason: "核查本窗口原图", requests: input.images.slice(0, 4).map(image => ({ timeMs: image.timeMs })) }
      : { action: "resolve", reason: "fixture deliberately misses corner, preview repairs it", frames: input.proposal }));
    const inspected: PreviewReviewInput[] = [];
    const checkpoints = Array.from({ length: 8 }, (_, index) => ({ timeMs: (index + 1) * 125, crop: { x: 0.7, y: 0.7, width: 0.3, height: 0.3 } }));
    const review = vi.spyOn(controller.reviewerProvider, "supervisePreview").mockImplementation(async input => {
      expect(input.trackHorizonMs).toBe(sourceDurationMs);
      if (coverEnabled) { expect(input.knowledge).toBeUndefined(); expect(input.trackPurpose).toBe("cover-placement"); }
      else expect(input.knowledge!.requiredRanges).toEqual([{ startMs: 0, endMs: sourceDurationMs }]);
      inspected.push(input);
      if (cancel) { void controller.cancel(); return JSON.stringify({ action: "pass", reason: "取消竞态" }); }
      expect(queue.snapshot().batches).toHaveLength(0);
      expect(input.evidence.every(image => image.sourceUrl.startsWith("data:image/jpeg;") && image.previewUrl?.startsWith("data:image/jpeg;"))).toBe(true);
      expect(JSON.stringify(input)).not.toContain(directory);
      const rectangle = { x: 0.825, y: 0.89, width: 0.15, height: 0.1 };
      const track = { startMs: 0, endMs: sourceDurationMs, keyframes: [{ timeMs: 0, rectangle }] };
      if (coverEnabled) {
        if (input.turn <= 2) return JSON.stringify({ action: "inspect", reason: "核查局部", requests: checkpoints.slice((input.turn - 1) * 4, input.turn * 4) });
        if (input.turn >= 4) {
          for (const request of checkpoints) expect(input.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ requestedTimeMs: request.timeMs, crop: expect.any(Object) })]));
          const previousIds = new Set(inspected[inspected.length - 2].evidence.map(image => image.previewEvidenceId));
          expect(input.evidence.every(image => !previousIds.has(image.previewEvidenceId))).toBe(true);
        }
        if (input.turn <= 4) return JSON.stringify({ action: "revise", reason: "覆盖右下角原图标", tracks: [{ targetId: "placement-badge",
          track: { ...track, keyframes: [{ timeMs: 0, rectangle: { ...rectangle, x: input.turn === 3 ? 0.82 : 0.825 } }] } }] });
        return JSON.stringify({ action: "pass", reason: "覆盖完整且未遮挡主体，允许近似边界" });
      }
      const facts = input.knowledge!.facts, evidenceIds = facts.observations.map(o => o.evidenceId);
      return JSON.stringify(inspected.length === 1
        ? { action: "revise", reason: "右下已有原贴纸，修正占位", tracks: [{ targetId: "source-badge", track }],
          sourceFacts: { ...facts, targets: [{ id: "source-badge", segments: [{ id: "badge", track, interpolation: "linear", evidenceIds }] }], observations: evidenceIds.map(evidenceId => ({ evidenceId, targetId: "source-badge", presence: "PRESENT", rectangle })) },
          issues: [{ id: "missing", scope: "source", kind: "missing_target", reason: "右下存在原贴纸", ranges: facts.reviewedRanges, evidenceIds }], resolvedIssueIds: ["missing"] }
        : { action: "pass", reason: "重新检查修订样片" });
    });
    const render = vi.spyOn(queue, "renderPreview");
    try {
      const outputDirectory = path.join(directory, "output");
      await controller.start({ ruleId: "clean", brief: "", mediaIds: service.currentProject.mediaItems.map(media => media.id), outputDirectory,
        decorations: { mode: "agent", displayMode, productPrice: "手动内容", sticker: "none", fontFamily: "Noto Sans CJK SC" }, exportSettings: { resolutionMode: "source", frameRateMode: "source", quality: "balanced" } }, new Set([outputDirectory]));
      await vi.waitFor(() => expect(controller.busy).toBe(false), { timeout: 60_000 });
      expect(controller.snapshot()?.items[0].error).toBeUndefined();
      const trace = controller.snapshot()?.items[0].coverDiagnostics;
      if (coverEnabled) {
        expect(trace?.droppedEvents).toBe(0);
        for (const stage of ["queue-wait", "full-render", "artifact-verify", "paired-evidence", "proposal-provider", "review-provider"]) {
          expect(trace?.events).toEqual(expect.arrayContaining([expect.objectContaining({ stage, durationMs: expect.any(Number) })]));
        }
        expect(trace?.events.some(event => event.outcome === "running")).toBe(false);
        expect(JSON.stringify(trace)).not.toMatch(/data:image|source.mp4|fixture|右下|sourcePath|baseUrl|apiKey/);
        expect(JSON.stringify(service.currentProject)).not.toMatch(/coverDiagnostics|droppedEvents|startedMs/);
        if (cancel) expect(trace?.events.at(-1)).toMatchObject({ stage: "lifecycle", outcome: "cancelled" });
      } else expect(trace).toBeUndefined();
      if (cancel) {
        expect(controller.snapshot()?.items[0].status).toBe("cancelled");
        expect(queue.snapshot().batches).toHaveLength(0);
        expect(review).toHaveBeenCalledOnce();
        for (const [call] of render.mock.calls) await expect(access(call.cacheDirectory)).rejects.toThrow();
        return;
      }
      expect(review).toHaveBeenCalledTimes(coverEnabled ? 5 : 2);
      expect(inspected.map(input => [input.turn, input.revision, input.remainingRevisions])).toEqual(coverEnabled
        ? [[1, 0, 2], [2, 0, 2], [3, 0, 2], [4, 1, 1], [5, 2, 0]] : [[1, 0, 2], [2, 1, 1]]);
      expect(inspected.at(-1)!.history).toEqual(expect.arrayContaining([expect.objectContaining({ action: "revise", applied: true })]));
      expect(inspected.every(input => coverEnabled ? !input.knowledge : input.knowledge?.facts.reviewedRanges.length)).toBe(true);
      expect(inspected.every(input => input.evidence.every(image => image.sourceEvidenceId && image.previewEvidenceId))).toBe(true);
      expect(render).toHaveBeenCalledTimes(coverEnabled ? 3 : 2);
      expect(detect).toHaveBeenCalledTimes(coverEnabled ? 0 : inspectWindows ? 7 : 3);
      expect(propose).toHaveBeenCalledTimes(coverEnabled ? 1 : 0);
      if (coverEnabled) expect(recognition).not.toHaveBeenCalled();
      if (inspectWindows) expect(recognition.mock.calls.filter(([input]) => input.turn === 3).reduce((count, [input]) => count + input.evidence.length, 0)).toBeGreaterThan(40);
      await vi.waitFor(() => expect(queue.snapshot().batches[0]?.batch.tasks[0].status).toBe("completed"), { timeout: 30_000 });
      const batch = queue.snapshot().batches[0].batch;
      expect(batch.templateSnapshot.productPrice).toBe("手动内容");
      expect(batch.templateSnapshot.decorationDisplayMode).toBe(displayMode);
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && !layer.cover && (!layer.activeRanges || layer.activeRanges.some(range => range.startMs < 3000)))).toHaveLength(3);
      expect(batch.templateSnapshot.layers.filter(layer => layer.type === "sticker" && layer.cover)).toHaveLength(coverEnabled ? 1 : 0);
      if (coverEnabled) expect(batch.templateSnapshot.layers.find(layer => layer.type === "sticker" && layer.cover)).toMatchObject({ cover: { stickerId: coverId, automatic: true } });
      if (coverEnabled) {
        expect(batch.templateSnapshot.coverPlacement?.tracks[0].targetId).toBe("placement-badge");
        expect(batch.templateSnapshot.sourceStickerKnowledge).toBeUndefined();
        expect(await knowledge.listOutcomes()).toHaveLength(0);
      }
      expect((await jobs.loadAll())).toHaveLength(1);
      expect(JSON.stringify(await jobs.loadAll())).not.toMatch(/coverDiagnostics|droppedEvents|startedMs/);
      expect(await fingerprintFile(source)).toBe(fingerprint);
      const output = await ffmpeg.probe(batch.tasks[0].outputPath!);
      expect(output.streams?.some(stream => stream.codec_type === "audio")).toBe(true);
      expect(Number(output.format?.duration)).toBeCloseTo(duration, 1);
      if (coverEnabled) {
        const saved = (await jobs.load(batch.id)).state.batch.templateSnapshot;
        expect(saved.coverPlacement).toBeDefined();
        const copy = path.join(directory, "renamed.mp4"); await copyFile(source, copy); await service.addMedia([copy]);
        review.mockResolvedValue(JSON.stringify({ action: "pass", reason: "本版新样片已检查" }));
        const copied = service.currentProject.mediaItems.find(item => item.sourcePath === copy)!;
        vi.mocked(controller.provider.shortlist).mockImplementation(async (_rule, _brief, _frames, _signal, catalog, _selection, purpose) => [purpose === "cover" ? catalog.stickers[0].id : "heart"]);
        vi.mocked(controller.provider.selectCoverSticker).mockImplementation(async (_frames, _signal, catalog) => catalog.stickers[0].id);
        const request = { ruleId: "clean" as const, brief: "", mediaIds: [copied.id], outputDirectory,
          decorations: { mode: "agent" as const, productPrice: "新手动内容", sticker: "none", fontFamily: "Noto Sans CJK SC" },
          exportSettings: { resolutionMode: "source" as const, frameRateMode: "source" as const, quality: "balanced" as const } };
        await controller.start(request, new Set([outputDirectory]));
        await vi.waitFor(() => { expect(controller.busy).toBe(false); expect(controller.snapshot()?.items[0].error).toBeUndefined(); expect(queue.snapshot().batches).toHaveLength(2);
          expect(queue.snapshot().batches.every(({ batch }) => batch.tasks[0].status === "completed")).toBe(true); }, { timeout: 30_000 });
        expect(propose).toHaveBeenCalled(); expect(review).toHaveBeenCalledTimes(6); expect(render).toHaveBeenCalledTimes(4);
        expect(queue.snapshot().batches[1].batch.templateSnapshot.coverPlacement).toBeDefined();
        await controller.start({ ...request, sourceStickerRefresh: { projectId: service.currentProject.id, mediaIds: [copied.id] } }, new Set([outputDirectory]));
        await vi.waitFor(() => { expect(controller.busy).toBe(false); expect(queue.snapshot().batches).toHaveLength(3);
          expect(queue.snapshot().batches.every(({ batch }) => batch.tasks[0].status === "completed")).toBe(true); }, { timeout: 30_000 });
        expect(propose.mock.calls.length).toBeGreaterThanOrEqual(2); expect(review).toHaveBeenCalledTimes(7);
      }
      const retainedDirectory = render.mock.calls.at(-1)![0].cacheDirectory;
      await expect(access(retainedDirectory)).resolves.toBeUndefined();
      expect(controller.snapshot()?.items[0].previewUrl).toMatch(/^jianji-agent-preview:\/\//);
      await controller.cancel();
      for (const directory of new Set(render.mock.calls.map(([call]) => call.cacheDirectory))) await expect(access(directory)).rejects.toThrow();
    } finally { await controller.cancel(); await knowledge.close(); await queue.shutdown(); await rm(directory, { recursive: true, force: true }); }
  }, 90_000);

});
