import { z } from "zod";
import { CoverPlacementSchema, PlacementTargetIdSchema, type CoverPlacement } from "../shared/cover-placement.js";
import { CoverRectangleSchema, CoverTrackSchema } from "../shared/cover-sticker.js";
import type { SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { ProviderError } from "./api-transport.js";
import type { MediaItem } from "./domain.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { SupervisorEvidence, type SupervisorEvidenceImage } from "./supervisor-evidence.js";
import { supervisorValidationFeedback } from "./supervisor-protocol.js";
import { diagnosticEvidence, diagnosticRequests, diagnosticTracks, measureCoverStage, type CoverDiagnostics } from "./cover-diagnostics.js";

const MAX_PROPOSAL_TURNS = 3;
const MAX_INITIAL_CONTACTS = 12;
const MAX_INSPECTION_REQUESTS = 4;
const MAX_OWNER_REQUESTS = 40;
const TrackSchema = z.object({ targetId: PlacementTargetIdSchema, track: CoverTrackSchema }).strict();
const InspectionRequestSchema = z.object({ timeMs: z.number().int().nonnegative(), crop: CoverRectangleSchema.optional() }).strict();
const ProposalDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), reason: z.string().trim().min(1).max(500), tracks: z.array(TrackSchema).max(64) }).strict(),
  z.object({ action: z.literal("inspect"), reason: z.string().trim().min(1).max(500), requests: z.array(InspectionRequestSchema).min(1).max(MAX_INSPECTION_REQUESTS) }).strict(),
  z.object({ action: z.literal("stop"), reason: z.string().trim().min(1).max(500) }).strict(),
]);

export interface ReviewCoverPlacementInput {
  durationMs: number;
  images: readonly SupervisorEvidenceImage[];
  feedback?: string;
  turn: number;
}

function sameSource(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.fingerprint === right.fingerprint && left.byteLength === right.byteLength && left.width === right.width && left.height === right.height
    && left.rotation === right.rotation && left.durationMs === right.durationMs && left.timeBase === right.timeBase
    && left.timeOriginPts === right.timeOriginPts && left.interpretationVersion === right.interpretationVersion;
}

function initialTimes(durationMs: number): number[] {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new ProviderError("素材时长无效，无法建议覆盖位置。");
  const count = Math.min(MAX_INITIAL_CONTACTS, durationMs);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round(index * (durationMs - 1) / (count - 1)));
}

function proposalFeedback(error: unknown): string {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return supervisorValidationFeedback(error);
  return "本地校验不通过：轨迹必须在素材时长内，关键帧必须位于轨迹内，同一目标的时段不得重叠。";
}

function mediaMatches(source: SourceIdentity, media: MediaItem): boolean {
  return source.fingerprint === media.fingerprint && source.durationMs === media.durationMs && source.width === media.width && source.height === media.height && source.rotation === media.rotation;
}

