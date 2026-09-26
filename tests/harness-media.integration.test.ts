import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultProject, createDefaultTemplate, now, ProjectSchema, type ExportBatch, type MediaItem } from "../src/main/domain.js";
import { runCommand } from "../src/main/ffmpeg.js";
import { ffmpegBin, ffprobeBin, rotateFixtureArgs } from "./helpers/ffmpeg-bin.js";
import { fingerprintFile } from "../src/main/paths.js";
import { loadMediaSelection, validateMediaSelection } from "../src/harness/media.js";
import { HarnessRun } from "../src/harness/run.js";
import { aggregateOutcome, HarnessPolicySchema, type HarnessPolicy } from "../src/harness/types.js";

let ffmpegPath: string | null;
let ffprobePath: string | null;
const temporaryRoots: string[] = [];

beforeAll(async () => {
  ffmpegPath = ffmpegBin;
  ffprobePath = ffprobeBin;
});

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function policy(): Promise<HarnessPolicy> {
  return HarnessPolicySchema.parse(JSON.parse(await (await import("node:fs/promises")).readFile(path.resolve(".agent/harness/policy.json"), "utf8")));
}

async function createRun(root: string): Promise<HarnessRun> {
  const policyDirectory = path.join(root, ".agent", "harness");
  await mkdir(policyDirectory, { recursive: true });
  await writeFile(path.join(policyDirectory, "policy.json"), await (await import("node:fs/promises")).readFile(path.resolve(".agent/harness/policy.json")));
  return HarnessRun.create(root, "media", path.join(policyDirectory, "policy.json"));
}

