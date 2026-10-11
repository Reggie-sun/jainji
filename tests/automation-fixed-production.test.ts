import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { BatchProductionController } from "../src/main/batch-production-controller";
import { createDefaultProject } from "../src/main/domain";
import { ProjectStore } from "../src/main/store";

it("freezes the supplied main-process project without rereading mutable recent projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fixed-production-"));
  const project = createDefaultProject("固定模板"), recentId = crypto.randomUUID();
  project.mediaItems = [{ id: crypto.randomUUID(), sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100,
    durationMs: 1000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }];
  const load = vi.fn(async () => { throw new Error("must not read mutable template"); });
  let frozenName = "";
  const controller = new BatchProductionController(root, {
    name: () => "当前名称", loadProject: load, outputDirectory: async () => "/output",
    taskStatuses: () => new Map(), queue: () => ({ revision: 0, batches: [] }), cancelExport: async () => {}, changed: () => {},
    session: async file => {
      frozenName = (await new ProjectStore(file).readSnapshot()).name;
      return { busy: false, start: async () => {}, snapshot: () => undefined, cancel: async () => {}, persist: async () => {} };
    },
  });
  try {
    const promise = controller.start({ entries: [{ recentProjectId: recentId, requestedCount: 1, productPrice: "文字", coverEnabled: false, displayMode: "full", mode: "random" }] }, new Map([[recentId, project]]));
    project.name = "更改后";
    await promise; await vi.waitFor(() => expect(controller.busy).toBe(false));
    expect(load).not.toHaveBeenCalled(); expect(frozenName).toBe("固定模板");
  } finally { await controller.cancel(); await rm(root, { recursive: true, force: true }); }
});

it.each(["job", "run"] as const)("shares the original %s cancellation signal with early upload adapters", async kind => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fixed-production-cancel-"));
  const project = createDefaultProject("固定模板"), recentId = crypto.randomUUID();
  project.mediaItems = [{ id: crypto.randomUUID(), sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100,
    durationMs: 1000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }];
  let busy = true, started = false;
  const controller = new BatchProductionController(root, {
    name: () => "固定模板", loadProject: async () => project, outputDirectory: async () => "/output",
    taskStatuses: () => new Map(), queue: () => ({ revision: 0, batches: [] }), cancelExport: async () => {}, changed: () => {},
    session: async () => ({ get busy() { return busy; }, start: async () => { started = true; }, snapshot: () => undefined,
      cancel: async () => { busy = false; }, persist: async () => {} }),
  });
  try {
    const run = await controller.start({ entries: [{ recentProjectId: recentId, requestedCount: 1, productPrice: "文字", coverEnabled: false, displayMode: "full", mode: "random" }] });
    await vi.waitFor(() => expect(started).toBe(true));
    const jobId = run.jobs[0].id, signal = controller.executionSignal(run.id, jobId);
    expect(signal.aborted).toBe(false);
    expect(() => controller.executionSignal(crypto.randomUUID(), jobId)).toThrow("变化");
    if (kind === "job") await controller.cancelJob({ runId: run.id, jobId });
    else await controller.cancel();
    expect(signal.aborted).toBe(true);
    expect(() => controller.executionSignal(run.id, jobId)).toThrow("取消");
  } finally { await controller.cancel(); await rm(root, { recursive: true, force: true }); }
});
