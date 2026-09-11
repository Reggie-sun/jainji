import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

describe("ExportQueue", () => {
  it("isolates one failed task and publishes a later task", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-queue-"));
    const output = path.join(directory, "output");
    const sourceA = path.join(directory, "a.mp4");
    const sourceB = path.join(directory, "b.mp4");
    await writeFile(sourceA, "a"); await writeFile(sourceB, "b");
    const makeMedia = async (id: string, sourcePath: string): Promise<MediaItem> => ({ id, sourcePath, displayName: path.basename(sourcePath), fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() });
    const media = await Promise.all([makeMedia(crypto.randomUUID(), sourceA), makeMedia(crypto.randomUUID(), sourceB)]);
    let calls = 0;
    const fakeFfmpeg = {
      ffmpegPath: "/fake/ffmpeg",
      run: (args: string[]) => ({ process: {}, promise: (async () => { const current = ++calls; if (current > 1) await writeFile(args[args.length - 1], "encoded"); return { code: current === 1 ? 1 : 0, stdout: "", stderr: "test failure" }; })(), cancel: async () => undefined }),
    } as unknown as FfmpegAdapter;
    const fakeVerifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 1, durationMs: 1_000, createdAt: now() }) } as unknown as ArtifactVerifier;
    const fakeCompiler = { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any;
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg: fakeFfmpeg, compiler: fakeCompiler, artifactVerifier: fakeVerifier, fontResolver: { resolve: async () => null } });
    queue.setMediaLookup((id) => media.find((item) => item.id === id));
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: media.map((item) => item.id), mediaItems: media, outputDirectory: output, preset: DEFAULT_PRESET });
    await queue.start(batch.id);
    const tasks = queue.snapshot().batches[0].batch.tasks;
    expect(tasks.map((task) => task.status)).toEqual(["failed", "completed"]);
    expect(tasks[1].outputArtifact?.durationMs).toBe(1_000);
  });

  it("marks persisted execution states as interrupted on recovery", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-recovery-"));
    const output = path.join(directory, "output");
    const source = path.join(directory, "input.mp4");
    await writeFile(source, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: source, displayName: "input.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const ffmpeg = { ffmpegPath: "/fake", run: () => { throw new Error("not expected"); } } as unknown as FfmpegAdapter;
    const jobStore = new JobStore(path.join(directory, "jobs"));
    const firstQueue = new ExportQueue({ jobStore, ffmpeg, fontResolver: { resolve: async () => null } });
    firstQueue.setMediaLookup((id) => id === media.id ? media : undefined);
    const batch = await firstQueue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: output, preset: DEFAULT_PRESET });
    const state = firstQueue.snapshot().batches[0];
    state.batch.tasks[0].status = "running";
    state.batch.status = "active";
    await jobStore.save(state);
    const recoveredQueue = new ExportQueue({ jobStore, ffmpeg, fontResolver: { resolve: async () => null } });
    const recovered = await recoveredQueue.recover();
    expect(recovered.batches[0].batch.id).toBe(batch.id);
    expect(recovered.batches[0].batch.tasks[0].status).toBe("interrupted");
    expect(recovered.batches[0].batch.tasks[0].errorCode).toBe("interrupted");
  });

  it("waits for an active task to stop before persisting shutdown recovery", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-shutdown-"));
    const output = path.join(directory, "output");
    const source = path.join(directory, "input.mp4");
    await writeFile(source, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: source, displayName: "input.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let finish!: (result: { code: number; stdout: string; stderr: string }) => void;
    const ffmpeg = {
      ffmpegPath: "/fake",
      run: () => {
        started();
        const promise = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => { finish = resolve; });
        return { process: { exitCode: null }, promise, cancel: async () => finish({ code: 130, stdout: "", stderr: "interrupted" }) };
      },
    } as unknown as FfmpegAdapter;
    const fakeCompiler = { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any;
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg, compiler: fakeCompiler, fontResolver: { resolve: async () => null } });
    queue.setMediaLookup((id) => id === media.id ? media : undefined);
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: output, preset: DEFAULT_PRESET });
    const startPromise = queue.start(batch.id);
    await startedPromise;
    await queue.shutdown();
    await startPromise;
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("interrupted");
    expect(task.errorCode).toBe("interrupted");
  });

  it("downgrades a completed task when its output is missing on project open", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-artifact-recovery-"));
    const output = path.join(directory, "output");
    const source = path.join(directory, "input.mp4");
    await writeFile(source, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: source, displayName: "input.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const jobStore = new JobStore(path.join(directory, "jobs"));
    const ffmpeg = { ffmpegPath: "/fake", run: () => { throw new Error("not expected"); } } as unknown as FfmpegAdapter;
    const firstQueue = new ExportQueue({ jobStore, ffmpeg, fontResolver: { resolve: async () => null } });
    firstQueue.setMediaLookup((id) => id === media.id ? media : undefined);
    const batch = await firstQueue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: output, preset: DEFAULT_PRESET });
    const state = firstQueue.snapshot().batches[0];
    state.batch.tasks[0].status = "completed";
    state.batch.tasks[0].outputArtifact = { taskId: state.batch.tasks[0].id, path: state.batch.tasks[0].outputPath!, sizeBytes: 10, durationMs: 1_000, createdAt: now() };
    state.batch.status = "completed";
    await jobStore.save(state);
    const verifier = { verify: async () => { throw new Error("missing output"); } } as unknown as ArtifactVerifier;
    const recoveredQueue = new ExportQueue({ jobStore, ffmpeg, artifactVerifier: verifier, fontResolver: { resolve: async () => null } });
    await recoveredQueue.hydrate([batch]);
    const task = recoveredQueue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe("artifact_missing");
  });
});
