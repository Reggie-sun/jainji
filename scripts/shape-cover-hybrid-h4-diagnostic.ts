/** Explicit development preview only. No production admission or automatic retries. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openHybridPreviewInput, renderHybridPreview, buildHybridPreviewPacket, reviewHybridPreview } from "../src/main/shape-cover-hybrid-preview.js";
import { ModelConnections } from "../src/main/model-connections.js";
import { createHybridVisionRoutes, probeMiniMaxVisionRoute } from "../src/main/shape-cover-vision-provider.js";
import { encodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";
import { discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { createVisionPacket, type VisionImageInput, type VisionPacket } from "../src/main/shape-cover-vision-packet.js";
import { fingerprintFile } from "../src/main/paths.js";

const [directory, inputPath, archivePath, ffmpegPath, ffprobePath, userData, mode, existingQaDirectory] = process.argv.slice(2);
if (![directory, inputPath, archivePath, ffmpegPath, ffprobePath, userData].every(Boolean) || !["--render", "--live", "--qa-only"].includes(mode) || mode === "--qa-only" && !existingQaDirectory) throw Error("Explicit private inputs and --render/--live/--qa-only required");
await mkdir(directory, { recursive: true });
const freezePaths = [inputPath, archivePath, "src/main/shape-cover-hybrid-preview.ts", "scripts/shape-cover-hybrid-h4-diagnostic.ts",
  "src/main/compiler.ts", "src/main/shape-cover-vision-router.ts", "src/main/shape-cover-vision-provider.ts", "src/main/shape-cover-vision-schema.ts", "src/main/shape-cover-vision-packet.ts"];
const frozen = await Promise.all(freezePaths.map(async file => ({ file, sha256: discoveryHash(await readFile(file)) })));
await writeFile(path.join(directory, "run-once.json"), JSON.stringify({ baseline: "000f3e6251cd4e4b13d531e2cbd32dfb208b4069", mode, frozen, at: new Date().toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
const verifyFreeze = async () => { for (const f of frozen) if (discoveryHash(await readFile(f.file)) !== f.sha256) throw Error("H4_CODE_OR_INPUT_CHANGED"); };
const signal = AbortSignal.timeout(1800000), input = { ...JSON.parse(await readFile(inputPath, "utf8")), signal, ffmpeg: { ffmpegPath, ffprobePath } };
const archive = JSON.parse(await readFile(archivePath, "utf8"));
const overlay = archive.h3.corners.find((c: { corner: string; status: string }) => c.corner === "TOP_RIGHT" && c.status === "FROZEN")?.overlay;
const preview = await openHybridPreviewInput(overlay, input);
let packet: VisionPacket, technical: Awaited<ReturnType<typeof renderHybridPreview>>["technical"];
if (mode === "--qa-only") {
  // Consume the original verified artifact and exact sampled image bytes. Never render again.
  const oldResultPath = path.join(existingQaDirectory, "result.json"), oldPacketPath = path.join(existingQaDirectory, "packet.json");
  const oldResultBytes = await readFile(oldResultPath), oldPacketBytes = await readFile(oldPacketPath);
  const oldResult = JSON.parse(oldResultBytes.toString()), saved = JSON.parse(oldPacketBytes.toString());
  const { packetDigest: oldDigest, ...oldManifest } = saved;
  technical = oldResult.technical;
  if (discoveryHash(JSON.stringify(oldManifest)) !== oldDigest || oldResult.packetDigest !== oldDigest ||
      technical.version !== "HybridRenderedPreview/v1" || technical.authority !== "none" || technical.productState !== "PRODUCT_DISABLED" ||
      technical.pngSha256 !== overlay.pngSha256 || technical.bindingDigest !== overlay.bindingDigest ||
      technical.sourceKey !== saved.sourceKey || technical.uncoveredPixels !== 0 || technical.fullDecode !== "PASS" || technical.clock !== "PASS") throw Error("H4_ARCHIVED_PREVIEW_BINDING");
  const operation = path.dirname(technical.previewPath), imageFiles: { file: string; sha256: string }[] = [];
  const verify = async () => {
    await preview.verifyFresh();
    if (await fingerprintFile(technical.previewPath) !== technical.previewFingerprint ||
        discoveryHash(await readFile(oldResultPath)) !== discoveryHash(oldResultBytes) ||
        discoveryHash(await readFile(oldPacketPath)) !== discoveryHash(oldPacketBytes)) throw Error("H4_ARCHIVED_PREVIEW_CHANGED");
    for (const item of imageFiles) if (discoveryHash(await readFile(item.file)) !== item.sha256) throw Error("H4_ARCHIVED_FRAME_CHANGED");
  };
  const images: VisionImageInput[] = [];
  for (const image of saved.images) {
    if (!Number.isSafeInteger(image.ordinal) || image.ordinal < 0 || !["ORIGINAL", "COVERED"].includes(image.kind)) throw Error("H4_ARCHIVED_FRAME_BINDING");
    const file = path.join(operation, `frame-${image.ordinal}-${image.kind}.png`), png = await readFile(file);
    if (discoveryHash(png) !== image.imageSha256 || png.length !== image.byteLength) throw Error("H4_ARCHIVED_FRAME_CHANGED");
    imageFiles.push({ file, sha256: image.imageSha256 });
    const { imageSha256, byteLength, ...binding } = image;
    images.push({ ...binding, png });
  }
  const candidates = overlay.semanticTarget.candidateIds.map((candidateId: string, i: number) => ({ candidateId, sourceBox: overlay.maskConfirmation.sourceBoxes[i] }));
  if (JSON.stringify(saved.candidates.map((c: { candidateId: string; sourceBox: unknown }) => ({ candidateId: c.candidateId, sourceBox: c.sourceBox }))) !== JSON.stringify(candidates)) throw Error("H4_ARCHIVED_TARGET_BINDING");
  await verify();
  packet = createVisionPacket({ kind: "PREVIEW", sourceKey: saved.sourceKey, sourceWidth: saved.sourceWidth, sourceHeight: saved.sourceHeight, timeBase: saved.timeBase,
    candidates, reviewScope: "Evaluate ONLY the confirmed TOP_RIGHT replacement in the paired frames. Unchanged graphics in other unconfirmed corners are V1 partial-processing scope, not residual failures. Check residual/edges, all collateral product/person/important-text occlusion caused by this replacement, unnatural size/position and temporal changes. Candidate boxes are frozen H3 source-pixel confirmation boxes. Never infer deterministic coverage or production approval." }, images, verify);
  await writeFile(path.join(directory, "reused-preview.json"), JSON.stringify({ technical, oldDigest, imageFiles, oldResultSha256: discoveryHash(oldResultBytes), oldPacketSha256: discoveryHash(oldPacketBytes) }, null, 2), { flag: "wx", mode: 0o600 });
} else {
  const render = await renderHybridPreview(preview, directory); technical = render.technical;
  console.log(JSON.stringify({ stage: "RENDERED", technical }));
  packet = await buildHybridPreviewPacket(preview, render);
}
await verifyFreeze(); await packet.verifyFresh();
await writeFile(path.join(directory, "packet.json"), JSON.stringify({ ...packet.manifest, packetDigest: packet.packetDigest }, null, 2), { flag: "wx", mode: 0o600 });
if (mode === "--live" || mode === "--qa-only") {
  const connections = new ModelConnections(userData, process.cwd(), async () => {}, () => {});
  try {
    await connections.restore();
    if (connections.chatgpt.status().status !== "ready") await connections.chatgpt.refresh();
    const profile = connections.store.snapshot().profiles.find(p => p.model === "MiniMax-M3" && p.protocol === "responses" &&
      ["api.minimaxi.com", "api.minimax.io"].includes(new URL(p.baseUrl).hostname));
    let probe: Awaited<ReturnType<typeof probeMiniMaxVisionRoute>> | undefined;
    if (profile) {
      const rgba = Buffer.alloc(96 * 32 * 4);
      for (let i = 0; i < rgba.length / 4; i++) { rgba[i * 4 + Math.floor(i % 96 / 32)] = 255; rgba[i * 4 + 3] = 255; }
      probe = await probeMiniMaxVisionRoute(connections, { connectionId: profile.id, model: profile.model },
        await encodeShapeCoverPng(rgba, { width: 96, height: 32 }, input.ffmpeg), signal);
      if (probe.route.imageCapability === "AVAILABLE") {
        const complete = probe.route.complete;
        probe.route.complete = async (...args) => {
          const raw = await complete(...args);
          await writeFile(path.join(directory, "minimax-qa-output.txt"), raw, { flag: "wx", mode: 0o600 });
          return raw;
        };
      }
    }
    await writeFile(path.join(directory, "capability.json"), JSON.stringify({ model: probe?.route.model ?? null, status: probe?.route.imageCapability ?? "UNAVAILABLE",
      modelRequests: probe?.modelRequests ?? 0, imageSha256: probe?.imageSha256 ?? null }, null, 2), { flag: "wx", mode: 0o600 });
    await verifyFreeze();
    const result = await reviewHybridPreview(packet, createHybridVisionRoutes(connections, probe?.route), signal);
    await verifyFreeze(); await packet.verifyFresh();
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ technical, packetDigest: packet.packetDigest, ...result }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ stage: "QA", ...result }));
  } finally { await connections.dispose(); }
}
