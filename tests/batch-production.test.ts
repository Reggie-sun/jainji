import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchProductionStartSchema } from "../src/shared/batch-production";
import { BatchProductionController, type BatchProductionSession } from "../src/main/batch-production-controller";
import { createDefaultProject, type ExportTask, type Project } from "../src/main/domain";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";
import type { AgentRun, AgentStartInput } from "../src/shared/agent";
import type { QueueSnapshot } from "../src/main/queue";
import { ProjectStore } from "../src/main/store";

const entry = () => ({ recentProjectId: crypto.randomUUID(), requestedCount: 5, productPrice: "手动文字", coverEnabled: false, displayMode: "full" as const });
const directories: string[] = [];
const controllers: BatchProductionController[] = [];
vi.setConfig({ testTimeout: 15000 });
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 25 });
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.cancel()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function project(name: string, count = 1): Project {
  const value = createDefaultProject(name);
  value.mediaItems = Array.from({ length: count }, (_, index) => ({ id: crypto.randomUUID(), sourcePath: `/fixture/${name}/素材/${index}.mp4`,
    displayName: `${index}.mp4`, fingerprint: "fixture", sizeBytes: 100, durationMs: 6000, width: 720, height: 1280,
    rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }));
  value.templates[0].productPriceDraft = "保存的文字";
  value.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: value.mediaItems.map(item => item.id),
    ruleId: "clean", brief: "保存的说明", decorations: { mode: "random" }, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS, requestedCount: 1 });
  return value;
}

