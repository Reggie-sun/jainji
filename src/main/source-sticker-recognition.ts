import { randomUUID } from "node:crypto";
import { COVER_DETECTION_WINDOW, COVER_SAMPLE_INTERVAL_MS, type CoverDetectionImage, type DetectedCoverFrame } from "../shared/automatic-cover.js";
import { CoverTrackSchema, type CoverRectangle } from "../shared/cover-sticker.js";
import { KnowledgeCandidateSchema, SourceFactsSchema, type KnowledgeEvidence, type SourceFacts, type SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { ProviderError } from "./api-transport.js";
import { detectCollaborativeCovers } from "./collaborative-cover.js";
import type { MediaItem } from "./domain.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";
import { SupervisorEvidence, type SupervisorEvidenceImage } from "./supervisor-evidence.js";
import type { RecognitionReviewInput } from "./supervisor-protocol.js";

const BINDING = { candidateId: "source-recognition", factsDigest: "0".repeat(64), templateDigest: "0".repeat(64), outputSettingsDigest: "0".repeat(64) };

export type SourceEvidence = Extract<KnowledgeEvidence, { kind: "source" }>;
export type RecognitionReviewContext = RecognitionReviewInput;
export interface SourceStickerRecognitionResult { facts: SourceFacts; evidence: SourceEvidence[]; blobs: Map<string, Buffer>; requests: number }
type BoundFrame = { frame: DetectedCoverFrame; evidenceId: string; actualTimeMs: number };
type SampleChunk = { samples: BoundFrame[]; endpoint?: BoundFrame };

function sameSource(left: SourceIdentity, right: SourceIdentity): boolean { return sourceKey(left) === sourceKey(right); }
function requestedTimes(horizonMs: number): number[] {
  const result: number[] = [];
  for (let timeMs = 0; timeMs < horizonMs; timeMs += COVER_SAMPLE_INTERVAL_MS) result.push(timeMs);
  return result;
}
function ratioMatches(left: CoverRectangle, right: CoverRectangle): boolean {
  const a = left.width * right.height, b = left.height * right.width;
  return Math.abs(a - b) <= 1e-6 * Math.max(a, b);
}
function keyframes(samples: readonly BoundFrame[], targetId: string, endpoint?: BoundFrame): Array<{ timeMs: number; rectangle: CoverRectangle }> {
  const result: Array<{ timeMs: number; rectangle: CoverRectangle }> = [];
  const append = (sample: BoundFrame, times: readonly number[]) => {
    const target = sample.frame.targets.find((item) => item.id === targetId);
    if (!target) throw new Error("Missing present target");
    for (const timeMs of times) {
      const prior = result.at(-1);
      if (prior?.timeMs === timeMs) {
        if ((["x", "y", "width", "height"] as const).some((key) => Math.abs(prior.rectangle[key] - target.rectangle[key]) > 1e-9)) throw new ProviderError("源贴纸抽帧时间过密且位置不一致，无法可靠建立知识。");
        continue;
      }
      if (prior && timeMs < prior.timeMs) throw new ProviderError("源贴纸抽帧时间无序，无法可靠建立知识。");
      result.push({ timeMs, rectangle: { ...target.rectangle } });
    }
  };
  for (const sample of samples) {
    const start = Math.floor(sample.actualTimeMs), end = Math.ceil(sample.actualTimeMs);
    append(sample, start === end ? [start] : [start, end]);
  }
  if (endpoint) append(endpoint, [Math.floor(endpoint.actualTimeMs)]);
  while (result.length > 1) {
    const last = result.at(-1)!, prior = result.at(-2)!;
    if ((["x", "y", "width", "height"] as const).some((key) => Math.abs(last.rectangle[key] - prior.rectangle[key]) > 1e-9)) break;
    result.pop();
  }
  return result;
}
function splitSamples(samples: readonly BoundFrame[], targetId: string): SampleChunk[] {
  const result: SampleChunk[] = [];
  for (let start = 0; start < samples.length;) {
    if (keyframes(samples.slice(start), targetId).length <= 50) {
      result.push({ samples: [...samples.slice(start)] });
      break;
    }
    let boundary = start + 1;
    while (boundary < samples.length && keyframes(samples.slice(start, boundary), targetId, samples[boundary]).length <= 50) boundary += 1;
    boundary -= 1;
    if (boundary <= start) throw new ProviderError("源贴纸轨迹无法在关键帧上限内安全分段。");
    result.push({ samples: [...samples.slice(start, boundary)], endpoint: samples[boundary] });
    start = boundary;
  }
  return result;
}
function sourceFacts(frames: readonly BoundFrame[], horizonMs: number, reviewedRange = { startMs: 0, endMs: horizonMs }): SourceFacts {
  const targetIds = [...new Set(frames.flatMap(({ frame }) => frame.targets.map((target) => target.id)))];
  if (targetIds.length > 64) throw new ProviderError("素材中的贴纸数量过多，无法可靠建立知识。");
  const observations: SourceFacts["observations"] = [];
  for (const bound of frames) {
    if (!targetIds.length) observations.push({ evidenceId: bound.evidenceId, presence: "ABSENT" });
    for (const targetId of targetIds) {
      const target = bound.frame.targets.find((item) => item.id === targetId);
      observations.push(target
        ? { evidenceId: bound.evidenceId, targetId, presence: "PRESENT", rectangle: { ...target.rectangle } }
        : { evidenceId: bound.evidenceId, targetId, presence: "ABSENT" });
    }
  }
  const targets: SourceFacts["targets"] = [];
  let segmentCount = 0;
  for (const targetId of targetIds) {
    const runs: Array<{ samples: BoundFrame[]; boundary?: number }> = [];
    let active: BoundFrame[] = [];
    for (const bound of frames) {
      const target = bound.frame.targets.find((item) => item.id === targetId);
      const prior = active.at(-1)?.frame.targets.find((item) => item.id === targetId);
      if (!target || (prior && !ratioMatches(prior.rectangle, target.rectangle))) {
        if (active.length) runs.push({ samples: active, boundary: bound.actualTimeMs });
        active = target ? [bound] : [];
      } else active.push(bound);
    }
    if (active.length) runs.push({ samples: active });
    const segments = runs.flatMap((run) => splitSamples(run.samples, targetId).map(({ samples, endpoint }, index) => {
      const first = samples[0].actualTimeMs, last = samples.at(-1)!.actualTimeMs;
      const boundary = endpoint?.actualTimeMs ?? run.boundary;
      const startMs = Math.floor(first), endMs = boundary === undefined ? horizonMs : Math.floor(boundary);
      if (startMs < 0 || endMs <= startMs || endMs <= last) throw new ProviderError("源贴纸时域无法安全表示。");
      const track = CoverTrackSchema.parse({ startMs, endMs, keyframes: keyframes(samples, targetId, endpoint) });
      return { track, evidenceIds: [...samples, ...(endpoint ? [endpoint] : [])].map((item) => item.evidenceId), interpolation: "linear" as const };
    })).map((segment, index) => ({ ...segment, id: `${targetId}_segment_${index}` }));
    segmentCount += segments.length;
    if (segments.length) targets.push({ id: targetId, segments });
  }
  if (segmentCount > 64) throw new ProviderError("源贴纸时段过于复杂，无法可靠建立知识。");
  return SourceFactsSchema.parse({ reviewedRanges: [reviewedRange], targets, exclusions: [], observations, samplingStrategy: "supervised-source-frames-v1" });
}
function validateCandidate(source: SourceIdentity, facts: SourceFacts, evidence: SourceEvidence[], requests: number): void {
  KnowledgeCandidateSchema.parse({ schemaVersion: 1, id: "source-recognition", state: "candidate", source, baseRevisionId: null, runId: randomUUID(), requiredRanges: facts.reviewedRanges, facts, evidence, resolvedDisputeIds: [], changes: [], provenance: { executor: "automatic-cover", supervisor: "supervisor", contractVersion: 1, requests, at: new Date().toISOString() } });
}
async function verifySource(ffmpeg: FfmpegAdapter, media: MediaItem, source: SourceIdentity, signal: AbortSignal): Promise<void> {
  const evidence = new SupervisorEvidence(ffmpeg, media);
  try { if (!sameSource(await evidence.sourceIdentity(signal), source)) throw new ProviderError("素材身份或时间解释已变化，不能复用源贴纸知识。"); }
  finally { await evidence.dispose(); }
}

/** Builds only source facts from supervised original frames; persistence remains an external owner. */
export async function recognizeSourceStickerKnowledge(
  ffmpeg: FfmpegAdapter, media: MediaItem, source: SourceIdentity, horizonMs: number, signal: AbortSignal,
  detect: (images: CoverDetectionImage[], signal: AbortSignal) => Promise<DetectedCoverFrame[]>,
  review: (context: RecognitionReviewContext, signal: AbortSignal) => Promise<unknown>, onStage: (stage: string) => void,
  onWindow?: (window: SourceStickerRecognitionResult) => Promise<void>,
): Promise<SourceStickerRecognitionResult> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(horizonMs) || horizonMs <= 0 || horizonMs > source.durationMs || horizonMs > media.durationMs) throw new ProviderError("源贴纸识别时段无效。");
  await verifySource(ffmpeg, media, source, signal);
  const requested = requestedTimes(horizonMs), detected: BoundFrame[] = [];
  const evidenceById = new Map<string, SourceEvidence>(), blobs = new Map<string, Buffer>();
  let requests = 0;
  for (let offset = 0; offset < requested.length; offset += COVER_DETECTION_WINDOW - 1) {
    signal.throwIfAborted();
    const owner = new SupervisorEvidence(ffmpeg, media);
    try {
      onStage("正在抽取源贴纸核查证据");
      const inspected = await owner.inspect(requested.slice(offset, offset + COVER_DETECTION_WINDOW).map((timeMs) => ({ timeMs })), signal);
      const actualFrames = new Set<number>();
      const images = inspected.filter((image) => {
        if (actualFrames.has(image.timeMs)) return false;
        actualFrames.add(image.timeMs);
        return true;
      });
      const modelImages: CoverDetectionImage[] = images.map((image) => {
        const timeMs = Math.round(image.timeMs);
        if (!Number.isSafeInteger(timeMs) || image.timeMs < 0 || image.timeMs >= horizonMs || !image.sourceEvidenceId) throw new ProviderError("源贴纸抽帧时间无效，无法建立知识。");
        return { timeMs, url: image.sourceUrl };
      });
      if (new Set(modelImages.map((image) => image.timeMs)).size !== modelImages.length) throw new ProviderError("源贴纸抽帧时间冲突，无法可靠建立知识。");
      if (detected.length && modelImages[0]?.timeMs !== detected.at(-1)!.frame.timeMs) throw new ProviderError("源贴纸抽帧无法保留重叠帧，不能可靠建立知识。");
      const allImages: SupervisorEvidenceImage[] = [...images], requestStart = requests;
      const result = await detectCollaborativeCovers(modelImages, detected.at(-1)?.frame, signal,
        async (input, requestSignal) => { requests += 1; return detect([...input], requestSignal); },
        async (context, requestSignal) => {
          requests += 1;
          const value = await review(context, requestSignal);
          if (typeof value !== "string") throw new ProviderError("主管识别响应无效。");
          return value;
        },
        async (requests, requestSignal) => {
          const extra = await owner.inspect(requests, requestSignal);
          allImages.push(...extra);
          return extra;
        }, onStage,
      );
      const handoff = owner.capture(allImages, BINDING);
      if (!sameSource(handoff.source, source)) throw new ProviderError("素材在源贴纸核查期间发生变化。");
      const windowEvidence = handoff.evidence.filter((item): item is SourceEvidence => item.kind === "source"), windowBlobs = new Map<string, Buffer>();
      for (const item of windowEvidence) {
        if (item.timeMs < 0 || item.timeMs >= horizonMs) throw new ProviderError("源贴纸证据超出核查时段。");
        const bytes = handoff.blobs.get(item.digest);
        if (!bytes) throw new ProviderError("源贴纸证据字节缺失。");
        evidenceById.set(item.id, item); blobs.set(item.digest, Buffer.from(bytes)); windowBlobs.set(item.digest, Buffer.from(bytes));
      }
      const window = result.map((frame, index) => {
        const sourceEvidenceId = images[index]?.sourceEvidenceId, evidence = sourceEvidenceId ? evidenceById.get(sourceEvidenceId) : undefined;
        if (!evidence || evidence.crop || Math.round(evidence.timeMs) !== frame.timeMs) throw new ProviderError("源贴纸观察未能绑定完整原图证据。");
        return { frame, evidenceId: evidence.id, actualTimeMs: evidence.timeMs };
      });
      const first = window[0]?.actualTimeMs, last = window.at(-1)?.actualTimeMs;
      if (first === undefined || last === undefined) throw new ProviderError("源贴纸识别窗口没有可确认观察。");
      const reviewedRange = { startMs: Math.floor(first), endMs: Math.min(horizonMs, Math.ceil(last) + 1) };
      const windowFacts = sourceFacts(window, reviewedRange.endMs, reviewedRange);
      const windowResult = { facts: windowFacts, evidence: windowEvidence, blobs: windowBlobs, requests: requests - requestStart };
      validateCandidate(source, windowFacts, windowEvidence, windowResult.requests);
      // A resolved/captured window is durable even if cancellation races after it.
      if (onWindow) await onWindow(windowResult);
      if (detected.length) {
        if (window[0]?.frame.timeMs !== detected.at(-1)!.frame.timeMs) throw new ProviderError("源贴纸识别窗口未正确重叠。");
        detected[detected.length - 1] = { ...window[0], evidenceId: detected.at(-1)!.evidenceId, actualTimeMs: detected.at(-1)!.actualTimeMs };
        detected.push(...window.slice(1));
      } else detected.push(...window);
    } finally { await owner.dispose(); }
  }
  signal.throwIfAborted();
  await verifySource(ffmpeg, media, source, signal);
  const facts = sourceFacts(detected, horizonMs), evidence = [...evidenceById.values()];
  validateCandidate(source, facts, evidence, requests);
  return { facts, evidence, blobs, requests };
}
