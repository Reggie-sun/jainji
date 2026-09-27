import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { fingerprintFile } from "../src/main/paths";
import type { ArtifactVerifier } from "../src/main/artifact";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import { DouyinUploadService } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { CoverReviewController } from "../src/main/cover-review-controller";
import type { AgentStartInput } from "../src/shared/agent";

async function fixture(saveGate?: (status: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "douyin-export-"));
  const source = path.join(directory, "a.mp4"), sample = path.join(directory, "sample.mp4");
  await writeFile(source, "input"); await writeFile(sample, "encoded");
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath: source, displayName: "a.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 5, durationMs: 1000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
  const jobs = new JobStore(path.join(directory, "jobs")), store = new DouyinUploadStore(path.join(directory, "upload")); await store.load();
  const uploader = new DouyinUploadService(store, { loadBatch: async id => (await jobs.load(id)).state, browser: () => { throw new Error("Disabled must not connect"); } });
  const originalSave = jobs.save.bind(jobs);
  jobs.save = async state => { await saveGate?.(state.batch.tasks[0].status); await originalSave(state); };
  const facts: { projectId: string; batchId: string; taskId: string; artifact: OutputArtifact }[] = [];
  const callback = vi.fn(async (fact: typeof facts[number]) => { facts.push(fact); await uploader.committed({ project_id: fact.projectId, batch_id: fact.batchId, export_task_id: fact.taskId }); });
  const queue = new ExportQueue({ jobStore: jobs,
    ffmpeg: { ffmpegPath: "/fake", run: (args: string[]) => ({ process: {}, promise: writeFile(args.at(-1)!, "encoded").then(() => ({ code: 0, stdout: "", stderr: "" })), cancel: async () => {} }) } as unknown as FfmpegAdapter,
    compiler: { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any,
    artifactVerifier: { verify: async (file: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: file, sizeBytes: (await readFile(file)).length, durationMs: 1000, createdAt: now() }) } as ArtifactVerifier,
    fontResolver: { resolve: async () => null }, onFinalArtifactCommitted: callback,
  });
  queue.setMediaLookup(() => media);
  const input = { template: createDefaultTemplate(), projectId: crypto.randomUUID(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out"), preset: DEFAULT_PRESET };
  return { queue, jobs, uploader, store, input, media, sample, callback, facts };
}

describe("formal export to upload boundary", () => {
  it.each(["prepare", "approve"] as const)("rejects assisted %s before persisting private publication intent", async method => {
    const save = vi.fn(), model = vi.fn(), changed = vi.fn();
    const controller = new CoverReviewController({ saveReviewDraft: save } as any, { assertIdle: model } as any, {} as any, { changed } as any);
    const input = { douyinUpload: { enabled: true, caption: "private publication caption" } } as AgentStartInput;
    await expect(controller[method](crypto.randomUUID(), 0, input, new Set())).rejects.toThrow("半自动审阅暂不支持抖音上传");
    expect(save).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });
  it("waits for completed save and binds the collision-resolved actual final path", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let completedSave = false;
    const f = await fixture(async status => { if (status === "completed") { completedSave = true; await gate; } });
    const batch = await f.queue.createBatch(f.input); await f.uploader.registerBatch(batch, { enabled: true });
    await writeFile(batch.tasks[0].outputPath!, "existing");
    const work = f.queue.start(batch.id); await vi.waitFor(() => expect(completedSave).toBe(true));
    expect(f.callback).not.toHaveBeenCalled(); expect(f.store.tasks()).toHaveLength(0);
    release(); await work; await vi.waitFor(() => expect(f.store.tasks()).toHaveLength(1));
    const task = (await f.jobs.load(batch.id)).state.batch.tasks[0];
    expect(f.facts[0].artifact.path).toBe(task.outputArtifact?.path);
    expect(task.outputPath).not.toBe(batch.tasks[0].outputPath);
    expect(await readFile(batch.tasks[0].outputPath!, "utf8")).toBe("existing");
  });
  it("has zero notifications when the completed save rejects", async () => {
    const f = await fixture(async status => { if (status === "completed") throw new Error("save failure"); });
    const batch = await f.queue.createBatch(f.input); await f.uploader.registerBatch(batch, { enabled: true });
    await expect(f.queue.start(batch.id)).rejects.toThrow();
    expect(f.callback).not.toHaveBeenCalled(); expect(f.store.tasks()).toHaveLength(0);
    expect((await f.jobs.load(batch.id)).state.batch.tasks[0].status).toBe("verifying");
  });
  it("registers approved-sample intent after first save but before copying and admits only the formal path", async () => {
    const f = await fixture(); let created = false;
    const result = await f.queue.publishApprovedSample({ ...f.input, media: f.media, samplePath: f.sample, onTaskCreated: async batch => {
      expect(Object.keys(batch).sort()).toEqual(["id", "projectId", "tasks"]);
      expect(Object.keys(batch.tasks[0])).toEqual(["id"]);
      const saved = (await f.jobs.load(batch.id)).state.batch.tasks[0];
      expect(saved.status).toBe("validating");
      await expect(readFile(saved.outputPath!)).rejects.toThrow();
      await f.uploader.registerBatch(batch, { enabled: true }); created = true;
    } });
    expect(created).toBe(true); await vi.waitFor(() => expect(f.store.tasks()).toHaveLength(1));
    expect(f.store.tasks()[0].input.video_path).toBe(result.outputPath);
    expect(result.outputPath).not.toBe(f.sample);
  });
  it("isolates rejected notifications and intent registration from completed exports", async () => {
    const f = await fixture(); f.callback.mockImplementation(async () => { throw new Error("notification failed"); });
    const result = await f.queue.publishApprovedSample({ ...f.input, media: f.media, samplePath: f.sample, onTaskCreated: async () => { throw new Error("intent failed"); } });
    expect((await f.jobs.load(result.batchId)).state.batch.tasks[0].status).toBe("completed");
    expect(f.store.tasks()).toHaveLength(0);
  });
  it("reconciles a missed notification without running a browser or selecting history", async () => {
    const f = await fixture(); f.callback.mockImplementation(async () => {});
    const batch = await f.queue.createBatch(f.input); await f.uploader.registerBatch(batch, { enabled: true }); await f.queue.start(batch.id);
    expect(f.store.tasks()).toHaveLength(0); await f.uploader.reconcile(); expect(f.store.tasks()[0].result.state).toBe("PENDING");
    const unselected = await f.queue.createBatch(f.input); await f.queue.start(unselected.id); await f.uploader.reconcile(); expect(f.store.tasks()).toHaveLength(1);
  });
});
