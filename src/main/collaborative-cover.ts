import { ProviderError } from "./api-transport.js";
import { alignTargets, CoverObservationError } from "./cover-track-provider.js";
import type { CoverDetectionImage, DetectedCoverFrame } from "../shared/automatic-cover.js";
import type { EvidenceRequest, SupervisorEvidenceImage } from "./supervisor-evidence.js";
import { MAX_RECOGNITION_TURNS, RecognitionDecisionSchema, supervisorValidationFeedback, type RecognitionReviewInput } from "./supervisor-protocol.js";

/** Executor proposes once; a separately configured supervisor owns bounded evidence-based corrections. */
export async function detectCollaborativeCovers(
  images: readonly CoverDetectionImage[], previous: DetectedCoverFrame | undefined, signal: AbortSignal,
  detector: (images: readonly CoverDetectionImage[], signal: AbortSignal) => Promise<DetectedCoverFrame[]>,
  supervisor: (input: RecognitionReviewInput, signal: AbortSignal) => Promise<string>,
  inspect: (requests: readonly EvidenceRequest[], signal: AbortSignal) => Promise<SupervisorEvidenceImage[]>,
  onStage: (stage: string) => void = () => {},
): Promise<DetectedCoverFrame[]> {
  signal.throwIfAborted();
  let proposal: DetectedCoverFrame[] | undefined, feedback: string | undefined;
  let evidence: SupervisorEvidenceImage[] = [];
  onStage("执行 Agent 正在识别原贴纸");
  try { proposal = await detector(images, signal); }
  catch (error) {
    signal.throwIfAborted();
    // Auth/network/capability failures are not observation errors and are never retried.
    if (!(error instanceof CoverObservationError)) throw error;
    feedback = "执行 Agent 的观察无法使用（JSON 格式、时序不合格或判断不确定）。请根据原图独立核查并修正，必要时申请补帧或局部放大。";
  }
  for (let turn = 1; turn <= MAX_RECOGNITION_TURNS; turn++) {
    signal.throwIfAborted();
    onStage(`主管识别检查 ${turn}/${MAX_RECOGNITION_TURNS}${feedback ? " · 修正本地校验问题" : ""}`);
    const raw = await supervisor({ images, proposal, previous, evidence, feedback, turn }, signal);
    signal.throwIfAborted();
    let decision;
    try {
      decision = RecognitionDecisionSchema.parse(JSON.parse(raw));
      if (decision.action === "resolve") {
        if (decision.frames.length !== images.length || decision.frames.some((frame, index) => frame.timeMs !== images[index].timeMs)) throw new Error("time-mismatch");
        return previous ? alignTargets(previous, decision.frames) : decision.frames;
      }
      if (decision.action === "inspect" && decision.requests.some(request => request.timeMs < images[0].timeMs || request.timeMs > images.at(-1)!.timeMs)) throw new Error("out-of-window");
    } catch (error) { feedback = supervisorValidationFeedback(error); continue; }
    if (decision.action === "stop") throw new ProviderError(`主管检查仍无法确认原贴纸，本条未导出。主管报告：${decision.reason}`);
    if (turn === MAX_RECOGNITION_TURNS) break;
    onStage(`主管请求补充证据：${decision.reason}`);
    evidence = [...evidence, ...await inspect(decision.requests, signal)];
    feedback = "补充证据已提供。坐标以完整原图为准，裁剪图只用于放大检查；请返回原始输入时间的完整结果。";
  }
  throw new ProviderError(`主管识别达到 ${MAX_RECOGNITION_TURNS} 轮上限，仍未得到通过本地校验的结果，本条未导出。`);
}
