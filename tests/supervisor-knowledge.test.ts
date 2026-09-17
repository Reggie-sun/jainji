import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultTemplate } from "../src/main/domain";
import { superviseRenderedTemplate, PreviewReviewSession } from "../src/main/supervised-preview";
import { factsDigest, sourceKey, SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { knowledgeTracks, type DisputeHandoff, type KnowledgeReviewOptions } from "../src/main/supervisor-knowledge";
import type { KnowledgeCandidate, KnowledgeRevision, KnowledgeEvidence } from "../src/shared/source-sticker-knowledge";
import type { SupervisorEvidenceImage } from "../src/main/supervisor-evidence";
import { supervisePreview } from "../src/main/supervisor-provider";
import type { ModelMessage } from "../src/main/api-transport";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const pass = JSON.stringify({ action: "pass", reason: "已检查" });
const range = { startMs: 0, endMs: 3000 };
const rectangle = { x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
function fixture() {
  const bytes = Buffer.from("source image"), previewBytes = Buffer.from("preview image");
  const frame = { id: "source", kind: "source" as const, digest: hash(bytes), byteLength: bytes.length, pts: 0, timeMs: 0, width: 720, height: 1280 };
  const candidate: KnowledgeCandidate = { schemaVersion: 1, id: "candidate", state: "candidate", runId: "run", baseRevisionId: null,
    source: { fingerprint: `sha256:${"a".repeat(64)}`, byteLength: 100, width: 720, height: 1280, rotation: 0, durationMs: 5000, timeBase: "1/1000", timeOriginPts: 0, interpretationVersion: 1 },
    requiredRanges: [range], facts: { reviewedRanges: [range], targets: [], observations: [{ evidenceId: "source", presence: "ABSENT" }], exclusions: [], samplingStrategy: "full-frame-sampled" },
    evidence: [frame], changes: [], resolvedDisputeIds: [], provenance: { executor: "test", supervisor: "test", contractVersion: 1, requests: 2, at: "2026-09-17T00:00:00.000Z" } };
  const capture = vi.fn((_images: readonly SupervisorEvidenceImage[], binding: Parameters<KnowledgeReviewOptions["capture"]>[1]) => {
    const preview: KnowledgeEvidence = { id: `preview-${binding.candidateId}-${binding.templateDigest}`, kind: "preview", sourceEvidenceId: frame.id, digest: hash(previewBytes), byteLength: previewBytes.length, pts: 0, timeMs: 0, timeBase: "1/1000", timeOriginPts: 0, width: 720, height: 1280, ...binding };
    return { source: candidate.source, evidence: [frame, preview], blobs: new Map([[hash(bytes), bytes], [hash(previewBytes), previewBytes]]) };
  });
  const knowledge: KnowledgeReviewOptions = { candidate, blobs: new Map([[hash(bytes), bytes]]), outputSettingsDigest: "c".repeat(64), capture };
  const template = { ...createDefaultTemplate(), decorationDisplayMode: "first-3s" as const };
  const render = vi.fn(async () => "preview"), inspect = vi.fn(async () => [{ sourceEvidenceId: "source", requestedTimeMs: 0, timeMs: 0, sourceUrl: "source", previewUrl: "preview", previewTimeMs: 0 }]);
  const review = vi.fn().mockResolvedValue(pass);
  const rebuild = vi.fn(() => structuredClone(template));
  return { template, durationMs: 5000, tracks: knowledgeTracks(candidate), coverEnabled: false, automaticCorners: true, signal: new AbortController().signal, render, inspect, review, rebuild, onStage: vi.fn(), knowledge };
}
function correction(input: ReturnType<typeof fixture>) {
  const facts = structuredClone(input.knowledge.candidate.facts);
  facts.targets = [{ id: "a", segments: [{ id: "segment", track: { ...range, keyframes: [{ timeMs: 0, rectangle }] }, evidenceIds: ["source"], interpolation: "linear" }] }];
  facts.observations = [{ targetId: "a", evidenceId: "source", presence: "PRESENT", rectangle }];
  const issue = { id: "missed", scope: "source" as const, kind: "missing_target" as const, ranges: [range], evidenceIds: ["source"], reason: "原图漏检" };
  return { action: "revise", reason: "修正源事实", sourceFacts: facts, tracks: knowledgeTracks({ ...input.knowledge.candidate, facts }), issues: [issue], resolvedIssueIds: [issue.id] };
}
function withPrevious(input: ReturnType<typeof fixture>) {
  const candidate = input.knowledge.candidate;
  input.knowledge.previousRevision = { id: "previous", sourceKey: sourceKey(candidate.source), state: "reviewed", verification: "sampled", candidate: structuredClone(candidate), factsDigest: factsDigest(candidate.facts), proof: {} } as KnowledgeRevision;
  candidate.baseRevisionId = "previous";
  const onDispute = vi.fn(async (_handoff: DisputeHandoff) => {}); input.knowledge.onDispute = onDispute;
  return onDispute;
}

describe("supervisor knowledge handoff", () => {
  it("accepts evidence-backed source correction despite unchanged pixels, then rerenders and binds a fresh proof", async () => {
    const input = fixture(); input.review.mockResolvedValueOnce(JSON.stringify(correction(input))).mockResolvedValue(pass);
    const onReviewed = vi.fn(async () => "saved" as const); input.knowledge.onReviewed = onReviewed;
    const result = await superviseRenderedTemplate(input);
    expect(result.template).toEqual(input.template);
    expect(result.budget).toEqual({ turns: 2, revisions: 1, renders: 2 });
    expect(result.issues[0]).toMatchObject({ status: "resolved", reportedTurn: 1, resolvedTurn: 2 });
    expect(result.knowledge!.candidate.id).not.toBe("candidate");
    expect(result.knowledge!.proof.factsDigest).toBe(factsDigest(result.knowledge!.candidate.facts));
    expect(result.knowledge!.candidate.evidence.filter(e => e.kind === "preview")).toHaveLength(1);
    expect(input.review.mock.calls[0][0].knowledge).toMatchObject({ requiredRanges: [range], facts: input.knowledge.candidate.facts });
    expect(input.review.mock.calls[1][0].knowledge.facts.targets).toHaveLength(1);
    expect(result.persistence).toBe("saved"); expect(onReviewed).toHaveBeenCalledOnce();
  });
  it("cannot clear a render defect with an unrelated fact-only change", async () => {
    const input = fixture(), patch = correction(input);
    input.review.mockResolvedValueOnce(JSON.stringify({ ...patch, issues: [...patch.issues, { id: "corner", scope: "render", kind: "missing_corner", reason: "缺角", ranges: [range], evidenceIds: ["source"] }] })).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
    expect(input.render).toHaveBeenCalledTimes(2);
  });
  it("does not accept unchanged facts or unreviewed evidence as a repair", async () => {
    for (const bad of ["noop", "evidence"]) {
      const input = fixture(), patch = correction(input);
      if (bad === "noop") { patch.sourceFacts = structuredClone(input.knowledge.candidate.facts); patch.tracks = []; }
      else patch.issues[0].evidenceIds = ["invented"];
      input.review.mockResolvedValueOnce(JSON.stringify(patch)).mockResolvedValue(pass);
      await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
      expect(input.render).toHaveBeenCalledOnce();
    }
  });
  it("hands counterevidence off before stop and before exhausted repair budget", async () => {
    for (const action of ["stop", "revise"]) {
      const input = fixture(), onDispute = withPrevious(input), patch = correction(input);
      input.review.mockResolvedValueOnce("invalid").mockResolvedValueOnce("invalid").mockResolvedValueOnce("invalid").mockResolvedValueOnce("invalid")
        .mockResolvedValue(JSON.stringify(action === "stop" ? { action, reason: "无法继续", issues: patch.issues } : patch));
      await expect(superviseRenderedTemplate(input)).rejects.toThrow(action === "stop" ? "无法确认" : "上限");
      expect(onDispute).toHaveBeenCalledOnce();
      expect(onDispute.mock.calls[0][0]).toMatchObject({ dispute: { revisionId: "previous", kind: "missing_target" } });
      expect(input.rebuild).not.toHaveBeenCalled();
    }
  });
  it("propagates persistence errors without another model request", async () => {
    const input = fixture(); withPrevious(input);
    input.knowledge.onDispute = vi.fn(async () => { throw new Error("disk unavailable"); });
    input.review.mockResolvedValueOnce(JSON.stringify(correction(input))).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("disk unavailable");
    expect(input.review).toHaveBeenCalledOnce(); expect(input.rebuild).not.toHaveBeenCalled();
  });
  it("awaits already-confirmed counterevidence on cancel, but rejects late responses before handoff", async () => {
    const input = fixture(), onDispute = withPrevious(input), abort = new AbortController(); input.signal = abort.signal;
    input.review.mockImplementation(async () => { abort.abort(); return JSON.stringify(correction(input)); });
    await expect(superviseRenderedTemplate(input)).rejects.toThrow(); expect(onDispute).not.toHaveBeenCalled();
    const accepted = fixture(), acceptedAbort = new AbortController(); withPrevious(accepted); accepted.signal = acceptedAbort.signal;
    let saved = false;
    accepted.knowledge.onDispute = vi.fn(async () => { acceptedAbort.abort(); await Promise.resolve(); saved = true; });
    accepted.review.mockResolvedValue(JSON.stringify(correction(accepted)));
    await expect(superviseRenderedTemplate(accepted)).rejects.toThrow(); expect(saved).toBe(true); expect(accepted.rebuild).not.toHaveBeenCalled();
  });
  it("charges rebinding to the original version budget", async () => {
    const input = fixture(), session = new PreviewReviewSession();
    await superviseRenderedTemplate({ ...input, session });
    input.template.version++;
    const next = await superviseRenderedTemplate({ ...input, session });
    expect(next.budget).toEqual({ turns: 2, revisions: 1, renders: 2 });
    input.template.version++; await superviseRenderedTemplate({ ...input, session });
    input.template.version++;
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("上限");
    expect(input.review).toHaveBeenCalledTimes(3);
  });
  it("does not resume around a failed durable dispute handoff", async () => {
    const input = fixture(), session = new PreviewReviewSession(); withPrevious(input);
    input.knowledge.onDispute = vi.fn(async () => { throw new Error("disk unavailable"); });
    input.review.mockResolvedValue(JSON.stringify(correction(input)));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("disk unavailable");
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("反证");
    expect(input.review).toHaveBeenCalledOnce();
  });
  it("clips the render projection while retaining full source knowledge in first-3s mode", async () => {
    const input = fixture(), patch = correction(input), facts = patch.sourceFacts;
    facts.reviewedRanges[0].endMs = 5000; facts.targets[0].segments[0].track.endMs = 5000;
    input.knowledge.candidate.facts = facts;
    input.tracks = patch.tracks;
    const result = await superviseRenderedTemplate(input);
    expect(result.knowledge!.candidate.facts.targets[0].segments[0].track.endMs).toBe(5000);
    expect(result.tracks[0].track.endMs).toBe(3000);
  });
  it("keeps a confirmed dispute durable across failed repair, cancellation, disposal and reopen", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-supervisor-handoff-"));
    let store = await SourceStickerKnowledgeStore.open(directory);
    try {
      const first = fixture(), source = first.knowledge.candidate.source;
      const token = await store.beginRun(source); first.knowledge.candidate.runId = token.id;
      first.knowledge.onReviewed = async ({ candidate, proof, blobs }) => { await store.publish(token, candidate, proof, blobs); return "saved"; };
      const result = await superviseRenderedTemplate(first);
      const found = await store.lookup(source, [range]); if (found.status !== "hit") throw new Error("expected baseline");
      expect(result.persistence).toBe("saved");
      await store.endRun(token);
      const next = fixture(), abort = new AbortController(); next.signal = abort.signal;
      const nextToken = await store.beginRun(source, abort.signal); next.knowledge.candidate.runId = nextToken.id;
      next.knowledge.candidate.baseRevisionId = found.revision.id; next.knowledge.previousRevision = found.revision;
      next.knowledge.onDispute = async ({ dispute, blobs }) => { await store.recordDispute(nextToken, dispute, blobs); abort.abort(); };
      next.review.mockResolvedValue(JSON.stringify(correction(next)));
      await expect(superviseRenderedTemplate(next)).rejects.toThrow();
      expect(next.rebuild).not.toHaveBeenCalled();
      await store.endRun(nextToken); await store.close();
      store = await SourceStickerKnowledgeStore.open(directory);
      expect(await store.lookup(source, [range])).toMatchObject({ status: "disputed" });
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it("persists a valid source issue even if the same response carries a malformed repair", async () => {
    const input = fixture(), onDispute = withPrevious(input), patch = correction(input);
    input.review.mockResolvedValueOnce(JSON.stringify({ ...patch, sourceFacts: { invalid: true } })).mockResolvedValue(pass);
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("上限");
    expect(onDispute).toHaveBeenCalledOnce();
  });
  it("awaits all confirmed counterevidence before observing cancellation", async () => {
    const input = fixture(), abort = new AbortController(); withPrevious(input); input.signal = abort.signal;
    const patch = correction(input), saved: string[] = [];
    patch.issues.push({ ...patch.issues[0], id: "second" });
    input.knowledge.onDispute = async ({ dispute }) => { await Promise.resolve(); abort.abort(); saved.push(dispute.id); };
    input.review.mockResolvedValue(JSON.stringify(patch));
    await expect(superviseRenderedTemplate(input)).rejects.toThrow();
    expect(saved).toEqual(["missed", "second"]); expect(input.rebuild).not.toHaveBeenCalled();
  });
  it("does not suppress prior-revision disputes because unrelated metadata changed", async () => {
    const input = fixture(), onDispute = withPrevious(input);
    input.knowledge.candidate.facts.samplingStrategy = "rechecked-sampling";
    const patch = correction(input);
    input.review.mockResolvedValue(JSON.stringify({ action: "stop", reason: "确认原事实错误", issues: patch.issues }));
    await expect(superviseRenderedTemplate(input)).rejects.toThrow("无法确认");
    expect(onDispute).toHaveBeenCalledOnce();
  });
  it("cannot resolve a prior issue by resuming with the stale pre-repair candidate", async () => {
    const input = fixture(), session = new PreviewReviewSession();
    input.review.mockResolvedValueOnce(JSON.stringify(correction(input))).mockRejectedValueOnce(new Error("network"));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("network");
    input.review.mockResolvedValue(pass);
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("上限");
    expect(session.snapshot().issues[0].status).toBe("open");
  });
  it("retains durable dispute references across a same-version resume", async () => {
    const input = fixture(), session = new PreviewReviewSession(), onDispute = withPrevious(input), patch = correction(input);
    input.review.mockResolvedValueOnce(JSON.stringify({ action: "stop", reason: "暂停检查", issues: patch.issues }));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("无法确认");
    input.review.mockResolvedValueOnce(JSON.stringify(patch)).mockResolvedValue(pass);
    const result = await superviseRenderedTemplate({ ...input, session });
    expect(onDispute).toHaveBeenCalledOnce();
    expect(result.knowledge!.candidate.resolvedDisputeIds).toEqual(["missed"]);
  });
  it("sends whole fact context and full companions alongside cropped evidence, without paths", async () => {
    const input = fixture(); await superviseRenderedTemplate(input);
    const context = input.review.mock.calls[0][0];
    context.evidence[0] = { ...context.evidence[0], sourceUrl: "data:source-crop", previewUrl: "data:preview-crop", fullSourceUrl: "data:source-full", fullPreviewUrl: "data:preview-full", fullSourceEvidenceId: "parent" };
    const complete = vi.fn(async (_messages: ModelMessage[]) => pass);
    await supervisePreview(complete, context, input.signal);
    const messages = complete.mock.calls[0][0], content = messages[1].content;
    expect(messages[0].content).toContain("即使没有改变有效画面");
    expect(JSON.stringify(content)).toContain("requiredRanges");
    expect(Array.isArray(content) && content.filter(item => item.type === "image_url").map(item => item.image_url.url)).toEqual(["data:source-full", "data:preview-full", "data:source-crop", "data:preview-crop"]);
    expect(JSON.stringify(messages)).not.toContain("sourcePath");
  });
  it("reaffirms an existing issue against a newly bound base revision", async () => {
    const input = fixture(), session = new PreviewReviewSession(), onDispute = withPrevious(input), patch = correction(input);
    input.review.mockResolvedValue(JSON.stringify({ action: "stop", reason: "源事实仍然错误", issues: patch.issues }));
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("无法确认");
    input.knowledge.previousRevision!.id = "new-base"; input.knowledge.candidate.baseRevisionId = "new-base";
    await expect(superviseRenderedTemplate({ ...input, session })).rejects.toThrow("无法确认");
    expect(onDispute.mock.calls.map(([handoff]) => handoff.dispute.revisionId)).toEqual(["previous", "new-base"]);
    expect(session.snapshot().revisions).toBe(1);
  });
});
