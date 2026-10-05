import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { prepareDiscoveryEvidence, discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { confirmHybridCornerTargets } from "../src/main/shape-cover-vision-corner-semantic.js";
import { ShapeCoverVisionSession, type VisionRoute, type VisionRole, type VisionReceipt } from "../src/main/shape-cover-vision-router.js";
import { prepareHybridCornerOverlays, readHybridFrozenOverlay } from "../src/main/shape-cover-hybrid-h3.js";
import { loadBundledStickerAssets } from "../src/main/bundled-stickers.js";
import { UploadedStickers } from "../src/main/uploaded-stickers.js";
import { isCoverPoolStickerId } from "../src/shared/cover-sticker.js";
import { isAutomaticStickerAllowed } from "../src/shared/automatic-stickers.js";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings.js";

/** Explicit private development input. Replays existing H2 responses only; never opens connections or calls a provider. */
const { values } = parseArgs({ options: { input: { type: "string" }, receipts: { type: "string" }, case: { type: "string", default: "real233s" },
  output: { type: "string" }, "user-data": { type: "string", default: path.join(homedir(), ".config/jianji") },
  ffmpeg: { type: "string", default: path.join(homedir(), ".config/jianji/tools/ffmpeg/bin/ffmpeg") },
  ffprobe: { type: "string", default: path.join(homedir(), ".config/jianji/tools/ffmpeg/bin/ffprobe") } } });
if (!values.input || !values.receipts || !values.output) throw Error("Specify --input --receipts --output; output must be a new private directory");
await mkdir(values.output, { mode: 0o700 });
const inputBytes = await readFile(values.input), historicalBytes = await readFile(values.receipts);
const input = JSON.parse(inputBytes.toString()), old = JSON.parse(historicalBytes.toString()).evaluations.find((e: { case: string }) => e.case === values.case);
if (!old?.result?.receipts) throw Error("H2 historical corner receipts unavailable");
const bundled = await loadBundledStickerAssets(path.resolve("resources/stickers/downloaded"));
const uploads = await new UploadedStickers(path.join(values["user-data"]!, "uploaded-stickers"), () => { throw Error("No import in this diagnostic"); }).load();
const assets: Record<string, { assetPath: string; assetFingerprint: string }> = { ...bundled, ...uploads };
for (const name of await readdir(path.join(values["user-data"]!, "agent-stickers"))) {
  const matched = /^(heart|burst|arrow|sparkle)-([a-f0-9]{12})\.png$/.exec(name); if (!matched) continue;
  const assetPath = path.join(values["user-data"]!, "agent-stickers", name), sha = discoveryHash(await readFile(assetPath));
  if (sha.slice(0, 12) !== matched[2] || assets[matched[1]]) throw Error("Local builtin catalog mismatch");
  assets[matched[1]] = { assetPath, assetFingerprint: `sha256:${sha}` };
}
const candidates = Object.entries(assets).filter(([id]) => isCoverPoolStickerId(id) || isAutomaticStickerAllowed(id)).map(([id, asset]) => ({ id, asset })).sort((a, b) => a.id.localeCompare(b.id));
await writeFile(path.join(values.output, "input-freeze.json"), JSON.stringify({ inputSha256: discoveryHash(inputBytes), h2ReceiptsSha256: discoveryHash(historicalBytes),
  case: values.case, settings: DEFAULT_EXPORT_SETTINGS, candidates, realProviderRequests: 0, productState: "PRODUCT_DISABLED" }, null, 2), { flag: "wx", mode: 0o600 });
const signal = AbortSignal.timeout(300000), ffmpeg = { ffmpegPath: values.ffmpeg!, ffprobePath: values.ffprobe! }, tools = { ...ffmpeg, signal };
const evidence = await prepareDiscoveryEvidence({ ...input, ffmpeg, signal }, { frames: 24 });
try {
  const route = (role: VisionRole): VisionRoute => ({ provider: "historical-receipt-replay", model: role,
    imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: async messages => {
      const content = messages[1].content as { text: string }[], metadata = JSON.parse(content[0].text), context = JSON.parse(content.at(-1)!.text);
      const prior: VisionReceipt | undefined = old.result.receipts.find((r: VisionReceipt) => r.role === role && r.corner === context.corner);
      assert.ok(prior?.output, "No extra historical response permitted"); assert.equal(metadata.packetDigest, prior.packetDigest);
      assert.deepEqual(metadata.candidates.map((c: { candidateId: string }) => c.candidateId), prior.candidateIds);
      assert.deepEqual(metadata.images.map((i: { imageSha256: string }) => i.imageSha256), prior.imageHashes);
      assert.equal(discoveryHash(JSON.stringify(context)), prior.contextDigest);
      return JSON.stringify(prior.output);
    } });
  const routes = { LUNA: route("LUNA"), SOL: route("SOL"), MINIMAX: route("MINIMAX") };
  const semantic = await confirmHybridCornerTargets(evidence, tools, new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes, 180000, "CORNER"), signal);
  assert.deepEqual(semantic.corners.TOP_RIGHT.confirmedTarget, old.result.corners.TOP_RIGHT.confirmedTarget);
  const h3 = await prepareHybridCornerOverlays({ ...input, ffmpeg, signal }, evidence, semantic, candidates, DEFAULT_EXPORT_SETTINGS, path.join(values.output, "frozen"));
  for (const c of h3.corners) if (c.status === "FROZEN") await readHybridFrozenOverlay(h3, c.corner, tools);
  const record = { kind: "H3_REAL_SOURCE_H2_RECEIPT_REPLAY", realProviderRequests: 0, semantic, h3 };
  await writeFile(path.join(values.output, "result.json"), JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
  if (values.case === "real233s") {
    const mask = h3.corners.find(c => c.corner === "TOP_RIGHT")?.mask;
    assert.equal(mask?.markedPixels, 3395); assert.deepEqual(mask.bbox, { x: 628, y: 1, width: 81, height: 59 });
    assert.equal(mask.sha256, "fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893");
  }
  console.log(JSON.stringify({ status: h3.status, poolSize: candidates.length, sourceErrors: h3.sourceErrors, corners: h3.corners.map(c => ({
    corner: c.corner, status: c.status, reason: c.reason, mask: c.mask && { markedPixels: c.mask.markedPixels, bbox: c.mask.bbox, sha256: c.mask.sha256 },
    motion: c.motion?.status, selectedSticker: c.overlay?.selectedSticker, placement: c.overlay?.placement, coverage: c.overlay?.coverage,
    pngPath: c.overlay?.pngPath, pngSha256: c.overlay?.pngSha256 })) }));
} finally { await evidence.close(); }
