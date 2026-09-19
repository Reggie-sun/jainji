import { ProviderError } from "./api-transport.js";
import { EditTemplateSchema, assertPriceOnlyTemplate, type EditTemplate } from "./domain.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import type { EvidenceRequest, SupervisorEvidenceImage } from "./supervisor-evidence.js";
import { MAX_PREVIEW_REVISIONS, MAX_PREVIEW_TURNS, PreviewDecisionSchema, PreviewIssueSchema, supervisorValidationFeedback, validateSupervisorTracks, type PreviewIssue, type PreviewIssueRecord, type PreviewReviewInput, type PreviewRevision } from "./supervisor-protocol.js";
import { SupervisorKnowledgeReview, knowledgeTracks, templateDigest, type KnowledgeReviewOptions, type KnowledgeReviewHandoff } from "./supervisor-knowledge.js";
import { factsDigest, sourceKey } from "./source-sticker-knowledge-store.js";
import { coversRanges, type ReviewedRange } from "../shared/source-sticker-knowledge.js";
import { decorationDisplaySeconds } from "../shared/decorations.js";
import { diagnosticEvidence, diagnosticRequests, diagnosticTracks, diagnosticValidationReason, measureCoverStage, type CoverDiagnostics } from "./cover-diagnostics.js";
import { staticAutomaticCoverTracks } from "./cover-sticker.js";

interface SupervisedPreviewInput {
  diagnostics?: CoverDiagnostics;
  trackPurpose?: "cover-placement";
  session?: PreviewReviewSession;
  knowledge?: KnowledgeReviewOptions;
  template: EditTemplate;
  durationMs: number;
  tracks: AutomaticCoverTrack[];
  coverEnabled: boolean;
  automaticCorners: boolean;
  signal: AbortSignal;
  render(template: EditTemplate, signal: AbortSignal, diagnostics?: CoverDiagnostics): Promise<string>;
  inspect(requests: readonly EvidenceRequest[], signal: AbortSignal, previewPath: string): Promise<SupervisorEvidenceImage[]>;
  review(input: PreviewReviewInput, signal: AbortSignal): Promise<string>;
  rebuild(revision: PreviewRevision): EditTemplate;
  onStage(stage: string): void;
}

const limitError = () => new ProviderError(`主管样片检查达到上限（最多 ${MAX_PREVIEW_TURNS} 轮检查、${MAX_PREVIEW_REVISIONS} 次修订），本条未导出。`);
/** One instance belongs to one version; failures and knowledge rebindings do not reset it. */
export class PreviewReviewSession {
  private busy = false;
  private scope?: string;
  private readonly state = { turns: 0, revisions: 0, renders: 0, history: [] as PreviewReviewInput["history"], issues: [] as PreviewIssueRecord[],
    unresolved: false, unscopedIssue: false, blocked: false, corners: [] as NonNullable<PreviewRevision["corners"]>, binding: "",
    inspections: [] as EvidenceRequest[] };
  snapshot() { return structuredClone(this.state); }
  enter(scope: string, binding: string) {
    if (this.state.blocked) throw new Error("反证持久交接失败，不能继续此检查会话");
    if (this.busy || (this.scope && this.scope !== scope)) throw new Error("主管检查会话不属于此版本或正在使用");
    if (this.state.turns >= MAX_PREVIEW_TURNS) throw limitError();
    if (this.state.binding && this.state.binding !== binding) {
      if (this.state.revisions >= MAX_PREVIEW_REVISIONS) throw limitError();
      this.state.revisions++;
      // An applied repair is not transferable to a different binding. In particular,
      // retrying with a pre-repair candidate must not inherit its repaired verdict.
      for (const issue of this.state.issues) { issue.status = "open"; delete issue.resolvedTurn; }
      this.state.unresolved ||= this.state.unscopedIssue;
      this.state.history.push({ turn: this.state.turns, revision: this.state.revisions, action: "rebind", reason: "知识或模板重新绑定，必须重新渲染检查", applied: true });
    }
    this.scope = scope; this.state.binding = binding; this.busy = true;
    return this.state;
  }
  leave(): void { this.busy = false; }
}
export interface SupervisedPreviewResult {
  previewPath: string;
  template: EditTemplate;
  tracks: AutomaticCoverTrack[];
  checkedRanges: ReviewedRange[];
  budget: { turns: number; revisions: number; renders: number };
  history: PreviewReviewInput["history"];
  issues: PreviewIssueRecord[];
  knowledge?: KnowledgeReviewHandoff;
  persistence: "saved" | "not-saved" | "not-requested";
  session: PreviewReviewSession;
}

