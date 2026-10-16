import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { now, type MediaItem } from "../src/main/domain";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { fingerprintFile } from "../src/main/paths";
import { createFissionBatches } from "../src/main/video-fission";
import { videoPathsInDirectory } from "../src/main/media";
import { createAutomaticOutputDirectory } from "../src/main/automatic-output-directory";
import { loadMediaSelection, validateMediaSelection } from "../src/harness/media";
import { HarnessRun } from "../src/harness/run";
import { HarnessPolicySchema } from "../src/harness/types";

async function fixture(audio = true) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-fission-"));
  const sourcePath = path.join(root, "原片.mp4");
  const rendered = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=3",
    ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac"] : []), sourcePath]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "原片.mp4", fingerprint: await fingerprintFile(sourcePath), sizeBytes: (await stat(sourcePath)).size, durationMs: 3000, width: 180, height: 320, rotation: 0, probeStatus: "ready", importedAt: now() };
  const ffmpeg = new FfmpegAdapter(ffmpegBin, ffprobeBin);
  const jobStore = new JobStore(path.join(root, "jobs"));
  const queue = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
  queue.setMediaLookup(id => id === media.id ? media : undefined);
  const input = { projectId: crypto.randomUUID(), mediaIds: [media.id], total: 2, outputDirectory: path.join(root, "out") };
  return { root, media, ffmpeg, jobStore, queue, input };
}

describe("video fission real queue", () => {
  it("imports only direct video files and reuses automatic output naming with a fission root", async () => {
    const { root, media } = await fixture(false);
    await writeFile(path.join(root, "readme.txt"), "ignore");
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "old.mp4"), "ignore");
    expect(await videoPathsInDirectory(root)).toEqual([media.sourcePath]);
    const at = new Date(2026, 9, 16, 12, 34);
    const first = await createAutomaticOutputDirectory([media.sourcePath], at, undefined, "fission");
    const second = await createAutomaticOutputDirectory([media.sourcePath], at, undefined, "fission");
    expect(first).toBe(path.join(root, "裂变", "10.16 12：34"));
    expect(second).toBe(`${first} (2)`);
    expect(await createAutomaticOutputDirectory([media.sourcePath], at, first, "fission")).toBe(first);
    expect(await videoPathsInDirectory(root)).toEqual([media.sourcePath]);
  });
  it.each([true, false])("renders exact frozen variants with audio=%s and passes media Harness", { timeout: 90_000 }, async audio => {
    const { root, media, queue, input, jobStore, ffmpeg } = await fixture(audio);
    const batches = await createFissionBatches(queue, input, [media]);
    expect(batches.map(b => b.tasks.length)).toEqual([1, 1]);
    expect(batches[0].templateSnapshot.layers).toEqual([]);
    const run = vi.spyOn(ffmpeg, "run");
    await Promise.all(batches.map(b => queue.start(b.id)));
    const completed = queue.snapshot().batches;
    expect(completed.flatMap(b => b.batch.tasks).map(t => t.status)).toEqual(["completed", "completed"]);
    expect(new Set(completed.flatMap(b => b.batch.tasks.map(t => t.outputPath))).size).toBe(2);
    expect(run.mock.calls.filter(([args]) => args.includes("-xerror"))).toHaveLength(2);
    expect(await fingerprintFile(media.sourcePath)).toBe(media.fingerprint);
    expect(await fingerprintFile(completed[0].batch.tasks[0].outputPath!)).not.toBe(await fingerprintFile(completed[1].batch.tasks[0].outputPath!));
    const recovered = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
    await recovered.recover();
    for (const state of completed) expect(recovered.snapshot().batches.find(b => b.batch.id === state.batch.id)?.batch.templateSnapshot.fission).toEqual(state.batch.templateSnapshot.fission);

    const policyPath = path.join(root, ".agent/harness/policy.json");
    await mkdir(path.dirname(policyPath), { recursive: true });
    const policyBytes = await readFile(path.resolve(".agent/harness/policy.json"));
    await writeFile(policyPath, policyBytes);
    const harness = await HarnessRun.create(root, "media", policyPath);
    const policy = HarnessPolicySchema.parse(JSON.parse(policyBytes.toString()));
    const selection = await loadMediaSelection({ kind: "queue", filePath: jobStore.pathFor(batches[1].id) });
    const result = await validateMediaSelection(policy, harness, selection);
    expect(result.checks.filter(c => c.required && c.status !== "PASS")).toEqual([]);
  });

  it("rejects failed decoding without publishing, and retries the same frozen recipe", { timeout: 60_000 }, async () => {
    const { media, queue, input, ffmpeg } = await fixture();
    const run = ffmpeg.run.bind(ffmpeg);
    let rejectDecode = true;
    ffmpeg.run = (args, progress) => args.includes("-xerror") && rejectDecode
      ? { process: {} as any, promise: Promise.resolve({ code: 1, stdout: "", stderr: "fixture decode error" }), cancel: async () => {} }
      : run(args, progress);
    const [batch] = await createFissionBatches(queue, { ...input, total: 1 }, [media]);
    const frozen = structuredClone(batch.templateSnapshot);
    await queue.start(batch.id);
    let task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("failed");
    expect(task.outputArtifact).toBeUndefined();
    await expect(stat(task.outputPath!)).rejects.toThrow();
    rejectDecode = false;
    await queue.retry([task.id]);
    task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("completed");
    expect(task.attempt).toBe(2);
    expect(queue.snapshot().batches[0].batch.templateSnapshot).toEqual(frozen);
  });

  it("never starts a partially prepared submission, retaining cancelled queue history", async () => {
    const { media, queue, input } = await fixture();
    const create = queue.createBatch.bind(queue);
    let calls = 0;
    vi.spyOn(queue, "createBatch").mockImplementation(async value => {
      if (++calls === 2) throw new Error("fixture preparation failure");
      return create(value);
    });
    const start = vi.spyOn(queue, "start");
    await expect(createFissionBatches(queue, input, [media])).rejects.toThrow("fixture preparation failure");
    expect(start).not.toHaveBeenCalled();
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("cancelled");
  });

  it("cancels preparation before any prepared batch can start", async () => {
    const { media, queue, input } = await fixture(false);
    const controller = new AbortController();
    const create = queue.createBatch.bind(queue);
    vi.spyOn(queue, "createBatch").mockImplementation(async (value, signal) => {
      const batch = await create(value, signal); controller.abort(); return batch;
    });
    await expect(createFissionBatches(queue, input, [media], controller.signal)).rejects.toThrow();
    expect(queue.snapshot().batches[0].batch.tasks[0].status).toBe("cancelled");
  });
});
