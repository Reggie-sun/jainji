import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { DEFAULT_PRESET, now, type Project } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import type { QueueSnapshot } from "../src/main/queue";
import { ProjectStore } from "../src/main/store";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-sync-"));
  directories.push(directory);
  const file = path.join(directory, "project.json");
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  await service.saveProject(file);
  const id = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const snapshot: QueueSnapshot = { revision: 1, batches: [{
    schemaVersion: 2, revision: 1, updatedAt: now(),
    batch: {
      schemaVersion: 2, id, projectId: service.currentProject.id,
      templateSnapshot: service.activeTemplate, mediaIds: [mediaId],
      outputDirectory: directory, preset: DEFAULT_PRESET, status: "active", estimatedBytes: 0, createdAt: now(),
      tasks: [{ id: crypto.randomUUID(), batchId: id, mediaId, status: "running", progress: 0, attempt: 1, createdAt: now(), attempts: [] }],
    },
  }] };
  return { service, file, snapshot };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("bounds project saves during a progress burst and persists the latest state", async () => {
  const { service, file, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  const original = ProjectStore.prototype.save;
  const save = vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async function (this: ProjectStore, project: Project) {
    const frozen = structuredClone(project);
    started.resolve();
    await gate.promise;
    await original.call(this, frozen);
  });
  const first = service.syncQueue(snapshot);
  await started.promise;
  const pending = [];
  for (let index = 1; index <= 100; index++) {
    snapshot.batches[0].batch.tasks[0].progress = index / 100;
    pending.push(service.syncQueue(snapshot));
  }
  const writesWhileBlocked = save.mock.calls.length;
  const distinctPending = new Set(pending).size;
  gate.resolve();
  await Promise.all([first, ...pending]);
  expect(writesWhileBlocked).toBe(1);
  expect(distinctPending).toBe(1);
  expect(save).toHaveBeenCalledTimes(2);
  const saved = JSON.parse(await readFile(file, "utf8"));
  expect(saved.exportBatches[0].tasks[0].progress).toBe(1);
  expect(service.hasUnsavedChanges).toBe(false);
});

it("keeps unsaved changes after an autosave failure and retries on the next update", async () => {
  const { service, file, snapshot } = await fixture();
  vi.spyOn(ProjectStore.prototype, "save").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(service.syncQueue(snapshot)).rejects.toThrow("disk unavailable");
  expect(service.hasUnsavedChanges).toBe(true);
  snapshot.batches[0].batch.tasks[0].progress = 0.5;
  await service.syncQueue(snapshot);
  expect(JSON.parse(await readFile(file, "utf8")).exportBatches[0].tasks[0].progress).toBe(0.5);
  expect(service.hasUnsavedChanges).toBe(false);
});

it("reports invalid queue state as a rejected promise to snapshot subscribers", async () => {
  const { service, snapshot } = await fixture();
  snapshot.batches[0].batch.tasks[0].progress = 2;
  let pending!: Promise<void>;
  expect(() => { pending = service.syncQueue(snapshot); }).not.toThrow();
  await expect(pending).rejects.toThrow();
});

it("still saves a pending final update if the active autosave fails", async () => {
  const { service, file, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  const save = vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async () => {
    started.resolve();
    await gate.promise;
    throw new Error("first write failed");
  });
  const first = service.syncQueue(snapshot);
  await started.promise;
  snapshot.batches[0].batch.tasks[0].progress = 1;
  const final = service.syncQueue(snapshot);
  const settled = Promise.allSettled([first, final]);
  gate.resolve();
  await settled;
  expect(save).toHaveBeenCalledTimes(2);
  expect(JSON.parse(await readFile(file, "utf8")).exportBatches[0].tasks[0].progress).toBe(1);
  expect(service.hasUnsavedChanges).toBe(false);
  await expect(first).rejects.toThrow("first write failed");
});

it("does not clear edits made while a project save is in flight", async () => {
  const { service, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async () => { started.resolve(); await gate.promise; });
  const pending = service.syncQueue(snapshot);
  await started.promise;
  service.renameProject("edited during save");
  gate.resolve();
  await pending;
  expect(service.hasUnsavedChanges).toBe(true);
});

