import { mkdir, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EditTemplateSchema, ExportPresetSchema, MediaItemSchema, type EditTemplate, type ExportPreset, type MediaItem, type ExportBatch } from "./domain.js";
import { ShapeCoverCandidateRequestSchema, type ShapeCoverCandidateRequest } from "./shape-cover-candidates.js";
import { verifyShapeCoverAdmission, type ShapeCoverAdmission } from "./shape-cover-admission.js";
import { MAX_FROZEN_SHAPE_BYTES } from "../shared/shape-cover.js";
import { reviewDigest } from "./cover-review-approval.js";
import type { ExportQueue } from "./queue.js";
import type { JobStore } from "./store.js";
import { artifactDirectory, artifactUnsafe, inspectArtifactFile, readArtifactJson, syncArtifactDirectory, writeArtifactJson,
  SHAPE_ARTIFACT_METADATA_BYTES, SHAPE_ARTIFACT_SAMPLE_BYTES, SHAPE_ARTIFACT_TOTAL_BYTES } from "./shape-cover-artifact-io.js";

const Key = z.object({ runId: z.string().uuid(), mediaId: z.string().uuid(), version: z.number().int().positive().max(100) }).strict();
export type ShapeCoverArtifactKey = z.infer<typeof Key>;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const File = z.object({ name: z.string().regex(/^asset-\d{1,4}\.bin$|^sample\.(mp4|mov|mkv)$/), fingerprint: Fingerprint,
  bytes: z.number().int().positive().max(SHAPE_ARTIFACT_SAMPLE_BYTES), kind: z.enum(["candidate", "layer", "sample"]), index: z.number().int().nonnegative().max(1024) }).strict();
const Data = z.object({ key: Key, projectId: z.string().uuid(), request: ShapeCoverCandidateRequestSchema,
  template: EditTemplateSchema, media: MediaItemSchema, preset: ExportPresetSchema,
  outputDirectory: z.string().min(1).max(4096).refine(path.isAbsolute), sampleFingerprint: Fingerprint }).strict();
const Manifest = z.object({ schemaVersion: z.literal(1), authority: z.literal("none"), bindingDigest: Digest, data: Data,
  files: z.array(File).min(2).max(1024) }).strict();
const Intent = z.object({ schemaVersion: z.literal(1), bindingDigest: Digest }).strict();
const Receipt = z.object({ schemaVersion: z.literal(1), bindingDigest: Digest, batchId: z.string().uuid(), taskId: z.string().uuid(),
  outputPath: z.string().min(1).max(4096).refine(path.isAbsolute), outputFingerprint: Fingerprint }).strict();
type ArtifactManifest = z.infer<typeof Manifest>;
export type ShapeCoverReconciliation = { authority: "none" } & (
  { state: "NO_INTENT" } | { state: "UNKNOWN" } |
  { state: "COMPLETED_VERIFIED"; result: { batchId: string; taskId: string; outputPath: string } }
);
interface CaptureInput {
  key: ShapeCoverArtifactKey; request: ShapeCoverCandidateRequest; template: EditTemplate; media: MediaItem; preset: ExportPreset;
  outputDirectory: string; samplePath: string; admission: ShapeCoverAdmission; signal: AbortSignal;
}
const exists = async (file: string) => { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };

