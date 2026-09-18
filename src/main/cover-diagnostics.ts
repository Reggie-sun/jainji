import { createHash } from "node:crypto";
import { CoverDiagnosticEventSchema, MAX_COVER_DIAGNOSTIC_BYTES, MAX_COVER_DIAGNOSTIC_EVENTS,
  type CoverDiagnosticEvent, type CoverDiagnosticStage, type CoverDiagnosticState, type CoverDiagnosticReason } from "../shared/cover-diagnostics.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import type { EvidenceRequest, SupervisorEvidenceImage } from "./supervisor-evidence.js";

type Details = Partial<Pick<CoverDiagnosticEvent, "action" | "reason" | "tracks" | "previousTracks" | "requests" | "priorInspections" | "evidence">>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rectangle = (value: NonNullable<EvidenceRequest["crop"]>) => ({ x: value.x, y: value.y, width: value.width, height: value.height });
export function diagnosticRequests(requests: readonly EvidenceRequest[]): EvidenceRequest[] {
  return requests.slice(0, 40).map(value => ({ timeMs: value.timeMs, ...(value.crop ? { crop: rectangle(value.crop) } : {}) }));
}
export function diagnosticEvidence(images: readonly SupervisorEvidenceImage[]): NonNullable<CoverDiagnosticEvent["evidence"]> {
  return images.slice(0, 40).map(value => ({ requestedTimeMs: value.requestedTimeMs, timeMs: value.timeMs,
    ...(value.previewTimeMs !== undefined ? { previewTimeMs: value.previewTimeMs } : {}),
    ...(value.crop ? { crop: rectangle(value.crop) } : {}), ...(value.previewCrop ? { previewCrop: rectangle(value.previewCrop) } : {}) }));
}
/** Called only after domain validation. Hash target IDs too: they are model-controlled text. */
export function diagnosticTracks(tracks: readonly AutomaticCoverTrack[]): NonNullable<CoverDiagnosticEvent["tracks"]> {
  const entries = tracks.slice(0, 64).map(({ targetId, track }) => ({ target: hash(targetId), digest: hash({
    startMs: track.startMs, endMs: track.endMs, keyframes: track.keyframes.map(frame => ({ timeMs: frame.timeMs, rectangle: rectangle(frame.rectangle) })),
  }) })).sort((a, b) => a.target.localeCompare(b.target) || a.digest.localeCompare(b.digest));
  return { digest: hash(entries), entries };
}
export function diagnosticValidationReason(error: unknown): CoverDiagnosticReason {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "time-range": case "no-visible-change": case "protected-field": case "unresolved-revision": case "corner-correction": return message;
    default: return "invalid-revision";
  }
}

/** One bounded buffer per run item; scopes share it, never any template or durable owner. */
export class CoverDiagnostics {
  readonly state: CoverDiagnosticState;
  constructor(private readonly changed: () => void = () => {}, state?: CoverDiagnosticState,
    private readonly phase: CoverDiagnosticEvent["phase"] = "item", private readonly turn = 0, private readonly revision = 0) {
    this.state = state ?? { schemaVersion: 1, events: [], droppedEvents: 0 };
  }
  scope(phase: CoverDiagnosticEvent["phase"], turn = 0, revision = 0): CoverDiagnostics {
    return new CoverDiagnostics(this.changed, this.state, phase, turn, revision);
  }
  private notify(): void { try { this.changed(); } catch { /* Observation must not affect production. */ } }
  record(stage: CoverDiagnosticStage, outcome: CoverDiagnosticEvent["outcome"], details: Details = {}): CoverDiagnosticEvent | undefined {
    const parsed = CoverDiagnosticEventSchema.safeParse({ ...details, phase: this.phase, turn: this.turn, revision: this.revision, stage, outcome, startedMs: performance.now() });
    // Reserve room for a final timestamp and outcome on every running span.
    if (!parsed.success || this.state.events.length >= MAX_COVER_DIAGNOSTIC_EVENTS
      || Buffer.byteLength(JSON.stringify(this.state)) + (parsed.success ? Buffer.byteLength(JSON.stringify(parsed.data)) : 0) + 256 * (this.state.events.filter(event => event.outcome === "running").length + 1) > MAX_COVER_DIAGNOSTIC_BYTES) {
      this.state.droppedEvents = Math.min(1_000_000, this.state.droppedEvents + 1); this.notify(); return;
    }
    this.state.events.push(parsed.data); this.notify(); return parsed.data;
  }
  async measure<T>(stage: CoverDiagnosticStage, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const event = this.record(stage, "running");
    let failed = false;
    try { return await work(); }
    catch (error) { failed = true; throw error; }
    finally { this.finish(event, signal, failed); }
  }
  finish(event: CoverDiagnosticEvent | undefined, signal: AbortSignal, failed = false): void {
    if (!event) return;
    event.finishedMs = performance.now(); event.durationMs = event.finishedMs - event.startedMs;
    event.outcome = signal.aborted ? "cancelled" : failed ? "failed" : "ok";
    if (event.outcome !== "ok") event.reason = signal.aborted ? "cancelled" : "stage-failed";
    this.notify();
  }
}
export function measureCoverStage<T>(diagnostics: CoverDiagnostics | undefined, stage: CoverDiagnosticStage, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return diagnostics ? diagnostics.measure(stage, signal, work) : work();
}