it("does not mark a newly selected project saved when the old autosave completes", async () => {
  const { service, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async () => { started.resolve(); await gate.promise; });
  const pending = service.syncQueue(snapshot);
  await started.promise;
  service.newProject("new project");
  gate.resolve();
  await pending;
  expect(service.currentProject.name).toBe("new project");
  expect(service.hasUnsavedChanges).toBe(true);
});

it("does not overwrite an explicit replacement project with an old pending autosave", async () => {
  const { service, file, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  const original = ProjectStore.prototype.save;
  vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async function (this: ProjectStore, project: Project) {
    const frozen = structuredClone(project);
    await original.call(this, frozen);
    started.resolve();
    await gate.promise;
  });
  const first = service.syncQueue(snapshot);
  await started.promise;
  snapshot.batches[0].batch.tasks[0].progress = 1;
  const final = service.syncQueue(snapshot);
  service.newProject("replacement project");
  const saved = service.saveProject(file);
  await saved;
  gate.resolve();
  await Promise.all([first, final, saved]);
  const disk = JSON.parse(await readFile(file, "utf8"));
  expect(disk.id).toBe(service.currentProject.id);
  expect(disk.name).toBe("replacement project");
  expect(service.hasUnsavedChanges).toBe(false);
});

it("does not include later unsaved edits in a pending autosave snapshot", async () => {
  const { service, file, snapshot } = await fixture();
  const originalName = service.currentProject.name;
  const gate = deferred();
  const started = deferred();
  vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async () => { started.resolve(); await gate.promise; });
  const first = service.syncQueue(snapshot);
  await started.promise;
  snapshot.batches[0].batch.tasks[0].progress = 1;
  const final = service.syncQueue(snapshot);
  service.renameProject("later unsaved edit");
  gate.resolve();
  await Promise.all([first, final]);
  expect(JSON.parse(await readFile(file, "utf8")).name).toBe(originalName);
  expect(service.hasUnsavedChanges).toBe(true);
});

it("supersedes the old autosave destination after save-as without waiting for future progress", async () => {
  const { service, file, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  const original = ProjectStore.prototype.save;
  vi.spyOn(ProjectStore.prototype, "save").mockImplementationOnce(async function (this: ProjectStore, project: Project) {
    await original.call(this, project);
    started.resolve();
    await gate.promise;
  });
  const first = service.syncQueue(snapshot);
  await started.promise;
  snapshot.batches[0].batch.tasks[0].progress = 1;
  const final = service.syncQueue(snapshot);
  const newFile = path.join(path.dirname(file), "save-as.json");
  await service.saveProject(newFile, "saved as");
  service.renameProject("later unsaved edit");
  gate.resolve();
  await Promise.all([first, final]);
  expect(JSON.parse(await readFile(file, "utf8")).exportBatches[0].tasks[0].progress).toBe(0);
  const saved = JSON.parse(await readFile(newFile, "utf8"));
  expect(saved.name).toBe("saved as");
  expect(saved.exportBatches[0].tasks[0].progress).toBe(1);
  expect(service.hasUnsavedChanges).toBe(true);
});

it("does not overwrite a manual save of the same project with an older pending snapshot", async () => {
  const { service, file, snapshot } = await fixture();
  const gate = deferred();
  const started = deferred();
  const original = ProjectStore.prototype.save;
  let chain = Promise.resolve();
  let firstWrite = true;
  vi.spyOn(ProjectStore.prototype, "save").mockImplementation(function (this: ProjectStore, project: Project) {
    const frozen = structuredClone(project);
    // Mirror the store's per-path serialization, blocking the first disk write.
    const work = chain.then(async () => {
      if (firstWrite) { firstWrite = false; started.resolve(); await gate.promise; }
      await original.call(this, frozen);
    });
    chain = work.catch(() => undefined);
    return work;
  });
  const first = service.syncQueue(snapshot);
  await started.promise;
  snapshot.batches[0].batch.tasks[0].progress = 1;
  const final = service.syncQueue(snapshot);
  const manual = service.saveProject(file, "manually saved new name");
  await vi.waitFor(() => expect(service.currentProject.name).toBe("manually saved new name"));
  gate.resolve();
  await Promise.all([first, final, manual]);
  const saved = JSON.parse(await readFile(file, "utf8"));
  expect(saved.name).toBe("manually saved new name");
  expect(saved.exportBatches[0].tasks[0].progress).toBe(1);
  expect(service.hasUnsavedChanges).toBe(false);
});