/** Immutable data custody and a one-shot side-effect barrier; JobStore remains the task authority. */
export class ShapeCoverArtifactStore {
  private readonly root: string;
  private readonly projectId: string;
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(input: { root: string; projectId: string; jobStore: JobStore }) {
    if (!path.isAbsolute(input.root)) artifactUnsafe("root must be absolute");
    this.root = path.resolve(input.root);
    this.projectId = z.string().uuid().parse(input.projectId);
    this.jobStore = input.jobStore;
  }
  private readonly jobStore: JobStore;
  private directory(key: ShapeCoverArtifactKey): string {
    const parsed = Key.parse(key);
    return path.join(this.root, this.projectId, `${parsed.runId}-${parsed.mediaId}-${parsed.version}`);
  }
  private async directories(key: ShapeCoverArtifactKey): Promise<string> {
    await artifactDirectory(path.dirname(this.root));
    if (!await exists(this.root)) await mkdir(this.root, { mode: 0o700 });
    await artifactDirectory(this.root);
    await syncArtifactDirectory(path.dirname(this.root));
    const project = path.join(this.root, this.projectId);
    await mkdir(project, { recursive: true, mode: 0o700 });
    await artifactDirectory(project);
    await syncArtifactDirectory(this.root);
    return this.directory(key);
  }
  private async loadManifest(key: ShapeCoverArtifactKey): Promise<ArtifactManifest> {
    const directory = this.directory(key);
    await artifactDirectory(this.root);
    await artifactDirectory(path.dirname(directory));
    await artifactDirectory(directory);
    const manifest = Manifest.parse(await readArtifactJson(path.join(directory, "manifest.json")));
    if (manifest.data.projectId !== this.projectId || reviewDigest(manifest.data.key) !== reviewDigest(Key.parse(key))
      || manifest.data.key.mediaId !== manifest.data.media.id || manifest.bindingDigest !== reviewDigest(manifest.data)) artifactUnsafe("manifest binding mismatch");
    const expected = this.resources(manifest.data, "");
    if (expected.length !== manifest.files.length || new Set(manifest.files.map(file => file.name)).size !== manifest.files.length) artifactUnsafe("resource set mismatch");
    let bytes = 0;
    for (const [i, file] of manifest.files.entries()) {
      const wanted = expected[i];
      if (file.name !== wanted.name || file.kind !== wanted.kind || file.index !== wanted.index || file.fingerprint !== wanted.fingerprint) artifactUnsafe("resource binding mismatch");
      const observed = await inspectArtifactFile(path.join(directory, file.name), file.kind === "sample" ? SHAPE_ARTIFACT_SAMPLE_BYTES : MAX_FROZEN_SHAPE_BYTES);
      bytes += observed.bytes;
      if (observed.fingerprint !== file.fingerprint || observed.bytes !== file.bytes || bytes > SHAPE_ARTIFACT_TOTAL_BYTES) artifactUnsafe("resource bytes mismatch");
    }
    return manifest;
  }
  private resources(data: z.infer<typeof Data>, samplePath: string) {
    const files: Array<{ name: string; source: string; fingerprint: string; kind: "candidate" | "layer" | "sample"; index: number }> = [];
    for (const [index, candidate] of data.request.candidates.entries()) files.push({ name: `asset-${files.length}.bin`, source: candidate.asset.assetPath,
      fingerprint: candidate.asset.assetFingerprint, kind: "candidate", index });
    for (const [index, layer] of data.template.layers.entries()) if (layer.type === "sticker") files.push({ name: `asset-${files.length}.bin`,
      source: layer.assetPath, fingerprint: layer.assetFingerprint, kind: "layer", index });
    files.push({ name: `sample.${data.preset.container}`, source: samplePath, fingerprint: data.sampleFingerprint, kind: "sample", index: 0 });
    if (files.length > 1024) artifactUnsafe("resource count limit");
    return files;
  }
  private async capture(input: CaptureInput): Promise<ArtifactManifest> {
    input.signal.throwIfAborted();
    await verifyShapeCoverAdmission(input.admission, input.template, input.media, input.preset, input.samplePath, input.request);
    const sample = await inspectArtifactFile(input.samplePath, SHAPE_ARTIFACT_SAMPLE_BYTES, input.signal);
    const data = Data.parse({ key: input.key, projectId: this.projectId, request: input.request, template: input.template,
      media: input.media, preset: input.preset, outputDirectory: path.resolve(input.outputDirectory), sampleFingerprint: sample.fingerprint });
    if (data.key.mediaId !== data.media.id || !data.template.layers.some(layer => layer.type === "sticker" && layer.cover?.shapeMatched)) artifactUnsafe("key or shape mismatch");
    for (const layer of data.template.layers) if (layer.type === "sticker" && layer.cover?.shapeMatched && layer.cover.selection
      && (layer.cover.selection.runId !== data.key.runId || layer.cover.selection.round !== data.key.version)) artifactUnsafe("production key mismatch");
    if (Buffer.byteLength(JSON.stringify(data)) > SHAPE_ARTIFACT_METADATA_BYTES) artifactUnsafe("metadata limit");
    const sources = this.resources(data, input.samplePath), digest = reviewDigest(data);
    const directory = await this.directories(data.key);
    if (await exists(directory)) {
      const manifest = await this.loadManifest(data.key);
      if (manifest.bindingDigest !== digest) artifactUnsafe("same key has different content");
      if (!await exists(path.join(directory, "publication-intent.json"))) artifactUnsafe("existing snapshot lacks publication intent");
      return manifest;
    }
    await mkdir(directory, { mode: 0o700 });
    let committed = false;
    try {
      const files: ArtifactManifest["files"] = [];
      let bytes = 0;
      for (const source of sources) {
        const copied = await inspectArtifactFile(source.source, source.kind === "sample" ? SHAPE_ARTIFACT_SAMPLE_BYTES : MAX_FROZEN_SHAPE_BYTES,
          input.signal, path.join(directory, source.name));
        bytes += copied.bytes;
        if (bytes > SHAPE_ARTIFACT_TOTAL_BYTES || copied.fingerprint !== source.fingerprint) artifactUnsafe("capture bytes mismatch");
        files.push(File.parse({ name: source.name, fingerprint: copied.fingerprint, bytes: copied.bytes, kind: source.kind, index: source.index }));
      }
      await verifyShapeCoverAdmission(input.admission, input.template, input.media, input.preset, input.samplePath, input.request);
      input.signal.throwIfAborted();
      const manifest = Manifest.parse({ schemaVersion: 1, authority: "none", bindingDigest: digest, data, files });
      await writeArtifactJson(path.join(directory, "manifest.json"), manifest);
      committed = true;
      await syncArtifactDirectory(path.dirname(directory));
      return manifest;
    } finally {
      if (!committed) await rm(directory, { recursive: true, force: true });
    }
  }