async function fixture(options: { allComplete?: boolean; startThrows?: boolean; holding?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-batch-test-")); directories.push(root);
  const entries = [{ ...entry(), requestedCount: 1 }, { ...entry(), requestedCount: 1, displayMode: "first-5s" as const }];
  const projects = [project("蝴蝶贴"), project("氨糖膏")];
  const events: string[] = [];
  const tasks: ExportTask[] = [];
  const starts: AgentStartInput[] = [];
  const frozen: Project[] = [];
  const queue = () => ({ revision: 0, batches: projects.map(project => ({ batch: { projectId: project.id,
    tasks: tasks.filter(task => project.mediaItems.some(media => media.id === task.mediaId)) } })) } as unknown as QueueSnapshot);
  const dependencies = {
    name: (id: string) => projects[entries.findIndex(entry => entry.recentProjectId === id)].name,
    loadProject: vi.fn(async (id: string) => { events.push(`load:${id}`); return projects[entries.findIndex(entry => entry.recentProjectId === id)]; }),
    outputDirectory: vi.fn(async (value: Project) => `/output/${value.name}`),
    queue,
    taskStatuses: () => new Map(tasks.map(task => [task.id, task.status])),
    cancelExport: vi.fn(async (id: string) => { const task = tasks.find(task => task.id === id)!; if (task.status === "running") task.status = "cancelled"; }),
    changed: vi.fn(),
    session: vi.fn(async (file: string): Promise<BatchProductionSession> => {
      const value = await new ProjectStore(file).readSnapshot(); frozen.push(value);
      let run: AgentRun | undefined;
      let busy = false;
      return {
        get busy() { return busy; },
        snapshot: () => run,
        start: async input => {
          starts.push(input); events.push(`start:${value.name}`);
          busy = Boolean(options.holding);
          const status = options.allComplete || starts.length > 1 ? "completed" : "running";
          const items = Array.from({ length: input.requestedCount ?? input.mediaIds.length * (input.multiplier ?? 1) }, (_, index) => {
            const id = crypto.randomUUID(); tasks.push({ id, status, mediaId: input.mediaIds[index % input.mediaIds.length], progress: 0.37 } as ExportTask);
            return { id: crypto.randomUUID(), mediaId: input.mediaIds[index % input.mediaIds.length], version: Math.floor(index / input.mediaIds.length) + 1, name: value.name, taskId: id, status: "exporting" as const };
          });
          run = { id: crypto.randomUUID(), projectId: value.id, ruleId: "clean", status: busy ? "running" : "finished", items };
          if (options.startThrows && starts.length === 1) throw new Error("fixture preparation failed after enqueue");
        },
        cancel: async () => { busy = false; if (run) run.status = "cancelled"; for (const item of run?.items ?? []) await dependencies.cancelExport(item.taskId!); },
        persist: vi.fn(async () => {
          if (run) { value.latestProduction = { id: run.id, items: run.items }; await new ProjectStore(file).save(value); }
        }),
      };
    }),
  };
  const controller = new BatchProductionController(root, dependencies); controllers.push(controller);
  return { root, controller, dependencies, entries, projects, tasks, starts, frozen, events };
}

describe("cross-template batch admission", () => {
  it.each(["random", "manual", "agent"] as const)("freezes the explicitly chosen %s mode without changing saved templates", async mode => {
    const f = await fixture({ allComplete: true });
    f.projects[0].workspaceDraft!.decorations.mode = "agent";
    const saved = structuredClone(f.projects[0]);
    await f.controller.start({ entries: [{ ...f.entries[0], mode }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts[0].decorations?.mode).toBe(mode);
    expect(f.controller.snapshot()?.jobs[0].mode).toBe(mode);
    expect(f.projects[0]).toEqual(saved);
  });

  it("rejects unsupported modes before creating any production session", async () => {
    const f = await fixture();
    await expect(f.controller.start({ entries: [{ ...f.entries[0], mode: "fast" }] })).rejects.toThrow();
    expect(f.dependencies.session).not.toHaveBeenCalled();
  });

  it("observes the active job and waiting job without switching projects or starting sessions", async () => {
    const f = await fixture({ holding: true });
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    const first = await f.controller.details({ runId: run.id, jobId: run.jobs[0].id });
    expect(first.items).toHaveLength(1);
    expect(first.tasks).toHaveLength(1);
    expect(first.tasks[0].progress).toBe(0.37);
    const waiting = await f.controller.details({ runId: run.id, jobId: run.jobs[1].id });
    expect(waiting.items).toEqual([]); expect(waiting.tasks).toEqual([]);
    expect(f.dependencies.session).toHaveBeenCalledTimes(1);
    expect(f.dependencies.loadProject).toHaveBeenCalledTimes(2);
  });

  it("limits completed and restored details to this job's own tasks, excluding project history", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0].latestProduction = { id: crypto.randomUUID(), items: [{ id: crypto.randomUUID(), mediaId: f.projects[0].mediaItems[0].id,
      name: "旧批作品", version: 1, status: "failed" }] };
    const run = await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    f.tasks.push({ id: crypto.randomUUID(), mediaId: f.projects[0].mediaItems[0].id, status: "completed" } as ExportTask);
    for (const controller of [f.controller, new BatchProductionController(f.root, f.dependencies)]) {
      if (controller !== f.controller) await controller.restore();
      const detail = await controller.details({ runId: run.id, jobId: run.jobs[0].id });
      expect(detail.items.map(item => item.name)).toEqual(["蝴蝶贴"]);
      expect(detail.tasks.map(task => task.id)).toEqual([f.tasks[0].id]);
    }
    expect(f.dependencies.session).toHaveBeenCalledTimes(2);
  });

  it("rejects foreign or stale detail identifiers", async () => {
    const f = await fixture({ allComplete: true });
    const run = await f.controller.start({ entries: f.entries });
    await expect(f.controller.details({ runId: run.id, jobId: crypto.randomUUID() })).rejects.toThrow("重新选择");
    await expect(f.controller.details({ runId: crypto.randomUUID(), jobId: run.jobs[0].id })).rejects.toThrow("重新选择");
    await expect(f.controller.details({ runId: "../latest", jobId: run.jobs[0].id })).rejects.toThrow();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    await waitFor(() => expect(f.controller.busy).toBe(false));
    await f.controller.start({ entries: f.entries });
    await expect(f.controller.details({ runId: run.id, jobId: run.jobs[0].id })).rejects.toThrow("重新选择");
  });

  it("counts and waits for exports without reading full queue snapshots", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    const queueReads = vi.spyOn(f.dependencies, "queue");
    expect(f.controller.snapshot()?.jobs[0]).toMatchObject({ completedCount: 0, failedCount: 0 });
    f.controller.wake();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(queueReads).not.toHaveBeenCalled();
    queueReads.mockRestore();
  });
  it("requires manual display text and unique saved project references", () => {
    const row = entry();
    expect(BatchProductionStartSchema.safeParse({ entries: [{ ...row, productPrice: " " }] }).success).toBe(false);
    expect(BatchProductionStartSchema.safeParse({ entries: [row, row] }).success).toBe(false);
    expect(BatchProductionStartSchema.parse({ entries: [row, entry()] }).entries).toHaveLength(2);
    expect(BatchProductionController).toBeDefined();
  });

  it("rejects blank text before opening any template or starting a session", async () => {
    const f = await fixture();
    await expect(f.controller.start({ entries: [{ ...f.entries[0], productPrice: " " }] })).rejects.toThrow();
    expect(f.dependencies.loadProject).not.toHaveBeenCalled(); expect(f.dependencies.session).not.toHaveBeenCalled();
  });

  it("freezes every template and waits for actual verified export completion before the next product", async () => {
    const f = await fixture(); const originals = structuredClone(f.projects);
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    expect(f.starts).toHaveLength(1);
    expect(f.events.slice(0, 2)).toEqual(f.entries.map(entry => `load:${entry.recentProjectId}`));
    f.projects[1].workspaceDraft!.brief = "生产开始后的编辑";
    f.tasks[0].status = "verifying"; f.controller.wake();
    await new Promise(resolve => setTimeout(resolve, 50)); expect(f.starts).toHaveLength(1);
    f.tasks[0].status = "completed"; f.controller.wake();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts).toHaveLength(2); expect(f.starts[1].brief).toBe(originals[1].workspaceDraft!.brief);
    expect(f.starts.map(input => input.decorations?.displayMode)).toEqual(["full", "first-5s"]);
    expect(f.starts.map(input => input.decorations?.productPrice)).toEqual(["手动文字", "手动文字"]);
    expect(f.projects[0]).toEqual(originals[0]);
    expect(f.frozen[0].templates[0].productPriceDraft).toBe("手动文字");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["completed", "completed"]);
  });

  it("records a failed export and continues the next product without retry", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.tasks).toHaveLength(1));
    f.tasks[0].status = "failed"; f.controller.wake();
    f.tasks[0].errorMessage = "fixture encoder unavailable";
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.starts).toHaveLength(2);
    expect(f.controller.snapshot()?.jobs[0].failedCount).toBe(1);
    expect(f.controller.snapshot()?.jobs[0].error).toBe("fixture encoder unavailable");
  });

  it("continues after unreadable templates and never mutates saved cover configuration", async () => {
    const f = await fixture({ allComplete: true });
    f.dependencies.loadProject.mockRejectedValueOnce(new Error("fixture missing project"));
    const saved = structuredClone(f.projects[1]);
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.starts).toHaveLength(1); expect(f.projects[1]).toEqual(saved);
  });

  it("stops the current export and cancels all following products", async () => {
    const f = await fixture({ holding: true });
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.starts).toHaveLength(1));
    await f.controller.cancel();
    expect(f.controller.snapshot()?.status).toBe("cancelled");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["cancelled", "cancelled"]);
    expect(f.tasks[0].status).toBe("cancelled"); expect(f.starts).toHaveLength(1);
  });

  it("drains a partial enqueue when preparation fails before continuing", async () => {
    const f = await fixture({ startThrows: true });
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.tasks[0].status).toBe("cancelled");
    expect(f.controller.snapshot()?.jobs.map(job => job.status)).toEqual(["failed", "completed"]);
    expect(f.controller.snapshot()?.jobs[0].error).toContain("after enqueue");
  });

  it("uses exact per-project quantity and rejects assisted cover without bypassing approval", async () => {
    const f = await fixture({ allComplete: true });
    f.projects[0] = project("蝴蝶贴", 2);
    f.projects[1].coverSticker = { ...DEFAULT_COVER_STICKER, trackingMode: "assisted" };
    await f.controller.start({ entries: [{ ...f.entries[0], requestedCount: 3 }, { ...f.entries[1], coverEnabled: true }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    expect(f.starts[0].requestedCount).toBe(3);
    expect(f.starts[0].multiplier).toBeUndefined();
    expect(f.controller.snapshot()?.jobs[0].actualCount).toBe(3);
    expect(f.controller.snapshot()?.jobs[0].completedCount).toBe(3);
    expect(f.controller.snapshot()?.jobs[1].error).toContain("人工批准");
    expect(f.starts).toHaveLength(1);
  });

  it.each([100, 250, 5])("makes exactly %i outputs from 33 sources", async requestedCount => {
    const f = await fixture({ allComplete: true });
    f.projects[0] = project("蝴蝶贴", 33);
    await f.controller.start({ entries: [{ ...f.entries[0], requestedCount }] });
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("finished"));
    const job = f.controller.snapshot()!.jobs[0];
    expect(job.status).toBe("completed");
    expect(job.actualCount).toBe(requestedCount);
    expect(job.completedCount).toBe(requestedCount);
    expect(f.starts[0].mediaIds).toHaveLength(Math.min(33, requestedCount));
    expect(f.tasks).toHaveLength(requestedCount);
  });

  it("rejects a second batch and active unrelated exports", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("批量制作正在进行");
    await f.controller.cancel();
    f.tasks.push({ id: crypto.randomUUID(), status: "queued" } as ExportTask);
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("当前导出");
  });

  it("marks recovered runs interrupted without starting models or exports", async () => {
    const f = await fixture();
    const run = await f.controller.start({ entries: f.entries }); await f.controller.cancel();
    run.status = "running";
    await writeFile(path.join(f.root, "latest.json"), JSON.stringify(run));
    const restore = new BatchProductionController(f.root, f.dependencies);
    const calls = f.dependencies.session.mock.calls.length;
    await restore.restore();
    expect(restore.snapshot()?.status).toBe("interrupted"); expect(restore.busy).toBe(false);
    expect(restore.snapshot()?.jobs.every(job => job.status === "interrupted")).toBe(true);
    expect(f.dependencies.session).toHaveBeenCalledTimes(calls);
    expect(JSON.parse(await readFile(path.join(f.root, "latest.json"), "utf8")).status).toBe("interrupted");
  });

  it("keeps corrupt batch state intact and blocks only the batch entry", async () => {
    const f = await fixture(); const file = path.join(f.root, "latest.json");
    await writeFile(file, "{invalid"); await f.controller.restore();
    expect(f.controller.warning).toContain("无法恢复"); expect(f.controller.busy).toBe(false);
    await expect(f.controller.start({ entries: f.entries })).rejects.toThrow("暂停批量入口");
    expect(await readFile(file, "utf8")).toBe("{invalid");
    expect(f.dependencies.session).not.toHaveBeenCalled();
  });

  it("stops the whole batch when task custody cannot be confirmed", async () => {
    const f = await fixture();
    await f.controller.start({ entries: f.entries });
    await waitFor(() => expect(f.controller.snapshot()?.jobs[0].status).toBe("exporting"));
    f.tasks.splice(0); f.controller.wake();
    await waitFor(() => expect(f.controller.snapshot()?.status).toBe("interrupted"));
    expect(f.starts).toHaveLength(1);
    expect(f.controller.snapshot()?.error).toContain("无法确认");
  });

  it("does not erase source state or start production when initial persistence fails", async () => {
    const f = await fixture(); const blocked = path.join(f.root, "not-a-directory");
    await writeFile(blocked, "fixture");
    const controller = new BatchProductionController(blocked, f.dependencies);
    await expect(controller.start({ entries: f.entries })).rejects.toThrow();
    await waitFor(() => expect(controller.busy).toBe(false));
    expect(f.dependencies.session).not.toHaveBeenCalled();
    expect(await readFile(blocked, "utf8")).toBe("fixture");
  });

  it("reads saved project snapshots without rewriting, backup recovery or quarantine", async () => {
    const f = await fixture(); const file = path.join(f.root, "original.json");
    const bytes = JSON.stringify(f.projects[0]); await writeFile(file, bytes);
    expect((await new ProjectStore(file).readSnapshot()).name).toBe("蝴蝶贴");
    expect(await readFile(file, "utf8")).toBe(bytes);
    await writeFile(`${file}.bak`, bytes); await writeFile(file, "{broken");
    await expect(new ProjectStore(file).readSnapshot()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
    expect(await readFile(`${file}.bak`, "utf8")).toBe(bytes);
  });
});
