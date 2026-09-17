import { ProviderError } from "./api-transport.js";
import { EditTemplateSchema, assertPriceOnlyTemplate, type EditTemplate } from "./domain.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import type { EvidenceRequest, SupervisorEvidenceImage } from "./supervisor-evidence.js";
import { MAX_PREVIEW_REVISIONS, MAX_PREVIEW_TURNS, PreviewDecisionSchema, supervisorValidationFeedback, validateSupervisorTracks, type PreviewReviewInput, type PreviewRevision } from "./supervisor-protocol.js";

interface SupervisedPreviewInput {
  template: EditTemplate;
  durationMs: number;
  tracks: AutomaticCoverTrack[];
  coverEnabled: boolean;
  automaticCorners: boolean;
  signal: AbortSignal;
  render(template: EditTemplate, signal: AbortSignal): Promise<string>;
  inspect(requests: readonly EvidenceRequest[], signal: AbortSignal, previewPath: string): Promise<SupervisorEvidenceImage[]>;
  review(input: PreviewReviewInput, signal: AbortSignal): Promise<string>;
  rebuild(revision: PreviewRevision): EditTemplate;
  onStage(stage: string): void;
}

function sampleTimes(template: EditTemplate, durationMs: number): EvidenceRequest[] {
  const end = Math.max(0, durationMs - 1);
  const times = template.decorationDisplayMode === "first-3s"
    ? [0, Math.min(500, end / 4), Math.max(0, Math.min(3000, durationMs) - 500), Math.max(0, Math.min(3000, durationMs) - 250), 3100, durationMs / 2, end]
    : [0, ...[1, 2, 3, 4, 5, 6].map(index => end * index / 7), end];
  return [...new Set(times.map(time => Math.round(Math.min(end, time))))].sort((a, b) => a - b).map(timeMs => ({ timeMs }));
}

export function supervisorLayerProjection(template: EditTemplate): Array<Record<string, unknown>> {
  return template.layers.map(layer => layer.type === "text"
    ? { type: layer.type, content: layer.content, x: layer.x, y: layer.y, width: layer.width }
    : { type: layer.type, x: layer.x, y: layer.y, width: layer.width, rotationDeg: layer.rotationDeg, visible: layer.visible,
      activeRanges: layer.activeRanges, cover: layer.cover ? { height: layer.cover.height, motion: layer.cover.motion } : undefined });
}

function effectiveLayers(template: EditTemplate, durationMs: number): string {
  const endMs = template.decorationDisplayMode === "first-3s" ? Math.min(3000, durationMs) : durationMs;
  return JSON.stringify(supervisorLayerProjection({ ...template, layers: template.layers.flatMap(layer => {
    if (!layer.visible) return [];
    if (layer.type !== "sticker" || !layer.activeRanges) return [layer];
    const activeRanges = layer.activeRanges.map(range => ({ startMs: range.startMs, endMs: Math.min(endMs, range.endMs) })).filter(range => range.endMs > range.startMs);
    return activeRanges.length ? [{ ...layer, activeRanges }] : [];
  }) }));
}

