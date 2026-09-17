import { createHash } from "node:crypto";
import { chmod, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ProjectSchema,
  QueueStateSchema,
  assertPriceOnlyTemplate,
  type ExportBatch,
  type ExportTask,
  type MediaItem,
} from "../main/domain.js";
import { discoverBinary } from "../main/ffmpeg.js";
import { canonicalPath, fingerprintFile, isPathWithinDirectory, pathsEqual } from "../main/paths.js";
import { outputDimensions } from "../shared/export-settings.js";
import type { HarnessRun, ProcessResult } from "./run.js";
import { outcomeForProcess, relativeEvidencePath } from "./run.js";
import type { HarnessCheckResult, HarnessOutcome, HarnessPolicy } from "./types.js";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  time_base?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeJson {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string; size?: string; tags?: Record<string, string> };
}

export type MediaInputOptions =
  | { kind: "project"; filePath: string; batchIds: string[] }
  | { kind: "queue"; filePath: string };

export interface MediaSelection {
  inputPath: string;
  inputSha256: string;
  kind: "project" | "queue";
  batches: ExportBatch[];
  inputsSnapshot: Record<string, unknown>;
}

interface MediaTaskEvidence {
  taskId: string;
  batchId: string;
  mediaId: string;
  sourcePath: string;
  outputPath: string;
  sourceSha256?: string;
  outputSha256?: string;
  frames: Array<{ position: string; source?: FrameEvidence; output?: FrameEvidence }>;
}

