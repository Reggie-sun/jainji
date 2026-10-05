import { expect, it } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmHybridCornerTargets, getConfirmedCornerTargets } from "../src/main/shape-cover-vision-corner-semantic.js";
import { ShapeCoverVisionSession, type VisionRole, type VisionRoute } from "../src/main/shape-cover-vision-router.js";

it("actual M1 full-frame discovery feeds four independent original-image packets and skips central/UNKNOWN proposals", async () => {
  const root = await mkdtemp(join(tmpdir(), "jianji-h2c-")), width = 160, height = 160, frames = 12;
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const signal = new AbortController().signal, tools = { ...ffmpeg, signal };
  const raw = Buffer.alloc(width * height * 3 * frames), boxes = [[8, 8], [130, 8], [8, 130], [130, 130], [75, 75]];
  for (let f = 0; f < frames; f++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const stable = boxes.some(([bx, by]) => x >= bx && x < bx + 12 && y >= by && y < by + 12);
    const v = stable ? ((x + y) % 3 ? 240 : 20) : (f * 103 + x * 13 + y * 11) % 230 + 10;
    const offset = ((f * height + y) * width + x) * 3; raw.fill(v, offset, offset + 3);
  }
  const sourcePath = join(root, "private-source.mp4");
  let evidence: Awaited<ReturnType<typeof prepareDiscoveryEvidence>> | undefined;
  try {
    const encoded = spawnSync(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "6", "-i", "pipe:0",
      "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { input: raw, timeout: 20000 });
    expect(encoded.status).toBe(0);
    const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 2000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    evidence = await prepareDiscoveryEvidence({ sourcePath, source, ffmpeg, signal }, { frames: 12 });
    const m1 = await discoverStationaryTargets(evidence, signal); expect(m1.components.filter(c => c.state === "CANDIDATE")).toHaveLength(5);
    const routes = Object.fromEntries((["LUNA", "SOL", "MINIMAX"] as VisionRole[]).map(role => [role, {
      provider: "fixture", model: role, imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: async messages => {
        const content = messages[1].content as { type: string; text?: string }[], p = JSON.parse(content[0].text!), ctx = JSON.parse(content.at(-1)!.text!);
        expect(content.filter(c => c.type === "image_url")).toHaveLength(6); expect(JSON.stringify(messages)).not.toContain(sourcePath);
        const candidateIds = p.candidates.map((c: { candidateId: string }) => c.candidateId), rejected = ctx.corner === "BOTTOM_LEFT";
        return JSON.stringify({ packetDigest: p.packetDigest, corner: ctx.corner, decisions: candidateIds.map((candidateId: string) => ({ candidateId,
          decision: rejected ? "REJECT" : "CONFIRM", class: rejected ? "SUBTITLE" : "OVERLAY_LOGO", temporalState: "STABLE", riskFlags: [], shortReason: "fixture observation" })),
          groups: rejected ? [] : [{ candidateIds, sameLogicalOverlay: true }], undetectedCornerOverlaySuspected: false });
      },
    } satisfies VisionRoute])) as unknown as Record<VisionRole, VisionRoute>;
    const r = await confirmHybridCornerTargets(evidence, tools, new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes, 180000, "CORNER"), signal);
    expect(r.status).toBe("CORNER_SEMANTIC_READY"); expect(r.outOfScopeCandidateIds).toHaveLength(1); expect(r.corners.BOTTOM_LEFT.status).toBe("NO_OVERLAY");
    expect(await getConfirmedCornerTargets(r)).toHaveLength(3); expect(r.requestCounts).toEqual({ LUNA: 4, SOL: 0, MINIMAX: 0 });
    expect(r.receipts.every(p => p.contextDigest && p.corner && p.imageHashes.length === 6)).toBe(true);
    await appendFile(sourcePath, Buffer.from([1])); await expect(getConfirmedCornerTargets(r)).rejects.toThrow(/generation/);
  } finally { await evidence?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