  /** Data-only load. Rebased paths deliberately cannot reuse an old admission handle. */
  async load(key: ShapeCoverArtifactKey) {
    const manifest = await this.loadManifest(key), directory = this.directory(key);
    const data = structuredClone(manifest.data);
    for (const file of manifest.files) {
      if (file.kind === "candidate") data.request.candidates[file.index].asset.assetPath = path.join(directory, file.name);
      if (file.kind === "layer") {
        const layer = data.template.layers[file.index];
        if (layer.type !== "sticker") artifactUnsafe("layer mismatch");
        layer.assetPath = path.join(directory, file.name);
      }
    }
    return { ...data, authority: "none" as const, samplePath: path.join(directory, `sample.${data.preset.container}`), bindingDigest: manifest.bindingDigest };
  }

  /** Only reads a completed JobStore fact and exact output bytes; never performs publication. */
  async completed(key: ShapeCoverArtifactKey) {
    const manifest = await this.loadManifest(key), directory = this.directory(key);
    const intent = Intent.parse(await readArtifactJson(path.join(directory, "publication-intent.json")));
    const receipt = Receipt.parse(await readArtifactJson(path.join(directory, "publication-receipt.json")));
    if (intent.bindingDigest !== manifest.bindingDigest || receipt.bindingDigest !== manifest.bindingDigest
      || receipt.outputFingerprint !== manifest.data.sampleFingerprint) artifactUnsafe("publication binding mismatch");
    return this.verifyCompleted(manifest, receipt);
  }

