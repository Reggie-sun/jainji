import { mkdtemp, rm, stat, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { createDefaultProject, now } from "../src/main/domain";
import { fingerprintFile } from "../src/main/paths";
import { AutomationRuntime } from "../src/main/automation-runtime";
import { AutomationScheduler } from "../src/main/automation-scheduler";
import * as fissionOwner from "../src/main/video-fission";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import type { AutomationRequest, AutomationTask } from "../src/shared/automation";

it("runs daily frozen fission through the original queue, validates every output and allocates a fresh directory per occurrence", { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scheduled-fission-media-"));
  const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin), jobs = new JobStore(path.join(root, "jobs"));
  const queue = new ExportQueue({ ffmpeg, jobStore: jobs, fontResolver: { resolve: async () => null } });
  let scheduler: AutomationScheduler | undefined;
  try {
    const sourcePath = path.join(root, "原片.mp4");
    const made = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=0.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:v", "libx264", "-c:a", "aac", sourcePath]).promise;
    expect(made.code, made.stderr).toBe(0);
    const project = createDefaultProject("定时裂变");
    project.mediaItems = [{ id: crypto.randomUUID(), sourcePath, displayName: "原片.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: (await stat(sourcePath)).size,
      durationMs: 500, width: 180, height: 320, rotation: 0, probeStatus: "ready", importedAt: now() }];
    const original = await readFile(sourcePath);
    let clock = new Date(2026, 9, 18, 11, 59);
    const runtime = new AutomationRuntime(path.join(root, "automation"), {
      loadProject: async () => { throw Error("no batch templates"); }, modelBinding: () => { throw Error("no model allowed"); },
      account: async () => { throw Error("no upload account allowed"); }, controller: {} as any, queue, approvedDirectories: new Set(), task: id => scheduler?.task(id),
      produce: async () => { throw Error("no ordinary production allowed"); }, clear: async () => { throw Error("no cleanup allowed"); }, upload: async () => { throw Error("no upload allowed"); },
      finishUploadAccount: async () => {}, releaseUploadAccounts: () => {},
      fission: { loadProject: async () => structuredClone(project), execute: (request, frozen, signal) => fissionOwner.executeScheduledFission(queue, request, frozen.mediaItems, async () => {}, signal) },
    });
    scheduler = new AutomationScheduler(path.join(root, "automation"), {
      prepare: (r: AutomationRequest, id: string) => runtime.prepare(r, id), configure: (t: AutomationTask) => runtime.configure(t),
      configurationIssue: t => runtime.configurationIssue(t), execute: (t, s) => runtime.execute(t, s), busy: () => false, changed: () => {}, now: () => clock,
    });
    await scheduler.load(); scheduler.start();
    const task = (await scheduler.create({ name: "每日裂变", time: "12:00", enabled: true, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
      fission: { projectId: project.id, mediaIds: project.mediaItems.map(m => m.id), total: 2 } })).tasks[0];
    await scheduler.tick(); expect(queue.snapshot().batches).toHaveLength(0);
    clock = new Date(2026, 9, 18, 12); await vi.waitFor(() => expect(scheduler!.task(task.id)?.lastRun?.state).toBe("COMPLETED"), { timeout: 20000 });
    expect(scheduler.task(task.id)?.lastRun).toMatchObject({ state: "COMPLETED", exports: expect.any(Array) });
    expect(scheduler.task(task.id)?.lastRun?.exports).toHaveLength(2);
    await vi.waitFor(() => expect(scheduler!.busy).toBe(false));
    await scheduler.tick(); expect(queue.snapshot().batches).toHaveLength(2);
    project.mediaItems = []; // The second occurrence must use the private saved source snapshot.
    clock = new Date(2026, 9, 19, 12); await scheduler.tick();
    await vi.waitFor(() => expect(scheduler!.task(task.id)?.lastRun).toMatchObject({ day: "2026-10-19", state: "COMPLETED" }), { timeout: 20000 });
    expect(scheduler.task(task.id)?.lastRun?.state).toBe("COMPLETED");
    const batches = queue.snapshot().batches.map(s => s.batch);
    expect(batches).toHaveLength(4);
    expect(new Set(batches.map(b => b.outputDirectory)).size).toBe(2);
    for (const batch of batches) {
      expect(batch.outputDirectory).toContain(`${path.sep}裂变${path.sep}`);
      expect(batch.templateSnapshot.fission).toBeDefined();
      for (const output of batch.tasks) {
        expect(output.status).toBe("completed"); expect(output.outputArtifact?.taskId).toBe(output.id);
        const persisted = await jobs.load(batch.id); expect(persisted.state.batch.tasks.find(t => t.id === output.id)?.status).toBe("completed");
        const probe = await ffmpeg.probe(output.outputPath!); expect(probe.streams?.filter(s => s.codec_type === "audio")).toHaveLength(1);
      }
    }
    expect(await readFile(sourcePath)).toEqual(original);
    expect((await readdir(path.join(root, "裂变"))).length).toBe(2);
  } finally { await scheduler?.stop(); await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
});


it("cancels all prepared fission tasks when the scheduled occurrence is stopped", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scheduled-fission-cancel-"));
  const signal = new AbortController(), ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
  const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(root, "jobs")), fontResolver: { resolve: async () => null },
    onSnapshot: snapshot => { if (snapshot.batches.some(b => b.batch.tasks.some(t => t.status === "running"))) signal.abort(); } });
  try {
    const sourcePath = path.join(root, "source.mp4");
    const made = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=1", "-c:v", "libx264", sourcePath]).promise;
    expect(made.code).toBe(0);
    const media = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: (await stat(sourcePath)).size,
      durationMs: 1000, width: 180, height: 320, rotation: 0 as const, probeStatus: "ready" as const, importedAt: now() };
    await expect(fissionOwner.executeScheduledFission(queue, { projectId: crypto.randomUUID(), mediaIds: [media.id], total: 3 }, [media], async () => {}, signal.signal)).rejects.toThrow();
    expect(signal.signal.aborted).toBe(true);
    const tasks = queue.snapshot().batches.flatMap(s => s.batch.tasks);
    expect(tasks).toHaveLength(3); expect(tasks.every(t => t.status === "cancelled")).toBe(true);
    expect(tasks.some(t => t.outputArtifact)).toBe(false);
  } finally { await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
});
