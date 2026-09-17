import { createHash, randomUUID } from "node:crypto";
import { constants, renameSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  KnowledgeCandidateSchema, KnowledgeDisputeSchema, KnowledgePublicationProofSchema, ReviewedRangeSchema,
  SourceIdentitySchema, coversRanges, type KnowledgeCandidate, type KnowledgeDispute, type KnowledgeEvidence,
  type KnowledgePublicationProof, type KnowledgeRevision, type ReviewedRange, type SourceFacts, type SourceIdentity,
} from "../shared/source-sticker-knowledge.js";
import { fingerprintFile } from "./paths.js";
import { interpolateCoverRectangle } from "../shared/cover-sticker.js";

const DEFAULT_QUOTA_BYTES = 256 * 1024 * 1024;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal(1), source: SourceIdentitySchema, currentRevisionId: Id.nullable(),
  events: z.array(z.object({ id: Id, digest: Digest }).strict()).max(4096),
  references: z.record(Id, Id).refine((refs) => Object.keys(refs).length <= 4096), updatedAt: z.number().int().nonnegative(),
}).strict();
const EventSchema = z.discriminatedUnion("type", [
  z.object({ schemaVersion: z.literal(1), type: z.literal("revision"), candidate: KnowledgeCandidateSchema, proof: KnowledgePublicationProofSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), type: z.literal("dispute"), source: SourceIdentitySchema, dispute: KnowledgeDisputeSchema }).strict(),
]);
type Manifest = z.infer<typeof ManifestSchema>;
type Event = z.infer<typeof EventSchema>;
type Loaded = { manifest: Manifest; revisions: Map<string, KnowledgeRevision>; disputes: Map<string, KnowledgeDispute> };
export interface KnowledgeRun { readonly id: string }
type Run = { token: KnowledgeRun; source: SourceIdentity; signal?: AbortSignal; ended: boolean; publication?: string };
type StoreOptions = { quotaBytes?: number; fault?: (point: string) => void | Promise<void> };
export type KnowledgeLookup = { status: "hit"; revision: KnowledgeRevision } | { status: "miss"; reason: "absent" | "coverage" }
  | { status: "disputed"; disputeIds: string[] } | { status: "unusable"; reason: string };

