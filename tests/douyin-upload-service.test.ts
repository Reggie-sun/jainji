import { mkdtemp, mkdir, readFile, writeFile, chmod, rename, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadConfigSchema, uploadFailure } from "../src/shared/douyin-upload";
import { createDefaultTemplate, DEFAULT_PRESET, BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, now, type QueueState } from "../src/main/domain";

async function setup(options: { publishFails?: boolean; connectFails?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "douyin-service-")); const output = path.join(root, "out"); await mkdir(output);
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  await store.setConfig(DouyinUploadConfigSchema.parse({ enabled: true }));
  const states = new Map<string, QueueState>(); const events: string[] = [];
  const port: UploadBrowserPort = {
    connect: async () => { events.push("connect"); if (options.connectFails) throw uploadFailure("CDP_UNAVAILABLE", "browser", "暂时无法连接。", "检查浏览器。", false, true); },
    open: async () => { events.push("open"); }, upload: async task => { events.push("upload"); expect(await readFile(task.snapshotPath, "utf8")).toBe("encoded"); },
    ready: async () => {}, fill: async () => {},
    publish: async task => { expect(store.hasMarker(task.result.upload_task_id)).toBe(true); events.push("publish"); if (options.publishFails) throw new Error("token=secret /home/private"); },
    verify: async () => { events.push("verify"); return { platform_content_id: "123", accepted_status: "reviewing", confirmation_source: "browser", url: "https://creator.douyin.com/detail/123", observed_at: now(), evidence: "Same ID reopened in management page" }; },
    stop: async () => { events.push("stop"); },
  };
  const service = new DouyinUploadService(store, { loadBatch: async id => { const state = states.get(id); if (!state) throw new Error("missing"); return state; }, browser: () => port, retryDelay: async () => {} });
  async function artifact(contents = "encoded") {
    const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), taskId = crypto.randomUUID();
    const video = path.join(output, `${taskId}.mp4`); await writeFile(video, contents);
    const batch: QueueState["batch"] = { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory: output, preset: DEFAULT_PRESET, status: "completed" as const, estimatedBytes: 7, createdAt: now(), tasks: [{ id: taskId, batchId, mediaId: crypto.randomUUID(), status: "completed" as const, progress: 1, attempt: 1, createdAt: now(), attempts: [], outputPath: video, outputArtifact: { taskId, path: video, sizeBytes: contents.length, durationMs: 1000, createdAt: now() } }] };
    states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, batch, updatedAt: now() });
    const identity = { project_id: projectId, batch_id: batchId, export_task_id: taskId };
    await service.registerIntent(identity, { enabled: true, caption: "手工" }); return { identity, video };
  }
  return { store, service, events, artifact, states, port, root };
}