/** Produces approximate render-space placement only; it never creates reusable source facts. */
export async function proposeCoverPlacement(
  ffmpeg: FfmpegAdapter, media: MediaItem, signal: AbortSignal,
  complete: (context: ReviewCoverPlacementInput, signal: AbortSignal) => Promise<string>, onStage: (stage: string) => void,
  guard?: (source: SourceIdentity) => Promise<void>,
  diagnostics?: CoverDiagnostics,
): Promise<CoverPlacement> {
  signal.throwIfAborted();
  const owner = new SupervisorEvidence(ffmpeg, media);
  try {
    onStage("正在核对素材身份");
    const source = await owner.sourceIdentity(signal);
    signal.throwIfAborted();
    if (!mediaMatches(source, media)) throw new ProviderError("素材身份或时长已变化，无法建议覆盖位置。");
    if (guard) await guard(source);
    signal.throwIfAborted();

    onStage("正在抽取全片覆盖位置参考帧");
    const contactsByActualTime = new Map<number, SupervisorEvidenceImage>();
    for (let offset = 0, requested = initialTimes(source.durationMs); offset < requested.length; offset += 8) {
      signal.throwIfAborted();
      const requests = requested.slice(offset, offset + 8).map((timeMs) => ({ timeMs }));
      const trace = diagnostics?.scope("proposal");
      trace?.record("sample", "ok", { requests: diagnosticRequests(requests) });
      const batch = await measureCoverStage(trace, "source-evidence", signal, () => owner.inspect(requests, signal));
      trace?.record("sample", "ok", { evidence: diagnosticEvidence(batch) });
      signal.throwIfAborted();
      // Keep the final requested endpoint when two requested times decode to one frame.
      for (const image of batch) contactsByActualTime.set(image.timeMs, image);
    }

    let images: SupervisorEvidenceImage[] = [...contactsByActualTime.values()].sort((left, right) => left.requestedTimeMs - right.requestedTimeMs);
    let ownerRequests = initialTimes(source.durationMs).length;
    let feedback: string | undefined;
    let lastReason = "未得到可渲染的近似覆盖位置。";
    let proposalTurns = 0;
    let providerCalls = 0;
    while (proposalTurns < MAX_PROPOSAL_TURNS) {
      signal.throwIfAborted();
      const turn = proposalTurns + 1;
      onStage(`正在建议近似覆盖位置 · 校验机会 ${turn}/${MAX_PROPOSAL_TURNS} · 取帧 ${ownerRequests}/${MAX_OWNER_REQUESTS}`);
      const trace = diagnostics?.scope("proposal", ++providerCalls);
      const raw = await measureCoverStage(trace, "proposal-provider", signal, () => complete({ durationMs: source.durationMs, images, feedback, turn }, signal));
      signal.throwIfAborted();
      let decision: z.infer<typeof ProposalDecisionSchema>;
      try { decision = ProposalDecisionSchema.parse(JSON.parse(raw)); }
      catch (error) {
        trace?.record("validation", "failed", { action: "invalid", reason: "invalid-response" });
        proposalTurns += 1; feedback = proposalFeedback(error); lastReason = feedback; continue;
      }

      if (decision.action === "propose") {
        proposalTurns += 1;
        let placement: CoverPlacement;
        try {
          placement = CoverPlacementSchema.parse({ schemaVersion: 1, source, tracks: decision.tracks });
        } catch (error) {
          trace?.record("validation", "failed", { action: "propose", reason: "invalid-tracks" });
          signal.throwIfAborted();
          feedback = proposalFeedback(error); lastReason = feedback; continue;
        }
        signal.throwIfAborted();
        const finalSource = await owner.sourceIdentity(signal);
        signal.throwIfAborted();
        if (!sameSource(finalSource, source) || !mediaMatches(finalSource, media)) throw new ProviderError("素材身份或时间解释已变化，不能返回近似覆盖位置。");
        trace?.record("validation", "ok", { action: "propose", reason: "accepted", tracks: diagnosticTracks(placement.tracks) });
        return placement;
      }
      if (decision.action === "stop") {
        trace?.record("validation", "failed", { action: "stop", reason: "provider-stop" });
        throw new ProviderError("主管无法确认近似覆盖位置，本条未导出。");
      }
      if (decision.requests.some((request) => request.timeMs >= source.durationMs)) {
        trace?.record("validation", "failed", { action: "inspect", reason: "time-range", requests: diagnosticRequests(decision.requests) });
        proposalTurns += 1;
        feedback = "补充证据时间必须位于素材时长内。";
        lastReason = feedback;
        continue;
      }
      if (ownerRequests + decision.requests.length > MAX_OWNER_REQUESTS) {
        trace?.record("validation", "failed", { action: "inspect", reason: "budget-exhausted", requests: diagnosticRequests(decision.requests) });
        throw new ProviderError("主管请求的补充证据超过本次 40 帧上限，本条未导出。");
      }
      trace?.record("validation", "ok", { action: "inspect", reason: "accepted", requests: diagnosticRequests(decision.requests) });
      onStage("正在抽取主管请求的补充证据");
      const extra = await measureCoverStage(trace, "source-evidence", signal, () => owner.inspect(decision.requests, signal));
      trace?.record("inspect", "ok", { requests: diagnosticRequests(decision.requests), evidence: diagnosticEvidence(extra) });
      signal.throwIfAborted();
      ownerRequests += decision.requests.length;
      images = [...images, ...extra];
      feedback = "补充证据已提供；请只给出近似渲染位置，不要声称为源贴纸事实。";
      lastReason = "主管请求补充证据后仍未给出可渲染的近似覆盖位置。";
    }
    diagnostics?.scope("proposal", providerCalls).record("validation", "failed", { reason: "budget-exhausted" });
    throw new ProviderError(`近似覆盖位置建议达到 ${MAX_PROPOSAL_TURNS} 轮上限：${lastReason}`);
  } finally { await owner.dispose(); }
}