export class KnowledgeStoreError extends Error {
  constructor(public readonly code: "locked" | "future_schema" | "integrity" | "conflict" | "cancelled" | "quota" | "source_changed", message = code as string) { super(message); }
}
function digest(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
function metadataSize(value: unknown): number {
  const bytes = Buffer.byteLength(canonical(value));
  if (bytes > MAX_RECORD_BYTES) throw new KnowledgeStoreError("quota", "Knowledge metadata exceeds the readable size limit");
  return bytes;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function sourceKey(source: SourceIdentity): string { return digest(canonical(SourceIdentitySchema.parse(source))); }
export function factsDigest(facts: SourceFacts): string { return digest(canonical(facts)); }

/** Uses the existing byte fingerprint owner. Stat checks detect a source replaced during hashing. */
export async function identifySource(file: string, interpretation: Omit<SourceIdentity, "fingerprint" | "byteLength">): Promise<SourceIdentity> {
  const before = await stat(file, { bigint: true });
  const fingerprint = await fingerprintFile(file);
  const after = await stat(file, { bigint: true });
  if (!before.isFile() || before.size !== after.size || before.ino !== after.ino || before.dev !== after.dev || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new KnowledgeStoreError("source_changed");
  return SourceIdentitySchema.parse({ ...interpretation, fingerprint, byteLength: Number(after.size) });
}
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (e) { if (isMissing(e)) return false; throw e; } }
async function directorySafe(directory: string): Promise<void> { const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new KnowledgeStoreError("integrity", "Unsafe knowledge directory"); }
async function syncDirectory(directory: string): Promise<void> {
  // Do not swallow failed durability barriers. Unsupported filesystems fail closed.
  const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); }
}
async function readSafe(file: string, limit = MAX_RECORD_BYTES): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new KnowledgeStoreError("integrity", "Invalid knowledge file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const bytes = await handle.readFile(); if (bytes.length > limit) throw new KnowledgeStoreError("integrity"); return bytes; } finally { await handle.close(); }
}
function parseJson(bytes: Buffer): unknown {
  const value = JSON.parse(bytes.toString("utf8"));
  if (value?.schemaVersion > 1) throw new KnowledgeStoreError("future_schema");
  return value;
}
async function writeDurable(file: string, bytes: Buffer | string): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(path.dirname(file));
}
async function atomicJson(file: string, value: unknown, beforeCommit?: () => void): Promise<void> {
  const temporary = `${file}.tmp-${randomUUID()}`;
  await writeDurable(temporary, canonical(value));
  beforeCommit?.();
  // Synchronous check+rename is the cancellation linearization point in the main process.
  renameSync(temporary, file);
  await syncDirectory(path.dirname(file));
}
function checkProof(candidate: KnowledgeCandidate, proof: KnowledgePublicationProof): void {
  const expected = factsDigest(candidate.facts);
  const sourceIds = new Set(candidate.evidence.filter((e) => e.kind === "source").map((e) => e.id));
  if (proof.candidateId !== candidate.id || proof.factsDigest !== expected || candidate.facts.observations.some((o) => o.presence === "UNKNOWN")) throw new KnowledgeStoreError("integrity", "Incomplete or stale knowledge proof");
  if (proof.sourceEvidenceIds.some((id) => !sourceIds.has(id)) || candidate.facts.observations.some((o) => !proof.sourceEvidenceIds.includes(o.evidenceId))) throw new KnowledgeStoreError("integrity", "Unreviewed source observations");
  const factEvidence = [...candidate.changes, ...candidate.facts.exclusions, ...candidate.facts.targets.flatMap((t) => t.segments)].flatMap((item) => item.evidenceIds);
  if (factEvidence.some((id) => !proof.sourceEvidenceIds.includes(id))) throw new KnowledgeStoreError("integrity", "Unreviewed fact correction/geometry evidence");
  for (const id of proof.previewEvidenceIds) {
    const frame = candidate.evidence.find((e) => e.id === id);
    if (!frame || frame.kind !== "preview" || frame.candidateId !== candidate.id || frame.factsDigest !== expected || !proof.sourceEvidenceIds.includes(frame.sourceEvidenceId)) throw new KnowledgeStoreError("integrity", "Preview does not bind these source facts");
  }
}
function checkBlobs(evidence: KnowledgeEvidence[], blobs: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const frame of evidence) {
    const bytes = blobs.get(frame.digest);
    if (!bytes || bytes.length !== frame.byteLength || digest(bytes) !== frame.digest) throw new KnowledgeStoreError("integrity", "Missing evidence or digest mismatch");
    result.set(frame.digest, Buffer.from(bytes));
  }
  return result;
}

// Compare actual facts in the disputed time/target scope. Renaming evidence, changing
// sampling metadata or adjusting an unrelated interval cannot clear a known problem.
function disputedFactsChanged(before: KnowledgeCandidate, after: KnowledgeCandidate, dispute: KnowledgeDispute): boolean {
  const targets = (candidate: KnowledgeCandidate) => candidate.facts.targets.filter((t) => !dispute.targetId || t.id === dispute.targetId);
  const times = new Set(dispute.ranges.flatMap((r) => [r.startMs, r.endMs]));
  for (const candidate of [before, after]) for (const target of targets(candidate)) for (const { track } of target.segments) {
    for (const time of [track.startMs, track.endMs, ...track.keyframes.map((f) => f.timeMs)]) if (dispute.ranges.some((r) => time >= r.startMs && time <= r.endMs)) times.add(time);
  }
  const points = [...times].sort((a, b) => a - b);
  const samples = [...points, ...points.slice(1).map((point, i) => (point + points[i]) / 2)].filter((time) => dispute.ranges.some((r) => time >= r.startMs && time < r.endMs));
  const at = (candidate: KnowledgeCandidate, time: number) => new Map(targets(candidate).flatMap((target) => {
    const segment = target.segments.find((s) => time >= s.track.startMs && time < s.track.endMs);
    return segment ? [[target.id, interpolateCoverRectangle(segment.track.keyframes, time)] as const] : [];
  }));
  for (const time of samples) {
    const a = at(before, time), b = at(after, time);
    if (a.size !== b.size || [...a].some(([id, rectangle]) => !b.has(id) || (["x", "y", "width", "height"] as const).some((key) => Math.abs(rectangle[key] - b.get(id)![key]) > 1e-9))) return true;
  }
  return false;
}

/** Single durable owner under userData. The OS-visible lifetime lock rejects shared-profile
 * instances. A crashed/poisoned owner is never automatically stolen: explicit recovery is
 * required. This barrier also survives total write failure during a confirmed dispute.
 * Source manifests are commit pointers; index.json is disposable and never a reuse authority.
 */