describe("Douyin admission and serial executor", () => {
  it("only admits selected durable formal files, snapshots them and publishes each byte identity once", async () => {
    const { service, events, artifact } = await setup(); const a = await artifact(), b = await artifact();
    await Promise.all([service.enqueueFinalArtifact(a.identity), service.enqueueFinalArtifact(b.identity), service.enqueueFinalArtifact(a.identity)]);
    await service.runPending();
    expect(events.filter(event => event === "publish")).toHaveLength(1);
    const results = service.status(a.identity.project_id).tasks;
    expect(results[0]).toMatchObject({ state: "SUCCEEDED", publish_outcome: "ACCEPTED" });
    expect(service.status(b.identity.project_id).tasks[0].duplicate_of).toBe(results[0].upload_task_id);
  });
  it("keeps unknown submission fenced and only verifies after explicit resume", async () => {
    const { store, service, events, artifact } = await setup({ publishFails: true }); const a = await artifact(); const b = await artifact("otherxx");
    await service.enqueueFinalArtifact(a.identity); await service.enqueueFinalArtifact(b.identity); await service.runPending();
    const result = service.status(a.identity.project_id).tasks[0];
    expect(result).toMatchObject({ state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED", retryable: false });
    expect(JSON.stringify(result)).not.toContain("secret"); expect(JSON.stringify(result)).not.toContain("/home/private");
    expect(store.hasMarker(result.upload_task_id)).toBe(true);
    expect(service.status(b.identity.project_id).tasks[0].state).toBe("PENDING");
    await service.resume(result.upload_task_id);
    expect(events.filter(event => event === "publish")).toHaveLength(1);
    expect(events.filter(event => event === "verify")).toHaveLength(1);
  });
  it("does not connect on load/reconcile or disabled configuration and rejects changed bytes", async () => {
    const { service, artifact, events, store } = await setup(); const a = await artifact();
    await service.reconcile(); expect(events).toEqual([]);
    await store.setConfig({ ...store.config, enabled: false }); await service.runPending(); expect(events).toEqual([]);
    await writeFile(a.video, "changed");
    await expect(service.enqueueFinalArtifact(a.identity)).rejects.toMatchObject({ failure: { code: "ARTIFACT_CHANGED" } });
  });
  it("accumulates only two safe automatic retries and preserves cancellation", async () => {
    const { service, artifact, events } = await setup({ connectFails: true }); const a = await artifact(); await service.enqueueFinalArtifact(a.identity); await service.runPending();
    const result = service.status(a.identity.project_id).tasks[0];
    expect(result).toMatchObject({ state: "FAILED_RETRYABLE", retry_count: 2, attempt_count: 3, publish_outcome: "NOT_SUBMITTED" });
    expect(events.filter(event => event === "connect")).toHaveLength(3);
    await service.cancel(result.upload_task_id); expect(service.status(a.identity.project_id).tasks[0].state).toBe("CANCELLED");
  });
  it("unselected files and non-completed tasks never reach the browser", async () => {
    const { service, artifact, states, events } = await setup(); const a = await artifact();
    states.get(a.identity.batch_id)!.batch.tasks[0].status = "failed";
    await expect(service.enqueueFinalArtifact(a.identity)).rejects.toMatchObject({ failure: { code: "EXPORT_NOT_COMMITTED" } });
    expect(await service.enqueueFinalArtifact({ ...a.identity, export_task_id: crypto.randomUUID() })).toBeUndefined();
    expect(events).toEqual([]);
  });
  it.each(["mov", "outside", "symlink", "missing"] as const)("rejects %s artifacts before creating a task or browser side effect", async kind => {
    const f = await setup(); const a = await f.artifact();
    const task = f.states.get(a.identity.batch_id)!.batch.tasks[0];
    if (kind === "mov" || kind === "outside") {
      const target = kind === "mov" ? a.video.replace(/\.mp4$/, ".mov") : path.join(f.root, "outside.mp4");
      await rename(a.video, target); task.outputPath = target; task.outputArtifact!.path = target;
    } else if (kind === "symlink") {
      const target = path.join(f.root, "real.mp4"); await rename(a.video, target); await symlink(target, a.video);
    } else await unlink(a.video);
    const code = { mov: "UNSUPPORTED_FORMAT", outside: "EXPORT_NOT_COMMITTED", symlink: "ARTIFACT_CHANGED", missing: "ARTIFACT_UNAVAILABLE" }[kind];
    await expect(f.service.enqueueFinalArtifact(a.identity)).rejects.toMatchObject({ failure: { code } });
    await f.service.runPending(); expect(f.events).toEqual([]); expect(f.store.tasks()).toEqual([]);
  });
  it("concurrent manual resumes remain serial and cannot double publish", async () => {
    const { service, artifact, events } = await setup(); const a = await artifact(); const task = await service.enqueueFinalArtifact(a.identity);
    await Promise.all([service.resume(task!.result.upload_task_id), service.resume(task!.result.upload_task_id)]);
    expect(events.filter(event => event === "publish")).toHaveLength(1);
  });
  it("restored pending records are not silently awakened by a new artifact", async () => {
    const f = await setup(); const old = await f.artifact(); await f.service.enqueueFinalArtifact(old.identity);
    const reopenedStore = new DouyinUploadStore(f.store.root); await reopenedStore.load();
    f.port.publish = async task => { expect(reopenedStore.hasMarker(task.result.upload_task_id)).toBe(true); f.events.push("publish"); };
    const reopened = new DouyinUploadService(reopenedStore, { loadBatch: async id => f.states.get(id)!, browser: () => f.port });
    await reopened.reconcile(); await reopened.runPending(); expect(f.events).toEqual([]);
    const next = await f.artifact("encoded"); await reopened.registerIntent(next.identity, { enabled: true, caption: "手工" });
    await reopened.enqueueFinalArtifact(next.identity); await reopened.runPending();
    expect(reopenedStore.tasks().find(task => task.input.export_task_id === old.identity.export_task_id)?.result.state).toBe("PENDING");
    expect(f.events.filter(event => event === "publish")).toHaveLength(1);
  });
  it("does not re-arm an admission that finishes while stopping", async () => {
    const f = await setup(); const old = await f.artifact(); let release!: () => void, loading = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const service = new DouyinUploadService(f.store, { loadBatch: async id => { if (id === old.identity.batch_id) { loading = true; await gate; } return f.states.get(id)!; }, browser: () => f.port });
    const admission = service.enqueueFinalArtifact(old.identity);
    await vi.waitFor(() => expect(loading).toBe(true));
    const stopping = service.stop(); release(); await admission; await stopping;
    await service.configure(f.store.config);
    const next = await f.artifact(); await service.enqueueFinalArtifact(next.identity); await service.runPending();
    expect(f.store.tasks().find(task => task.input.export_task_id === old.identity.export_task_id)?.result.state).toBe("PENDING");
    expect(f.store.tasks().find(task => task.input.export_task_id === next.identity.export_task_id)?.result.state).toBe("SUCCEEDED");
    expect(f.events.filter(event => event === "publish")).toHaveLength(1);
  });
  it("halts a delayed preparation before the fence on cancel or timeout", async () => {
    const f = await setup(); let release!: () => void;
    f.port.ready = async (_task, signal) => { await new Promise<void>(resolve => { release = resolve; }); signal.throwIfAborted(); };
    const a = await f.artifact(); const task = await f.service.enqueueFinalArtifact(a.identity);
    const work = f.service.runPending(); await vi.waitFor(() => expect(typeof release).toBe("function"));
    await f.service.cancel(task!.result.upload_task_id); release(); await work;
    expect(f.events).not.toContain("publish"); expect(f.store.hasMarker(task!.result.upload_task_id)).toBe(false);
    expect(f.service.status(a.identity.project_id).tasks[0].state).toBe("CANCELLED");
  });
  it("failed durable success remains unknown and resumes through verification only", async () => {
    const f = await setup(); const a = await f.artifact(); const task = await f.service.enqueueFinalArtifact(a.identity);
    const original = f.store.saveTask.bind(f.store); let fail = true;
    f.store.saveTask = async value => { if (value.result.state === "SUCCEEDED" && fail) { fail = false; throw new Error("disk failure"); } return original(value); };
    await f.service.runPending();
    expect(f.service.status(a.identity.project_id).tasks[0]).toMatchObject({ state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED" });
    await f.service.resume(task!.result.upload_task_id);
    expect(f.events.filter(event => event === "publish")).toHaveLength(1);
    expect(f.service.status(a.identity.project_id).tasks[0].state).toBe("SUCCEEDED");
  });
  it("rejects changed private snapshots and keeps manual caption revisions before submission", async () => {
    const f = await setup(); const a = await f.artifact(); const task = await f.service.enqueueFinalArtifact(a.identity);
    await f.service.reviseCaption(task!.result.upload_task_id, " 用户修订 ");
    expect(f.store.task(task!.result.upload_task_id)?.revisions).toHaveLength(1);
    await chmod(task!.snapshotPath, 0o600); await writeFile(task!.snapshotPath, "changed"); await chmod(task!.snapshotPath, 0o400);
    await f.service.runPending(); expect(f.events).not.toContain("publish");
    expect(f.service.status(a.identity.project_id).tasks[0]).toMatchObject({ state: "FAILED_TERMINAL", failure: { code: "ARTIFACT_CHANGED" } });
  });
  it("blocks same bytes with conflicting manual fields instead of claiming a second success", async () => {
    const f = await setup(); const a = await f.artifact(); await f.service.enqueueFinalArtifact(a.identity); await f.service.runPending();
    const b = await f.artifact(); const task = await f.service.enqueueFinalArtifact(b.identity); await f.service.reviseCaption(task!.result.upload_task_id, "不同文案"); await f.service.runPending();
    expect(f.events.filter(event => event === "publish")).toHaveLength(1);
    expect(f.service.status(b.identity.project_id).tasks[0]).toMatchObject({ state: "FAILED_TERMINAL", failure: { code: "INPUT_CONFLICT" } });
  });
  it("retains a known rejection and its fence without granting retry on restart", async () => {
    const f = await setup(); f.port.verify = async () => { throw uploadFailure("CONTENT_REJECTED", "input", "平台已拒绝。", "核查原因。", false); };
    const a = await f.artifact(); await f.service.enqueueFinalArtifact(a.identity); await f.service.runPending();
    const reopened = new DouyinUploadStore(f.store.root); await reopened.load();
    expect(reopened.tasks()[0].result).toMatchObject({ state: "FAILED_TERMINAL", publish_outcome: "REJECTED_KNOWN", retryable: false });
    expect(reopened.hasMarker(reopened.tasks()[0].result.upload_task_id)).toBe(true);
    expect(f.events.filter(event => event === "publish")).toHaveLength(1);
  });
});
