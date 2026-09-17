import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultTemplate, type MediaItem } from "../src/main/domain";
import { SourceStickerKnowledgeStore, identifySource, factsDigest } from "../src/main/source-sticker-knowledge-store";
import { SourceStickerKnowledgeSession, type KnowledgePreviewInput } from "../src/main/source-sticker-knowledge-session";
import { superviseRenderedTemplate } from "../src/main/supervised-preview";
import type { KnowledgeCandidate, SourceFacts } from "../src/shared/source-sticker-knowledge";
import type { PreviewReviewInput } from "../src/main/supervisor-protocol";

const stores: SourceStickerKnowledgeStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
const rectangle = { x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
function corrected(candidate: KnowledgeCandidate): SourceFacts {
  const evidenceId = candidate.facts.observations[0].evidenceId;
  return { ...candidate.facts, targets: [{ id: "a", segments: [{ id: "a0", interpolation: "linear", evidenceIds: [evidenceId], track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle }] } }] }], observations: [{ evidenceId, targetId: "a", presence: "PRESENT", rectangle }] };
}
async function fixture(quotaBytes?: number) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-session-"));
  const file = path.join(directory, "source.mp4"); await writeFile(file, "exact source bytes");
  const source = await identifySource(file, { width: 720, height: 1280, rotation: 0, durationMs: 6000, timeBase: "1/1000", timeOriginPts: 0, interpretationVersion: 1 });
  const storeOptions = { quotaBytes };
  const store = await SourceStickerKnowledgeStore.open(directory, storeOptions); stores.push(store);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath: file, fingerprint: source.fingerprint, durationMs: 6000, width: 720, height: 1280, rotation: 0, sizeBytes: source.byteLength, displayName: "source", probeStatus: "ready", importedAt: new Date().toISOString() };
  let recognitions = 0, previews = 0;
  let recognitionError: Error | undefined, recognitionFacts: ((facts: SourceFacts) => SourceFacts) | undefined, failAfterWindow = false;
  let acceptedWindow = () => {};
  let previewExtras = false;
  const inheritedEvidence: string[][] = [];
  let decision: (input: PreviewReviewInput) => string = () => JSON.stringify({ action: "pass", reason: "checked" });
  const original = Buffer.from("actual source frame"), rendered = Buffer.from("actual preview frame");
  const sourceEvidence = { id: "original", kind: "source" as const, digest: hash(original), byteLength: original.length, pts: 0, timeMs: 0, width: 720, height: 1280 };
  const recognize = async (_media: MediaItem, _source: unknown, horizon: number, _signal: AbortSignal, _stage: (message: string) => void, onWindow?: (result: { facts: SourceFacts; evidence: typeof sourceEvidence[]; blobs: Map<string, Buffer>; requests: number }) => Promise<void>) => {
    recognitions++;
    if (recognitionError) throw recognitionError;
    const facts: SourceFacts = { reviewedRanges: [{ startMs: 0, endMs: horizon }], targets: [], observations: [{ evidenceId: "original", presence: "ABSENT" }], exclusions: [], samplingStrategy: "fixture" };
    const result = { facts: recognitionFacts ? recognitionFacts(facts) : facts, evidence: [sourceEvidence], blobs: new Map([[hash(original), original]]), requests: 2 };
    if (failAfterWindow) { acceptedWindow(); await onWindow?.(result); throw new Error("later window failed"); }
    return result;
  };
  const review = async (input: KnowledgePreviewInput) => {
    inheritedEvidence.push(input.knowledge.candidate.evidence.map(e => e.id));
    return superviseRenderedTemplate({ ...input, durationMs: 6000, coverEnabled: false, automaticCorners: true,
    render: async () => { previews++; return "preview"; },
    inspect: async () => [{ requestedTimeMs: 0, timeMs: 0, sourceUrl: "source", sourceEvidenceId: "original", previewUrl: "preview", previewTimeMs: 0, previewEvidenceId: "preview" }],
    review: async (context) => decision(context),
    knowledge: { ...input.knowledge, outputSettingsDigest: "c".repeat(64), capture: (_images, binding) => ({ source, evidence: [sourceEvidence, ...(previewExtras ? [{ ...sourceEvidence, id: `preview-only-${previews}` }] : []), { id: "preview", kind: "preview", digest: hash(rendered), byteLength: rendered.length, pts: 0, timeMs: 0, timeBase: "1/1000", timeOriginPts: 0, width: 720, height: 1280, sourceEvidenceId: "original", ...binding }], blobs: new Map([[hash(original), original], [hash(rendered), rendered]]) }) },
  }); };
  const session = (refresh = false) => new SourceStickerKnowledgeSession({ store, identify: async () => source, recognize, review, executor: "fixture/executor", supervisor: "fixture/supervisor", refreshMediaIds: refresh ? new Set([media.id]) : undefined });
  const template = () => ({ ...createDefaultTemplate(), productPrice: "手动两行\n保持不变", decorationDisplayMode: "first-3s" as const,
    layers: [{ id: crypto.randomUUID(), type: "text" as const, content: "手动两行\n保持不变", textAlign: "center" as const, x: 0.1, y: 0.13, width: 0.8, visible: true, opacity: 1, zIndex: 10,
      fontFamily: "sans-serif", fontSizeRatio: 0.04, color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0 }] });
  return { directory, file, source, store, media, session, template, inheritedEvidence, extraPreviewSources: () => { previewExtras = true; }, counts: () => ({ recognitions, previews }), decide: (fn: typeof decision) => { decision = fn; }, recognitionFailure: (error: Error) => { recognitionError = error; }, recognitionChange: (fn: typeof recognitionFacts) => { recognitionFacts = fn; }, failAfterWindow: (accepted = () => {}) => { failAfterWindow = true; acceptedWindow = accepted; }, quota: (bytes: number) => { storeOptions.quotaBytes = bytes; } };
}
const stage = () => undefined;