function sampleTimes(template: EditTemplate, durationMs: number): EvidenceRequest[] {
  const end = Math.max(0, durationMs - 1);
  const limitMs = (decorationDisplaySeconds(template.decorationDisplayMode) ?? 0) * 1000;
  const times = limitMs
    ? [0, Math.max(0, Math.min(limitMs, durationMs) - 500), Math.max(0, Math.min(limitMs, durationMs) - 250), limitMs + 100,
      ...(template.stickerDisplayMode === "full" ? [end / 4, end / 2, end * 3 / 4] : [Math.min(500, end / 4), durationMs / 2]), end]
    : [0, ...[1, 2, 3, 4, 5, 6].map(index => end * index / 7), end];
  return [...new Set(times.map(time => Math.round(Math.min(end, time))))].sort((a, b) => a - b).map(timeMs => ({ timeMs }));
}

export function supervisorLayerProjection(template: EditTemplate): Array<Record<string, unknown>> {
  return template.layers.map(layer => layer.type === "text"
    ? { type: layer.type, content: layer.content, x: layer.x, y: layer.y, width: layer.width }
    : { type: layer.type, x: layer.x, y: layer.y, width: layer.width, rotationDeg: layer.rotationDeg, visible: layer.visible,
      activeRanges: layer.activeRanges, cover: layer.cover ? { height: layer.cover.height, motion: layer.cover.motion, opaqueBackground: layer.cover.opaqueBackground } : undefined });
}

function effectiveLayers(template: EditTemplate, durationMs: number): string {
  const endMs = template.stickerDisplayMode !== "full" && template.decorationDisplayMode === "first-3s" ? Math.min(3000, durationMs) : durationMs;
  return JSON.stringify(supervisorLayerProjection({ ...template, layers: template.layers.flatMap(layer => {
    if (!layer.visible) return [];
    if (layer.type !== "sticker" || !layer.activeRanges) return [layer];
    const activeRanges = layer.activeRanges.map(range => ({ startMs: range.startMs, endMs: Math.min(endMs, range.endMs) })).filter(range => range.endMs > range.startMs);
    return activeRanges.length ? [{ ...layer, activeRanges }] : [];
  }) }));
}

