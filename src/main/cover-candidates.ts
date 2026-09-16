import { randomUUID } from "node:crypto";
import { COVER_DETECTION_WINDOW, DetectedCoverFrameSchema, type CoverDetectionImage, type DetectedCoverFrame } from "../shared/automatic-cover.js";
import { CoverReviewMediaSchema, type CoverReviewMedia } from "../shared/cover-review.js";

export type CoverCandidateDetector = (images: readonly CoverDetectionImage[], previous: DetectedCoverFrame | undefined, signal: AbortSignal) => Promise<DetectedCoverFrame[]>;

function safeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "自动候选分析已取消。";
  return "自动候选分析未完成，请人工检查已保存的证据并补充覆盖框。";
}

/** Adapts strict detector observations into an explicitly human-reviewed draft. */
export async function analyzeCoverCandidates(
  mediaDraft: CoverReviewMedia,
  images: readonly CoverDetectionImage[],
  detect: CoverCandidateDetector,
  signal: AbortSignal,
  onRequest?: () => void | Promise<void>,
): Promise<CoverReviewMedia> {
  // Reanalysis is a controller-owned new-draft operation. A second algorithm
  // pass must not append ambiguous candidates to the same review revision.
  if (mediaDraft.identities.some((item) => item.origin === "algorithm") || mediaDraft.observations.some((item) => item.origin === "automatic-candidate")) {
    throw new Error("该审阅草稿已完成候选分析；请创建新修订后重新分析。");
  }
  if (new Set(images.map((image) => image.timeMs)).size !== images.length) throw new Error("候选抽帧时间标签不唯一。");
  const evidenceByImage = images.map((image) => mediaDraft.evidence.find((item) => Math.round((item.pts * item.timeBase - (item.timeOriginSeconds ?? 0)) * 1000) === image.timeMs));
  if (evidenceByImage.some((item) => !item) || new Set(evidenceByImage.map((item) => item?.id)).size !== evidenceByImage.length) throw new Error("候选抽帧与证据不匹配。");
  const media = structuredClone(mediaDraft);
  media.analysis = "complete";
  delete media.analysisError;
  media.disposition = "unresolved";
  const identities = new Map<string, string>();
  const seenIdentityEvidence = new Map<string, Set<string>>();
  let previous: DetectedCoverFrame | undefined;
  try {
    for (let offset = 0; offset < images.length; offset += COVER_DETECTION_WINDOW - 1) {
      signal.throwIfAborted();
      const window = images.slice(offset, offset + COVER_DETECTION_WINDOW);
      if (!window.length) break;
      await onRequest?.();
      signal.throwIfAborted();
      const frames = (await detect(window, previous, signal)).map((frame) => DetectedCoverFrameSchema.parse(frame));
      signal.throwIfAborted();
      if (frames.length !== window.length || frames.some((frame, index) => frame.timeMs !== window[index].timeMs)) throw new Error("invalid-detection");
      const freshFrames = previous ? frames.slice(1) : frames;
      previous = frames.at(-1);
      for (const frame of freshFrames) {
        const imageIndex = images.findIndex((image) => image.timeMs === frame.timeMs);
        const evidence = evidenceByImage[imageIndex];
        if (imageIndex < 0 || !evidence) throw new Error("missing-evidence");
        // The detector reports only observed targets. It never proves absence.
        if (!frame.targets.length) media.observations.push({ evidenceId: evidence.id, presence: "UNKNOWN", origin: "automatic-candidate" });
        for (const target of frame.targets) {
          let identityId = identities.get(target.id);
          if (!identityId) {
            if (media.identities.length >= 64) throw new Error("too-many-candidates");
            identityId = randomUUID(); identities.set(target.id, identityId);
            media.identities.push({ id: identityId, label: `自动候选 ${target.id}`, semantics: "unknown", origin: "algorithm" });
            seenIdentityEvidence.set(identityId, new Set());
          }
          media.observations.push({ evidenceId: evidence.id, identityId, presence: "PRESENT", rectangle: target.rectangle, origin: "automatic-candidate" });
          seenIdentityEvidence.get(identityId)!.add(evidence.id);
          // A detector label can quantize VFR PTS, so observations never become
          // executable tracks. Human editing supplies legal visible intervals.
        }
      }
      if (offset + COVER_DETECTION_WINDOW >= images.length) break;
    }
    for (const [identityId, evidenceIds] of seenIdentityEvidence) {
      media.issues.push({ id: randomUUID(), kind: "uncertain_presence", identityId, evidenceIds: [...evidenceIds], reason: "候选只代表已抽样观察；未抽样时段仍需人工确认。", origin: "algorithm" });
    }
  } catch (error) {
    media.analysis = "incomplete";
    media.analysisError = safeError(error);
    media.issues.push({ id: randomUUID(), kind: "insufficient_evidence", evidenceIds: media.evidence.map(({ id }) => id), reason: media.analysisError, origin: "local" });
  }
  return CoverReviewMediaSchema.parse(media);
}
