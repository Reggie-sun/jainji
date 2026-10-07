import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { DEFAULT_PRESET, createDefaultTemplate, now, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { fingerprintFile } from "../src/main/paths";
import type { ArtifactVerifier } from "../src/main/artifact";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { registerReviewedCoverUploads } from "../src/main/cover-review-upload";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import type { PageOwnership, QianchuanUploadSelection, ReadyEvidence } from "../src/shared/douyin-upload";

const uploadSelection: QianchuanUploadSelection = { enabled: true, accountProduct: "眼贴" };
const temporaryRoots = new Set<string>();
afterEach(async () => {
  await Promise.all([...temporaryRoots].map(root => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

async function fixture(saveGate?: (status: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "qianchuan-export-"));
  temporaryRoots.add(directory);
  const source = path.join(directory, "a.mp4"), sample = path.join(directory, "sample.mp4");
  await writeFile(source, "input"); await writeFile(sample, "encoded preview");
  const accountConfigPath = path.join(directory, "accounts.json");
  await writeFile(accountConfigPath, JSON.stringify({
    version: 1,
    accounts: QIANCHUAN_PRODUCTS.map((product, index) => ({ product, cdpEndpoint: `http://127.0.0.1:${12000 + index}`, advertiserId: String(3000 + index), adId: String(4000 + index) })),
  }), { mode: 0o600 });

  const media: MediaItem = { id: randomUUID(), sourcePath: source, displayName: "a.mp4", fingerprint: await fingerprintFile(source), sizeBytes: 5, durationMs: 1000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
  const jobs = new JobStore(path.join(directory, "jobs"));
  const store = new DouyinUploadStore(path.join(directory, "upload")); await store.load();
  const events: string[] = [];
  const ownershipByBatch = new Map<string, PageOwnership>();
  const browser: UploadBrowserPort = {
    connect: async (_task, signal) => { signal.throwIfAborted(); events.push("connect"); },
    open: async (tasks, selected, signal) => {
      const task = tasks[0]!;
      signal.throwIfAborted(); events.push("open");
      let ownership = ownershipByBatch.get(task.authorization.pageBatchId);
      if (!ownership) {
        ownership = { targetId: `fixture-${randomUUID()}`, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
        ownershipByBatch.set(task.authorization.pageBatchId, ownership);
      }
      return { pageOwnership: ownership, selectedIndex: selected.length + 1 };
    },
    upload: async (tasks, signal) => {
      signal.throwIfAborted();
      for (const task of tasks) {
      const fencePath = path.join(store.root, "selection-fences", `${task.result.upload_task_id}.json`);
      const fence = JSON.parse(await readFile(fencePath, "utf8")) as { upload_task_id: string; pageOwnership: PageOwnership };
      expect(fence.upload_task_id).toBe(task.result.upload_task_id);
      expect(fence.pageOwnership.pageBatchId).toBe(task.authorization.pageBatchId);
      expect((await stat(fencePath)).mode & 0o777).toBe(0o600);
      expect(store.hasMarker(task.result.upload_task_id)).toBe(true);
      expect(await readFile(task.snapshotPath)).toEqual(await readFile(task.input.video_path));
      }
      events.push("file-input");
    },
    ready: async tasks => {
      events.push("ready");
      return tasks.map(task => {
        const fence = store.fence(task.result.upload_task_id)!;
        const count = store.tasks().filter(other => other.authorization.pageBatchId === task.authorization.pageBatchId && store.hasMarker(other.result.upload_task_id)).length;
        return evidenceFor(task, fence.pageOwnership, count);
      });
    },
    pollReady: async (tasks, signal) => browser.ready(tasks, signal),
    readOnlyCheck: async (task, ownership, selected) => {
      events.push("readonly");
      expect(selected.some(file => file.fileName === task.result.file_name)).toBe(true);
      const fence = store.fence(task.result.upload_task_id)!;
      return evidenceFor(task, ownership, fence.selectedIndex);
    },
    stop: async () => { events.push("stop"); },
  };
  const uploader = new DouyinUploadService(store, {
    loadBatch: async id => (await jobs.load(id)).state,
    browser: () => browser,
    accounts: new QianchuanAccountConfigReader(),
    readiness: () => undefined,
  });
  await uploader.chooseConfig(accountConfigPath);
  await uploader.configure({ enabled: true });

  const originalSave = jobs.save.bind(jobs);
  jobs.save = async state => { await saveGate?.(state.batch.tasks[0]!.status); await originalSave(state); };
  const facts: { projectId: string; batchId: string; taskId: string; artifact: OutputArtifact }[] = [];
  const callback = vi.fn(async (fact: typeof facts[number]) => {
    facts.push(fact);
    await uploader.committed({ project_id: fact.projectId, batch_id: fact.batchId, export_task_id: fact.taskId });
  });
  const queue = new ExportQueue({
    jobStore: jobs,
    ffmpeg: { ffmpegPath: "/fake", run: (args: string[]) => ({ process: {}, promise: writeFile(args.at(-1)!, "encoded final").then(() => ({ code: 0, stdout: "", stderr: "" })), cancel: async () => {} }) } as unknown as FfmpegAdapter,
    compiler: { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any,
    artifactVerifier: { verify: async (file: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: file, sizeBytes: (await readFile(file)).length, durationMs: 1000, createdAt: now() }) } as ArtifactVerifier,
    fontResolver: { resolve: async () => null }, onFinalArtifactCommitted: callback,
  });
  queue.setMediaLookup(() => media);
  const input = { template: createDefaultTemplate(), projectId: randomUUID(), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out"), preset: DEFAULT_PRESET };
  async function preflight(count = 1) {
    const authorization = await uploader.preflight(uploadSelection, count);
    if (!authorization) throw new Error("fixture upload selection unexpectedly disabled");
    return authorization;
  }
  async function waitUntilReady() {
    await vi.waitFor(() => expect(store.tasks()[0]?.result.state).toBe("WAITING_FOR_CONFIRMATION"));
  }
  return { queue, jobs, uploader, store, input, media, sample, callback, facts, events, preflight, waitUntilReady };
}

function evidenceFor(task: Parameters<UploadBrowserPort["ready"]>[0][number], pageOwnership: PageOwnership, selectedCount: number): ReadyEvidence {
  return {
    advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId,
    fileName: task.result.file_name, selectedCount, observedAt: new Date().toISOString(), pageOwnership,
  };
}

describe("formal export to Qianchuan upload boundary", () => {
  it("atomically registers all reviewed versions, uploads only committed files and replays without browser effects", async () => {
    const f = await fixture();
    const batches = [await f.queue.createBatch(f.input), await f.queue.createBatch(f.input)];
    const preflight = vi.spyOn(f.uploader, "preflight"), save = vi.spyOn(f.store, "saveIntents");
    await registerReviewedCoverUploads(f.uploader, batches, uploadSelection, new AbortController().signal);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(preflight).toHaveBeenCalledWith(uploadSelection, 2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.store.intents()).toHaveLength(2);
    expect(new Set(f.store.intents().map(intent => intent.authorization.pageBatchId)).size).toBe(1);
    expect(f.store.tasks()).toHaveLength(0);
    expect(f.events).not.toContain("file-input");
    await f.queue.start(batches[0].id);
    await f.waitUntilReady();
    const events = [...f.events], before = f.store.intents();
    await registerReviewedCoverUploads(f.uploader, batches, uploadSelection, new AbortController().signal);
    expect(f.events).toEqual(events);
    expect(f.store.intents()).toEqual(before);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    await expect(registerReviewedCoverUploads(f.uploader, batches, { enabled: true, accountProduct: "肥皂" }, new AbortController().signal)).rejects.toThrow(/冲突/);
    expect(f.store.intents()).toEqual(before);
  });

  it("refuses partial prior registration, cancelled admission and registration of already produced history", async () => {
    const f = await fixture();
    const batches = [await f.queue.createBatch(f.input), await f.queue.createBatch(f.input)];
    const abort = new AbortController(); abort.abort();
    await expect(registerReviewedCoverUploads(f.uploader, batches, uploadSelection, abort.signal)).rejects.toThrow();
    expect(f.store.intents()).toHaveLength(0);
    await f.uploader.registerBatch(batches[0], uploadSelection, await f.preflight(2));
    await expect(registerReviewedCoverUploads(f.uploader, batches, uploadSelection, new AbortController().signal)).rejects.toThrow(/不完整/);
    expect(f.store.intents()).toHaveLength(1);
    const unrelated = await f.queue.createBatch(f.input);
    await f.queue.start(unrelated.id);
    const completed = (await f.jobs.load(unrelated.id)).state.batch;
    await expect(registerReviewedCoverUploads(f.uploader, [completed], uploadSelection, new AbortController().signal)).rejects.toThrow(/历史成片/);
  });

  it("does not leave a partial version ledger when the single atomic registration fails", async () => {
    const f = await fixture();
    const batches = [await f.queue.createBatch(f.input), await f.queue.createBatch(f.input)];
    const save = vi.spyOn(f.store, "saveIntents").mockRejectedValueOnce(new Error("disk failure"));
    await expect(registerReviewedCoverUploads(f.uploader, batches, uploadSelection, new AbortController().signal)).rejects.toThrow("disk failure");
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.store.intents()).toHaveLength(0);
    expect(f.events).not.toContain("file-input");
    await registerReviewedCoverUploads(f.uploader, batches, uploadSelection, new AbortController().signal);
    expect(f.store.intents()).toHaveLength(2);
  });
  it("waits for completed save and binds the collision-resolved formal MP4 path and bytes", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let completedSave = false;
    const f = await fixture(async status => { if (status === "completed") { completedSave = true; await gate; } });
    const batch = await f.queue.createBatch(f.input);
    const authorization = await f.preflight(batch.tasks.length);
    await f.uploader.registerBatch(batch, uploadSelection, authorization);
    await writeFile(batch.tasks[0]!.outputPath!, "existing output");

    const work = f.queue.start(batch.id);
    await vi.waitFor(() => expect(completedSave).toBe(true));
    expect(f.callback).not.toHaveBeenCalled();
    expect(f.store.tasks()).toHaveLength(0);

    release();
    await work;
    await f.waitUntilReady();
    const task = (await f.jobs.load(batch.id)).state.batch.tasks[0]!;
    const upload = f.store.tasks()[0]!;
    expect(f.facts[0]!.artifact.path).toBe(task.outputArtifact?.path);
    expect(task.outputPath).not.toBe(batch.tasks[0]!.outputPath);
    expect(upload.input.video_path).toBe(task.outputArtifact?.path);
    expect(upload.result.file_name).toBe(path.basename(task.outputArtifact!.path));
    expect(await readFile(upload.snapshotPath)).toEqual(await readFile(task.outputArtifact!.path));
    expect(upload.result.state).toBe("WAITING_FOR_CONFIRMATION");
    expect(f.events).toEqual(["connect", "open", "file-input", "ready"]);
    expect(await readFile(batch.tasks[0]!.outputPath!, "utf8")).toBe("existing output");
  });

  it("does not admit an export when the completed JobStore save rejects", async () => {
    const f = await fixture(async status => { if (status === "completed") throw new Error("save failure"); });
    const batch = await f.queue.createBatch(f.input);
    const authorization = await f.preflight(batch.tasks.length);
    await f.uploader.registerBatch(batch, uploadSelection, authorization);

    await expect(f.queue.start(batch.id)).rejects.toThrow();
    expect(f.callback).not.toHaveBeenCalled();
    expect(f.store.tasks()).toHaveLength(0);
    expect((await f.jobs.load(batch.id)).state.batch.tasks[0]!.status).toBe("verifying");
    expect(f.events).toEqual([]);
  });

  it("automatically uploads formal output once and keeps its marker across restart, repeated notification and same-byte new output", async () => {
    const f = await fixture();
    const batch = await f.queue.createBatch(f.input);
    await f.uploader.registerBatch(batch, uploadSelection, await f.preflight(batch.tasks.length));
    await f.queue.start(batch.id);
    await f.waitUntilReady();
    const first = f.store.tasks()[0]!;
    const fencePath = path.join(f.store.root, "selection-fences", `${first.result.upload_task_id}.json`);
    const fenceBytes = await readFile(fencePath);
    const identity = { project_id: batch.projectId!, batch_id: batch.id, export_task_id: batch.tasks[0]!.id };
    await f.uploader.stop();

    const reopenedStore = new DouyinUploadStore(f.store.root); await reopenedStore.load();
    const browserFactory = vi.fn((): UploadBrowserPort => { throw new Error("already uploaded bytes must never open a browser"); });
    const recovered = new DouyinUploadService(reopenedStore, {
      loadBatch: async id => (await f.jobs.load(id)).state, browser: browserFactory,
      accounts: new QianchuanAccountConfigReader(), readiness: () => undefined,
    });
    await recovered.restoreConfig(); await recovered.reconcile();
    await recovered.committed(identity); await recovered.runPending();
    expect(reopenedStore.tasks()).toHaveLength(1);
    expect(reopenedStore.task(first.result.upload_task_id)?.result).toEqual(first.result);
    expect(await readFile(fencePath)).toEqual(fenceBytes);

    f.callback.mockImplementation(async fact => {
      await recovered.committed({ project_id: fact.projectId, batch_id: fact.batchId, export_task_id: fact.taskId });
    });
    const nextBatch = await f.queue.createBatch(f.input);
    const authorization = await recovered.preflight(uploadSelection, nextBatch.tasks.length);
    await recovered.registerBatch(nextBatch, uploadSelection, authorization);
    await f.queue.start(nextBatch.id);
    await vi.waitFor(() => expect(reopenedStore.tasks()).toHaveLength(2));
    await recovered.runPending();
    const duplicate = reopenedStore.tasks().find(task => task.input.batch_id === nextBatch.id)!;
    expect(duplicate.result).toMatchObject({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", duplicate_of: first.result.upload_task_id });
    expect(duplicate.input.video_path).not.toBe(first.input.video_path);
    expect(duplicate.input.artifact_sha256).toBe(first.input.artifact_sha256);
    expect(reopenedStore.hasMarker(first.result.upload_task_id)).toBe(true);
    expect(reopenedStore.hasMarker(duplicate.result.upload_task_id)).toBe(false);
    expect(browserFactory).not.toHaveBeenCalled();
    expect(f.events.filter(event => event === "file-input")).toHaveLength(1);
    await recovered.stop();
  });

  it("registers a frozen target for an approved sample but uploads only the committed formal output", async () => {
    const f = await fixture();
    const authorization = await f.preflight(1);
    let created = false;
    const result = await f.queue.publishApprovedSample({
      ...f.input, media: f.media, samplePath: f.sample,
      onTaskCreated: async batch => {
        expect(Object.keys(batch).sort()).toEqual(["id", "projectId", "tasks"]);
        expect(Object.keys(batch.tasks[0]!).sort()).toEqual(["id"]);
        const saved = (await f.jobs.load(batch.id)).state.batch.tasks[0]!;
        expect(saved.status).toBe("validating");
        await expect(readFile(saved.outputPath!)).rejects.toThrow();
        await f.uploader.registerBatch(batch, uploadSelection, authorization);
        created = true;
      },
    });

    expect(created).toBe(true);
    await f.waitUntilReady();
    expect(f.store.tasks()[0]!.input.video_path).toBe(result.outputPath);
    expect(result.outputPath).not.toBe(f.sample);
    expect(await readFile(f.store.tasks()[0]!.snapshotPath)).toEqual(await readFile(result.outputPath));
    expect(f.events).toEqual(["connect", "open", "file-input", "ready"]);
  });

  it("keeps export completion when authorization registration or the upload notification fails", async () => {
    const f = await fixture();
    f.callback.mockImplementation(async () => { throw new Error("notification failed"); });
    const result = await f.queue.publishApprovedSample({
      ...f.input, media: f.media, samplePath: f.sample,
      onTaskCreated: async () => { throw new Error("intent registration failed"); },
    });
    expect((await f.jobs.load(result.batchId)).state.batch.tasks[0]!.status).toBe("completed");
    expect(f.store.tasks()).toHaveLength(0);
    expect(f.events).toEqual([]);
  });

  it("reconciles a missed completion notification into pending state without waking restored work", async () => {
    const f = await fixture();
    const batch = await f.queue.createBatch(f.input);
    const authorization = await f.preflight(batch.tasks.length);
    await f.uploader.registerBatch(batch, uploadSelection, authorization);
    f.callback.mockImplementation(async () => {});
    await f.queue.start(batch.id);
    expect(f.store.tasks()).toHaveLength(0);

    await f.uploader.reconcile();
    expect(f.store.tasks()).toHaveLength(1);
    expect(f.store.tasks()[0]!.result.state).toBe("PENDING");
    await f.uploader.runPending();
    expect(f.events).toEqual([]);
    expect(f.store.tasks()[0]!.result.state).toBe("PENDING");

    const unrelated = await f.queue.createBatch({ ...f.input, projectId: randomUUID() });
    await f.queue.start(unrelated.id);
    await f.uploader.reconcile();
    expect(f.store.tasks()).toHaveLength(1);
    expect(f.events).toEqual([]);
  });
});
