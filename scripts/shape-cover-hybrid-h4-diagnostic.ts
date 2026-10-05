/** Explicit development preview only. No production admission or automatic retries. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openHybridPreviewInput, renderHybridPreview, buildHybridPreviewPacket, reviewHybridPreview } from "../src/main/shape-cover-hybrid-preview.js";
import { ModelConnections } from "../src/main/model-connections.js";
import { createHybridVisionRoutes, probeMiniMaxVisionRoute } from "../src/main/shape-cover-vision-provider.js";
import { encodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";
import { discoveryHash } from "../src/main/source-fact-discovery-evidence.js";

const [directory, inputPath, archivePath, ffmpegPath, ffprobePath, userData, mode] = process.argv.slice(2);
if (![directory, inputPath, archivePath, ffmpegPath, ffprobePath, userData].every(Boolean) || !["--render", "--live"].includes(mode)) throw Error("Explicit private inputs and --render/--live required");
await mkdir(directory, { recursive: true });
const freezePaths = [inputPath, archivePath, "src/main/shape-cover-hybrid-preview.ts", "scripts/shape-cover-hybrid-h4-diagnostic.ts",
  "src/main/compiler.ts", "src/main/shape-cover-vision-router.ts", "src/main/shape-cover-vision-provider.ts", "src/main/shape-cover-vision-packet.ts"];
const frozen = await Promise.all(freezePaths.map(async file => ({ file, sha256: discoveryHash(await readFile(file)) })));
await writeFile(path.join(directory, "run-once.json"), JSON.stringify({ baseline: "000f3e6251cd4e4b13d531e2cbd32dfb208b4069", mode, frozen, at: new Date().toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
const verifyFreeze = async () => { for (const f of frozen) if (discoveryHash(await readFile(f.file)) !== f.sha256) throw Error("H4_CODE_OR_INPUT_CHANGED"); };
const signal = AbortSignal.timeout(1800000), input = { ...JSON.parse(await readFile(inputPath, "utf8")), signal, ffmpeg: { ffmpegPath, ffprobePath } };
const archive = JSON.parse(await readFile(archivePath, "utf8"));
const overlay = archive.h3.corners.find((c: { corner: string; status: string }) => c.corner === "TOP_RIGHT" && c.status === "FROZEN")?.overlay;
const preview = await openHybridPreviewInput(overlay, input), render = await renderHybridPreview(preview, directory);
console.log(JSON.stringify({ stage: "RENDERED", technical: render.technical }));
const packet = await buildHybridPreviewPacket(preview, render);
await verifyFreeze(); await packet.verifyFresh();
await writeFile(path.join(directory, "packet.json"), JSON.stringify({ ...packet.manifest, packetDigest: packet.packetDigest }, null, 2), { flag: "wx", mode: 0o600 });
if (mode === "--live") {
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
    }
    await writeFile(path.join(directory, "capability.json"), JSON.stringify({ model: probe?.route.model ?? null, status: probe?.route.imageCapability ?? "UNAVAILABLE",
      modelRequests: probe?.modelRequests ?? 0, imageSha256: probe?.imageSha256 ?? null }, null, 2), { flag: "wx", mode: 0o600 });
    await verifyFreeze();
    const result = await reviewHybridPreview(packet, createHybridVisionRoutes(connections, probe?.route), signal);
    await verifyFreeze(); await packet.verifyFresh();
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ technical: render.technical, packetDigest: packet.packetDigest, ...result }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ stage: "QA", ...result }));
  } finally { await connections.dispose(); }
}