describe("source knowledge session", () => {
  it("does not accumulate preview-only source evidence in later versions or warm runs", async () => {
    const f = await fixture(); f.extraPreviewSources();
    const session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage);
    for (let i = 0; i < 3; i++) { const t = f.template(); await session.review(binding, t, () => t, signal(), stage); }
    await session.close();
    const warm = f.session(), next = await warm.acquire(f.media, 3000, signal(), stage), t = f.template();
    await warm.review(next, t, () => t, signal(), stage); await warm.close();
    expect(f.inheritedEvidence).toEqual(Array.from({ length: 4 }, () => ["original"]));
  });

  it("reuses exact source across media/project IDs but renders and reviews every new version", async () => {
    const f = await fixture(), first = f.session();
    const binding = await first.acquire(f.media, 3000, signal(), stage);
    const template = f.template();
    const version = await first.review(binding, template, () => template, signal(), stage);
    expect(await first.enqueue(version, signal(), async frozen => frozen.productPrice)).toBe("手动两行\n保持不变");
    await first.close();
    const second = f.session();
    const copy = await second.acquire({ ...f.media, id: crypto.randomUUID() }, 3000, signal(), stage);
    const next = f.template(); await second.review(copy, next, () => next, signal(), stage);
    expect(f.counts()).toEqual({ recognitions: 1, previews: 2 });
    await second.close();
  });

  it("invalidates earlier versions after a later fact correction and reuses the original preview budget", async () => {
    const f = await fixture(), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage);
    const a = f.template(), b = f.template();
    const first = await session.review(binding, a, () => a, signal(), stage);
    let correctedOnce = false;
    f.decide(context => {
      if (!correctedOnce) {
        correctedOnce = true;
        const facts = corrected({ facts: context.knowledge!.facts } as KnowledgeCandidate);
        return JSON.stringify({ action: "revise", reason: "missing sticker", tracks: [{ targetId: "a", track: facts.targets[0].segments[0].track }], sourceFacts: facts, resolvedIssueIds: ["missing"], issues: [{ id: "missing", scope: "source", kind: "missing_target", ranges: [{ startMs: 0, endMs: 3000 }], evidenceIds: ["original"], reason: "source has sticker" }] });
      }
      if (context.feedback && !context.feedback.includes("已按修订")) throw new Error(context.feedback);
      return JSON.stringify({ action: "pass", reason: "checked" });
    });
    const second = await session.review(binding, b, () => b, signal(), stage);
    await expect(session.enqueue(first, signal(), async () => "unsafe")).rejects.toThrow();
    await session.reconcile([first, second], signal(), stage);
    expect(first.reviewSession.snapshot()).toMatchObject({ turns: 2, revisions: 1, renders: 2 });
    const frozen = await session.enqueue(first, signal(), async template => template);
    expect(frozen.sourceStickerKnowledge?.revisionId).toBe(second.template.sourceStickerKnowledge?.revisionId);
    expect(frozen.productPrice).toBe("手动两行\n保持不变");
    expect(f.counts()).toEqual({ recognitions: 1, previews: 4 });
    await session.close();
  });

  it("keeps confirmed disputes blocked after failed correction, session close and restart", async () => {
    const f = await fixture(), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage);
    const t = f.template(); const first = await session.review(binding, t, () => t, signal(), stage);
    f.decide(() => JSON.stringify({ action: "fail", reason: "source wrong", issues: [{ id: "wrong", scope: "source", kind: "missing_target", ranges: [{ startMs: 0, endMs: 3000 }], evidenceIds: ["original"], reason: "confirmed" }] }));
    const b = f.template(); await expect(session.review(binding, b, () => b, signal(), stage)).rejects.toThrow();
    await expect(session.enqueue(first, signal(), async () => "unsafe")).rejects.toThrow();
    await session.close(); await f.store.close();
    const reopened = await SourceStickerKnowledgeStore.open(f.directory); stores.push(reopened);
    expect((await reopened.lookup(f.source, [{ startMs: 0, endMs: 3000 }])).status).toBe("disputed");
  });

  it("allows a quota-only unsaved result, but rejects source changes and stale publication races", async () => {
    const f = await fixture(100), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage);
    const t = f.template(), version = await session.review(binding, t, () => t, signal(), stage);
    expect((await session.enqueue(version, signal(), async template => template)).sourceStickerKnowledge).toMatchObject({ persistence: "not-saved", verification: "sampled" });
    await writeFile(f.file, "replacement bytes");
    await expect(session.enqueue(version, signal(), async () => "unsafe")).rejects.toThrow();
    await session.close();
  });

  it("does not use partial coverage for a longer request and explicit refresh bypasses a warm hit", async () => {
    const f = await fixture(), first = f.session(); const a = await first.acquire(f.media, 3000, signal(), stage);
    const t = f.template(); await first.review(a, t, () => t, signal(), stage); await first.close();
    const longer = f.session(); await longer.acquire(f.media, 6000, signal(), stage); await longer.close();
    const refresh = f.session(true); await refresh.acquire(f.media, 3000, signal(), stage); await refresh.close();
    expect(f.counts().recognitions).toBe(3);
    expect((await f.store.readHead(f.source))?.revision.factsDigest).toBe(factsDigest({ reviewedRanges: [{ startMs: 0, endMs: 3000 }], targets: [], observations: [{ evidenceId: "original", presence: "ABSENT" }], exclusions: [], samplingStrategy: "fixture" }));
  });

  it("stops the CAS loser instead of enqueueing or rerunning its model", async () => {
    const f = await fixture(), a = f.session(), b = f.session();
    const first = await a.acquire(f.media, 3000, signal(), stage), other = await b.acquire(f.media, 3000, signal(), stage);
    const t = f.template(); await a.review(first, t, () => t, signal(), stage);
    const u = f.template(); await expect(b.review(other, u, () => u, signal(), stage)).rejects.toMatchObject({ code: "conflict" });
    expect(f.counts()).toEqual({ recognitions: 2, previews: 2 });
    await a.close(); await b.close();
  });

  it("refuses cancelled/late preview results and known changed templates", async () => {
    const f = await fixture(), session = f.session(), abort = new AbortController();
    const binding = await session.acquire(f.media, 3000, abort.signal, stage), t = f.template();
    f.decide(() => { abort.abort(); return JSON.stringify({ action: "pass", reason: "late" }); });
    await expect(session.review(binding, t, () => t, abort.signal, stage)).rejects.toThrow();
    expect(await f.store.readHead(f.source)).toBeUndefined(); await session.close();
    const fresh = f.session(); f.decide(() => JSON.stringify({ action: "pass", reason: "checked" }));
    const bind = await fresh.acquire(f.media, 3000, signal(), stage), v = await fresh.review(bind, t, () => t, signal(), stage);
    v.template.productPrice = "changed";
    await expect(fresh.enqueue(v, signal(), async () => "unsafe")).rejects.toThrow("失效"); await fresh.close();
  });

  it("does not withdraw old knowledge for failed refresh without counterevidence and does not fall back in that run", async () => {
    const f = await fixture(), first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close();
    f.recognitionFailure(new Error("network failure"));
    const refresh = f.session(true);
    await expect(refresh.acquire(f.media, 3000, signal(), stage)).rejects.toThrow("network failure");
    await expect(refresh.acquire(f.media, 3000, signal(), stage)).rejects.toThrow("network failure");
    expect(f.counts().recognitions).toBe(2); await refresh.close();
    expect((await f.store.lookup(f.source, [{ startMs: 0, endMs: 3000 }])).status).toBe("hit");
    const later = f.session(); await later.acquire(f.media, 3000, signal(), stage); await later.close();
    expect(f.counts().recognitions).toBe(2);
  });

  it("persists a refresh contradiction before a new preview, even if that preview fails", async () => {
    const f = await fixture(), first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close();
    f.recognitionChange(facts => corrected({ facts } as KnowledgeCandidate));
    const refresh = f.session(true), next = await refresh.acquire(f.media, 3000, signal(), stage);
    expect((await f.store.lookup(f.source, [{ startMs: 0, endMs: 3000 }])).status).toBe("disputed");
    f.decide(() => { throw new Error("network failure"); });
    await expect(refresh.review(next, t, () => t, signal(), stage)).rejects.toThrow("network failure"); await refresh.close();
    const later = f.session(); await expect(later.acquire(f.media, 3000, signal(), stage)).rejects.toThrow("反证"); await later.close();
  });

  it("blocks prior unsaved versions when later source counterevidence cannot be repaired", async () => {
    const f = await fixture(100), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage), t = f.template();
    const first = await session.review(binding, t, () => t, signal(), stage);
    f.decide(() => JSON.stringify({ action: "stop", reason: "cannot repair", issues: [{ id: "missing", scope: "source", kind: "missing_target", ranges: [{ startMs: 0, endMs: 3000 }], evidenceIds: ["original"], reason: "confirmed" }] }));
    const u = f.template(); await expect(session.review(binding, u, () => u, signal(), stage)).rejects.toThrow();
    await expect(session.reconcile([first], signal(), stage)).rejects.toThrow("反证");
    await expect(session.enqueue(first, signal(), async () => "unsafe")).rejects.toThrow(); await session.close();
  });

  it("cannot clear a cold source's known issue by starting a fresh version with a plain pass", async () => {
    const f = await fixture(), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage), a = f.template();
    f.decide(() => JSON.stringify({ action: "stop", reason: "cannot repair", issues: [{ id: "missing", scope: "source", kind: "missing_target", ranges: [{ startMs: 0, endMs: 3000 }], evidenceIds: ["original"], reason: "confirmed" }] }));
    await expect(session.review(binding, a, () => a, signal(), stage)).rejects.toThrow();
    f.decide(() => JSON.stringify({ action: "pass", reason: "new version" }));
    const b = f.template(); await expect(session.review(binding, b, () => b, signal(), stage)).rejects.toThrow("反证");
    expect(await f.store.readHead(f.source)).toBeUndefined();
    expect(f.counts().previews).toBe(1); await session.close();
  });

  it.each([false, true])("keeps confirmed window counterevidence across a later failure (cancel after acceptance: %s)", async (cancel) => {
    const f = await fixture(), first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close();
    const abort = new AbortController();
    f.recognitionChange(facts => corrected({ facts } as KnowledgeCandidate)); f.failAfterWindow(() => { if (cancel) abort.abort(); });
    const refresh = f.session(true);
    await expect(refresh.acquire(f.media, 3000, abort.signal, stage)).rejects.toThrow();
    await refresh.close(); await f.store.close();
    const reopened = await SourceStickerKnowledgeStore.open(f.directory); stores.push(reopened);
    expect((await reopened.lookup(f.source, [{ startMs: 0, endMs: 3000 }])).status).toBe("disputed");
  });

  it("never silently treats a late refresh of an identical-byte copy as a warm hit", async () => {
    const f = await fixture(), first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close();
    const refresh = f.session(true);
    const a = await refresh.acquire({ ...f.media, id: crypto.randomUUID() }, 3000, signal(), stage);
    const v = await refresh.review(a, t, () => t, signal(), stage);
    await expect(refresh.acquire(f.media, 3000, signal(), stage)).rejects.toThrow("刷新");
    await expect(refresh.enqueue(v, signal(), async () => "unsafe")).rejects.toThrow();
    await refresh.close();
  });

  it("does not mistake new detector target labels for visual counterevidence on refresh", async () => {
    const f = await fixture(); f.recognitionChange(facts => corrected({ facts } as KnowledgeCandidate));
    const first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close();
    f.recognitionChange(facts => {
      const changed = corrected({ facts } as KnowledgeCandidate);
      return { ...changed, targets: changed.targets.map(target => ({ ...target, id: "renamed" })), observations: changed.observations.map(observation => ({ ...observation, targetId: "renamed" })) };
    });
    const refresh = f.session(true); await refresh.acquire(f.media, 3000, signal(), stage);
    expect((await f.store.lookup(f.source, [{ startMs: 0, endMs: 3000 }])).status).toBe("hit");
    await refresh.close();
  });

  it("does not reset a failed version's budget by resubmitting its template ID", async () => {
    const f = await fixture(), session = f.session(), binding = await session.acquire(f.media, 3000, signal(), stage), t = f.template();
    f.decide(() => "not json");
    await expect(session.review(binding, t, () => t, signal(), stage)).rejects.toThrow("上限");
    f.decide(() => JSON.stringify({ action: "pass", reason: "fresh budget?" }));
    await expect(session.review(binding, t, () => t, signal(), stage)).rejects.toThrow("版本");
    expect(await f.store.readHead(f.source)).toBeUndefined(); await session.close();
  });

  it("keeps evidence-backed change provenance for every approved version when refresh publication exceeds quota", async () => {
    const f = await fixture(), first = f.session(), binding = await first.acquire(f.media, 3000, signal(), stage), t = f.template();
    await first.review(binding, t, () => t, signal(), stage); await first.close(); f.quota(100);
    f.recognitionChange(facts => ({ ...facts, samplingStrategy: "fresh-sampling" }));
    const refresh = f.session(true), bind = await refresh.acquire(f.media, 3000, signal(), stage);
    const a = f.template(), b = f.template();
    const v1 = await refresh.review(bind, a, () => a, signal(), stage), v2 = await refresh.review(bind, b, () => b, signal(), stage);
    for (const v of [v1, v2]) expect((await refresh.enqueue(v, signal(), async value => value)).sourceStickerKnowledge?.persistence).toBe("not-saved");
    await refresh.close();
  });
});