async function fixture(): Promise<{ root: string; projectPath: string; batch: ExportBatch; media: MediaItem }> {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-harness-media-"));
  temporaryRoots.push(root);
  const outputDirectory = path.join(root, "output");
  await mkdir(outputDirectory);
  const sourcePath = path.join(root, "source.mp4");
  const outputPath = path.join(outputDirectory, "result.mp4");
  const generated = await runCommand(ffmpegPath!, [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
  ]).promise;
  expect(generated.code, generated.stderr).toBe(0);
  const rendered = await runCommand(ffmpegPath!, [
    "-v", "error", "-y", "-i", sourcePath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", outputPath,
  ]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const timestamp = now();
  const media: MediaItem = {
    id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: await fingerprintFile(sourcePath),
    sizeBytes: (await stat(sourcePath)).size, durationMs: 2_000, width: 320, height: 180, rotation: 0,
    probeStatus: "ready", importedAt: timestamp,
  };
  const template = createDefaultTemplate("harness fixture");
  const batchId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const batch: ExportBatch = {
    schemaVersion: 2,
    id: batchId,
    templateSnapshot: template,
    mediaIds: [media.id],
    mediaSnapshots: [media],
    outputDirectory,
    preset: { container: "mp4", videoCodec: "h264", audioCodec: "aac", resolutionMode: "source", frameRateMode: "source", quality: "balanced" },
    status: "completed",
    estimatedBytes: (await stat(outputPath)).size,
    createdAt: timestamp,
    finishedAt: timestamp,
    tasks: [{
      id: taskId, batchId, mediaId: media.id, status: "completed", progress: 1, attempt: 1, outputPath,
      outputArtifact: { taskId, path: outputPath, sizeBytes: (await stat(outputPath)).size, durationMs: 2_000, createdAt: timestamp },
      createdAt: timestamp, startedAt: timestamp, finishedAt: timestamp,
      attempts: [{ attempt: 1, status: "completed", startedAt: timestamp, finishedAt: timestamp, outputPath }],
    }],
  };
  const project = createDefaultProject("harness fixture");
  project.mediaItems = [media];
  project.templates = [template];
  project.activeTemplateId = template.id;
  project.exportBatches = [batch];
  const projectPath = path.join(root, "project.json");
  await writeFile(projectPath, JSON.stringify(ProjectSchema.parse(project)));
  return { root, projectPath, batch, media };
}

async function replaceFixtureMedia(
  sample: Awaited<ReturnType<typeof fixture>>,
  sourcePath: string,
  outputPath: string,
  mediaOverrides: Partial<MediaItem>,
): Promise<void> {
  const project = JSON.parse(await readFile(sample.projectPath, "utf8"));
  const media = {
    ...project.mediaItems[0],
    ...mediaOverrides,
    sourcePath,
    fingerprint: await fingerprintFile(sourcePath),
    sizeBytes: (await stat(sourcePath)).size,
  };
  project.mediaItems[0] = media;
  project.exportBatches[0].mediaSnapshots[0] = media;
  project.exportBatches[0].tasks[0].outputPath = outputPath;
  project.exportBatches[0].tasks[0].outputArtifact.path = outputPath;
  project.exportBatches[0].tasks[0].outputArtifact.sizeBytes = (await stat(outputPath)).size;
  project.exportBatches[0].tasks[0].outputArtifact.durationMs = media.durationMs;
  project.exportBatches[0].tasks[0].attempts[0].outputPath = outputPath;
  await writeFile(sample.projectPath, JSON.stringify(ProjectSchema.parse(project)));
}

describe("actual media validation harness", () => {
  it("selects only explicit batches and rejects unknown or duplicate ids", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    await expect(loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [crypto.randomUUID()] })).rejects.toThrow(/Unknown batch/);
    await expect(loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id, sample.batch.id] })).rejects.toThrow(/Duplicate batch/);
    const project = JSON.parse(await readFile(sample.projectPath, "utf8"));
    const historical = structuredClone(project.exportBatches[0]);
    historical.id = crypto.randomUUID();
    historical.tasks[0].id = crypto.randomUUID();
    historical.tasks[0].batchId = historical.id;
    historical.tasks[0].outputArtifact.taskId = historical.tasks[0].id;
    project.exportBatches.push(historical);
    await writeFile(sample.projectPath, JSON.stringify(ProjectSchema.parse(project)));
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    expect(selected.batches.map((batch) => batch.id)).toEqual([sample.batch.id]);
    const ambiguous = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id, historical.id] });
    const ambiguityResult = await validateMediaSelection(await policy(), await createRun(sample.root), ambiguous);
    expect(ambiguityResult.checks).toContainEqual(expect.objectContaining({ id: "selection:membership", status: "FAIL", category: "manifest_ambiguous" }));

    const queuePath = path.join(sample.root, "queue.json");
    await writeFile(queuePath, JSON.stringify({ schemaVersion: 2, revision: 0, batch: sample.batch, updatedAt: now() }));
    const queued = await loadMediaSelection({ kind: "queue", filePath: queuePath });
    expect(queued.batches.map((batch) => batch.id)).toEqual([sample.batch.id]);
  });

  it("validates a frozen completed artifact and creates hashed locator frames without visual approval", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const run = await createRun(sample.root);
    const validation = await validateMediaSelection(await policy(), run, selected);
    expect(aggregateOutcome(validation.checks), JSON.stringify(validation.checks, null, 2)).toBe("PASS");
    expect(validation.tasks[0].frames).toHaveLength(3);
    expect(validation.tasks[0].frames.every((frame) => frame.source?.sha256.startsWith("sha256:") && frame.output?.sha256.startsWith("sha256:"))).toBe(true);
  }, 120_000);

  it("does not pass missing frozen snapshots", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const project = JSON.parse(await (await import("node:fs/promises")).readFile(sample.projectPath, "utf8"));
    delete project.exportBatches[0].mediaSnapshots;
    await writeFile(sample.projectPath, JSON.stringify(project));
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(aggregateOutcome(validation.checks)).toBe("NOT_EVALUATED");
    expect(validation.checks).toContainEqual(expect.objectContaining({ id: `${sample.batch.id}:membership`, category: "frozen_snapshot_missing" }));
  });

  it("fails corrupt output and source fingerprint drift", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    await writeFile(sample.media.sourcePath, "changed source");
    await writeFile(sample.batch.tasks[0].outputPath!, "not a video");
    const project = JSON.parse(await (await import("node:fs/promises")).readFile(sample.projectPath, "utf8"));
    project.exportBatches[0].tasks[0].outputArtifact.sizeBytes = (await stat(sample.batch.tasks[0].outputPath!)).size;
    await writeFile(sample.projectPath, JSON.stringify(project));
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(aggregateOutcome(validation.checks)).toBe("FAIL");
    expect(validation.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${sample.batch.tasks[0].id}:source-identity`, category: "source_fingerprint_mismatch" }),
      expect.objectContaining({ id: `${sample.batch.tasks[0].id}:decode`, status: "FAIL" }),
    ]));
  }, 120_000);

  it("fails a recoverably damaged stream even when ordinary FFmpeg decoding exits zero", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const outputPath = sample.batch.tasks[0].outputPath!;
    const bytes = await readFile(outputPath);
    const payloadStart = bytes.indexOf(Buffer.from("mdat"));
    expect(payloadStart).toBeGreaterThan(0);
    for (let index = payloadStart + 1_024; index < Math.min(bytes.length, payloadStart + 1_040); index += 1) bytes[index] ^= 0xff;
    await writeFile(outputPath, bytes);
    const ordinaryDecode = await runCommand(ffmpegPath, ["-v", "error", "-nostdin", "-i", outputPath, "-map", "0:v:0", "-f", "null", "-"]).promise;
    expect(ordinaryDecode.code, ordinaryDecode.stderr).toBe(0);
    expect(ordinaryDecode.stderr).not.toBe("");
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(validation.checks).toContainEqual(expect.objectContaining({ id: `${sample.batch.tasks[0].id}:decode`, status: "FAIL" }));
    expect(aggregateOutcome(validation.checks)).toBe("FAIL");
  }, 120_000);

  it("fails an output that loses audio or violates the frozen dimensions", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const outputPath = sample.batch.tasks[0].outputPath!;
    const changed = await runCommand(ffmpegPath, ["-v", "error", "-y", "-i", sample.media.sourcePath, "-t", "1", "-vf", "scale=160:90", "-an", "-c:v", "libx264", outputPath]).promise;
    expect(changed.code, changed.stderr).toBe(0);
    const project = JSON.parse(await (await import("node:fs/promises")).readFile(sample.projectPath, "utf8"));
    project.exportBatches[0].tasks[0].outputArtifact.sizeBytes = (await stat(outputPath)).size;
    await writeFile(sample.projectPath, JSON.stringify(project));
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(aggregateOutcome(validation.checks)).toBe("FAIL");
    expect(validation.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${sample.batch.tasks[0].id}:output-spec`, status: "FAIL" }),
      expect.objectContaining({ id: `${sample.batch.tasks[0].id}:duration`, status: "FAIL" }),
      expect.objectContaining({ id: `${sample.batch.tasks[0].id}:audio`, status: "FAIL" }),
    ]));
  }, 120_000);

  it("accepts rotated CFR display dimensions and rejects the wrong fixed frame rate", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const basePath = path.join(sample.root, "rotation-base.mp4");
    const rotatedPath = path.join(sample.root, "rotated.mp4");
    const rotatedOutput = path.join(sample.root, "output", "rotated-result.mp4");
    expect((await runCommand(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", basePath]).promise).code).toBe(0);
    // The declared rotation is 270 (clockwise 90); ffprobe reports the display
    // matrix as -90 and the harness normalizes that to 270.
    const rotationArgs = await rotateFixtureArgs(270);
    expect((await runCommand(ffmpegPath, ["-v", "error", "-y", ...rotationArgs.input, "-i", basePath, "-c", "copy", ...rotationArgs.output, rotatedPath]).promise).code).toBe(0);
    expect((await runCommand(ffmpegPath, ["-v", "error", "-y", "-i", rotatedPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", rotatedOutput]).promise).code).toBe(0);
    await replaceFixtureMedia(sample, rotatedPath, rotatedOutput, { width: 180, height: 320, rotation: 270, durationMs: 1_000 });
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const rotated = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(aggregateOutcome(rotated.checks), JSON.stringify(rotated.checks, null, 2)).toBe("PASS");

    const project = JSON.parse(await readFile(sample.projectPath, "utf8"));
    project.exportBatches[0].preset.frameRateMode = "30";
    await writeFile(sample.projectPath, JSON.stringify(project));
    const fixed = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const wrongRate = await validateMediaSelection(await policy(), await createRun(sample.root), fixed);
    expect(wrongRate.checks).toContainEqual(expect.objectContaining({ id: `${sample.batch.tasks[0].id}:frame-rate`, status: "FAIL" }));
  }, 120_000);

  it("keeps VFR source-mode evidence not evaluated instead of using an average rate", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const vfrPath = path.join(sample.root, "vfr-source.mp4");
    const vfrOutput = path.join(sample.root, "output", "vfr-result.mp4");
    const generated = await runCommand(ffmpegPath, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-fps_mode", "vfr",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", vfrPath,
    ]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const rendered = await runCommand(ffmpegPath, ["-v", "error", "-y", "-i", vfrPath, "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", vfrOutput]).promise;
    expect(rendered.code, rendered.stderr).toBe(0);
    await replaceFixtureMedia(sample, vfrPath, vfrOutput, { width: 320, height: 180, rotation: 0, durationMs: 2_000 });
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(validation.checks).toContainEqual(expect.objectContaining({
      id: `${sample.batch.tasks[0].id}:frame-rate`, status: "NOT_EVALUATED", category: "vfr_or_measurement_unavailable",
    }));
    expect(aggregateOutcome(validation.checks)).toBe("NOT_EVALUATED");
  }, 120_000);

  it("accepts CFR timestamps quantized to alternating Matroska time-base ticks", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const sample = await fixture();
    const sourcePath = path.join(sample.root, "source.mkv");
    const outputPath = path.join(sample.root, "output", "result.mkv");
    expect((await runCommand(ffmpegPath, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", sourcePath,
    ]).promise).code).toBe(0);
    expect((await runCommand(ffmpegPath, [
      "-v", "error", "-y", "-i", sourcePath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", outputPath,
    ]).promise).code).toBe(0);
    await replaceFixtureMedia(sample, sourcePath, outputPath, { durationMs: 1_000, width: 320, height: 180, rotation: 0 });
    const project = JSON.parse(await readFile(sample.projectPath, "utf8"));
    project.exportBatches[0].preset.container = "mkv";
    await writeFile(sample.projectPath, JSON.stringify(ProjectSchema.parse(project)));
    const selected = await loadMediaSelection({ kind: "project", filePath: sample.projectPath, batchIds: [sample.batch.id] });
    const validation = await validateMediaSelection(await policy(), await createRun(sample.root), selected);
    expect(validation.checks).toContainEqual(expect.objectContaining({ id: `${sample.batch.tasks[0].id}:frame-rate`, status: "PASS" }));
    expect(aggregateOutcome(validation.checks), JSON.stringify(validation.checks, null, 2)).toBe("PASS");
  }, 120_000);

  it.skipIf(process.platform === "win32")("rejects duplicate task-to-media membership and canonical output aliases", async (context) => {
    if (!ffmpegPath || !ffprobePath) { context.skip(); return; }
    const membershipSample = await fixture();
    const membershipProject = JSON.parse(await readFile(membershipSample.projectPath, "utf8"));
    const secondMedia = { ...membershipProject.mediaItems[0], id: crypto.randomUUID() };
    const secondOutput = path.join(membershipSample.root, "output", "second.mp4");
    await copyFile(membershipSample.batch.tasks[0].outputPath!, secondOutput);
    const duplicateTask = structuredClone(membershipProject.exportBatches[0].tasks[0]);
    duplicateTask.id = crypto.randomUUID();
    duplicateTask.outputPath = secondOutput;
    duplicateTask.outputArtifact = { ...duplicateTask.outputArtifact, taskId: duplicateTask.id, path: secondOutput };
    duplicateTask.attempts[0].outputPath = secondOutput;
    membershipProject.mediaItems.push(secondMedia);
    membershipProject.exportBatches[0].mediaIds.push(secondMedia.id);
    membershipProject.exportBatches[0].mediaSnapshots.push(secondMedia);
    membershipProject.exportBatches[0].tasks.push(duplicateTask);
    await writeFile(membershipSample.projectPath, JSON.stringify(ProjectSchema.parse(membershipProject)));
    const membershipSelection = await loadMediaSelection({ kind: "project", filePath: membershipSample.projectPath, batchIds: [membershipSample.batch.id] });
    const membershipValidation = await validateMediaSelection(await policy(), await createRun(membershipSample.root), membershipSelection);
    expect(membershipValidation.checks).toContainEqual(expect.objectContaining({
      id: `${membershipSample.batch.id}:membership`, status: "FAIL", category: "manifest_invalid",
      message: expect.stringContaining("Frozen media/task membership mismatch"),
    }));

    const aliasSample = await fixture();
    const aliasProject = JSON.parse(await readFile(aliasSample.projectPath, "utf8"));
    const aliasMedia = { ...aliasProject.mediaItems[0], id: crypto.randomUUID() };
    const aliasOutput = path.join(aliasSample.root, "output", "alias.mp4");
    await symlink(aliasSample.batch.tasks[0].outputPath!, aliasOutput);
    const aliasTask = structuredClone(aliasProject.exportBatches[0].tasks[0]);
    aliasTask.id = crypto.randomUUID();
    aliasTask.mediaId = aliasMedia.id;
    aliasTask.outputPath = aliasOutput;
    aliasTask.outputArtifact = { ...aliasTask.outputArtifact, taskId: aliasTask.id, path: aliasOutput };
    aliasTask.attempts[0].outputPath = aliasOutput;
    aliasProject.mediaItems.push(aliasMedia);
    aliasProject.exportBatches[0].mediaIds.push(aliasMedia.id);
    aliasProject.exportBatches[0].mediaSnapshots.push(aliasMedia);
    aliasProject.exportBatches[0].tasks.push(aliasTask);
    const sourceAliasMedia = { ...aliasProject.mediaItems[0], id: crypto.randomUUID() };
    const sourceAliasOutput = path.join(aliasSample.root, "output", "source-alias.mp4");
    await symlink(aliasSample.media.sourcePath, sourceAliasOutput);
    const sourceAliasTask = structuredClone(aliasProject.exportBatches[0].tasks[0]);
    sourceAliasTask.id = crypto.randomUUID();
    sourceAliasTask.mediaId = sourceAliasMedia.id;
    sourceAliasTask.outputPath = sourceAliasOutput;
    sourceAliasTask.outputArtifact = {
      ...sourceAliasTask.outputArtifact,
      taskId: sourceAliasTask.id,
      path: sourceAliasOutput,
      sizeBytes: (await stat(sourceAliasOutput)).size,
    };
    sourceAliasTask.attempts[0].outputPath = sourceAliasOutput;
    aliasProject.mediaItems.push(sourceAliasMedia);
    aliasProject.exportBatches[0].mediaIds.push(sourceAliasMedia.id);
    aliasProject.exportBatches[0].mediaSnapshots.push(sourceAliasMedia);
    aliasProject.exportBatches[0].tasks.push(sourceAliasTask);
    await writeFile(aliasSample.projectPath, JSON.stringify(ProjectSchema.parse(aliasProject)));
    const aliasSelection = await loadMediaSelection({ kind: "project", filePath: aliasSample.projectPath, batchIds: [aliasSample.batch.id] });
    const aliasValidation = await validateMediaSelection(await policy(), await createRun(aliasSample.root), aliasSelection);
    expect(aliasValidation.checks).toContainEqual(expect.objectContaining({
      id: "selection:membership", status: "FAIL", category: "manifest_ambiguous",
      message: expect.stringContaining("resolve to the same artifact"),
    }));
    expect(aliasValidation.checks).toContainEqual(expect.objectContaining({
      id: "selection:membership", message: expect.stringContaining("resolves to selected source"),
    }));
  }, 120_000);
});
