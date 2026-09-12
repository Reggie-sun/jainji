import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/main/agent-runner";
import type { PackagingPlan } from "../src/main/agent-provider";
import type { ArtifactVerifier } from "../src/main/artifact";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import type { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { DecorationSchema } from "../src/shared/decorations";
import * as limits from "../src/main/execution-limits";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function media(): MediaItem {
  return { id: crypto.randomUUID(), sourcePath: "/tmp/input.mp4", displayName: "input.mp4", fingerprint: "test", sizeBytes: 5, durationMs: 1000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() };
}

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("AgentRunner concurrency", () => {
  it("plans three independent versions at once and refills a slot before the others finish", async () => {
    vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: 2, analysis: 3, threads: 2 });
    const plans: ReturnType<typeof deferred<PackagingPlan>>[] = [];
    const frames = vi.fn(async () => []);
    const enqueue = vi.fn(async () => crypto.randomUUID());
    const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;
    const runner = new AgentRunner({ frames, plan: () => { const next = deferred<PackagingPlan>(); plans.push(next); return next.promise; }, enqueue, stickerAssets, decorations: DecorationSchema.parse({ sticker: "none" }), onChange() {} });
    runner.start("project", "clean", "", [media()], 5);
    await vi.waitFor(() => expect(plans).toHaveLength(3));
    expect(frames).toHaveBeenCalledTimes(1);
    const plan: PackagingPlan = { summary: "ok", captions: [{ text: "好物", corner: "top-left", size: 0.026 }], filter: "cool", intensity: 0.3 };
    plans[1].resolve(plan);
    await vi.waitFor(() => expect(plans).toHaveLength(4));
    expect(enqueue).toHaveBeenCalledTimes(1);
    runner.cancel();
    plans.forEach((pending) => pending.resolve(plan));
    await runner.settled();
    expect(plans).toHaveLength(4);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(runner.snapshot()?.items.map((item) => item.status)).toEqual(["cancelled", "exporting", "cancelled", "cancelled", "cancelled"]);
    expect(runner.snapshot()?.status).toBe("cancelled");
  });
});