export class SourceStickerKnowledgeStore {
  readonly directory: string;
  private readonly runs = new Map<string, Run>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closePromise?: Promise<void>;
  private poisoned = false;
  private constructor(directory: string, private readonly options: StoreOptions) { this.directory = directory; }

  static async open(userData: string, options: StoreOptions = {}): Promise<SourceStickerKnowledgeStore> {
    if (options.quotaBytes !== undefined && (!Number.isSafeInteger(options.quotaBytes) || options.quotaBytes < 1)) throw new Error("Invalid knowledge quota");
    await mkdir(userData, { recursive: true });
    const directory = path.join(await realpath(userData), "source-sticker-knowledge");
    await mkdir(directory, { recursive: true }); await directorySafe(directory);
    const lock = path.join(directory, "owner.lock");
    try { await mkdir(lock); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new KnowledgeStoreError("locked", "Knowledge owner active or recovery required"); throw e; }
    const store = new SourceStickerKnowledgeStore(directory, options);
    try {
      await syncDirectory(directory); await syncDirectory(path.dirname(directory));
      const format = path.join(directory, "format.json");
      if (await exists(format)) z.object({ schemaVersion: z.literal(1) }).strict().parse(parseJson(await readSafe(format)));
      else {
        if ((await readdir(directory)).some((name) => name !== "owner.lock")) throw new KnowledgeStoreError("integrity", "Missing store format");
        await writeDurable(format, canonical({ schemaVersion: 1 }));
      }
      await mkdir(path.join(directory, "sources"), { recursive: true }); await directorySafe(path.join(directory, "sources"));
      await syncDirectory(directory);
      return store;
    } catch (e) {
      // A future format is preserved untouched; uncertain I/O keeps the durable owner barrier.
      if (e instanceof KnowledgeStoreError && e.code === "future_schema") { await rm(lock, { recursive: true }); await syncDirectory(directory); }
      throw e;
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => { if (this.closed || this.poisoned) throw new KnowledgeStoreError("integrity", "Knowledge store closed or requires recovery"); return operation(); });
    this.tail = result.catch(() => undefined); return result;
  }
  private sourceDirectory(source: SourceIdentity): string { return path.join(this.directory, "sources", sourceKey(source)); }
  private run(token: KnowledgeRun): Run {
    const run = this.runs.get(token.id);
    if (!run || run.token !== token || run.ended || run.signal?.aborted) throw new KnowledgeStoreError("cancelled");
    return run;
  }
  async beginRun(source: SourceIdentity, signal?: AbortSignal): Promise<KnowledgeRun> {
    const identity = SourceIdentitySchema.parse(source);
    return this.exclusive(async () => {
      if (signal?.aborted) throw new KnowledgeStoreError("cancelled");
      await this.load(identity);
      const token = Object.freeze({ id: randomUUID() });
      this.runs.set(token.id, { token, source: identity, signal, ended: false }); return token;
    });
  }
  async endRun(token: KnowledgeRun): Promise<void> {
    // Immediate revocation also fences a publication waiting on I/O.
    const run = this.runs.get(token.id); if (run?.token === token) run.ended = true;
    await this.tail;
    if (run?.token === token) this.runs.delete(token.id);
  }
  async verifySource(file: string, source: SourceIdentity): Promise<void> {
    if (sourceKey(await identifySource(file, source)) !== sourceKey(source)) throw new KnowledgeStoreError("source_changed");
  }

