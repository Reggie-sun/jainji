/** Explicit real-artifact product integration qualification; normal users enter through agent.start. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { discoveryHash as hash } from "../src/main/source-fact-discovery-evidence.js";
import { sourceKey, SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store.js";
import { createVisionPacket, type VisionImageInput } from "../src/main/shape-cover-vision-packet.js";
import { importApprovedHybridOverlay, hybridTemplate } from "../src/main/hybrid-cover-production.js";
import type { VisionRole, VisionRoute, VisionReceipt } from "../src/main/shape-cover-vision-router.js";
import { fingerprintFile } from "../src/main/paths.js";
import { AgentController } from "../src/main/agent-controller.js";
import { ApplicationService } from "../src/main/application.js";
import { ExportQueue } from "../src/main/queue.js";
import { FfmpegAdapter } from "../src/main/ffmpeg.js";
import { JobStore } from "../src/main/store.js";
import { createDefaultTemplate } from "../src/main/domain.js";
import { HYBRID_PRODUCT_ENABLED } from "../src/main/shape-cover-activation.js";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers.js";
import { DecorationSchema } from "../src/shared/decorations.js";

const [output, inputPath, archivePath, qaPath, packetPath, ffmpegPath, ffprobePath, expectedArchive, expectedQa, expectedPacket] = process.argv.slice(2);
if (![output, inputPath, archivePath, qaPath, packetPath, ffmpegPath, ffprobePath, expectedArchive, expectedQa, expectedPacket].every(Boolean)) throw Error("Explicit paths and SHA seals required");
if (!HYBRID_PRODUCT_ENABLED) throw Error("PRODUCT_DISABLED: complete final activation gates before this formal product export");
await mkdir(output, { recursive: false });
const snapshot = await Promise.all([inputPath, archivePath, qaPath, packetPath].map(async p => ({ path: p, bytes: await readFile(p) })));
for (const [i, expected] of [[1, expectedArchive], [2, expectedQa], [3, expectedPacket]] as const) assert.equal(hash(snapshot[i].bytes), expected);
const input = JSON.parse(snapshot[0].bytes.toString()), archive = JSON.parse(snapshot[1].bytes.toString()), qa = JSON.parse(snapshot[2].bytes.toString());
const { packetDigest, ...manifest } = JSON.parse(snapshot[3].bytes.toString());
const overlay = archive.h3.corners.find((c: { corner: string; status: string }) => c.corner === "TOP_RIGHT" && c.status === "FROZEN")?.overlay;
assert.ok(overlay); assert.equal(qa.verdict, "PASS"); assert.equal(qa.mode, "ARCHIVED_RECEIPT_REPLAY");
assert.equal(qa.technical.pngSha256, overlay.pngSha256); assert.equal(qa.technical.bindingDigest, overlay.bindingDigest);
assert.equal(qa.packetDigest, packetDigest); assert.equal(sourceKey(overlay.source), manifest.sourceKey);
assert.equal(qa.technical.uncoveredPixels, 0); assert.equal(qa.technical.fullDecode, "PASS"); assert.equal(qa.technical.clock, "PASS");
const tools = new FfmpegAdapter(ffmpegPath, ffprobePath), signal = AbortSignal.timeout(1800000);
const knowledge = await SourceStickerKnowledgeStore.open(path.join(output, "profile"));
const service = new ApplicationService(tools, { resolve: async () => null });
await service.addMedia([input.sourcePath]);
const media = service.currentProject.mediaItems[0]; assert.equal(media.fingerprint, input.source.fingerprint);
const imageFiles: { path: string; sha256: string }[] = [], images: VisionImageInput[] = [];
for (const image of manifest.images) {
  const file = path.join(path.dirname(qa.technical.previewPath), `frame-${image.ordinal}-${image.kind}.png`), png = await readFile(file);
  assert.equal(hash(png), image.imageSha256); assert.equal(png.length, image.byteLength);
  imageFiles.push({ path: file, sha256: image.imageSha256 });
  const { imageSha256: _sha, byteLength: _bytes, ...binding } = image;
  images.push({ ...binding, png });
}
const verify = async () => {
  signal.throwIfAborted();
  for (const durationMs of new Set<number>([overlay.source.durationMs, media.durationMs])) {
    const existing = await knowledge.lookup({ ...overlay.source, durationMs }, [{ startMs: 0, endMs: durationMs }]);
    assert.ok(existing.status !== "disputed" && existing.status !== "unusable", "Source knowledge must remain usable");
  }
  for (const f of snapshot) assert.equal(hash(await readFile(f.path)), hash(f.bytes));
  for (const f of imageFiles) assert.equal(hash(await readFile(f.path)), f.sha256);
  assert.equal(await fingerprintFile(qa.technical.previewPath), qa.technical.previewFingerprint);
};
const { version: _version, images: _images, ...metadata } = manifest;
const packet = createVisionPacket(metadata, images, verify); assert.equal(packet.packetDigest, packetDigest);
const consumed = new Set<string>();
const replayRoute = (role: VisionRole): VisionRoute => {
  const prior: VisionReceipt = qa.originalReceipts.find((r: VisionReceipt) => r.role === role);
  return { provider: "archived-receipt-replay", model: prior?.model ?? role, imageCapability: "AVAILABLE", verifyFresh: verify,
    complete: async messages => {
      assert.ok(prior?.output); assert.equal(consumed.has(role), false); consumed.add(role);
      assert.equal(prior.packetDigest, packet.packetDigest); assert.equal(prior.sourceKey, manifest.sourceKey);
      assert.deepEqual(prior.imageHashes, images.map(i => hash(i.png)));
      const content = messages[1].content as { text: string }[]; assert.equal(JSON.parse(content[0].text).packetDigest, packet.packetDigest);
      return JSON.stringify(prior.output);
    } };
};
const layer = await importApprovedHybridOverlay(overlay, { ...input, ffmpeg: tools, signal }, packet,
  { LUNA: replayRoute("LUNA"), SOL: replayRoute("SOL"), MINIMAX: replayRoute("MINIMAX") }, verify);
const template = hybridTemplate([layer], createDefaultTemplate("自动形状匹配 · TOP_RIGHT；其余角落保持原样"));
service.currentProject.coverSticker = { enabled: true, trackingMode: "agent", coverStrategy: "shape-matched-static-v1", stickerIds: [], rectangle: { x: 0, y: 0, width: 0.2, height: 0.2 } };
const queue = new ExportQueue({ jobStore: new JobStore(path.join(output, "jobs")), ffmpeg: tools, fontResolver: { resolve: async () => null } });
queue.setMediaLookup(id => service.getMedia(id));
// The internal session only supplies the already-approved frozen template. Quantity, enqueue, compile,
// rendering, verification and publication remain the normal controller/runner/queue product path.
const controller = new AgentController(service, queue, tools, () => {}, await ensureBuiltinStickerAssets(path.join(output, "stickers")), undefined, undefined, undefined, undefined,
  knowledge, undefined, undefined, undefined, { prepare: async () => structuredClone(template) });
await controller.start({ ruleId: "clean", brief: "", mediaIds: [media.id], outputDirectory: output, exportFormat: "mp4", exportSettings: overlay.settings,
  decorations: DecorationSchema.parse({ mode: "manual", displayText: { enabled: false, x: 0.5, y: 0.7 } }), requestedCount: 1 }, new Set([output]));
const deadline = Date.now() + 900000;
while (Date.now() < deadline && (controller.busy || queue.snapshot().batches.some(s => s.batch.tasks.some(t => ["queued", "validating", "running", "verifying"].includes(t.status))))) await pause(100);
const state = queue.snapshot().batches[0]; assert.ok(state); const task = state.batch.tasks[0]; assert.equal(task.status, "completed", task.errorMessage);
await verify();
assert.equal(state.batch.templateSnapshot.layers.length, 1);
const frozen = state.batch.templateSnapshot.layers[0]; assert.equal(frozen.type, "sticker");
if (frozen.type !== "sticker") throw Error("Expected frozen sticker layer");
assert.deepEqual(frozen.cover?.hybridApproved?.placement, overlay.placement); assert.equal(frozen.cover?.hybridApproved?.pngSha256, qa.technical.pngSha256);
assert.equal(frozen.cover?.hybridApproved?.bindingDigest, qa.technical.bindingDigest);
assert.equal(hash(await readFile(overlay.pngPath)), qa.technical.pngSha256);
await writeFile(path.join(output, "queue-state.json"), JSON.stringify(state, null, 2), { flag: "wx", mode: 0o600 });
const receipt = { status: "PASS", pipeline: "AgentController.start→AgentRunner→TemplateCompiler→ExportQueue→ArtifactVerifier→publishWithoutReplacement",
  liveModelRequests: 0, priorH4ReceiptReplay: [...consumed], sourceKnowledge: "isolated canonical store", sourceKey: manifest.sourceKey, pngSha256: overlay.pngSha256, bindingDigest: overlay.bindingDigest,
  placement: overlay.placement, coverage: overlay.coverage, corner: "TOP_RIGHT", partial: true, unconfirmedCorners: "UNCHANGED",
  productDisabled: false, batchId: state.batch.id, taskId: task.id, artifact: task.outputArtifact, outputFingerprint: await fingerprintFile(task.outputPath!),
  originalH4PreviewFingerprint: qa.technical.previewFingerprint, seals: snapshot.map(s => ({ path: s.path, sha256: hash(s.bytes) })) };
await writeFile(path.join(output, "activation-export.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(receipt));
await knowledge.close();
