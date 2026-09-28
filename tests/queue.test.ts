import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";

describe("ExportQueue", () => {
  it("does not queue a disk write for every progress event before verifying", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-progress-backlog-"));
    const sourcePath = path.join(directory, "input.mp4");
    await writeFile(sourcePath, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "input.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const jobStore = new JobStore(path.join(directory, "jobs"));
    const save = jobStore.save.bind(jobStore);
    let saves = 0;
    jobStore.save = async (state) => { saves += 1; await save(state); };
    let savesAtVerification = 0;
    const snapshots: number[] = [];
    let snapshotsAtVerification = 0;
    const ffmpeg = {
      ffmpegPath: "/fake/ffmpeg",
      run: (args: string[], progress: (event: { progress: number; outTimeMs: number }) => void) => ({
        process: {},
        promise: (async () => {
          for (let index = 1; index <= 90; index += 1) progress({ progress: index * 11_000, outTimeMs: index * 11_000 });
          progress({ progress: 1, outTimeMs: 1_000_000 });
          await writeFile(args[args.length - 1], "encoded");
          return { code: 0, stdout: "", stderr: "" };
        })(),
        cancel: async () => undefined,
      }),
    } as unknown as FfmpegAdapter;
    const verifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => {
      savesAtVerification = saves;
      snapshotsAtVerification = snapshots.length;
      return { taskId, path: filePath, sizeBytes: 7, durationMs: 1_000, createdAt: now() };
    } } as ArtifactVerifier;
    const queue = new ExportQueue({ jobStore, ffmpeg, compiler: { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any, artifactVerifier: verifier, fontResolver: { resolve: async () => null }, onSnapshot: snapshot => snapshots.push(snapshot.revision) });
    queue.setMediaLookup(() => media);
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
    await queue.start(batch.id);
    expect(savesAtVerification).toBeLessThanOrEqual(6);
    expect(snapshotsAtVerification).toBeLessThanOrEqual(6);
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("completed");
    expect((await jobStore.load(batch.id)).state.batch.tasks[0]).toMatchObject({ status: "completed", progress: 1 });
  });

  it("does not publish unchanged progress and still publishes verified completion", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-unchanged-progress-"));
    const sourcePath = path.join(directory, "input.mp4");
    await writeFile(sourcePath, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "input.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const onSnapshot = vi.fn();
    let unchangedNotifications = 0;
    const ffmpeg = { ffmpegPath: "/fake", run: (args: string[], progress: (event: { progress: number; outTimeMs: number }) => void) => ({
      process: {}, cancel: async () => undefined, promise: (async () => {
        const before = onSnapshot.mock.calls.length;
        for (let index = 0; index < 100; index++) progress({ progress: 5_000, outTimeMs: 5_000 });
        unchangedNotifications = onSnapshot.mock.calls.length - before;
        await writeFile(args[args.length - 1], "encoded");
        return { code: 0, stdout: "", stderr: "" };
      })(),
    }) } as unknown as FfmpegAdapter;
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg, compiler: { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any,
      artifactVerifier: { verify: async (filePath: string, taskId: string) => ({ taskId, path: filePath, sizeBytes: 7, durationMs: 1_000, createdAt: now() }) } as ArtifactVerifier,
      fontResolver: { resolve: async () => null }, onSnapshot });
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
    await queue.start(batch.id);
    expect(unchangedNotifications).toBe(0);
    expect(onSnapshot.mock.calls.at(-1)?.[0].batches[0].batch.tasks[0]).toMatchObject({ status: "completed", progress: 1 });
  });

  it("scopes subscriber and requested snapshots without dropping other projects or exposing mutable task status", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-project-snapshots-"));
    const sourcePath = path.join(directory, "input.mp4");
    await writeFile(sourcePath, "input");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "input.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 5, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const firstProject = crypto.randomUUID(), secondProject = crypto.randomUUID();
    let selectedProject = firstProject;
    const onSnapshot = vi.fn();
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg: new FfmpegAdapter("unused", "unused"), fontResolver: { resolve: async () => null }, onSnapshot, snapshotProjectId: () => selectedProject });
    const create = (projectId: string) => queue.createBatch({ projectId, template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
    const first = await create(firstProject), second = await create(secondProject);
    expect(onSnapshot.mock.calls.at(-1)?.[0].batches.map(({ batch }: { batch: { id: string } }) => batch.id)).toEqual([first.id]);
    selectedProject = secondProject;
    const third = await create(secondProject);
    expect(onSnapshot.mock.calls.at(-1)?.[0].batches.map(({ batch }: { batch: { id: string } }) => batch.id)).toEqual([second.id, third.id]);
    const scoped = queue.snapshot(firstProject);
    expect(scoped.batches.map(({ batch }) => batch.id)).toEqual([first.id]);
    scoped.batches[0].batch.tasks[0].progress = 0.5;
    const statuses = queue.taskStatuses();
    expect(statuses.size).toBe(3);
    expect(statuses.get(first.tasks[0].id)).toBe("queued");
    expect(statuses.has("missing-task")).toBe(false);
    (statuses as Map<string, string>).set(first.tasks[0].id, "completed");
    expect(queue.taskStatuses().get(first.tasks[0].id)).toBe("queued");
    expect(queue.snapshot().batches).toHaveLength(3);
    expect(queue.snapshot().batches[0].batch.tasks[0].progress).toBe(0);
  });

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

  it("publishes an approved preview sample as a completed export without re-rendering", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-queue-publish-"));
    const output = path.join(directory, "output");
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const samplePath = path.join(directory, "sample.mp4");
    await writeFile(samplePath, "encoded");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "a.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 1_000, width: 10, height: 10, rotation: 0, importedAt: now(), probeStatus: "ready" };
    let encodeCalls = 0;
    const fakeFfmpeg = {
      ffmpegPath: "/fake/ffmpeg",
      run: () => { encodeCalls += 1; throw new Error("encode must not run when publishing an approved sample"); },
    } as unknown as FfmpegAdapter;
    const fakeVerifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 9, durationMs: 1_000, createdAt: now() }) } as unknown as ArtifactVerifier;
    const fakeCompiler = { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any;
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg: fakeFfmpeg, compiler: fakeCompiler, artifactVerifier: fakeVerifier, fontResolver: { resolve: async () => null } });
    queue.setMediaLookup(() => media);
    const result = await queue.publishApprovedSample({ projectId: "ee661c87-50d2-4409-884c-828d0dc30dee", template: createDefaultTemplate(), media, samplePath, outputDirectory: output, preset: DEFAULT_PRESET });
    expect(encodeCalls).toBe(0);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(queue.snapshot().batches[0].batch.projectId).toBe("ee661c87-50d2-4409-884c-828d0dc30dee");
    expect(task.status).toBe("completed");
    expect(task.outputArtifact?.path).toBe(result.outputPath);
    expect(task.outputArtifact?.sizeBytes).toBe(9);
    expect(task.outputPath).toBe(result.outputPath);
    expect(result.outputPath.startsWith(output + path.sep)).toBe(true);
    expect(task.startedAt).toBeDefined();
    expect(task.finishedAt).toBeDefined();
  });

  it.each(["queued", "validating", "running", "verifying", "cancelling"] as const)("marks persisted %s as interrupted on recovery", async (status) => {
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
    state.batch.tasks[0].status = status;
    state.batch.status = "active";
    await jobStore.save(state);
    const recoveredQueue = new ExportQueue({ jobStore, ffmpeg, fontResolver: { resolve: async () => null } });
    const recovered = await recoveredQueue.recover();
    expect(recovered.batches[0].batch.id).toBe(batch.id);
    expect(recovered.batches[0].batch.tasks[0].status).toBe("interrupted");
    expect(recovered.batches[0].batch.tasks[0].errorCode).toBe("interrupted");
  });

  it.each(["project", "store", "memory"])("interrupts abandoned queued tasks when opening from %s without executing them", async (source) => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-open-queued-"));
    const sourcePath = path.join(directory, "input.mp4");
    await writeFile(sourcePath, "original");
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "input.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: 8, durationMs: 1000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
    const ffmpeg = { ffmpegPath: "/fake", run: () => { throw new Error("opening must not render"); } } as unknown as FfmpegAdapter;
    const jobStore = new JobStore(path.join(directory, "jobs"));
    const original = new ExportQueue({ jobStore, ffmpeg, fontResolver: { resolve: async () => null } });
    const batch = await original.createBatch({ projectId: crypto.randomUUID(), template: createDefaultTemplate(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
    const store = source === "project" ? new JobStore(path.join(directory, "empty-jobs")) : jobStore;
    const queue = source === "memory" ? original : new ExportQueue({ jobStore: store, ffmpeg, fontResolver: { resolve: async () => null } });
    await queue.hydrate([batch]);
    expect(queue.snapshot().batches[0].batch.tasks[0]).toMatchObject({ status: "interrupted", errorCode: "interrupted" });
    expect((await store.load(batch.id)).state.batch.tasks[0].status).toBe("interrupted");
    expect(await fingerprintFile(sourcePath)).toBe(media.fingerprint);
    expect(batch.tasks[0].status).toBe("queued");
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
    await queue.hydrate([batch]);
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("running");
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