/** This gate returns a frozen candidate only after reviewing the latest real render. It never enqueues. */
export async function superviseRenderedTemplate(input: SupervisedPreviewInput): Promise<SupervisedPreviewResult> {
  if (input.trackPurpose === "cover-placement" && (!input.coverEnabled || input.knowledge)) throw new ProviderError("近似覆盖不能作为原贴纸知识复核。");
  const { signal } = input;
  signal.throwIfAborted();
  let template = EditTemplateSchema.parse(input.template), tracks = input.trackPurpose === "cover-placement"
    ? staticAutomaticCoverTracks(input.tracks) : structuredClone(input.tracks);
  let previewPath: string | undefined, feedback: string | undefined;
  const trackHorizonMs = template.stickerDisplayMode !== "full" && template.decorationDisplayMode === "first-3s" ? Math.min(3000, input.durationMs) : input.durationMs;
  const checkedRanges = [{ startMs: 0, endMs: trackHorizonMs }];
  const knowledge = input.knowledge ? new SupervisorKnowledgeReview(input.knowledge, input.session?.snapshot().issues) : undefined;
  if (knowledge && (!coversRanges(knowledge.candidate.requiredRanges, checkedRanges) || knowledge.candidate.source.durationMs !== input.durationMs
    || JSON.stringify(knowledgeTracks(knowledge.candidate, trackHorizonMs)) !== JSON.stringify(tracks))) throw new Error("源知识与待检查版本不匹配");
  const binding = () => `${templateDigest(template)}:${knowledge ? `${knowledge.candidate.baseRevisionId}:${factsDigest(knowledge.candidate.facts)}` : JSON.stringify(tracks)}`;
  const session = input.session ?? new PreviewReviewSession();
  const state = session.enter(`${template.id}:${input.durationMs}:${trackHorizonMs}:${knowledge ? sourceKey(knowledge.candidate.source) : "local"}`, binding());
  const { history } = state;
  const priorInspections = state.inspections;
  let evidence: SupervisorEvidenceImage[] = [];
  try { while (state.turns < MAX_PREVIEW_TURNS) {
    signal.throwIfAborted();
    const diagnostics = input.diagnostics?.scope("preview", state.turns + 1, state.revisions);
    if (!previewPath) {
      input.onStage(`正在渲染主管检查样片 · 修订 ${state.revisions}/${MAX_PREVIEW_REVISIONS}`);
      state.renders++;
      const requests = sampleTimes(template, input.durationMs);
      if (input.trackPurpose === "cover-placement") {
        for (const request of priorInspections) {
          if (!requests.some(value => JSON.stringify(value) === JSON.stringify(request))) requests.push(structuredClone(request));
        }
      }
      diagnostics?.record("sample", "ok", { tracks: diagnosticTracks(tracks), requests: diagnosticRequests(requests), priorInspections: diagnosticRequests(priorInspections) });
      previewPath = await input.render(template, signal, diagnostics);
      evidence = [];
      for (let offset = 0; offset < requests.length; offset += 8) {
        signal.throwIfAborted();
        const images = await measureCoverStage(diagnostics, "paired-evidence", signal, () => input.inspect(requests.slice(offset, offset + 8), signal, previewPath!));
        evidence.push(...images);
      }
      diagnostics?.record("sample", "ok", { requests: diagnosticRequests(requests), evidence: diagnosticEvidence(evidence) });
    }
    signal.throwIfAborted();
    knowledge?.observe(evidence, template);
    const turn = ++state.turns, revision = state.revisions;
    input.onStage(`主管检查真实样片 ${turn}/${MAX_PREVIEW_TURNS} · 修订 ${revision}/${MAX_PREVIEW_REVISIONS}`);
    const raw = await measureCoverStage(diagnostics, "review-provider", signal, () => input.review({ trackPurpose: input.trackPurpose, durationMs: input.durationMs, trackHorizonMs, displayMode: template.decorationDisplayMode ?? "full", coverEnabled: input.coverEnabled,
      stickerDisplayMode: template.stickerDisplayMode, automaticCorners: input.automaticCorners, tracks, layers: supervisorLayerProjection(template), evidence, feedback, turn, revision,
      remainingRevisions: MAX_PREVIEW_REVISIONS - revision, history: structuredClone(history), issues: structuredClone(state.issues), knowledge: knowledge?.context() }, signal));
    signal.throwIfAborted();
    let decoded: unknown;
    let revisionReason: string | undefined;
    try {
      decoded = JSON.parse(raw);
      if (decoded && typeof decoded === "object" && "action" in decoded && decoded.action === "revise") {
        // Invalid patch data must not erase an already reported visual problem.
        revisionReason = "reason" in decoded && typeof decoded.reason === "string" ? decoded.reason.slice(0, 500) : "主管要求修订，但修订结构无效";
      }
    } catch (error) {
      diagnostics?.record("validation", "failed", { action: "invalid", reason: "invalid-response" });
      if (revisionReason) state.unresolved = state.unscopedIssue = true;
      feedback = supervisorValidationFeedback(error, trackHorizonMs);
      history.push({ turn, revision, action: revisionReason ? "revise" : "invalid", reason: revisionReason ?? "返回结构无效", feedback });
      continue;
    }
    // Persist independently of patch validity, repair budget and eventual verdict.
    // Storage errors are deliberately outside the protocol-feedback catch.
    const reported = decoded && typeof decoded === "object" && "issues" in decoded && Array.isArray(decoded.issues) ? decoded.issues : [];
    let issueError: unknown;
    const confirmed: PreviewIssue[] = [];
    if (reported.length > 32) issueError = new Error("问题数量超限");
    for (const value of reported.slice(0, 32)) {
      let issue: PreviewIssue;
      try {
        issue = PreviewIssueSchema.parse(value);
        if (!knowledge) throw new Error("缺少问题证据上下文");
        knowledge.validateIssue(issue);
        const existing = state.issues.find(record => record.id === issue.id);
        if (existing) {
          const { status: _status, reportedTurn: _turn, resolvedTurn: _resolved, disputedRevisionId: _dispute, ...original } = existing;
          if (JSON.stringify(original) !== JSON.stringify(issue)) throw new Error("问题编号不能复用");
        }
      } catch (error) { issueError = error; continue; }
      const existing = state.issues.find(record => record.id === issue.id);
      if (existing) {
        existing.status = "open";
        if (existing.disputedRevisionId === input.knowledge?.previousRevision?.id) continue;
      } else state.issues.push({ ...issue, status: "open", reportedTurn: turn });
      confirmed.push(issue);
    }
    const handoffs = await Promise.allSettled(confirmed.map(async issue => {
      const revisionId = await knowledge!.dispute(issue);
      if (revisionId) state.issues.find(record => record.id === issue.id)!.disputedRevisionId = revisionId;
    }));
    const failed = handoffs.find(result => result.status === "rejected");
    if (failed?.status === "rejected") { state.blocked = true; throw failed.reason; }
    signal.throwIfAborted();
    let decision: ReturnType<typeof PreviewDecisionSchema.parse>;
    try {
      if (issueError) throw issueError;
      decision = PreviewDecisionSchema.parse(decoded);
      if (decision.action === "revise" && input.trackPurpose === "cover-placement") {
        const validated = validateSupervisorTracks(decision.tracks, trackHorizonMs);
        const staticTracks = staticAutomaticCoverTracks(validated);
        const ignoredMovingOnly = staticTracks.length < validated.length
          && JSON.stringify(staticTracks) === JSON.stringify(tracks)
          && !decision.corners?.length && !decision.issues?.length && !decision.resolvedIssueIds?.length && !decision.sourceFacts;
        decision = ignoredMovingOnly
          ? { action: "pass", reason: "位置移动或跳变的原动图按快速导出规则忽略" }
          : { ...decision, tracks: staticTracks };
      }
    } catch (error) {
      diagnostics?.record("validation", "failed", { action: revisionReason ? "revise" : "invalid", reason: "invalid-response" });
      if (issueError || (revisionReason && !reported.length)) state.unresolved = state.unscopedIssue = true;
      feedback = supervisorValidationFeedback(error, trackHorizonMs);
      history.push({ turn, revision, action: revisionReason ? "revise" : "invalid", reason: revisionReason ?? "返回结构无效", feedback });
      continue;
    }
    try {
      history.push({ turn, revision, action: decision.action, reason: decision.reason });
      if (decision.action === "pass" && (state.unresolved || state.issues.some(issue => issue.status === "open"))) throw new Error("unresolved-revision");
      if (decision.action === "inspect" && decision.requests.some(request => request.timeMs >= input.durationMs)) throw new Error("time-range");
      if (decision.action === "revise") {
        if (!decision.issues?.length && !decision.resolvedIssueIds?.length) state.unresolved = state.unscopedIssue = true;
        if (revision >= MAX_PREVIEW_REVISIONS || turn === MAX_PREVIEW_TURNS) {
          diagnostics?.record("validation", "failed", { action: "revise", reason: "budget-exhausted" });
          break;
        }
        validateSupervisorTracks(decision.tracks, trackHorizonMs);
        if ((!input.automaticCorners && decision.corners?.length) || new Set(decision.corners?.map(corner => corner.corner)).size !== (decision.corners?.length ?? 0)) throw new Error("corner-correction");
        const updates = decision.corners ?? [];
        const corners = [...state.corners.filter(corner => !updates.some(update => update.corner === corner.corner)), ...updates];
        const candidate = EditTemplateSchema.parse(input.rebuild({ ...decision, corners }));
        assertPriceOnlyTemplate(candidate);
        if (JSON.stringify(candidate.layers.filter(layer => layer.type === "text")) !== JSON.stringify(template.layers.filter(layer => layer.type === "text"))
          || candidate.productPrice !== template.productPrice || candidate.decorationDisplayMode !== template.decorationDisplayMode || candidate.stickerDisplayMode !== template.stickerDisplayMode
          || (!input.coverEnabled && candidate.layers.some(layer => layer.type === "sticker" && layer.cover))) throw new Error("protected-field");
        const visibleChanged = effectiveLayers(candidate, input.durationMs) !== effectiveLayers(template, input.durationMs);
        if (decision.sourceFacts && !knowledge) throw new Error("源事实缺少证据");
        const corrected = knowledge?.correction(decision, state.issues, trackHorizonMs);
        if (knowledge && !corrected && JSON.stringify(decision.tracks) !== JSON.stringify(tracks)) throw new Error("源轨迹必须通过源事实修正");
        if (!visibleChanged && !corrected) throw new Error("no-visible-change");
        const resolved = decision.resolvedIssueIds ?? [];
        for (const id of resolved) {
          const issue = state.issues.find(value => value.id === id && value.status === "open");
          if (!issue || (issue.scope === "render" ? !visibleChanged : !corrected)) throw new Error("问题没有对应的有效修正");
        }
        for (const issue of state.issues) if (resolved.includes(issue.id)) issue.status = "awaiting-review";
        if (corrected) knowledge!.accept(corrected);
        diagnostics?.record("validation", "ok", { action: "revise", reason: "accepted", previousTracks: diagnosticTracks(tracks), tracks: diagnosticTracks(decision.tracks) });
        template = candidate; tracks = structuredClone(decision.tracks); state.revisions++;
        state.corners = corners; state.binding = binding();
        if (visibleChanged) state.unresolved = false;
        history.at(-1)!.applied = true;
        previewPath = undefined; evidence = []; feedback = "已按修订重新渲染，必须重新检查本次样片才能通过。";
        continue;
      }
    } catch (error) {
      diagnostics?.record("validation", "failed", { action: decision.action, reason: diagnosticValidationReason(error) });
      feedback = supervisorValidationFeedback(error, trackHorizonMs);
      if (history.at(-1)?.turn === turn) history.at(-1)!.feedback = feedback;
      else history.push({ turn, revision, action: revisionReason !== undefined ? "revise" : "invalid", reason: revisionReason ?? "返回结构无效", feedback });
      continue;
    }
    if (decision.action === "pass") {
      const handoff = knowledge?.handoff();
      const persistence = handoff ? await knowledge!.persist(handoff) : "not-requested";
      signal.throwIfAborted();
      for (const issue of state.issues) if (issue.status === "awaiting-review") { issue.status = "resolved"; issue.resolvedTurn = turn; }
      diagnostics?.record("validation", "ok", { action: "pass", reason: "accepted" });
      return { previewPath: previewPath!, template: structuredClone(template), tracks: structuredClone(tracks), checkedRanges, budget: { turns: state.turns, revisions: state.revisions, renders: state.renders },
        history: structuredClone(history), issues: structuredClone(state.issues), knowledge: handoff, persistence, session };
    }
    if (decision.action === "stop") {
      diagnostics?.record("validation", "failed", { action: "stop", reason: "provider-stop" });
      throw new ProviderError(`主管检查样片仍有无法确认的问题，本条未导出。主管报告：${decision.reason}`);
    }
    diagnostics?.record("validation", "ok", { action: "inspect", reason: "accepted", requests: diagnosticRequests(decision.requests) });
    // At most four requests per turn and five turns; keep geometry, never image bytes.
    for (const request of decision.requests) {
      if (!priorInspections.some(value => JSON.stringify(value) === JSON.stringify(request))) priorInspections.push(structuredClone(request));
    }
    if (turn === MAX_PREVIEW_TURNS) break;
    input.onStage(`主管请求样片补充证据：${decision.reason}`);
    const extra = await measureCoverStage(diagnostics, "paired-evidence", signal, () => input.inspect(decision.requests, signal, previewPath!));
    diagnostics?.record("inspect", "ok", { requests: diagnosticRequests(decision.requests), evidence: diagnosticEvidence(extra) });
    evidence = [...evidence, ...extra];
    feedback = "已提供同一版本样片的补充证据，请据此继续检查。";
  }
  input.diagnostics?.scope("preview", state.turns, state.revisions).record("validation", "failed", { reason: "budget-exhausted" });
  throw limitError();
  } finally { session.leave(); }
}