interface FrameEvidence {
  path: string;
  requestedTimeSeconds: number;
  actualTimeSeconds: number;
  sha256: string;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadMediaSelection(options: MediaInputOptions): Promise<MediaSelection> {
  const inputPath = path.resolve(options.filePath);
  const bytes = await readFile(inputPath);
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error(`Input is not valid JSON: ${errorMessage(error)}`); }
  if (options.kind === "queue") {
    const queue = QueueStateSchema.parse(raw);
    const batch = structuredClone(queue.batch);
    return {
      inputPath,
      inputSha256: sha256(bytes),
      kind: "queue",
      batches: [batch],
      inputsSnapshot: { kind: "queue", inputPath, inputSha256: sha256(bytes), batches: [batch] },
    };
  }
  if (options.batchIds.length === 0) throw new Error("At least one --batch id is required with --project.");
  const duplicates = options.batchIds.filter((id, index) => options.batchIds.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate batch id: ${duplicates[0]}`);
  const project = ProjectSchema.parse(raw);
  const selected = options.batchIds.map((id) => {
    const matches = project.exportBatches.filter((candidate) => candidate.id === id);
    if (matches.length === 0) throw new Error(`Unknown batch id: ${id}`);
    if (matches.length > 1) throw new Error(`Ambiguous duplicate batch id in project: ${id}`);
    return structuredClone(matches[0]);
  });
  return {
    inputPath,
    inputSha256: sha256(bytes),
    kind: "project",
    batches: selected,
    inputsSnapshot: { kind: "project", inputPath, inputSha256: sha256(bytes), projectId: project.id, batches: selected },
  };
}

function required(policy: HarnessPolicy, id: HarnessPolicy["media"]["checks"][number]["id"]): boolean {
  return policy.media.checks.find((check) => check.id === id)?.required ?? true;
}

function result(
  policy: HarnessPolicy,
  id: HarnessPolicy["media"]["checks"][number]["id"],
  scope: string,
  status: HarnessOutcome,
  message: string,
  evidence?: Record<string, unknown>,
  category?: string,
): HarnessCheckResult {
  return { id: `${scope}:${id}`, required: required(policy, id), status, message, ...(category ? { category } : {}), ...(evidence ? { evidence } : {}) };
}

function rate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator = "1"] = value.split("/");
  const parsed = Number(numerator) / Number(denominator);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function durationMs(probe: ProbeJson, stream?: ProbeStream): number | undefined {
  const seconds = Number(stream?.duration ?? probe.format?.duration);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

function streamDurationMs(stream: ProbeStream | undefined): number | undefined {
  const seconds = Number(stream?.duration);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

function rotation(stream: ProbeStream): number {
  const raw = Number(stream.tags?.rotate ?? stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0);
  return ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
}

function displayDimensions(stream: ProbeStream): { width?: number; height?: number } {
  const rotated = [90, 270].includes(rotation(stream));
  return rotated ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
}

function processFailure(processResult: ProcessResult, fallback: string): { status: HarnessOutcome; category?: string; message: string } | undefined {
  const outcome = outcomeForProcess(processResult);
  if (outcome.status === "PASS") return undefined;
  return { ...outcome, message: outcome.status === "FAIL" ? fallback : outcome.message };
}

async function probeFile(run: HarnessRun, ffprobe: string, filePath: string, logId: string, timeoutMs: number, signal?: AbortSignal): Promise<{ process: ProcessResult; probe?: ProbeJson; parseError?: string }> {
  const processResult = await run.command(logId, ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], timeoutMs, signal);
  if (processResult.code !== 0 || processResult.timedOut || processResult.interrupted || processResult.error) return { process: processResult };
  try { return { process: processResult, probe: JSON.parse(processResult.stdout) as ProbeJson }; }
  catch (error) { return { process: processResult, parseError: errorMessage(error) }; }
}

function membershipIssues(batch: ExportBatch): string[] {
  const issues: string[] = [];
  if (!batch.mediaSnapshots) return ["Frozen mediaSnapshots are missing."];
  const taskIds = new Set<string>();
  const outputPaths = new Set<string>();
  const mediaIds = new Set(batch.mediaIds);
  if (mediaIds.size !== batch.mediaIds.length) issues.push("Batch mediaIds contain duplicates.");
  if (batch.tasks.length !== batch.mediaIds.length) issues.push("Task count does not match frozen batch membership.");
  const snapshots = new Map(batch.mediaSnapshots.map((media) => [media.id, media]));
  if (snapshots.size !== batch.mediaSnapshots.length) issues.push("Frozen mediaSnapshots contain duplicate ids.");
  const expectedMediaCounts = new Map<string, number>();
  const snapshotCounts = new Map<string, number>();
  const taskMediaCounts = new Map<string, number>();
  for (const mediaId of batch.mediaIds) expectedMediaCounts.set(mediaId, (expectedMediaCounts.get(mediaId) ?? 0) + 1);
  for (const media of batch.mediaSnapshots) snapshotCounts.set(media.id, (snapshotCounts.get(media.id) ?? 0) + 1);
  for (const task of batch.tasks) {
    taskMediaCounts.set(task.mediaId, (taskMediaCounts.get(task.mediaId) ?? 0) + 1);
    if (taskIds.has(task.id)) issues.push(`Duplicate task id: ${task.id}`);
    taskIds.add(task.id);
    if (task.batchId !== batch.id) issues.push(`Task ${task.id} belongs to another batch.`);
    if (!mediaIds.has(task.mediaId) || !snapshots.has(task.mediaId)) issues.push(`Task ${task.id} has no unambiguous frozen media snapshot.`);
    if (task.status !== "completed") issues.push(`Task ${task.id} is ${task.status}, not completed.`);
    if (!task.outputPath || !task.outputArtifact) issues.push(`Task ${task.id} has no completed output artifact.`);
    if (task.outputPath && task.outputArtifact && (task.outputArtifact.taskId !== task.id || path.resolve(task.outputArtifact.path) !== path.resolve(task.outputPath))) {
      issues.push(`Task ${task.id} outputArtifact does not bind to its outputPath.`);
    }
    if (task.outputPath) {
      const normalized = path.resolve(task.outputPath);
      if (outputPaths.has(normalized)) issues.push(`Duplicate output path: ${normalized}`);
      outputPaths.add(normalized);
      if (!isPathWithinDirectory(batch.outputDirectory, normalized)) issues.push(`Task ${task.id} output is outside its batch directory.`);
      if (/\.partial(?:\.|$)/i.test(path.basename(normalized))) issues.push(`Task ${task.id} points to a partial artifact.`);
    }
  }
  for (const mediaId of new Set([...expectedMediaCounts.keys(), ...snapshotCounts.keys(), ...taskMediaCounts.keys()])) {
    if ((expectedMediaCounts.get(mediaId) ?? 0) !== (snapshotCounts.get(mediaId) ?? 0)) {
      issues.push(`Frozen media/snapshot membership mismatch for media ${mediaId}.`);
    }
    if ((expectedMediaCounts.get(mediaId) ?? 0) !== (taskMediaCounts.get(mediaId) ?? 0)) {
      issues.push(`Frozen media/task membership mismatch for media ${mediaId}.`);
    }
  }
  if (taskIds.size === 0) issues.push("The selected batch contains no tasks.");
  return issues;
}

async function verifyMembershipFiles(batch: ExportBatch): Promise<string[]> {
  const issues: string[] = [];
  const actualDirectory = await canonicalPath(batch.outputDirectory);
  for (const task of batch.tasks) {
    if (!task.outputPath) continue;
    try {
      const info = await stat(task.outputPath);
      if (!info.isFile() || info.size === 0) issues.push(`Task ${task.id} output is missing or empty.`);
      if (task.outputArtifact && task.outputArtifact.sizeBytes !== info.size) issues.push(`Task ${task.id} output size no longer matches outputArtifact.`);
      const actualOutput = await canonicalPath(task.outputPath);
      if (!isPathWithinDirectory(actualDirectory, actualOutput)) issues.push(`Task ${task.id} resolves outside its batch directory.`);
    } catch { issues.push(`Task ${task.id} output is missing or unreadable.`); }
    const media = batch.mediaSnapshots?.find((candidate) => candidate.id === task.mediaId);
    if (media && await pathsEqual(media.sourcePath, task.outputPath)) issues.push(`Task ${task.id} output resolves to its source file.`);
  }
  return issues;
}

function containerMatches(container: ExportBatch["preset"]["container"], format: ProbeJson["format"]): boolean {
  const names = new Set((format?.format_name ?? "").split(","));
  if (container === "mkv") return names.has("matroska");
  const brand = format?.tags?.major_brand?.trim().toLowerCase();
  if (container === "mov") return names.has("mov") && brand === "qt";
  return names.has("mp4") && brand !== "qt";
}

interface FrameTimeline {
  classification: "CFR" | "VFR" | "NOT_EVALUATED";
  effectiveRate?: number;
  frameCount?: number;
  reason?: string;
  timestamps?: number[];
}

async function frameTimeline(
  run: HarnessRun,
  ffprobe: string,
  filePath: string,
  logId: string,
  toleranceRatio: number,
  timeBaseSeconds: number | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FrameTimeline> {
  const command = await run.command(logId, ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", filePath,
  ], timeoutMs, signal);
  if (command.code !== 0 || command.timedOut || command.interrupted || command.error || command.outputTruncated) {
    return { classification: "NOT_EVALUATED", reason: command.outputTruncated ? "timestamp output exceeded the evidence limit" : "frame timestamps are unavailable" };
  }
  const timestamps = command.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => Number(line.split(",")[0])).filter(Number.isFinite);
  if (timestamps.length < 2) return { classification: "NOT_EVALUATED", frameCount: timestamps.length, reason: "fewer than two frame timestamps" };
  const deltas = timestamps.slice(1).map((value, index) => value - timestamps[index]);
  if (deltas.some((delta) => delta <= 0)) return { classification: "NOT_EVALUATED", frameCount: timestamps.length, reason: "timestamps are not strictly increasing" };
  const sorted = [...deltas].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  let maximumAbsoluteDelta = 0;
  for (const delta of deltas) maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, Math.abs(delta - median));
  const ratioAllowance = median * toleranceRatio;
  const quantizationAllowance = (timeBaseSeconds ?? 0) * 1.01;
  const allowedAbsoluteDelta = Math.max(ratioAllowance, quantizationAllowance);
  const effectiveRate = (timestamps.length - 1) / (timestamps.at(-1)! - timestamps[0]);
  return {
    classification: maximumAbsoluteDelta <= allowedAbsoluteDelta ? "CFR" : "VFR",
    effectiveRate,
    frameCount: timestamps.length,
    reason: `maximum frame-period deviation ${maximumAbsoluteDelta}s; allowance ${allowedAbsoluteDelta}s`,
    timestamps,
  };
}

function timelineEvidence(timeline: FrameTimeline): Omit<FrameTimeline, "timestamps"> {
  const { timestamps: _timestamps, ...evidence } = timeline;
  return evidence;
}

function nearestTimestamp(timeline: FrameTimeline, requestedSeconds: number): number | undefined {
  return timeline.timestamps?.reduce((nearest, value) => Math.abs(value - requestedSeconds) < Math.abs(nearest - requestedSeconds) ? value : nearest);
}

async function extractFrame(
  run: HarnessRun,
  ffmpeg: string,
  filePath: string,
  outputPath: string,
  requestedSeconds: number,
  actualSeconds: number | undefined,
  logId: string,
  policy: HarnessPolicy,
  signal?: AbortSignal,
): Promise<FrameEvidence | undefined> {
  if (actualSeconds === undefined) return undefined;
  const extracted = await run.command(`${logId}-extract`, ffmpeg, [
    "-v", "error", "-nostdin", "-ss", actualSeconds.toFixed(6), "-i", filePath, "-frames:v", "1",
    "-vf", `scale=${policy.media.thumbnailWidth}:-2`, "-q:v", "3", "-y", outputPath,
  ], policy.media.commandTimeoutMs, signal);
  if (extracted.code !== 0 || extracted.timedOut || extracted.interrupted) return undefined;
  try {
    await chmod(outputPath, 0o600);
    return { path: relativeEvidencePath(run, outputPath), requestedTimeSeconds: requestedSeconds, actualTimeSeconds: actualSeconds, sha256: await fingerprintFile(outputPath) };
  } catch { return undefined; }
}

async function taskChecks(
  policy: HarnessPolicy,
  run: HarnessRun,
  batch: ExportBatch,
  task: ExportTask,
  media: MediaItem,
  binaries: { ffmpeg: string; ffprobe: string },
  taskEvidence: MediaTaskEvidence,
  signal?: AbortSignal,
): Promise<HarnessCheckResult[]> {
  const checks: HarnessCheckResult[] = [];
  const scope = task.id;
  const sourceProbe = await probeFile(run, binaries.ffprobe, media.sourcePath, `${scope}-probe-source`, policy.media.commandTimeoutMs, signal);
  const outputProbe = await probeFile(run, binaries.ffprobe, task.outputPath!, `${scope}-probe-output`, policy.media.commandTimeoutMs, signal);
  const decode = await run.command(`${scope}-decode`, binaries.ffmpeg, [
    "-v", "error", "-xerror", "-err_detect", "explode", "-nostdin", "-i", task.outputPath!,
    "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-",
  ], policy.media.commandTimeoutMs, signal);
  const failedProbe = processFailure(sourceProbe.process, "Source ffprobe failed.") ?? processFailure(outputProbe.process, "Output ffprobe failed.") ?? processFailure(decode, "Full output decode failed.");
  if (failedProbe || sourceProbe.parseError || outputProbe.parseError || !sourceProbe.probe || !outputProbe.probe) {
    checks.push(result(policy, "decode", scope, failedProbe?.status ?? "NOT_EVALUATED", failedProbe?.message ?? "ffprobe returned invalid JSON.", {
      sourceProbeError: sourceProbe.parseError, outputProbeError: outputProbe.parseError,
    }, failedProbe?.category ?? "probe_invalid"));
    return checks;
  }
  const sourceVideo = sourceProbe.probe.streams?.find((stream) => stream.codec_type === "video");
  const outputVideo = outputProbe.probe.streams?.find((stream) => stream.codec_type === "video");
  if (!sourceVideo || !outputVideo) {
    checks.push(result(policy, "decode", scope, "FAIL", "Source or output has no readable video stream.", undefined, "missing_video"));
    return checks;
  }
  checks.push(result(policy, "decode", scope, "PASS", "Source and output probe succeeded; output decoded completely.", {
    logs: [`logs/${scope}-probe-source.stdout.log`, `logs/${scope}-probe-output.stdout.log`, `logs/${scope}-decode.stderr.log`],
  }));

  const expectedDimensions = outputDimensions(media, batch.preset);
  const observedSourceDimensions = displayDimensions(sourceVideo);
  const formatName = outputProbe.probe.format?.format_name;
  const majorBrand = outputProbe.probe.format?.tags?.major_brand;
  const expectedExtension = `.${batch.preset.container}`;
  const specificationMatches = outputVideo.width === expectedDimensions.width && outputVideo.height === expectedDimensions.height &&
    outputVideo.codec_name === "h264" && containerMatches(batch.preset.container, outputProbe.probe.format) &&
    path.extname(task.outputPath!).toLowerCase() === expectedExtension && observedSourceDimensions.width === media.width &&
    observedSourceDimensions.height === media.height && rotation(sourceVideo) === media.rotation;
  checks.push(result(policy, "output-spec", scope, specificationMatches ? "PASS" : "FAIL", specificationMatches ? "Output dimensions, codec, container, and rotated source dimensions match the frozen preset." : "Output media specification does not match the frozen preset.", {
    expected: { dimensions: expectedDimensions, videoCodec: batch.preset.videoCodec, container: batch.preset.container, sourceDimensions: { width: media.width, height: media.height } },
    observed: { width: outputVideo.width, height: outputVideo.height, codec: outputVideo.codec_name, formatName, majorBrand, extension: path.extname(task.outputPath!).toLowerCase(), sourceDimensions: observedSourceDimensions, sourceRotation: rotation(sourceVideo) },
  }, specificationMatches ? undefined : "spec_mismatch"));

  const sourceDuration = durationMs(sourceProbe.probe, sourceVideo);
  const outputDuration = durationMs(outputProbe.probe, outputVideo);
  const sourceRate = rate(sourceVideo.avg_frame_rate);
  const durationTolerance = Math.max(policy.media.durationMinimumToleranceMs, sourceRate ? policy.media.durationFramePeriods * 1_000 / sourceRate : 0);
  if (sourceDuration === undefined || outputDuration === undefined) {
    checks.push(result(policy, "duration", scope, "NOT_EVALUATED", "A reliable source or output duration is unavailable.", { sourceDuration, outputDuration, durationTolerance }, "measurement_unavailable"));
  } else {
    const frozenDelta = Math.abs(sourceDuration - media.durationMs);
    const outputDelta = Math.abs(outputDuration - sourceDuration);
    const artifactDelta = Math.abs(outputDuration - task.outputArtifact!.durationMs);
    const matches = frozenDelta <= durationTolerance && outputDelta <= durationTolerance && artifactDelta <= durationTolerance;
    checks.push(result(policy, "duration", scope, matches ? "PASS" : "FAIL", matches ? "Frozen, source, and output durations are within tolerance." : "Source or output duration exceeds the configured tolerance.", {
      expectedFrozenMs: media.durationMs, artifactDurationMs: task.outputArtifact!.durationMs, observedSourceMs: sourceDuration, observedOutputMs: outputDuration, frozenDeltaMs: frozenDelta, outputDeltaMs: outputDelta, artifactDeltaMs: artifactDelta, toleranceMs: durationTolerance,
    }, matches ? undefined : "duration_mismatch"));
  }

  const sourceAverageRate = rate(sourceVideo.avg_frame_rate);
  const sourceNominalRate = rate(sourceVideo.r_frame_rate);
  const outputAverageRate = rate(outputVideo.avg_frame_rate);
  const [sourceTimeline, outputTimeline] = await Promise.all([
    frameTimeline(run, binaries.ffprobe, media.sourcePath, `${scope}-timeline-source`, policy.media.frameRateToleranceRatio, rate(sourceVideo.time_base), policy.media.commandTimeoutMs, signal),
    frameTimeline(run, binaries.ffprobe, task.outputPath!, `${scope}-timeline-output`, policy.media.frameRateToleranceRatio, rate(outputVideo.time_base), policy.media.commandTimeoutMs, signal),
  ]);
  const expectedRate = batch.preset.frameRateMode === "30" ? 30 : sourceTimeline.effectiveRate;
  const timelineReliable = outputTimeline.classification === "CFR" && (batch.preset.frameRateMode === "30" || sourceTimeline.classification === "CFR");
  if (!timelineReliable || outputTimeline.effectiveRate === undefined || expectedRate === undefined) {
    checks.push(result(policy, "frame-rate", scope, "NOT_EVALUATED", "Frame rate cannot be reliably classified; VFR and incomplete timestamps do not pass.", {
      frameRateMode: batch.preset.frameRateMode, sourceAverageRate, sourceNominalRate, outputAverageRate, sourceTimeline: timelineEvidence(sourceTimeline), outputTimeline: timelineEvidence(outputTimeline),
    }, "vfr_or_measurement_unavailable"));
  } else {
    const relativeDelta = Math.abs(outputTimeline.effectiveRate - expectedRate) / expectedRate;
    const matches = relativeDelta <= policy.media.frameRateToleranceRatio;
    checks.push(result(policy, "frame-rate", scope, matches ? "PASS" : "FAIL", matches ? "Output frame rate matches the frozen mode." : "Output frame rate exceeds tolerance.", {
      expectedRate, outputAverageRate, relativeDelta, toleranceRatio: policy.media.frameRateToleranceRatio, sourceTimeline: timelineEvidence(sourceTimeline), outputTimeline: timelineEvidence(outputTimeline),
    }, matches ? undefined : "frame_rate_mismatch"));
  }

  const sourceAudio = sourceProbe.probe.streams?.find((stream) => stream.codec_type === "audio");
  const outputAudio = outputProbe.probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!sourceAudio && !outputAudio) {
    checks.push(result(policy, "audio", scope, "PASS", "Neither source nor output contains an audio stream."));
  } else if (!sourceAudio || !outputAudio) {
    checks.push(result(policy, "audio", scope, "FAIL", "Audio stream presence changed between source and output.", { source: Boolean(sourceAudio), output: Boolean(outputAudio) }, "audio_presence_mismatch"));
  } else {
    const sourceAudioDuration = streamDurationMs(sourceAudio);
    const outputAudioDuration = streamDurationMs(outputAudio);
    if (sourceAudioDuration === undefined || outputAudioDuration === undefined) {
      checks.push(result(policy, "audio", scope, "NOT_EVALUATED", "Audio duration is unavailable.", { codec: outputAudio.codec_name }, "measurement_unavailable"));
    } else {
      const delta = Math.abs(outputAudioDuration - sourceAudioDuration);
      const matches = outputAudio.codec_name === "aac" && delta <= policy.media.audioDurationToleranceMs;
      checks.push(result(policy, "audio", scope, matches ? "PASS" : "FAIL", matches ? "AAC audio presence and duration match the source." : "Output audio codec or duration is invalid.", {
        expectedCodec: batch.preset.audioCodec, observedCodec: outputAudio.codec_name, sourceDurationMs: sourceAudioDuration, outputDurationMs: outputAudioDuration, deltaMs: delta, toleranceMs: policy.media.audioDurationToleranceMs,
      }, matches ? undefined : "audio_mismatch"));
    }
  }

  const sampleDuration = sourceDuration ?? media.durationMs;
  const tailOffset = sourceAverageRate ? Math.max(100, 1_000 / sourceAverageRate) : 100;
  const samples = [
    { position: "head", time: 0 },
    { position: "middle", time: Math.max(0, sampleDuration / 2) / 1_000 },
    { position: "tail", time: Math.max(0, sampleDuration - tailOffset) / 1_000 },
  ];
  let framesOk = true;
  for (const sample of samples) {
    const directory = path.join(run.framesDirectory, scope);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const sourceFrame = await extractFrame(run, binaries.ffmpeg, media.sourcePath, path.join(directory, `source-${sample.position}.jpg`), sample.time, nearestTimestamp(sourceTimeline, sample.time), `${scope}-source-${sample.position}`, policy, signal);
    const outputFrame = await extractFrame(run, binaries.ffmpeg, task.outputPath!, path.join(directory, `output-${sample.position}.jpg`), sample.time, nearestTimestamp(outputTimeline, sample.time), `${scope}-output-${sample.position}`, policy, signal);
    if (!sourceFrame || !outputFrame) framesOk = false;
    taskEvidence.frames.push({ position: sample.position, ...(sourceFrame ? { source: sourceFrame } : {}), ...(outputFrame ? { output: outputFrame } : {}) });
  }
  checks.push(result(policy, "visual-evidence", scope, framesOk ? "PASS" : "FAIL", framesOk ? "Source/output locator frames were created and hashed; human visual review remains NOT_EVALUATED." : "One or more locator frames could not be created.", { frames: taskEvidence.frames }, framesOk ? undefined : "frame_extraction_failed"));
  return checks;
}

export async function validateMediaSelection(
  policy: HarnessPolicy,
  run: HarnessRun,
  selection: MediaSelection,
  signal?: AbortSignal,
): Promise<{ checks: HarnessCheckResult[]; tasks: MediaTaskEvidence[]; inputAfterSha256: string }> {
  const checks: HarnessCheckResult[] = [];
  const taskEvidence: MediaTaskEvidence[] = [];
  const selectedTaskIds = new Set<string>();
  const selectedOutputs = new Set<string>();
  const canonicalOutputs = new Map<string, string>();
  const canonicalSources = new Map<string, string>();
  const selectionIssues: string[] = [];
  for (const batch of selection.batches) {
    for (const media of batch.mediaSnapshots ?? []) {
      canonicalSources.set(await canonicalPath(media.sourcePath), media.sourcePath);
    }
  }
  for (const batch of selection.batches) {
    for (const task of batch.tasks) {
      if (selectedTaskIds.has(task.id)) selectionIssues.push(`Duplicate task id across selected batches: ${task.id}`);
      selectedTaskIds.add(task.id);
      if (task.outputPath) {
        const output = path.resolve(task.outputPath);
        if (selectedOutputs.has(output)) selectionIssues.push(`Duplicate output path across selected batches: ${output}`);
        selectedOutputs.add(output);
        const canonicalOutput = await canonicalPath(task.outputPath);
        const previousOutput = canonicalOutputs.get(canonicalOutput);
        if (previousOutput) selectionIssues.push(`Output paths resolve to the same artifact: ${previousOutput} and ${task.outputPath}`);
        canonicalOutputs.set(canonicalOutput, task.outputPath);
        const sourceAlias = canonicalSources.get(canonicalOutput);
        if (sourceAlias) selectionIssues.push(`Output ${task.outputPath} resolves to selected source ${sourceAlias}`);
      }
    }
  }
  if (selectionIssues.length > 0) {
    checks.push(result(policy, "membership", "selection", "FAIL", selectionIssues.join(" "), undefined, "manifest_ambiguous"));
    return { checks, tasks: taskEvidence, inputAfterSha256: sha256(await readFile(selection.inputPath)) };
  }
  const [ffmpeg, ffprobe] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([
    ffmpeg ? run.command("ffmpeg-version", ffmpeg, ["-version"], 30_000, signal) : undefined,
    ffprobe ? run.command("ffprobe-version", ffprobe, ["-version"], 30_000, signal) : undefined,
  ]);
  run.setTools({
    ffmpeg: ffmpeg ? `${ffmpeg} :: ${ffmpegVersion?.stdout.split(/\r?\n/)[0] ?? "version unavailable"}` : null,
    ffprobe: ffprobe ? `${ffprobe} :: ${ffprobeVersion?.stdout.split(/\r?\n/)[0] ?? "version unavailable"}` : null,
  });
  const identities = new Map<string, { before: string; results: HarnessCheckResult[] }>();

  for (const batch of selection.batches) {
    const staticIssues = membershipIssues(batch);
    const missingSnapshots = !batch.mediaSnapshots;
    const fileIssues = missingSnapshots ? [] : await verifyMembershipFiles(batch);
    const issues = [...staticIssues, ...fileIssues];
    checks.push(result(policy, "membership", batch.id, issues.length === 0 ? "PASS" : missingSnapshots ? "NOT_EVALUATED" : "FAIL", issues.length === 0 ? `Selected ${batch.tasks.length} frozen tasks.` : issues.join(" "), {
      expectedTaskCount: batch.tasks.length, batchId: batch.id,
    }, issues.length === 0 ? undefined : missingSnapshots ? "frozen_snapshot_missing" : "manifest_invalid"));
    try {
      assertPriceOnlyTemplate(batch.templateSnapshot);
      checks.push(result(policy, "template-text", batch.id, "PASS", "Frozen template satisfies the current manual-text contract."));
    } catch (error) {
      checks.push(result(policy, "template-text", batch.id, "FAIL", errorMessage(error), undefined, "template_text_invalid"));
    }
    if (issues.length > 0 || !batch.mediaSnapshots) continue;

    for (const task of batch.tasks) {
      const media = batch.mediaSnapshots.find((candidate) => candidate.id === task.mediaId)!;
      const evidence: MediaTaskEvidence = { taskId: task.id, batchId: batch.id, mediaId: task.mediaId, sourcePath: media.sourcePath, outputPath: task.outputPath!, frames: [] };
      taskEvidence.push(evidence);
      const identityCheck = result(policy, "source-identity", task.id, "PASS", "Source fingerprint matches the frozen snapshot; source and output are stable for this run.");
      checks.push(identityCheck);
      for (const [kind, filePath] of [["source", media.sourcePath], ["output", task.outputPath!]] as const) {
        try {
          const before = await fingerprintFile(filePath);
          if (kind === "source" && before !== media.fingerprint) {
            identityCheck.status = "FAIL";
            identityCheck.category = "source_fingerprint_mismatch";
            identityCheck.message = "Source fingerprint no longer matches the frozen snapshot.";
          }
          if (kind === "source") evidence.sourceSha256 = before;
          else evidence.outputSha256 = before;
          const tracked = identities.get(filePath) ?? { before, results: [] };
          tracked.results.push(identityCheck);
          identities.set(filePath, tracked);
        } catch (error) {
          identityCheck.status = "FAIL";
          identityCheck.category = "file_unreadable";
          identityCheck.message = `${kind} file is unreadable: ${errorMessage(error)}`;
        }
      }
      identityCheck.evidence = { sourceSha256: evidence.sourceSha256, frozenSourceSha256: media.fingerprint, outputSha256: evidence.outputSha256, attempt: task.attempt };
      if (!ffmpeg || !ffprobe) {
        for (const id of ["decode", "output-spec", "duration", "frame-rate", "audio", "visual-evidence"] as const) {
          checks.push(result(policy, id, task.id, "NOT_EVALUATED", "Required FFmpeg or ffprobe executable is unavailable.", undefined, "tool_unavailable"));
        }
        continue;
      }
      checks.push(...await taskChecks(policy, run, batch, task, media, { ffmpeg, ffprobe }, evidence, signal));
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;
  }

  for (const [filePath, identity] of identities) {
    let after: string | undefined;
    try { after = await fingerprintFile(filePath); } catch { /* handled below */ }
    if (after !== identity.before) {
      for (const check of identity.results) {
        check.status = "NOT_EVALUATED";
        check.category = "file_changed_during_run";
        check.message = "Source or output changed while validation was running; start a new run.";
        check.evidence = { ...check.evidence, before: identity.before, after };
      }
    }
  }
  const inputAfterSha256 = sha256(await readFile(selection.inputPath));
  if (inputAfterSha256 !== selection.inputSha256) {
    checks.push({ id: "input-identity", required: true, status: "NOT_EVALUATED", category: "input_changed_during_run", message: "The selected project or queue file changed during validation.", evidence: { before: selection.inputSha256, after: inputAfterSha256 } });
  }
  return { checks, tasks: taskEvidence, inputAfterSha256 };
}

export function mediaSummary(run: HarnessRun, checks: readonly HarnessCheckResult[], tasks: readonly MediaTaskEvidence[]): string {
  const checkRows = checks.map((check) => `| ${check.id} | ${check.status} | ${check.message.replaceAll("|", "\\|")} |`).join("\n");
  const taskSections = tasks.map((task) => {
    const frameRows = task.frames.map((frame) => `| ${frame.position} | ${frame.source ? `[source](${frame.source.path}) @ ${frame.source.actualTimeSeconds.toFixed(3)}s` : "missing"} | ${frame.output ? `[output](${frame.output.path}) @ ${frame.output.actualTimeSeconds.toFixed(3)}s` : "missing"} |`).join("\n");
    return `## Task ${task.taskId}\n\n- [Source](<${task.sourcePath}>) — \`${task.sourceSha256 ?? "unavailable"}\`\n- [Output](<${task.outputPath}>) — \`${task.outputSha256 ?? "unavailable"}\`\n\n| Position | Source locator | Output locator |\n| --- | --- | --- |\n${frameRows || "| — | missing | missing |"}`;
  }).join("\n\n");
  return `# Actual Media Validation\n\n` +
    `Run: \`${path.basename(run.directory)}\`\n\n` +
    `自动技术检查只覆盖显式选择的冻结任务。缩略帧仅用于人工定位，不能证明全时段无漏检、无裁剪或音画观感合格。\n\n` +
    `Visual review: **NOT_EVALUATED**\n\n` +
    `人工复核应播放完整成片，检查展示文字、主体遮挡、原贴纸覆盖、时段变化和音画。\n\n` +
    `| Check | Status | Evidence boundary |\n| --- | --- | --- |\n${checkRows}\n\n${taskSections}\n`;
}
