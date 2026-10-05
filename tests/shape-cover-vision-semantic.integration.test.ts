import { expect, it } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { buildVisionCandidatePacket } from "../src/main/shape-cover-vision-packet.js";
import { confirmHybridSemanticTargets } from "../src/main/shape-cover-vision-semantic.js";
import { ShapeCoverVisionSession, type VisionRole, type VisionRoute } from "../src/main/shape-cover-vision-router.js";
import { HYBRID_GPT_MODELS } from "../src/main/shape-cover-vision-provider.js";

it.each(["four", "multi"] as const)("real M1 %s set flows through complete source-bound semantic owner, never mask or store", async kind => {
  const root = await mkdtemp(join(tmpdir(), "jianji-h2-integration-")), width = 120, height = 120, frames = 12;
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const signal = new AbortController().signal, tools = { ...ffmpeg, signal };
  const raw = Buffer.alloc(width * height * 3 * frames);
  const boxes = kind === "four" ? [[10, 10, 10, 10], [65, 10, 10, 10], [10, 50, 10, 10], [65, 50, 10, 10]] : [[60, 10, 16, 12], [65, 31, 6, 6]];
  for (let f = 0; f < frames; f++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const stable = y >= 90 || boxes.some(([bx, by, w, h]) => x >= bx && x < bx + w && y >= by && y < by + h);
    const v = stable ? ((x + y) % 3 ? 240 : 20) : (f * 103 + x * 13 + y * 11) % 230 + 10;
    const offset = ((f * height + y) * width + x) * 3; raw.fill(v, offset, offset + 3);
  }
  const sourcePath = join(root, "private-source.mp4");
  let evidence: Awaited<ReturnType<typeof prepareDiscoveryEvidence>> | undefined;
  try {
    const render = spawnSync(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "6", "-i", "pipe:0",
      "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { input: raw, timeout: 20000 });
    expect(render.status).toBe(0);
    const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 2000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    evidence = await prepareDiscoveryEvidence({ sourcePath, source, ffmpeg, signal }, { frames: 12 });
    const m1 = await discoverStationaryTargets(evidence, signal), ids = m1.components.filter(c => c.state === "CANDIDATE").map(c => c.id);
    expect(ids).toHaveLength(kind === "four" ? 4 : 2);
    const unknown = m1.components.find(c => c.state === "UNKNOWN")!; expect(unknown).toBeDefined();
    await expect(buildVisionCandidatePacket(evidence, [unknown.id], tools)).rejects.toThrow("VISION_CANDIDATE_MISMATCH");
    const routes = Object.fromEntries((["LUNA", "SOL", "MINIMAX"] as VisionRole[]).map(role => [role, {
      provider: "fixture", model: role === "LUNA" ? HYBRID_GPT_MODELS.LUNA : role === "SOL" ? HYBRID_GPT_MODELS.SOL : "MiniMax-M3",
      imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: async messages => {
        const content = messages[1].content as { type: string; text?: string }[];
        const p = JSON.parse(content[0].text!); expect(content.filter(c => c.type === "image_url").length).toBe(3 + 3 * p.candidates.length);
        expect(JSON.stringify(messages)).not.toContain(sourcePath);
        const candidateIds = p.candidates.map((c: { candidateId: string }) => c.candidateId);
        return JSON.stringify({ packetDigest: p.packetDigest, decisions: candidateIds.map((candidateId: string) => ({ candidateId, decision: "CONFIRM", class: "OVERLAY_STICKER",
          temporalState: "STABLE", riskFlags: [], shortReason: "fixture semantic response" })), groups: kind === "multi" ? [{ candidateIds, sameLogicalOverlay: true }] :
          candidateIds.map((id: string) => ({ candidateIds: [id], sameLogicalOverlay: true })), undetectedOverlaySuspected: false, crossBatchGroupingSuspected: false });
      },
    } satisfies VisionRoute])) as unknown as Record<VisionRole, VisionRoute>;
    const session = new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes);
    const result = await confirmHybridSemanticTargets(evidence, tools, session, signal);
    expect(result.status).toBe("SEMANTIC_CONFIRMED"); expect(result.allCandidateIds.slice().sort()).toEqual(ids.slice().sort());
    expect(result.confirmedGroups).toHaveLength(kind === "four" ? 4 : 1); expect(result.receipts.map(r => r.role)).toEqual(kind === "four" ? ["LUNA", "LUNA"] : ["LUNA", "SOL"]);
    await result.verifyFresh(); await appendFile(sourcePath, Buffer.from([1])); await expect(result.verifyFresh()).rejects.toThrow(/generation/);
  } finally { await evidence?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
