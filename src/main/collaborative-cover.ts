import { ProviderError } from "./api-transport.js";
import { alignTargets, type CoverRecognitionRole } from "./cover-track-provider.js";
import type { CoverDetectionImage, DetectedCoverFrame } from "../shared/automatic-cover.js";

type Observe = (images: readonly CoverDetectionImage[], signal: AbortSignal, role: CoverRecognitionRole) => Promise<DetectedCoverFrame[]>;
const MIN_BOUNDARY_AGREEMENT_IOU = 0.8;

function consensus(detector: DetectedCoverFrame[], reviewer: DetectedCoverFrame[], previous?: DetectedCoverFrame): DetectedCoverFrame[] {
  if (detector.length !== reviewer.length) throw new Error("disagreement");
  const identities = new Map<string, string>(), reverse = new Map<string, string>();
  const agreed = detector.map((frame, index) => {
    const other = reviewer[index];
    if (frame.timeMs !== other.timeMs) throw new Error("disagreement");
    const [merged] = alignTargets(frame, [other]);
    other.targets.forEach((target, i) => {
      const id = merged.targets[i].id;
      const a = frame.targets.find(candidate => candidate.id === id)!.rectangle, b = target.rectangle;
      const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      // Cross-window identity matching tolerates nested extents; independent
      // same-frame boundary agreement must not inherit that permissive rule.
      if (intersection / (a.width * a.height + b.width * b.height - intersection) < MIN_BOUNDARY_AGREEMENT_IOU) throw new Error("disagreement");
      if ((identities.has(target.id) && identities.get(target.id) !== id)
        || (reverse.has(id) && reverse.get(id) !== target.id)) throw new Error("disagreement");
      identities.set(target.id, id); reverse.set(id, target.id);
    });
    return merged;
  });
  return previous ? alignTargets(previous, agreed) : agreed;
}

/** Two blind observers, at most one explicit joint dispute round, never a single-agent fallback. */
export async function detectCollaborativeCovers(
  images: readonly CoverDetectionImage[], previous: DetectedCoverFrame | undefined, signal: AbortSignal,
  detector: Observe, reviewer: Observe, onStage: (stage: "blind" | "dispute") => void = () => {},
): Promise<DetectedCoverFrame[]> {
  signal.throwIfAborted();
  const observe = async (dispute?: CoverRecognitionRole["dispute"]) => {
    const roles: CoverRecognitionRole[] = ["detector", "reviewer"].map(role => ({ role: role as CoverRecognitionRole["role"], ...(dispute ? { dispute } : {}) }));
    // Wait for both calls to settle so failure cannot leave an unowned paid request running.
    const results = await Promise.allSettled([detector(images, signal, roles[0]), reviewer(images, signal, roles[1])]);
    signal.throwIfAborted();
    const [first, second] = results;
    if (first.status === "rejected") throw first.reason;
    if (second.status === "rejected") throw second.reason;
    return [first.value, second.value] as const;
  };
  onStage("blind");
  const [first, second] = await observe();
  try { return consensus(first, second, previous); } catch { /* Explicit bounded dispute, not an implicit retry. */ }
  onStage("dispute");
  const [rechecked, reviewed] = await observe({ detector: first, reviewer: second, ...(previous ? { previous } : {}) });
  try { return consensus(rechecked, reviewed, previous); }
  catch { throw new ProviderError(`多 Agent 协同识别仍有分歧（${(images[0].timeMs / 1000).toFixed(2)}–${(images[images.length - 1].timeMs / 1000).toFixed(2)} 秒），一次争议复查后仍无法确认目标或时序，本条未导出。`); }
}
