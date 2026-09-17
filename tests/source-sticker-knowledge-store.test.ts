import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceStickerKnowledgeStore, identifySource, sourceKey, factsDigest } from "../src/main/source-sticker-knowledge-store";
import type { KnowledgeCandidate, SourceIdentity } from "../src/shared/source-sticker-knowledge";

const stores: SourceStickerKnowledgeStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const interpretation = { width: 720, height: 1280, rotation: 0 as const, durationMs: 10000, timeBase: "1/90000", timeOriginPts: 0, interpretationVersion: 1 };
async function fixture(options: Parameters<typeof SourceStickerKnowledgeStore.open>[1] = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-source-knowledge-"));
  const file = path.join(directory, "source.mp4");
  await writeFile(file, "original deterministic source bytes");
  const source = await identifySource(file, interpretation);
  const store = await SourceStickerKnowledgeStore.open(directory, options); stores.push(store);
  return { directory, file, source, store };
}
async function prepare(store: SourceStickerKnowledgeStore, source: SourceIdentity, baseRevisionId: string | null = null, endMs = 3000, signal?: AbortSignal) {
  const run = await store.beginRun(source, signal);
  const original = Buffer.from("original frame"), preview = Buffer.from("rendered frame");
  const candidate: KnowledgeCandidate = {
    schemaVersion: 1, id: crypto.randomUUID(), state: "candidate", source, baseRevisionId, runId: run.id,
    requiredRanges: [{ startMs: 0, endMs }],
    facts: { reviewedRanges: [{ startMs: 0, endMs }], targets: [], exclusions: [], observations: [{ evidenceId: "original", presence: "ABSENT" }], samplingStrategy: "timed-full-frames-v1" },
    evidence: [{ id: "original", kind: "source", digest: hash(original), byteLength: original.length, pts: 0, timeMs: 0, width: 720, height: 1280 }],
    resolvedDisputeIds: [], changes: baseRevisionId ? [{ ranges: [{ startMs: 0, endMs }], reason: "复查完整请求时域", evidenceIds: ["original"] }] : [], provenance: { executor: "test/executor", supervisor: "test/supervisor", contractVersion: 1, requests: 2, at: new Date().toISOString() },
  };
  const proof = { candidateId: candidate.id, factsDigest: factsDigest(candidate.facts), sourceReviewed: true as const, previewPassed: true as const, unresolvedIssueIds: [], sourceEvidenceIds: ["original"], previewEvidenceIds: ["preview"] };
  candidate.evidence.push({ id: "preview", kind: "preview", digest: hash(preview), byteLength: preview.length, pts: 0, timeMs: 0, timeBase: "1/90000", timeOriginPts: 0, width: 720, height: 1280, sourceEvidenceId: "original", candidateId: candidate.id, factsDigest: proof.factsDigest, templateDigest: "b".repeat(64), outputSettingsDigest: "c".repeat(64) });
  return { run, candidate, proof, blobs: new Map([[hash(original), original], [hash(preview), preview]]) };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;
const publish = (store: SourceStickerKnowledgeStore, p: Prepared) => store.publish(p.run, p.candidate, p.proof, p.blobs);
const ranges = [{ startMs: 0, endMs: 3000 }];

describe("durable source sticker knowledge", () => {
  it("checks out verified head evidence even when its coverage is partial, without lending mutable buffers", async () => {
    const { store, source } = await fixture(); const p = await prepare(store, source);
    await publish(store, p);
    const head = await store.readHead(source);
    expect(head?.revision.id).toBe(p.candidate.id);
    expect(head?.blobs.get(p.candidate.evidence[0].digest)?.toString()).toBe("original frame");
    head!.blobs.get(p.candidate.evidence[0].digest)!.fill(0);
    expect((await store.readHead(source))?.blobs.get(p.candidate.evidence[0].digest)?.toString()).toBe("original frame");
  });

  it("serializes final admission with publication and refuses stale or disputed knowledge", async () => {
    const { store, source } = await fixture(); const first = await prepare(store, source);
    await publish(store, first);
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
    const next = await prepare(store, source, first.candidate.id);
    const order: string[] = [];
    const admission = store.admit(first.run, first.candidate.id, async () => { entered(); await barrier; order.push("enqueue"); return "task"; });
    await entry;
    const publication = publish(store, next).then(() => { order.push("publish"); });
    release(); expect(await admission).toBe("task"); await publication;
    expect(order).toEqual(["enqueue", "publish"]);
    await expect(store.admit(first.run, first.candidate.id, async () => "wrong")).rejects.toMatchObject({ code: "conflict" });
    await store.recordDispute(next.run, { schemaVersion: 1, id: "known", revisionId: next.candidate.id, ranges, kind: "missing_target", reason: "confirmed contradiction", evidence: next.candidate.evidence.filter(e => e.kind === "source"), at: new Date().toISOString() }, next.blobs);
    await expect(store.readHead(source)).rejects.toMatchObject({ code: "conflict" });
    await expect(store.admit(next.run, next.candidate.id, async () => "wrong")).rejects.toMatchObject({ code: "conflict" });
  });
  it("hits identical copies after reopen; changed/reencoded bytes cannot hit; validates the source again", async () => {
    const { store, source, directory, file } = await fixture();
    const revision = await publish(store, await prepare(store, source));
    const copy = path.join(directory, "renamed.mp4"); await copyFile(file, copy);
    expect(await identifySource(copy, interpretation)).toEqual(source);
    await store.close();
    const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect(await reopened.lookup(source, ranges)).toMatchObject({ status: "hit", revision: { id: revision.id, state: "reviewed", verification: "sampled" } });
    await writeFile(file, "changed/reencoded bytes");
    expect((await reopened.lookup(await identifySource(file, interpretation), ranges)).status).toBe("miss");
    await expect(reopened.verifySource(file, source)).rejects.toThrow(/source_changed/);
    expect(sourceKey({ ...source, interpretationVersion: 2 })).not.toBe(sourceKey(source));
  });

  it("does not reuse 3 seconds for full duration; full duration serves 3 seconds", async () => {
    const { store, source } = await fixture();
    const first = await publish(store, await prepare(store, source));
    expect(await store.lookup(source, [{ startMs: 0, endMs: 10000 }])).toMatchObject({ status: "miss", reason: "coverage" });
    const second = await publish(store, await prepare(store, source, first.id, 10000));
    expect(await store.lookup(source, ranges)).toMatchObject({ status: "hit", revision: { id: second.id } });
    expect(await store.readRevision(source, first.id)).toMatchObject({ state: "superseded" });
  });

  it("requires exact candidate/preview binding and source observations, not just pass", async () => {
    const { store, source } = await fixture(); const p = await prepare(store, source);
    await expect(store.publish(p.run, p.candidate, { ...p.proof, candidateId: "other" }, p.blobs)).rejects.toThrow();
    await expect(store.publish(p.run, p.candidate, { ...p.proof, unresolvedIssueIds: ["issue"] }, p.blobs)).rejects.toThrow();
    await expect(store.publish(p.run, { ...p.candidate, facts: { ...p.candidate.facts, observations: [{ evidenceId: "original", presence: "UNKNOWN" }] } }, p.proof, p.blobs)).rejects.toThrow();
    expect((await store.lookup(source, ranges)).status).toBe("miss");
  });

  it("CAS is not last-writer-wins; exact duplicate publication is idempotent", async () => {
    const { store, source } = await fixture(); const a = await prepare(store, source), b = await prepare(store, source);
    const results = await Promise.allSettled([publish(store, a), publish(store, b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    const first = results[0]; expect(first.status).toBe("fulfilled");
    if (first.status === "fulfilled") expect((await publish(store, a)).id).toBe(first.value.id);
  });

  it("rejects another userData writer, including after an abandoned owner lock", async () => {
    const { directory } = await fixture();
    await expect(SourceStickerKnowledgeStore.open(directory)).rejects.toMatchObject({ code: "locked" });
  });

  it("cancelled runs and late responses cannot publish", async () => {
    const { store, source } = await fixture(); const controller = new AbortController();
    const p = await prepare(store, source, null, 3000, controller.signal); controller.abort();
    await expect(publish(store, p)).rejects.toMatchObject({ code: "cancelled" });
    const late = await prepare(store, source); await store.endRun(late.run);
    await expect(publish(store, late)).rejects.toMatchObject({ code: "cancelled" });
    expect((await store.lookup(source, ranges)).status).toBe("miss");
  });

  it("rebuilds the disposable index from verified records and never imports manual/assisted files", async () => {
    const { store, source, directory } = await fixture();
    await writeFile(path.join(directory, "legacy-project.json"), JSON.stringify({ manual: { rectangle: {} }, reviewDrafts: [{ approved: true }] }));
    expect((await store.lookup(source, ranges)).status).toBe("miss");
    const revision = await publish(store, await prepare(store, source));
    await writeFile(path.join(store.directory, "index.json"), "broken");
    expect(await store.rebuildIndex()).toMatchObject({ [sourceKey(source)]: revision.id });
    expect((await store.lookup(source, ranges)).status).toBe("hit");
  });

  it.each(["missing", "digest", "future"])("blocks %s evidence/record damage instead of returning miss", async (damage) => {
    const { store, source } = await fixture(); await publish(store, await prepare(store, source));
    const sourceDirectory = path.join(store.directory, "sources", sourceKey(source));
    const [event] = await readdir(path.join(sourceDirectory, "events"));
    const eventDirectory = path.join(sourceDirectory, "events", event);
    if (damage === "future") {
      const file = path.join(eventDirectory, "record.json"); const record = JSON.parse(await readFile(file, "utf8")); record.schemaVersion = 999; await writeFile(file, JSON.stringify(record));
    } else {
      const [blob] = await readdir(path.join(eventDirectory, "evidence")); const file = path.join(eventDirectory, "evidence", blob);
      if (damage === "missing") await rm(file); else await writeFile(file, "wrong bytes");
    }
    expect((await store.lookup(source, ranges)).status).toBe("unusable");
  });

  it("retains future store formats without overwriting", async () => {
    const { store, directory } = await fixture(); await store.close();
    const file = path.join(store.directory, "format.json"); await writeFile(file, '{"schemaVersion":999}');
    await expect(SourceStickerKnowledgeStore.open(directory)).rejects.toMatchObject({ code: "future_schema" });
    expect(await readFile(file, "utf8")).toBe('{"schemaVersion":999}');
  });

  it.each(["after_marker", "after_evidence", "after_record", "after_manifest"])("blocks interrupted publication at %s across restart", async (point) => {
    let fail = false;
    const { store, source, directory } = await fixture({ fault: (at) => { if (fail && at === point) throw new Error("simulated power loss"); } });
    const p = await prepare(store, source); fail = true;
    await expect(publish(store, p)).rejects.toThrow();
    await store.close(); const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("unusable");
  });

  it("persists valid disputes independently, surviving cancellation and restart", async () => {
    const { store, source, directory } = await fixture(); const revision = await publish(store, await prepare(store, source));
    const controller = new AbortController(); const p = await prepare(store, source, revision.id, 3000, controller.signal);
    const dispute = { schemaVersion: 1 as const, id: "dispute", revisionId: revision.id, ranges, kind: "missing_target" as const, reason: "原图有未记录贴纸", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() };
    await store.recordDispute(p.run, dispute, p.blobs); controller.abort(); await store.endRun(p.run);
    expect((await store.lookup(source, ranges)).status).toBe("disputed");
    await store.close(); const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("disputed");
    const late = await prepare(reopened, source, revision.id); await reopened.endRun(late.run);
    await expect(reopened.recordDispute(late.run, { ...dispute, id: "late" }, late.blobs)).rejects.toMatchObject({ code: "cancelled" });
  });

  it("invalid/network-only disputes do not withdraw reviewed knowledge", async () => {
    const { store, source } = await fixture(); const revision = await publish(store, await prepare(store, source)); const p = await prepare(store, source, revision.id);
    await expect(store.recordDispute(p.run, { schemaVersion: 1, id: "bad", revisionId: revision.id, ranges, kind: "network_error", reason: "timeout", evidence: [], at: new Date().toISOString() } as never, p.blobs)).rejects.toThrow();
    expect((await store.lookup(source, ranges)).status).toBe("hit");
  });

  it("failed dispute storage blocks old revisions after restart, even if its evidence was not saved", async () => {
    let fail = false;
    const { store, source, directory } = await fixture({ fault: (at) => { if (fail && at === "after_marker") throw new Error("disk full"); } });
    const revision = await publish(store, await prepare(store, source)); const p = await prepare(store, source, revision.id); fail = true;
    await expect(store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: revision.id, ranges, kind: "wrong_semantics", reason: "source contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs)).rejects.toThrow();
    await store.endRun(p.run); await store.close(); const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("unusable");
  });

  it("retains the owner barrier if even the dispute transaction marker cannot be written", async () => {
    let fail = false;
    const { store, source, directory } = await fixture({ fault: (at) => { if (fail && at === "before_marker") throw new Error("ENOSPC before marker"); } });
    const initial = await prepare(store, source); const revision = await publish(store, initial);
    const p = await prepare(store, source, revision.id); fail = true;
    await expect(store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: revision.id, ranges, kind: "missing_target", reason: "observed contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs)).rejects.toThrow();
    await store.close();
    await expect(SourceStickerKnowledgeStore.open(directory)).rejects.toMatchObject({ code: "locked" });
  });

  it("fences cancellation during evidence I/O before manifest publication", async () => {
    const controller = new AbortController();
    const { store, source, directory } = await fixture({ fault: (at) => { if (at === "after_evidence") controller.abort(); } });
    const p = await prepare(store, source, null, 3000, controller.signal);
    await expect(publish(store, p)).rejects.toMatchObject({ code: "cancelled" });
    await store.close(); const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("unusable");
  });

  it("finishes an accepted local dispute handoff when cancellation arrives during I/O", async () => {
    const controller = new AbortController(); let cancel = false;
    const { store, source } = await fixture({ fault: (at) => { if (cancel && at === "after_marker") controller.abort(); } });
    const initial = await prepare(store, source); const revision = await publish(store, initial); await store.endRun(initial.run);
    const p = await prepare(store, source, revision.id, 3000, controller.signal); cancel = true;
    await store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: revision.id, ranges, kind: "missing_target", reason: "observed contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs);
    expect(controller.signal.aborted).toBe(true);
    await store.endRun(p.run);
    expect((await store.collect(0)).removed).toEqual([]);
    expect((await store.lookup(source, ranges)).status).toBe("disputed");
  });
  it("finishes all queued counterevidence accepted before cancellation, without admitting late reports", async () => {
    const controller = new AbortController(); let cancel = false;
    const { store, source } = await fixture({ fault: (at) => { if (cancel && at === "after_marker") controller.abort(); } });
    const initial = await prepare(store, source); const revision = await publish(store, initial);
    const p = await prepare(store, source, revision.id, 3000, controller.signal); cancel = true;
    const dispute = { schemaVersion: 1 as const, revisionId: revision.id, ranges, kind: "missing_target" as const, reason: "observed contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() };
    await expect(Promise.all([store.recordDispute(p.run, { ...dispute, id: "one" }, p.blobs), store.recordDispute(p.run, { ...dispute, id: "two" }, p.blobs)])).resolves.toEqual([undefined, undefined]);
    const found = await store.lookup(source, ranges);
    expect(found.status).toBe("disputed");
    if (found.status === "disputed") expect(found.disputeIds).toEqual(["one", "two"]);
    await expect(store.recordDispute(p.run, { ...dispute, id: "late" }, p.blobs)).rejects.toMatchObject({ code: "cancelled" });
  });
  it.each(["close", "collect"])("protects accepted counterevidence while %s races its queued write", async (race) => {
    const { store, source, directory } = await fixture();
    const initial = await prepare(store, source); const revision = await publish(store, initial); await store.endRun(initial.run);
    const controller = new AbortController(), p = await prepare(store, source, revision.id, 3000, controller.signal);
    const collection = race === "collect" ? store.collect(0) : undefined;
    const saving = store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: revision.id, ranges, kind: "missing_target", reason: "observed contradiction", evidence: p.candidate.evidence.filter(e => e.kind === "source"), at: new Date().toISOString() }, p.blobs);
    controller.abort();
    const closing = race === "close" ? store.close() : undefined;
    await expect(saving).resolves.toBeUndefined();
    if (collection) expect((await collection).removed).toEqual([]);
    await closing; await store.close();
    const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("disputed");
  });

  it("requires actual fact correction to resolve a dispute, then retains immutable history", async () => {
    const { store, source } = await fixture(); const first = await publish(store, await prepare(store, source));
    const p = await prepare(store, source, first.id);
    await store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: first.id, ranges, kind: "missing_target", reason: "missed sticker", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs);
    p.candidate.resolvedDisputeIds = ["dispute"];
    await expect(publish(store, p)).rejects.toMatchObject({ code: "conflict" });
    p.candidate.facts.samplingStrategy = "renamed-strategy";
    p.proof.factsDigest = factsDigest(p.candidate.facts);
    for (const e of p.candidate.evidence) if (e.kind === "preview") e.factsDigest = p.proof.factsDigest;
    await expect(publish(store, p)).rejects.toMatchObject({ code: "conflict" });
    const rectangle = { x: 0, y: 0, width: 0.1, height: 0.1 };
    p.candidate.facts.targets = [{ id: "new-sticker", segments: [{ id: "segment", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle }] }, evidenceIds: ["original"], interpolation: "linear" }] }];
    p.candidate.facts.observations = [{ targetId: "new-sticker", evidenceId: "original", presence: "PRESENT", rectangle }];
    p.proof.factsDigest = factsDigest(p.candidate.facts);
    for (const e of p.candidate.evidence) if (e.kind === "preview") e.factsDigest = p.proof.factsDigest;
    const corrected = await publish(store, p);
    expect((await store.lookup(source, ranges))).toMatchObject({ status: "hit", revision: { id: corrected.id } });
    expect((await store.readRevision(source, first.id))?.candidate.facts.targets).toEqual([]);
  });

  it("protects persistent references across restart", async () => {
    const { store, source, directory } = await fixture(); const revision = await publish(store, await prepare(store, source));
    await store.retain(source, revision.id, "frozen-task"); await store.close();
    const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.collect(0)).removed).toEqual([]);
    await reopened.release(source, "frozen-task");
    expect((await reopened.collect(0)).removed).toEqual([sourceKey(source)]);
  });

  it("does not resolve an existing boundary dispute by adding a redundant keyframe", async () => {
    const { store, source } = await fixture(); const p = await prepare(store, source);
    const rectangle = { x: 0, y: 0, width: 0.1, height: 0.1 };
    p.candidate.facts.targets = [{ id: "sticker", segments: [{ id: "segment", track: { startMs: 0, endMs: 3000, keyframes: [{ timeMs: 0, rectangle }] }, evidenceIds: ["original"], interpolation: "linear" }] }];
    p.candidate.facts.observations = [{ targetId: "sticker", evidenceId: "original", presence: "PRESENT", rectangle }];
    p.proof.factsDigest = factsDigest(p.candidate.facts);
    for (const e of p.candidate.evidence) if (e.kind === "preview") e.factsDigest = p.proof.factsDigest;
    const first = await publish(store, p); const correction = await prepare(store, source, first.id);
    await store.recordDispute(correction.run, { schemaVersion: 1, id: "dispute", revisionId: first.id, ranges, targetId: "sticker", kind: "incomplete_boundary", reason: "boundary clips artwork", evidence: correction.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, correction.blobs);
    correction.candidate.facts = structuredClone(p.candidate.facts);
    correction.candidate.facts.targets[0].segments[0].track.keyframes.push({ timeMs: 1500, rectangle });
    correction.candidate.resolvedDisputeIds = ["dispute"]; correction.candidate.changes[0].targetId = "sticker";
    correction.proof.factsDigest = factsDigest(correction.candidate.facts);
    for (const e of correction.candidate.evidence) if (e.kind === "preview") e.factsDigest = correction.proof.factsDigest;
    await expect(publish(store, correction)).rejects.toMatchObject({ code: "conflict" });
    expect((await store.lookup(source, ranges)).status).toBe("disputed");
  });

  it("rejects operations admitted after close starts, while draining an accepted handoff", async () => {
    let block = false, reached!: () => void, resume!: () => void;
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const { store, source, directory } = await fixture({ fault: async (at) => { if (block && at === "after_marker") { reached(); await gate; } } });
    const revision = await publish(store, await prepare(store, source)); const p = await prepare(store, source, revision.id); block = true;
    const handoff = store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: revision.id, ranges, kind: "missing_target", reason: "observed contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs);
    await waiting; const closing = store.close(); const late = store.beginRun(source);
    const rejected = expect(late).rejects.toMatchObject({ code: "integrity" });
    await expect(SourceStickerKnowledgeStore.open(directory)).rejects.toMatchObject({ code: "locked" });
    resume(); await handoff; await closing; await rejected;
    const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("disputed");
  });

  it("blocks a rolled-back manifest that omits an already durable dispute", async () => {
    const { store, source, directory } = await fixture(); const first = await publish(store, await prepare(store, source));
    const manifest = path.join(store.directory, "sources", sourceKey(source), "manifest.json");
    const previous = await readFile(manifest);
    const p = await prepare(store, source, first.id);
    await store.recordDispute(p.run, { schemaVersion: 1, id: "dispute", revisionId: first.id, ranges, kind: "missing_target", reason: "observed contradiction", evidence: p.candidate.evidence.filter((e) => e.kind === "source"), at: new Date().toISOString() }, p.blobs);
    await writeFile(manifest, previous);
    expect((await store.lookup(source, ranges)).status).toBe("unusable");
    await expect(store.rebuildIndex()).rejects.toThrow();
    await store.close(); const reopened = await SourceStickerKnowledgeStore.open(directory); stores.push(reopened);
    expect((await reopened.lookup(source, ranges)).status).toBe("unusable");
    expect((await reopened.collect(0)).removed).toEqual([]);
  });

  it("does not publish fact corrections whose source evidence was never reviewed", async () => {
    const { store, source } = await fixture(); const first = await publish(store, await prepare(store, source));
    const p = await prepare(store, source, first.id, 10000);
    const frame = p.candidate.evidence.find((e) => e.kind === "source")!;
    p.candidate.evidence.push({ ...frame, id: "unreviewed" });
    p.candidate.changes[0].evidenceIds = ["unreviewed"];
    await expect(publish(store, p)).rejects.toMatchObject({ code: "integrity" });
    expect((await store.lookup(source, ranges))).toMatchObject({ status: "hit", revision: { id: first.id } });
  });

  it("keeps prior revision and evidence files byte-for-byte immutable", async () => {
    const { store, source } = await fixture(); const first = await publish(store, await prepare(store, source));
    const eventsDirectory = path.join(store.directory, "sources", sourceKey(source), "events");
    const [firstEvent] = await readdir(eventsDirectory); const file = path.join(eventsDirectory, firstEvent, "record.json"); const bytes = await readFile(file);
    await publish(store, await prepare(store, source, first.id, 10000));
    expect(await readFile(file)).toEqual(bytes);
    expect((await store.readRevision(source, first.id))?.state).toBe("superseded");
  });

  it("refuses metadata growth before changing a readable manifest or index", async () => {
    const { store, source, directory } = await fixture(); const first = await publish(store, await prepare(store, source));
    const manifest = path.join(store.directory, "sources", sourceKey(source), "manifest.json");
    const parsed = JSON.parse(await readFile(manifest, "utf8"));
    parsed.references = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`reference-${i}`, first.id]));
    await writeFile(manifest, JSON.stringify(parsed)); const before = await readFile(manifest);
    await expect(store.retain(source, first.id, "one-too-many")).rejects.toThrow();
    expect(await readFile(manifest)).toEqual(before);
    await store.rebuildIndex(); const index = await readFile(path.join(store.directory, "index.json"));
    await store.close(); const limited = await SourceStickerKnowledgeStore.open(directory, { quotaBytes: 64 }); stores.push(limited);
    await expect(limited.rebuildIndex()).rejects.toMatchObject({ code: "quota" });
    expect(await readFile(path.join(store.directory, "index.json"))).toEqual(index);
    expect((await limited.lookup(source, ranges)).status).toBe("hit");
  });

  it("enforces quota and protects running, referenced and disputed records from collection", async () => {
    const { store, source } = await fixture(); const p = await prepare(store, source); const revision = await publish(store, p); await store.endRun(p.run);
    const run = await store.beginRun(source);
    expect((await store.collect(0)).removed).toEqual([]);
    await store.endRun(run);
    await store.retain(source, revision.id, "frozen-task");
    expect((await store.collect(0)).removed).toEqual([]);
    await store.release(source, "frozen-task");
    expect((await store.collect(0)).removed).toEqual([sourceKey(source)]);
    expect((await store.lookup(source, ranges)).status).toBe("miss");
    const tiny = await fixture({ quotaBytes: 64 });
    await expect(publish(tiny.store, await prepare(tiny.store, tiny.source))).rejects.toMatchObject({ code: "quota" });
    expect((await tiny.store.lookup(tiny.source, ranges)).status).toBe("miss");
  });
});