async function queueFixture(cores = 2) {
  vi.spyOn(limits, "executionLimits").mockReturnValue({ exports: cores, analysis: 3, threads: cores });
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-concurrency-"));
  directories.push(directory);
  const source = path.join(directory, "input.mp4");
  await writeFile(source, "input");
  const item = { ...media(), sourcePath: source, fingerprint: await fingerprintFile(source) };
  const commands: { finish(code?: number): Promise<void> }[] = [];
  let active = 0;
  let peak = 0;
  const ffmpeg = {
    ffmpegPath: "/fake",
    run(args: string[]) {
      const result = deferred<{ code: number; stdout: string; stderr: string }>();
      const marker = `encoded-${commands.length}`;
      active++;
      peak = Math.max(peak, active);
      const finish = async (code = 0) => {
        if (code === 0) await writeFile(args.at(-1)!, marker);
        result.resolve({ code, stdout: "", stderr: "test failure" });
      };
      commands.push({ finish });
      return { process: {}, promise: result.promise.finally(() => { active--; }), cancel: () => finish(130) };
    },
  } as unknown as FfmpegAdapter;
  const jobStore = new JobStore(path.join(directory, "jobs"));
  const compile = vi.fn<TemplateCompiler["compile"]>(async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }));
  const queue = new ExportQueue({
    jobStore, ffmpeg,
    compiler: { compile } as unknown as TemplateCompiler,
    artifactVerifier: { verify: async (file: string, taskId: string) => ({ taskId, path: file, sizeBytes: (await readFile(file)).length, durationMs: 1000, createdAt: now() }) } as ArtifactVerifier,
    fontResolver: { resolve: async () => null },
  });
  const batch = (count = 1) => queue.createBatch({ template: createDefaultTemplate(), mediaIds: Array.from({ length: count }, () => item.id), mediaItems: [item], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
  return { queue, batch, commands, jobStore, compile, peak: () => peak };
}

describe("global export concurrency", () => {
  it("fills twenty export slots without exceeding the CPU thread budget", async () => {
    const f = await queueFixture(20);
    const batch = await f.batch(21);
    const running = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(20));
    expect(f.compile.mock.calls.map((call) => call[3].threads)).toEqual(Array(20).fill(1));
    await f.commands[0].finish();
    await vi.waitFor(() => expect(f.commands).toHaveLength(21));
    expect(f.compile.mock.calls[20][3].threads).toBe(1);
    await Promise.all(f.commands.slice(1).map((command) => command.finish()));
    await running;
    expect(f.peak()).toBe(20);
    expect(f.queue.snapshot().batches[0].batch.tasks.every((task) => task.status === "completed")).toBe(true);
  });

  it("gives sparse work more threads and reuses the budget as new batches arrive", async () => {
    const f = await queueFixture(20);
    const first = await f.batch();
    const running = f.queue.start(first.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    expect(f.compile.mock.calls[0][3].threads).toBe(8);
    const second = await f.batch(2);
    await f.queue.start(second.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    expect(f.compile.mock.calls.map((call) => call[3].threads)).toEqual([8, 6, 6]);
    const third = await f.batch();
    await f.queue.start(third.id);
    expect(f.commands).toHaveLength(3);
    await f.commands[0].finish();
    await vi.waitFor(() => expect(f.commands).toHaveLength(4));
    expect(f.compile.mock.calls[3][3].threads).toBe(8);
    await Promise.all(f.commands.slice(1).map((command) => command.finish()));
    await running;
    expect(f.queue.snapshot().batches.flatMap(({ batch }) => batch.tasks).every((task) => task.status === "completed")).toBe(true);
  });

  it("renders and verifies real FFmpeg exports up to the hardware concurrency limit", async (context) => {
    const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-parallel-ffmpeg-"));
    directories.push(directory);
    const source = path.join(directory, "input.mp4");
    const generated = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath);
    let active = 0;
    let peak = 0;
    const run = adapter.run.bind(adapter);
    vi.spyOn(adapter, "run").mockImplementation((...args) => {
      const command = run(...args);
      active++;
      peak = Math.max(peak, active);
      return { ...command, promise: command.promise.finally(() => { active--; }) };
    });
    const item = { ...media(), sourcePath: source, fingerprint: await fingerprintFile(source), width: 320, height: 180, durationMs: 2000 };
    const queue = new ExportQueue({ jobStore: new JobStore(path.join(directory, "jobs")), ffmpeg: adapter, fontResolver: { resolve: async () => null } });
    const count = limits.executionLimits().exports;
    const batch = await queue.createBatch({ template: createDefaultTemplate(), mediaIds: Array.from({ length: count }, () => item.id), mediaItems: [item], outputDirectory: path.join(directory, "output"), preset: DEFAULT_PRESET });
    await queue.start(batch.id);
    const tasks = queue.snapshot().batches[0].batch.tasks;
    expect(tasks.map((task) => task.errorMessage)).toEqual(Array(count).fill(undefined));
    expect(tasks.map((task) => task.status)).toEqual(Array(count).fill("completed"));
    expect(tasks.every((task) => task.outputArtifact!.durationMs >= 1900)).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(Math.min(2, count));
    expect(peak).toBeLessThanOrEqual(count);
  });

  it("starts newly submitted batches while another is running, caps at two, and preserves colliding outputs", async () => {
    const f = await queueFixture();
    const batches = await Promise.all([f.batch(), f.batch(), f.batch()]);
    const first = f.queue.start(batches[0].id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    const second = f.queue.start(batches[1].id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    const third = f.queue.start(batches[2].id);
    expect(f.commands).toHaveLength(2);
    await Promise.all(f.commands.slice(0, 2).map((command) => command.finish()));
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    await f.commands[2].finish();
    await Promise.all([first, second, third]);
    const tasks = f.queue.snapshot().batches.flatMap(({ batch }) => batch.tasks);
    expect(tasks.map((task) => task.status)).toEqual(["completed", "completed", "completed"]);
    expect(new Set(tasks.map((task) => task.outputPath)).size).toBe(3);
    expect(new Set(await Promise.all(tasks.map((task) => readFile(task.outputPath!, "utf8"))))).toEqual(new Set(["encoded-0", "encoded-1", "encoded-2"]));
    expect(f.peak()).toBe(2);
  });

  it("runs tasks within one batch concurrently, skips cancelled work, and isolates failures", async () => {
    const f = await queueFixture();
    const batch = await f.batch(4);
    const running = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    await f.queue.cancel(batch.tasks[2].id);
    await f.commands[0].finish(1);
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    await Promise.all(f.commands.slice(1).map((command) => command.finish()));
    await running;
    expect(f.queue.snapshot().batches[0].batch.tasks.map((task) => task.status)).toEqual(["failed", "completed", "cancelled", "completed"]);
    expect(f.peak()).toBe(2);
    const persisted = await f.jobStore.load(batch.id);
    expect(persisted.state.batch.tasks.map((task) => task.status)).toEqual(["failed", "completed", "cancelled", "completed"]);
  });

  it("cancels one active export without stopping its peers", async () => {
    const f = await queueFixture();
    const batch = await f.batch(3);
    const running = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    await f.queue.cancel(batch.tasks[0].id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    await Promise.all(f.commands.slice(1).map((command) => command.finish()));
    await running;
    expect(f.queue.snapshot().batches[0].batch.tasks.map((task) => task.status)).toEqual(["cancelled", "completed", "completed"]);
  });

  it("retries a failed task while its peer is still running without exceeding the limit", async () => {
    const f = await queueFixture();
    const batch = await f.batch(2);
    const running = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    await f.commands[0].finish(1);
    await vi.waitFor(() => expect(f.queue.snapshot().batches[0].batch.tasks[0].status).toBe("failed"));
    const retrying = f.queue.retry([batch.tasks[0].id]);
    let scheduled = false;
    void retrying.then(() => { scheduled = true; });
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    expect(scheduled).toBe(true);
    await Promise.all(f.commands.slice(1).map((command) => command.finish()));
    await Promise.all([running, retrying]);
    const tasks = f.queue.snapshot().batches[0].batch.tasks;
    expect(tasks.map((task) => task.status)).toEqual(["completed", "completed"]);
    expect(tasks[0].attempt).toBe(2);
    expect(tasks[0].attempts[0].status).toBe("failed");
    expect(f.peak()).toBe(2);
  });

  it("waits for all active exports on shutdown and leaves waiting tasks unstarted", async () => {
    const f = await queueFixture();
    const batch = await f.batch(4);
    const running = f.queue.start(batch.id);
    await vi.waitFor(() => expect(f.commands).toHaveLength(2));
    await f.queue.shutdown();
    await running;
    expect(f.commands).toHaveLength(2);
    expect(f.queue.snapshot().batches[0].batch.tasks.map((task) => task.status)).toEqual(["interrupted", "interrupted", "queued", "queued"]);
    expect((await f.jobStore.load(batch.id)).state.batch.tasks.map((task) => task.status)).toEqual(["interrupted", "interrupted", "queued", "queued"]);
  });
});