  private async load(source: SourceIdentity): Promise<Loaded | null> {
    const directory = this.sourceDirectory(source);
    if (!(await exists(directory))) return null;
    await directorySafe(directory);
    if (await exists(path.join(directory, "pending.json"))) throw new KnowledgeStoreError("integrity", "Interrupted knowledge transaction");
    const manifest = ManifestSchema.parse(parseJson(await readSafe(path.join(directory, "manifest.json"))));
    if (sourceKey(manifest.source) !== sourceKey(source) || new Set(manifest.events.map((e) => e.id)).size !== manifest.events.length) throw new KnowledgeStoreError("integrity");
    await directorySafe(path.join(directory, "events"));
    const eventNames = await readdir(path.join(directory, "events"));
    if (eventNames.length !== manifest.events.length || eventNames.some((id) => !manifest.events.some((event) => event.id === id))) throw new KnowledgeStoreError("integrity", "Manifest omits durable events");
    const revisions = new Map<string, KnowledgeRevision>(), disputes = new Map<string, KnowledgeDispute>();
    let head: string | null = null;
    for (const entry of manifest.events) {
      const eventDirectory = path.join(directory, "events", entry.id); await directorySafe(eventDirectory);
      const bytes = await readSafe(path.join(eventDirectory, "record.json"));
      const record = EventSchema.parse(parseJson(bytes));
      if (digest(bytes) !== entry.digest) throw new KnowledgeStoreError("integrity", "Record digest mismatch");
      const evidence = record.type === "revision" ? record.candidate.evidence : record.dispute.evidence;
      await directorySafe(path.join(eventDirectory, "evidence"));
      for (const frame of evidence) {
        const blob = await readSafe(path.join(eventDirectory, "evidence", frame.digest), 8 * 1024 * 1024);
        if (blob.length !== frame.byteLength || digest(blob) !== frame.digest) throw new KnowledgeStoreError("integrity", "Evidence digest mismatch");
      }
      if (record.type === "revision") {
        const candidate = record.candidate; checkProof(candidate, record.proof);
        if (sourceKey(candidate.source) !== sourceKey(source) || candidate.baseRevisionId !== head || revisions.has(candidate.id)) throw new KnowledgeStoreError("integrity", "Broken revision ancestry");
        this.checkResolution(candidate, disputes, revisions.get(head ?? ""));
        for (const id of candidate.resolvedDisputeIds) disputes.delete(id);
        revisions.set(candidate.id, { id: candidate.id, sourceKey: sourceKey(source), state: "reviewed", verification: "sampled", factsDigest: factsDigest(candidate.facts), candidate, proof: record.proof }); head = candidate.id;
      } else {
        if (sourceKey(record.source) !== sourceKey(source) || disputes.has(record.dispute.id)) throw new KnowledgeStoreError("integrity");
        this.checkDispute(source, record.dispute, revisions);
        disputes.set(record.dispute.id, record.dispute);
      }
    }
    if (manifest.currentRevisionId !== head || Object.values(manifest.references).some((id) => !revisions.has(id))) throw new KnowledgeStoreError("integrity", "Invalid manifest reference");
    for (const revision of revisions.values()) revision.state = [...disputes.values()].some((d) => d.revisionId === revision.id) ? "disputed" : revision.id === head ? "reviewed" : "superseded";
    return { manifest, revisions, disputes };
  }

  async lookup(source: SourceIdentity, required: ReviewedRange[]): Promise<KnowledgeLookup> {
    const identity = SourceIdentitySchema.parse(source);
    const ranges = z.array(ReviewedRangeSchema).min(1).parse(required);
    if (ranges.some((range) => range.endMs > identity.durationMs)) throw new Error("Requested range exceeds source duration");
    return this.exclusive(async () => {
      try {
        const loaded = await this.load(identity);
        if (!loaded) return { status: "miss", reason: "absent" };
        // Conservative: any unresolved source dispute blocks all new reuse for this source.
        if (loaded.disputes.size) return { status: "disputed", disputeIds: [...loaded.disputes.keys()] };
        const revision = loaded.revisions.get(loaded.manifest.currentRevisionId ?? "");
        if (!revision) return { status: "miss", reason: "absent" };
        return coversRanges(revision.candidate.facts.reviewedRanges, ranges) ? { status: "hit", revision } : { status: "miss", reason: "coverage" };
      } catch (e) { return { status: "unusable", reason: e instanceof KnowledgeStoreError ? e.message : "Knowledge integrity unknown" }; }
    });
  }
  async readRevision(source: SourceIdentity, revisionId: string): Promise<KnowledgeRevision | undefined> {
    return this.exclusive(async () => (await this.load(source))?.revisions.get(revisionId));
  }

