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
    open: async (task, selected, signal) => {
      signal.throwIfAborted(); events.push("open");
      let ownership = ownershipByBatch.get(task.authorization.pageBatchId);
      if (!ownership) {
        ownership = { targetId: `fixture-${randomUUID()}`, pageBatchId: task.authorization.pageBatchId, modalSessionId: randomUUID() };
        ownershipByBatch.set(task.authorization.pageBatchId, ownership);
      }
      return { pageOwnership: ownership, selectedIndex: selected.length + 1 };
    },
    upload: async (task, signal) => {
      signal.throwIfAborted();
      const fencePath = path.join(store.root, "selection-fences", `${task.result.upload_task_id}.json`);
      const fence = JSON.parse(await readFile(fencePath, "utf8")) as { upload_task_id: string; pageOwnership: PageOwnership };
      expect(fence.upload_task_id).toBe(task.result.upload_task_id);
      expect(fence.pageOwnership.pageBatchId).toBe(task.authorization.pageBatchId);
      expect((await stat(fencePath)).mode & 0o777).toBe(0o600);
      expect(store.hasMarker(task.result.upload_task_id)).toBe(true);
      expect(await readFile(task.snapshotPath)).toEqual(await readFile(task.input.video_path));
      events.push("file-input");
    },
    ready: async task => {
      events.push("ready");
      const fence = store.fence(task.result.upload_task_id)!;
      return evidenceFor(task, fence.pageOwnership, fence.selectedIndex);
    },
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

function evidenceFor(task: Parameters<UploadBrowserPort["ready"]>[0], pageOwnership: PageOwnership, selectedCount: number): ReadyEvidence {
  return {
    advertiserId: task.authorization.target.advertiserId, adId: task.authorization.target.adId,
    fileName: task.result.file_name, selectedCount, observedAt: new Date().toISOString(), pageOwnership,
  };
}

describe("formal export to Qianchuan upload boundary", () => {
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
