import { createHash, randomUUID } from "node:crypto";
import { assertOwnedReviewEvidence, type FullCanvasReviewEvidence } from "./source-fact-review-evidence.js";
import { encodeShapeCoverPng, decodeShapeCoverPng, type ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { fingerprintFile } from "./paths.js";
import { aiDigest, freezeAI } from "./source-fact-ai-contract.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const AI_INPUT_LIMITS = Object.freeze({ packetFrames: 8, totalPngBytes: 256 * 1024 ** 2, framePngBytes: 16 * 1024 ** 2 });
const owned = new WeakSet<object>();
export type AIInput = Awaited<ReturnType<typeof prepareAIInput>>;
export function assertOwnedAIInput(input: AIInput) {
  if (!owned.has(input)) throw Error("INCOMPLETE: AI input not owned or closed");
}

/** Whole original canvases only. Reuses PNG codec utilities, never placement or renderer logic. */
export async function prepareAIInput(evidence: FullCanvasReviewEvidence, fixtureId: string, tools: ShapeCoverMediaTools) {
  assertOwnedReviewEvidence(evidence);
  if (!/^[a-f0-9-]{36}$/.test(fixtureId)) throw Error("INCOMPLETE: anonymous fixture identity");
  const stableTools = { ...tools }, census = evidence.census;
  const check = async () => {
    assertOwnedReviewEvidence(evidence); stableTools.signal?.throwIfAborted();
    if (await fingerprintFile(stableTools.ffmpegPath) !== census.decode.ffmpegFingerprint
      || await fingerprintFile(stableTools.ffprobePath) !== census.decode.ffprobeFingerprint) throw Error("INCOMPLETE: PNG engine differs from D1");
  };
  await check();
  const frames = [], bytes: Buffer[] = []; let total = 0;
  for (const frame of census.frames) {
    const raw = await evidence.readFrame(frame.index);
    const png = await encodeShapeCoverPng(raw, census.source, stableTools);
    total += png.length;
    if (total > AI_INPUT_LIMITS.totalPngBytes || png.length > AI_INPUT_LIMITS.framePngBytes || png.length < 33
      || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.readUInt32BE(16) !== census.source.width
      || png.readUInt32BE(20) !== census.source.height) throw Error("INCOMPLETE: PNG dimensions or byte budget");
    const decoded = await decodeShapeCoverPng(png, census.source, stableTools);
    if (!raw.equals(decoded) || sha(raw) !== frame.pixelSha256 || raw.length !== frame.byteLength) throw Error("INCOMPLETE: PNG/RGBA roundtrip binding");
    bytes.push(Buffer.from(png));
    frames.push({ ordinal: frame.index, pts: frame.pts, endPts: frame.endPts, pixelSha256: frame.pixelSha256, byteLength: frame.byteLength,
      pngSha256: sha(png), pngByteLength: png.length, width: census.source.width, height: census.source.height });
  }
  await evidence.verifyFresh(); await check();
  const packets = [];
  for (let i = 0; i < frames.length; i += AI_INPUT_LIMITS.packetFrames) packets.push({ packetIndex: packets.length, frames: frames.slice(i, i + AI_INPUT_LIMITS.packetFrames) });
  const body = { inputId: randomUUID(), fixtureId, evidenceId: evidence.id, source: census.source, censusDigest: census.censusDigest,
    presentation: "ai-full-canvas-lossless-image/v1", packets };
  const manifest = freezeAI({ ...body, inputPlanDigest: aiDigest(body) });
  const getPacket = async (index: number) => {
    assertOwnedAIInput(input); assertOwnedReviewEvidence(evidence); stableTools.signal?.throwIfAborted();
    const packet = manifest.packets[index]; if (!packet || !Number.isInteger(index)) throw Error("INCOMPLETE: packet index");
    for (const frame of packet.frames) if (sha(await evidence.readFrame(frame.ordinal)) !== frame.pixelSha256) throw Error("INCOMPLETE: evidence changed");
    return { ...packet, images: packet.frames.map(f => Buffer.from(bytes[f.ordinal])) };
  };
  const verifyFresh = async () => { assertOwnedAIInput(input); await evidence.verifyFresh(); await check(); };
  const close = () => { owned.delete(input); bytes.length = 0; };
  const input = Object.freeze({ manifest, getPacket, verifyFresh, close }); owned.add(input);
  return input;
}