  /** Restart observation only. A discovered result never creates a receipt or publication permission. */
  async reconcile(key: ShapeCoverArtifactKey): Promise<ShapeCoverReconciliation> {
    try {
      const directory = this.directory(key), intentPath = path.join(directory, "publication-intent.json");
      for (const parent of [this.root, path.dirname(directory), directory]) {
        if (!await exists(parent)) return { state: "NO_INTENT", authority: "none" };
        await artifactDirectory(parent);
      }
      if (!await exists(intentPath)) return { state: "NO_INTENT", authority: "none" };
      const manifest = await this.loadManifest(key);
      const intent = Intent.parse(await readArtifactJson(intentPath));
      if (intent.bindingDigest !== manifest.bindingDigest) artifactUnsafe("intent binding mismatch");
      const receiptPath = path.join(directory, "publication-receipt.json");
      const receiptPresent = await exists(receiptPath);
      let receipt: z.infer<typeof Receipt>;
      if (receiptPresent) {
        receipt = Receipt.parse(await readArtifactJson(receiptPath));
        if (receipt.bindingDigest !== manifest.bindingDigest || receipt.outputFingerprint !== manifest.data.sampleFingerprint) artifactUnsafe("receipt binding mismatch");
      } else {
        // B5 snapshots without explicit run/version selection cannot support receipt-less discovery.
        const shapes = manifest.data.template.layers.filter(layer => layer.type === "sticker" && layer.cover?.shapeMatched);
        if (!shapes.length || shapes.some(layer => layer.type !== "sticker" || layer.cover?.selection?.runId !== key.runId
          || layer.cover.selection.round !== key.version)) artifactUnsafe("missing production identity");
        const ids = await this.jobStore.canonicalBatchIds();
        const matches: ExportBatch[] = [];
        const observed: Array<{ id: string; digest: string }> = [];
        for (const id of ids) {
          const state = await this.jobStore.readCanonical(id), { batch } = state;
          observed.push({ id, digest: reviewDigest(state) });
          if (this.matchesBatch(manifest, batch)) matches.push(batch);
          if (matches.length > 1) artifactUnsafe("ambiguous canonical completion");
        }
        if (matches.length !== 1) artifactUnsafe("canonical completion unproven");
        const batch = matches[0], task = batch.tasks[0];
        receipt = Receipt.parse({ schemaVersion: 1, bindingDigest: manifest.bindingDigest, batchId: batch.id, taskId: task.id,
          outputPath: task.outputPath, outputFingerprint: manifest.data.sampleFingerprint });
        for (const item of observed) if (item.digest !== reviewDigest(await this.jobStore.readCanonical(item.id))) artifactUnsafe("canonical job changed during discovery");
        if (reviewDigest(ids) !== reviewDigest(await this.jobStore.canonicalBatchIds())) artifactUnsafe("canonical inventory changed");
      }
      const result = await this.verifyCompleted(manifest, receipt);
      // Detect drift in the durable bindings during observation; never repair it.
      if (reviewDigest(intent) !== reviewDigest(Intent.parse(await readArtifactJson(intentPath)))
        || reviewDigest(manifest) !== reviewDigest(await this.loadManifest(key))) artifactUnsafe("custody changed during reconciliation");
      if (receiptPresent ? reviewDigest(receipt) !== reviewDigest(Receipt.parse(await readArtifactJson(receiptPath))) : await exists(receiptPath)) artifactUnsafe("receipt changed during reconciliation");
      return { state: "COMPLETED_VERIFIED", authority: "none", result };
    } catch { return { state: "UNKNOWN", authority: "none" }; }
  }