/** This gate returns a frozen candidate only after reviewing the latest real render. It never enqueues. */
export async function superviseRenderedTemplate(input: SupervisedPreviewInput): Promise<EditTemplate> {
  const { signal } = input;
  signal.throwIfAborted();
  let template = EditTemplateSchema.parse(input.template), tracks = structuredClone(input.tracks);
  let revision = 0, previewPath: string | undefined, feedback: string | undefined;
  let unresolvedRevision = false;
  let acceptedCorners: NonNullable<PreviewRevision["corners"]> = [];
  const history: PreviewReviewInput["history"] = [];
  const trackHorizonMs = template.decorationDisplayMode === "first-3s" ? Math.min(3000, input.durationMs) : input.durationMs;
  let evidence: SupervisorEvidenceImage[] = [];
  for (let turn = 1; turn <= MAX_PREVIEW_TURNS; turn++) {
    signal.throwIfAborted();
    if (!previewPath) {
      input.onStage(`正在渲染主管检查样片 · 修订 ${revision}/${MAX_PREVIEW_REVISIONS}`);
      previewPath = await input.render(template, signal);
      evidence = await input.inspect(sampleTimes(template, input.durationMs), signal, previewPath);
    }
    signal.throwIfAborted();
    input.onStage(`主管检查真实样片 ${turn}/${MAX_PREVIEW_TURNS} · 修订 ${revision}/${MAX_PREVIEW_REVISIONS}`);
    const raw = await input.review({ durationMs: input.durationMs, trackHorizonMs, displayMode: template.decorationDisplayMode ?? "full", coverEnabled: input.coverEnabled,
      automaticCorners: input.automaticCorners, tracks, layers: supervisorLayerProjection(template), evidence, feedback, turn, revision,
      remainingRevisions: MAX_PREVIEW_REVISIONS - revision, history: structuredClone(history) }, signal);
    signal.throwIfAborted();
    let decision;
    let revisionReason: string | undefined;
    try {
      const decoded: unknown = JSON.parse(raw);
      if (decoded && typeof decoded === "object" && "action" in decoded && decoded.action === "revise") {
        // Invalid patch data must not erase an already reported visual problem.
        unresolvedRevision = true;
        revisionReason = "reason" in decoded && typeof decoded.reason === "string" ? decoded.reason.slice(0, 500) : "主管要求修订，但修订结构无效";
      }
      decision = PreviewDecisionSchema.parse(decoded);
      history.push({ turn, revision, action: decision.action, reason: decision.reason });
      if (decision.action === "pass" && unresolvedRevision) throw new Error("unresolved-revision");
      if (decision.action === "inspect" && decision.requests.some(request => request.timeMs >= input.durationMs)) throw new Error("time-range");
      if (decision.action === "revise") {
        unresolvedRevision = true;
        if (revision >= MAX_PREVIEW_REVISIONS || turn === MAX_PREVIEW_TURNS) break;
        validateSupervisorTracks(decision.tracks, trackHorizonMs);
        if ((!input.automaticCorners && decision.corners?.length) || new Set(decision.corners?.map(corner => corner.corner)).size !== (decision.corners?.length ?? 0)) throw new Error("corner-correction");
        const updates = decision.corners ?? [];
        const corners = [...acceptedCorners.filter(corner => !updates.some(update => update.corner === corner.corner)), ...updates];
        const candidate = EditTemplateSchema.parse(input.rebuild({ ...decision, corners }));
        assertPriceOnlyTemplate(candidate);
        if (JSON.stringify(candidate.layers.filter(layer => layer.type === "text")) !== JSON.stringify(template.layers.filter(layer => layer.type === "text"))
          || candidate.productPrice !== template.productPrice || candidate.decorationDisplayMode !== template.decorationDisplayMode
          || (!input.coverEnabled && candidate.layers.some(layer => layer.type === "sticker" && layer.cover))) throw new Error("protected-field");
        if (effectiveLayers(candidate, input.durationMs) === effectiveLayers(template, input.durationMs)) throw new Error("no-visible-change");
        template = candidate; tracks = structuredClone(decision.tracks); revision++;
        acceptedCorners = corners;
        unresolvedRevision = false;
        history.at(-1)!.applied = true;
        previewPath = undefined; evidence = []; feedback = "已按修订重新渲染，必须重新检查本次样片才能通过。";
        continue;
      }
    } catch (error) {
      feedback = supervisorValidationFeedback(error, trackHorizonMs);
      if (history.at(-1)?.turn === turn) history.at(-1)!.feedback = feedback;
      else history.push({ turn, revision, action: revisionReason !== undefined ? "revise" : "invalid", reason: revisionReason ?? "返回结构无效", feedback });
      continue;
    }
    if (decision.action === "pass") return structuredClone(template);
    if (decision.action === "stop") throw new ProviderError(`主管检查样片仍有无法确认的问题，本条未导出。主管报告：${decision.reason}`);
    if (turn === MAX_PREVIEW_TURNS) break;
    input.onStage(`主管请求样片补充证据：${decision.reason}`);
    evidence = [...evidence, ...await input.inspect(decision.requests, signal, previewPath)];
    feedback = "已提供同一版本样片的补充证据，请据此继续检查。";
  }
  throw new ProviderError(`主管样片检查达到上限（最多 ${MAX_PREVIEW_TURNS} 轮检查、${MAX_PREVIEW_REVISIONS} 次修订），本条未导出。`);
}