  private checkResolution(candidate: KnowledgeCandidate, disputes: Map<string, KnowledgeDispute>, previous?: KnowledgeRevision): void {
    if (new Set(candidate.resolvedDisputeIds).size !== candidate.resolvedDisputeIds.length || candidate.resolvedDisputeIds.length !== disputes.size || candidate.resolvedDisputeIds.some((id) => !disputes.has(id))) throw new KnowledgeStoreError("conflict", "Unresolved or unknown source dispute");
    if (previous && factsDigest(candidate.facts) !== previous.factsDigest && !candidate.changes.length) throw new KnowledgeStoreError("integrity", "Fact revisions require evidence and reasons");
    for (const dispute of disputes.values()) {
      if (!previous || !disputedFactsChanged(previous.candidate, candidate, dispute) || !coversRanges(candidate.facts.reviewedRanges, dispute.ranges)
        || !candidate.changes.some((change) => coversRanges(change.ranges, dispute.ranges) && (!dispute.targetId || change.targetId === dispute.targetId))) throw new KnowledgeStoreError("conflict", "Dispute has no bound fact correction");
    }
  }
  private checkDispute(source: SourceIdentity, dispute: KnowledgeDispute, revisions: Map<string, KnowledgeRevision>): void {
    const affected = revisions.get(dispute.revisionId);
    if (!affected || !coversRanges(affected.candidate.facts.reviewedRanges, dispute.ranges) || (dispute.targetId && !affected.candidate.facts.targets.some((t) => t.id === dispute.targetId))) throw new KnowledgeStoreError("integrity", "Invalid dispute target/range");
    // Reuse the source evidence and timing validator without converting a dispute to new facts.
    KnowledgeCandidateSchema.parse({ ...affected.candidate, requiredRanges: dispute.ranges, facts: { reviewedRanges: dispute.ranges, targets: [], exclusions: [], samplingStrategy: "dispute-evidence", observations: dispute.evidence.filter((e) => !e.crop).map((e) => ({ evidenceId: e.id, presence: "UNKNOWN" })) }, evidence: dispute.evidence, changes: [], resolvedDisputeIds: [], source });
  }

  async publish(token: KnowledgeRun, input: KnowledgeCandidate, proofInput: KnowledgePublicationProof, inputBlobs: ReadonlyMap<string, Buffer>): Promise<KnowledgeRevision> {
    // Parse/copy at the boundary: queued caller mutations cannot change the eventual commit.
    const candidate = KnowledgeCandidateSchema.parse(input), proof = KnowledgePublicationProofSchema.parse(proofInput);
    checkProof(candidate, proof); const blobs = checkBlobs(candidate.evidence, inputBlobs);
    return this.exclusive(async () => {
      const run = this.run(token);
      if (candidate.runId !== token.id || sourceKey(candidate.source) !== sourceKey(run.source)) throw new KnowledgeStoreError("conflict", "Candidate run/source mismatch");
      const loaded = await this.load(run.source);
      const existing = loaded?.revisions.get(candidate.id);
      if (existing) {
        if (existing.state !== "reviewed" || loaded!.disputes.size || canonical(existing.candidate) !== canonical(candidate) || canonical(existing.proof) !== canonical(proof)) throw new KnowledgeStoreError("conflict");
        return existing;
      }
      if (run.publication || candidate.baseRevisionId !== (loaded?.manifest.currentRevisionId ?? null)) throw new KnowledgeStoreError("conflict");
      this.checkResolution(candidate, loaded?.disputes ?? new Map(), loaded?.revisions.get(candidate.baseRevisionId ?? ""));
      await this.append(run.source, { schemaVersion: 1, type: "revision", candidate, proof }, blobs, loaded, () => this.run(token));
      run.publication = candidate.id;
      return (await this.load(run.source))!.revisions.get(candidate.id)!;
    });
  }
  async recordDispute(token: KnowledgeRun, input: KnowledgeDispute, inputBlobs: ReadonlyMap<string, Buffer>): Promise<void> {
    const dispute = KnowledgeDisputeSchema.parse(input); const blobs = checkBlobs(dispute.evidence, inputBlobs);
    return this.exclusive(async () => {
      const run = this.run(token), loaded = await this.load(run.source);
      if (!loaded) throw new KnowledgeStoreError("integrity", "No reviewed source to dispute");
      this.checkDispute(run.source, dispute, loaded.revisions);
      const existing = loaded.disputes.get(dispute.id);
      if (existing) { if (canonical(existing) !== canonical(dispute)) throw new KnowledgeStoreError("conflict"); return; }
      this.run(token); // Acceptance point: confirmed evidence handoff finishes despite subsequent cancellation.
      try { await this.append(run.source, { schemaVersion: 1, type: "dispute", source: run.source, dispute }, blobs, loaded); }
      catch (e) {
        // Includes failures before append could create its source marker (quota accounting,
        // directory errors, etc.). The lifetime lock must then survive close/restart.
        try { if (!(await exists(path.join(this.sourceDirectory(run.source), "pending.json")))) this.poisoned = true; }
        catch { this.poisoned = true; }
        throw e;
      }
    });
  }