  private matchesBatch(manifest: ArtifactManifest, batch: ExportBatch): boolean {
    return batch.projectId === this.projectId && batch.tasks.length === 1
      && batch.tasks[0].mediaId === manifest.data.key.mediaId && reviewDigest(batch.mediaIds) === reviewDigest([manifest.data.key.mediaId])
      && batch.outputDirectory === manifest.data.outputDirectory
      && reviewDigest(batch.templateSnapshot) === reviewDigest(manifest.data.template) && reviewDigest(batch.preset) === reviewDigest(manifest.data.preset)
      && reviewDigest(batch.mediaSnapshots) === reviewDigest([manifest.data.media]);
  }
  private async verifyCompleted(manifest: ArtifactManifest, receipt: z.infer<typeof Receipt>) {
    const state = await this.jobStore.readCanonical(receipt.batchId), { batch } = state;
    const task = batch.tasks.find(task => task.id === receipt.taskId);
    if (!this.matchesBatch(manifest, batch) || batch.status !== "completed" || !task || task.status !== "completed"
      || task.progress !== 1 || task.attempt < 1 || !task.startedAt || !task.finishedAt || task.errorCode || task.errorMessage
      || task.outputArtifact?.taskId !== task.id || task.outputArtifact.sizeBytes <= 0
      || task.mediaId !== manifest.data.key.mediaId || task.outputPath !== receipt.outputPath || task.outputArtifact?.path !== receipt.outputPath
      || batch.outputDirectory !== manifest.data.outputDirectory || path.dirname(receipt.outputPath) !== manifest.data.outputDirectory
      || path.extname(receipt.outputPath) !== `.${manifest.data.preset.container}`) artifactUnsafe("completed queue fact mismatch");
    await artifactDirectory(manifest.data.outputDirectory);
    const output = await inspectArtifactFile(receipt.outputPath, SHAPE_ARTIFACT_SAMPLE_BYTES);
    if (output.fingerprint !== receipt.outputFingerprint || output.bytes !== task.outputArtifact?.sizeBytes) artifactUnsafe("completed output changed");
    if (reviewDigest(state) !== reviewDigest(await this.jobStore.readCanonical(receipt.batchId))) artifactUnsafe("completed queue fact changed");
    return { batchId: receipt.batchId, taskId: receipt.taskId, outputPath: receipt.outputPath };
  }

  publish(input: CaptureInput & { queue: Pick<ExportQueue, "publishApprovedSample"> }) {
    // Detach mutable caller data before waiting; the opaque handle itself must retain identity.
    const frozen = { ...structuredClone({ ...input, admission: undefined, queue: undefined, signal: undefined }), admission: input.admission, queue: input.queue, signal: input.signal };
    const key = this.directory(input.key), previous = this.pending.get(key) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => this.publishOnce(frozen));
    const tracked = work.finally(() => { if (this.pending.get(key) === tracked) this.pending.delete(key); });
    this.pending.set(key, tracked);
    return tracked;
  }
  private async publishOnce(input: CaptureInput & { queue: Pick<ExportQueue, "publishApprovedSample"> }) {
    const manifest = await this.capture(input), directory = this.directory(input.key);
    const intentPath = path.join(directory, "publication-intent.json");
    input.signal.throwIfAborted();
    if (await exists(intentPath)) return this.completed(input.key);
    await this.loadManifest(input.key);
    // Exclusive create is the cross-process barrier. It is never cleared or retried.
    await writeArtifactJson(intentPath, { schemaVersion: 1, bindingDigest: manifest.bindingDigest });
    input.signal.throwIfAborted();
    const samplePath = path.join(directory, `sample.${input.preset.container}`);
    await verifyShapeCoverAdmission(input.admission, input.template, input.media, input.preset, samplePath, input.request);
    const published = await input.queue.publishApprovedSample({ template: input.template, media: input.media, preset: input.preset,
      samplePath, outputDirectory: manifest.data.outputDirectory, projectId: this.projectId, shapeAdmission: input.admission });
    // A failure after queue side effects leaves the permanent barrier closed.
    const receipt = Receipt.parse({ schemaVersion: 1, bindingDigest: manifest.bindingDigest, ...published, outputFingerprint: manifest.data.sampleFingerprint });
    await this.verifyCompleted(manifest, receipt);
    await writeArtifactJson(path.join(directory, "publication-receipt.json"), receipt);
    return this.completed(input.key);
  }
}
