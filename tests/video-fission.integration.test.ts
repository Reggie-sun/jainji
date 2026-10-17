import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem } from "../src/main/domain";
import { fissionVariant, type FissionSettings } from "../src/shared/video-fission";
import { TemplateCompiler } from "../src/main/compiler";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { fingerprintFile } from "../src/main/paths";
import { createFissionBatches, prepareFissionProduction } from "../src/main/video-fission";
import type { UploadAuthorization } from "../src/shared/douyin-upload";
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
  it("freezes micro-adjustments in a new ordinary export without changing its timing or audio rate", { timeout: 60_000 }, async () => {
    const { media, queue, input, ffmpeg, jobStore } = await fixture();
    const run = vi.spyOn(ffmpeg, "run");
    const batch = await queue.createBatch({ projectId: input.projectId, template: createDefaultTemplate(), mediaItems: [media], mediaIds: input.mediaIds, outputDirectory: input.outputDirectory, preset: { ...DEFAULT_PRESET, resolutionMode: "source" } });
    await queue.start(batch.id);
    const task = queue.snapshot().batches[0].batch.tasks[0];
    expect(task.status).toBe("completed");
    expect(batch.templateSnapshot.fission).toBeUndefined();
    expect(batch.preset.microAdjustments).toEqual(DEFAULT_PRESET.microAdjustments);
    const command = run.mock.calls.find(([args]) => args.includes("-filter_complex"))![0];
    expect(command).not.toContain("-af");
    expect(command[command.indexOf("-t") + 1]).toBe("3.000");
    const probe = await ffmpeg.probe(task.outputPath!);
    expect(probe.streams?.find(stream => stream.codec_type === "video")).toMatchObject({ width: 180, height: 320 });
    expect(Number(probe.format?.duration)).toBeCloseTo(3, 1);
    expect(probe.streams?.filter(stream => stream.codec_type === "audio")).toHaveLength(1);
    const recovered = new ExportQueue({ ffmpeg, jobStore, fontResolver: { resolve: async () => null } });
    await recovered.recover();
    expect(recovered.snapshot().batches[0].batch.preset.microAdjustments).toEqual(batch.preset.microAdjustments);
  });

  it("preflights the exact total and registers every frozen fission task before rendering", async () => {
    const { media, queue, input } = await fixture(false);
    const selection = { enabled: true, accountProduct: "眼贴" } as const;
    const authorization = { pageBatchId: crypto.randomUUID() } as UploadAuthorization;
    const events: string[] = [];
    const batches = await prepareFissionProduction(queue, { ...input, douyinUpload: selection }, [media], {
      preflight: async (actual, total) => { events.push("preflight"); expect(actual).toEqual(selection); expect(total).toBe(2); expect(queue.snapshot().batches).toEqual([]); return authorization; },
      remember: async batches => { events.push("remember"); expect(batches.flatMap(batch => batch.tasks)).toHaveLength(2); },
      registerBatches: async (batches, actual, auth) => { events.push("register"); expect(actual).toEqual(selection); expect(auth).toBe(authorization); expect(batches.flatMap(batch => batch.tasks).map(task => task.status)).toEqual(["queued", "queued"]); },
    });
    expect(events).toEqual(["preflight", "remember", "register"]);
    expect(batches.flatMap(batch => batch.tasks)).toHaveLength(2);
    expect(queue.snapshot().batches.flatMap(state => state.batch.tasks).map(task => task.status)).toEqual(["queued", "queued"]);
  });

  it("creates no exports when upload preflight is denied", async () => {
    const { media, queue, input } = await fixture(false);
    await expect(prepareFissionProduction(queue, { ...input, douyinUpload: { enabled: true, accountProduct: "眼贴" } }, [media], {
      preflight: async () => { throw new Error("fixture target rejected"); }, remember: async () => {}, registerBatches: async () => {},
    })).rejects.toThrow("fixture target rejected");
    expect(queue.snapshot().batches).toEqual([]);
  });

  it("cancels all prepared exports when upload intent registration is uncertain", async () => {
    const { media, queue, input } = await fixture(false);
    await expect(prepareFissionProduction(queue, { ...input, douyinUpload: { enabled: true, accountProduct: "眼贴" } }, [media], {
      preflight: async () => ({ pageBatchId: crypto.randomUUID() }) as UploadAuthorization,
      remember: async () => {}, registerBatches: async () => { throw new Error("fixture uncertain registration"); },
    })).rejects.toThrow("fixture uncertain registration");
    const tasks = queue.snapshot().batches.flatMap(state => state.batch.tasks);
    expect(tasks.map(task => task.status)).toEqual(["cancelled", "cancelled"]);
    for (const task of tasks) await expect(stat(task.outputPath!)).rejects.toThrow();
  });
  it("keeps combined color and detail adjustments close to neutral across bright, dark and skin-tone fixtures", { timeout: 60_000 }, async () => {
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/unused", displayName: "fixture", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 320, height: 180, rotation: 0, probeStatus: "ready", importedAt: now() };
    const neutral = { speed: 1, inset: 0, contrast: 1, saturation: 1, brightness: 0, gamma: 1 } as const;
    const render = async (source: string, settings: FissionSettings, pixelFormat = "rgb24") => {
      const command = await new TemplateCompiler().compile({ ...createDefaultTemplate(), fission: settings }, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: ffmpegBin, fontResolver: { resolve: async () => null }, textFilePath: () => "/unused", threads: 1 });
      return execFileSync(ffmpegBin, ["-v", "error", "-threads", "1", "-filter_complex_threads", "1", "-f", "lavfi", "-i", source, "-filter_complex", command.args[command.args.indexOf("-filter_complex") + 1], "-map", "[vout]", "-frames:v", "1", "-pix_fmt", pixelFormat, "-f", "rawvideo", "pipe:1"], { timeout: 10_000, maxBuffer: 2_000_000 });
    };
    for (const source of ["testsrc2=s=320x180:r=1:d=1", "smptebars=s=320x180:r=1:d=1", "color=c=0xcfae92:s=320x180:r=1:d=1", "color=c=0x101218:s=320x180:r=1:d=1"]) {
      const baseline = await render(source, neutral);
      for (const version of [0, 1, 13, 24, 73, 249]) {
        // Hold geometry and timing equal to isolate the combined visual controls.
        const changed = await render(source, { ...fissionVariant(version), speed: 1, inset: 0 });
        expect(changed.length).toBe(baseline.length);
        const errors = Array.from(changed, (value, index) => Math.abs(value - baseline[index])).sort((a, b) => a - b);
        const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
        expect(mean, `${source}, variant ${version}`).toBeLessThanOrEqual(1.25);
        expect(errors[Math.floor(errors.length * 0.99)], `${source}, variant ${version} p99`).toBeLessThanOrEqual(6);
      }
    }
    const source = "testsrc2=s=320x180:r=1:d=1";
    const base = { ...fissionVariant(0), speed: 1, inset: 0 } as const;
    // Hold the entire pipeline equal: ignoring either requested control must fail.
    for (const [low, high] of [[{ temperatureKelvin: 6460 }, { temperatureKelvin: 6540 }], [{ sharpness: 0 }, { sharpness: 0.045 }], [{ grainStrength: 0 }, { grainStrength: 2 }], [{ vignetteAngle: 0 }, { vignetteAngle: 0.08 }]]) {
      expect(await render(source, { ...base, ...low }), JSON.stringify({ low, high })).not.toEqual(await render(source, { ...base, ...high }));
    }
    expect(await render(source, base)).toEqual(await render(source, base));
  });
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