  private async transaction(source: SourceIdentity, action: () => Promise<void>): Promise<void> {
    const directory = this.sourceDirectory(source);
    try {
      await this.options.fault?.("before_marker");
      await mkdir(directory, { recursive: true }); await directorySafe(directory); await syncDirectory(path.dirname(directory));
      await writeDurable(path.join(directory, "pending.json"), canonical({ schemaVersion: 1, transactionId: randomUUID() }));
    } catch (e) { this.poisoned = true; throw e; }
    // On any later failure the durable source marker stays, including after a committed
    // manifest. Never guess whether a missing dispute was just a cache miss.
    await this.options.fault?.("after_marker");
    await action();
    await unlink(path.join(directory, "pending.json"));
    try { await syncDirectory(directory); } catch (e) { this.poisoned = true; throw e; }
  }
  private async append(source: SourceIdentity, event: Event, blobs: Map<string, Buffer>, loaded: Loaded | null, beforeCommit?: () => void): Promise<void> {
    const bytes = canonical(event);
    if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new KnowledgeStoreError("quota", "Knowledge record too large");
    const manifest: Manifest = loaded ? structuredClone(loaded.manifest) : { schemaVersion: 1, source, currentRevisionId: null, events: [], references: {}, updatedAt: Date.now() };
    if (manifest.events.length >= 4096) throw new KnowledgeStoreError("quota", "Source event limit reached");
    const eventId = randomUUID(); manifest.events.push({ id: eventId, digest: digest(bytes) }); manifest.updatedAt = Date.now();
    if (event.type === "revision") manifest.currentRevisionId = event.candidate.id;
    const needed = Buffer.byteLength(bytes) + [...blobs.values()].reduce((sum, blob) => sum + blob.length, 0) + metadataSize(manifest) + 256;
    const quota = this.options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
    if (await this.usage() + needed > quota) {
      if (event.type === "dispute") {
        // Preserve a durable block even when quota prevents retaining the full counterevidence.
        await this.transaction(source, async () => { throw new KnowledgeStoreError("quota"); });
      }
      throw new KnowledgeStoreError("quota", "Knowledge quota reached; collect unreferenced sources before retrying");
    }
    beforeCommit?.();
    await this.transaction(source, async () => {
      const events = path.join(this.sourceDirectory(source), "events"); await mkdir(events, { recursive: true }); await syncDirectory(path.dirname(events));
      const directory = path.join(events, eventId); await mkdir(directory); await syncDirectory(events);
      const evidenceDirectory = path.join(directory, "evidence"); await mkdir(evidenceDirectory); await syncDirectory(directory);
      for (const [key, blob] of blobs) await writeDurable(path.join(evidenceDirectory, key), blob);
      await this.options.fault?.("after_evidence");
      // Verify the persisted bytes before making the revision reachable.
      for (const [key, blob] of blobs) { const saved = await readSafe(path.join(evidenceDirectory, key), 8 * 1024 * 1024); if (saved.length !== blob.length || digest(saved) !== key) throw new KnowledgeStoreError("integrity"); }
      await writeDurable(path.join(directory, "record.json"), bytes);
      await this.options.fault?.("after_record");
      await atomicJson(path.join(this.sourceDirectory(source), "manifest.json"), ManifestSchema.parse(manifest), beforeCommit);
      await this.options.fault?.("after_manifest");
    });
  }

