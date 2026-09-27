import path from "node:path";
import { ExportSettingsSchema } from "../shared/export-settings.js";
import { EditTemplateSchema, type EditTemplate, type ExportPreset, type MediaItem, type StickerLayer } from "./domain.js";
import { ProviderError } from "./agent-provider.js";
import { computeCommonShapeCoverCandidates, readAdmittedShapeCoverTarget, type ShapeCoverCandidateRequest } from "./shape-cover-candidates.js";
import { freezeShapeCoverCandidate, type FrozenShapeCoverResult } from "./shape-cover-freeze.js";
import { admitShapeCoverSample, type ShapeCoverAdmission, type ShapeCoverReviewInput } from "./shape-cover-admission.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import type { ExportBatchIdentity, ExportQueue } from "./queue.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import type { ShapeCoverArtifactStore } from "./shape-cover-artifacts.js";

const unsafe = (reason: string): never => { throw new ProviderError(`UNSAFE: ${reason}`); };

/** Run-local integration only. Frozen JSON never carries publication authority. */
export class ShapeCoverProduction {
  private readonly request: ShapeCoverCandidateRequest;
  private commonIds: string[] = [];
  private readonly versions = new Map<number, { candidateId: string; frozen: Promise<FrozenShapeCoverResult> }>();
  constructor(private readonly input: {
    request: ShapeCoverCandidateRequest; store: SourceStickerKnowledgeStore; ffmpeg: FfmpegAdapter;
    queue: ExportQueue; preset: ExportPreset; directory: string;
    artifacts: ShapeCoverArtifactStore; outputDirectory: string;
    onTaskCreated?: (batch: ExportBatchIdentity) => Promise<void>;
    review(context: ShapeCoverReviewInput, signal: AbortSignal): Promise<string>; reviewerIdentity: string;
  }) { this.request = structuredClone(input.request); }

  get commonSafeCandidateIds(): readonly string[] { return [...this.commonIds]; }

  async prepare(media: readonly MediaItem[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const settings = ExportSettingsSchema.parse({ resolutionMode: this.input.preset.resolutionMode, frameRateMode: this.input.preset.frameRateMode, quality: this.input.preset.quality });
    // This production entry has one preset. The lower-level matrix still supports multiple settings.
    if (this.request.outputSettings.length !== 1 || JSON.stringify(ExportSettingsSchema.parse(this.request.outputSettings[0].settings)) !== JSON.stringify(settings)) unsafe("制作输出设置与形状矩阵不同。");
    const matches = (target: ShapeCoverCandidateRequest["intendedTargets"][number], item: MediaItem) =>
      target.sourcePath === item.sourcePath && target.source.fingerprint === item.fingerprint && target.source.byteLength === item.sizeBytes
      && target.source.width === item.width && target.source.height === item.height && target.source.rotation === item.rotation && target.source.durationMs === item.durationMs;
    if (this.request.intendedTargets.some(target => !media.some(item => matches(target, item)))
      || media.some(item => !this.request.intendedTargets.some(target => matches(target, item)))) unsafe("intended targets 与本轮全部制作素材不同。");
    for (const item of new Map(media.map(item => [item.sourcePath, item])).values()) {
      const intended = this.request.intendedTargets.filter(target => matches(target, item));
      // Prove completeness against the canonical source facts, never infer masks from boxes.
      for (const target of intended) await readAdmittedShapeCoverTarget(target, this.input.store);
      const head = await this.input.store.readHead(intended[0].source);
      const segments = head!.revision.candidate.facts.targets.flatMap(target => target.segments.map(segment => ({ targetId: target.id, segment })));
      if (segments.length !== intended.length || segments.some(({ targetId, segment }) => intended.filter(target => target.targetId === targetId
        && target.segmentId === segment.id && target.range.startMs === segment.track.startMs && target.range.endMs === segment.track.endMs).length !== 1)) unsafe("本轮源贴纸目标或有效时段不完整。");
      signal.throwIfAborted();
    }
    const common = await computeCommonShapeCoverCandidates(this.request, this.input.store, { ffmpegPath: this.input.ffmpeg.ffmpegPath, ffprobePath: this.input.ffmpeg.ffprobePath, signal });
    signal.throwIfAborted();
    if (common.status !== "PASS") unsafe(common.reason ?? "无共同安全候选。");
    this.commonIds = [...common.commonSafeCandidateIds];
  }

  async layers(version: number, candidateId: string, media: MediaItem, runId: string, signal: AbortSignal): Promise<StickerLayer[]> {
    signal.throwIfAborted();
    if (!this.commonIds.includes(candidateId)) unsafe("选款不在整轮共同安全集合。");
    let round = this.versions.get(version);
    if (!round) {
      round = { candidateId, frozen: freezeShapeCoverCandidate(this.request, candidateId, this.input.store, path.join(this.input.directory, `round-${version}`),
        { ffmpegPath: this.input.ffmpeg.ffmpegPath, ffprobePath: this.input.ffmpeg.ffprobePath, signal }) };
      this.versions.set(version, round);
    }
    if (round.candidateId !== candidateId) unsafe("同轮覆盖选款不一致。");
    const frozen = await round.frozen;
    signal.throwIfAborted();
    if (frozen.status !== "PASS") unsafe(frozen.reason);
    const targetIds = new Set(this.request.intendedTargets.filter(target => target.sourcePath === media.sourcePath).map(target => target.id));
    const layers = frozen.layers.filter(cell => targetIds.has(cell.intendedTargetId)).map(({ layer }) => ({ ...structuredClone(layer),
      cover: { ...structuredClone(layer.cover!), selection: { runId, round: version } } }));
    if (!layers.length) unsafe("本版缺冻结覆盖图层。");
    return layers;
  }

  async admit(template: EditTemplate, media: MediaItem, signal: AbortSignal) {
    const candidateId = template.layers.flatMap(layer => layer.type === "sticker" && layer.cover?.shapeMatched ? [layer.cover.shapeMatched.candidateId] : [])[0];
    if (!candidateId) return unsafe("本版缺冻结形状选款。");
    const result = await admitShapeCoverSample({ request: this.request, candidateId, template: EditTemplateSchema.parse(template), media, signal,
      preset: this.input.preset, queue: this.input.queue, ffmpeg: this.input.ffmpeg, store: this.input.store, cacheDirectory: this.input.directory,
      reviewer: { identity: this.input.reviewerIdentity, role: "independent-content-safety", review: this.input.review } });
    signal.throwIfAborted();
    if (result.status !== "PASS") return unsafe(result.reason);
    return result;
  }

  /** Orchestration only: custody, authority and publication outcomes belong to the artifact owner. */
  publish(input: { template: EditTemplate; media: MediaItem; runId: string; version: number;
    samplePath: string; admission: ShapeCoverAdmission; signal: AbortSignal }) {
    return this.input.artifacts.publish({ key: { runId: input.runId, mediaId: input.media.id, version: input.version },
      request: this.request, template: input.template, media: input.media, preset: this.input.preset,
      samplePath: input.samplePath, admission: input.admission, signal: input.signal, outputDirectory: this.input.outputDirectory,
      queue: { publishApprovedSample: request => this.input.queue.publishApprovedSample({ ...request, onTaskCreated: this.input.onTaskCreated }) } });
  }
}