  async retain(source: SourceIdentity, revisionId: string, referenceId: string): Promise<void> {
    Id.parse(referenceId); Id.parse(revisionId);
    return this.exclusive(async () => {
      const loaded = await this.load(source); if (!loaded?.revisions.has(revisionId)) throw new KnowledgeStoreError("integrity");
      if (loaded.manifest.references[referenceId] && loaded.manifest.references[referenceId] !== revisionId) throw new KnowledgeStoreError("conflict");
      loaded.manifest.references[referenceId] = revisionId;
      ManifestSchema.parse(loaded.manifest);
      if (await this.usage() + metadataSize(loaded.manifest) + 256 > (this.options.quotaBytes ?? DEFAULT_QUOTA_BYTES)) throw new KnowledgeStoreError("quota");
      await this.transaction(source, () => atomicJson(path.join(this.sourceDirectory(source), "manifest.json"), loaded.manifest));
    });
  }
  async release(source: SourceIdentity, referenceId: string): Promise<void> {
    Id.parse(referenceId);
    return this.exclusive(async () => {
      const loaded = await this.load(source); if (!loaded) return;
      delete loaded.manifest.references[referenceId];
      await this.transaction(source, () => atomicJson(path.join(this.sourceDirectory(source), "manifest.json"), loaded.manifest));
    });
  }
  async rebuildIndex(): Promise<Record<string, string | null>> {
    return this.exclusive(async () => {
      const file = path.join(this.directory, "index.json");
      if (await exists(file)) { try { parseJson(await readSafe(file)); } catch (e) { if (e instanceof KnowledgeStoreError && e.code === "future_schema") throw e; } }
      const index: Record<string, string | null> = {};
      for (const key of await readdir(path.join(this.directory, "sources"))) {
        if (!/^[a-f0-9]{64}$/.test(key)) throw new KnowledgeStoreError("integrity");
        const directory = path.join(this.directory, "sources", key); await directorySafe(directory);
        const manifest = ManifestSchema.parse(parseJson(await readSafe(path.join(directory, "manifest.json"))));
        if (sourceKey(manifest.source) !== key) throw new KnowledgeStoreError("integrity");
        const loaded = (await this.load(manifest.source))!;
        index[key] = loaded.disputes.size ? null : loaded.manifest.currentRevisionId;
      }
      const record = { schemaVersion: 1, entries: index };
      if (await this.usage() + metadataSize(record) > (this.options.quotaBytes ?? DEFAULT_QUOTA_BYTES)) throw new KnowledgeStoreError("quota");
      await atomicJson(file, record); return index;
    });
  }
  private async usage(directory = this.directory): Promise<number> {
    await directorySafe(directory); let bytes = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new KnowledgeStoreError("integrity");
      const file = path.join(directory, entry.name);
      bytes += entry.isDirectory() ? await this.usage(file) : (await lstat(file)).size;
    }
    return bytes;
  }
  /** Oldest-updated whole sources first. Pins, active runs, disputes and unreadable sources
   * are never evicted. Orphan transactions require explicit recovery, not quota cleanup.
   * Rename invalidates lookup before evidence removal; no source media is ever touched.
   */
  async collect(targetBytes = this.options.quotaBytes ?? DEFAULT_QUOTA_BYTES): Promise<{ removed: string[]; bytes: number }> {
    if (!Number.isSafeInteger(targetBytes) || targetBytes < 0) throw new Error("Invalid collection target");
    return this.exclusive(async () => {
      const candidates: { key: string; loaded: Loaded }[] = [];
      for (const key of await readdir(path.join(this.directory, "sources"))) {
        if (!/^[a-f0-9]{64}$/.test(key)) continue;
        try {
          const directory = path.join(this.directory, "sources", key); await directorySafe(directory);
          const manifest = ManifestSchema.parse(parseJson(await readSafe(path.join(directory, "manifest.json"))));
          if (sourceKey(manifest.source) !== key) continue;
          const loaded = (await this.load(manifest.source))!;
          if (loaded.disputes.size || Object.keys(manifest.references).length || [...this.runs.values()].some((r) => !r.ended && !r.signal?.aborted && sourceKey(r.source) === key)) continue;
          candidates.push({ key, loaded });
        } catch { /* Integrity-unknown records are protected, never silently discarded. */ }
      }
      const removed: string[] = []; let bytes = await this.usage();
      for (const { key } of candidates.sort((a, b) => a.loaded.manifest.updatedAt - b.loaded.manifest.updatedAt)) {
        if (bytes <= targetBytes) break;
        const directory = path.join(this.directory, "sources", key), trash = path.join(this.directory, `collected-${randomUUID()}`);
        await rename(directory, trash); await syncDirectory(path.dirname(directory)); await syncDirectory(this.directory);
        await rm(trash, { recursive: true }); await syncDirectory(this.directory); removed.push(key); bytes = await this.usage();
      }
      return { removed, bytes };
    });
  }
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const run of this.runs.values()) run.ended = true;
    this.closePromise = this.tail.then(async () => {
      this.runs.clear();
      if (!this.poisoned) { await rm(path.join(this.directory, "owner.lock"), { recursive: true }); await syncDirectory(this.directory); }
    });
    return this.closePromise;
  }
}
