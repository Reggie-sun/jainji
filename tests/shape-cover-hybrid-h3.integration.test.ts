import { expect, it, vi } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { confirmHybridCornerTargets } from "../src/main/shape-cover-vision-corner-semantic.js";
import { ShapeCoverVisionSession, type VisionRole, type VisionRoute } from "../src/main/shape-cover-vision-router.js";
import { prepareHybridCornerOverlays, readHybridFrozenOverlay } from "../src/main/shape-cover-hybrid-h3.js";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers.js";
import * as extraction from "../src/main/source-mask-static-extraction.js";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin.js";

it.each([false, true])("fresh H2→original mask→motion→local artwork→opaque frozen PNG stays deterministic with aligned candidates=%s", async aligned => {
  const root = await mkdtemp(join(tmpdir(), "h3-corner-")), width = 160, height = 160, count = aligned ? 36 : 12;
  const ffmpeg = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin }, signal = AbortSignal.timeout(120000), tools = { ...ffmpeg, signal };
  const sourcePath = join(root, "source.mp4"), raw = Buffer.alloc(width * height * 3 * count), boxes = [[8, 8], [130, 8]];
  for (let f = 0; f < count; f++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const stable = boxes.some(([bx, by]) => x >= bx && x < bx + 12 && y >= by && y < by + 12);
    const v = stable ? ((x + y) % 3 ? 240 : 20) : (f * 103 + x * 13 + y * 11) % 230 + 10;
    const p = ((f * height + y) * width + x) * 3; raw.fill(v, p, p + 3);
  }
  const encoded = spawnSync(ffmpegBin, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "6", "-i", "pipe:0",
    "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { input: raw, timeout: 20000 });
  expect(encoded.status).toBe(0);
  let evidence: Awaited<ReturnType<typeof prepareDiscoveryEvidence>> | undefined;
  let candidateEvidence: typeof evidence;
  try {
    const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: count / 6 * 1000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    const input = { sourcePath, source, ffmpeg, signal }; evidence = await prepareDiscoveryEvidence(input, { frames: Math.min(24, count) });
    if (aligned) {
      candidateEvidence = await prepareDiscoveryEvidence(input);
      expect(candidateEvidence.receipt.frames.length).toBeGreaterThan(evidence.receipt.frames.length);
    }
    const route = (role: VisionRole): VisionRoute => ({ provider: "fixture", model: role === "LUNA" ? "gpt-6-luna" : role === "SOL" ? "gpt-6.1-sol" : "MiniMax-M3",
      imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: async messages => {
        const content = messages[1].content as { text: string }[], p = JSON.parse(content[0].text), context = JSON.parse(content.at(-1)!.text), candidateIds = p.candidates.map((c: { candidateId: string }) => c.candidateId);
        return JSON.stringify({ packetDigest: p.packetDigest, corner: context.corner, decisions: candidateIds.map((candidateId: string) => ({ candidateId,
          decision: "CONFIRM", class: "OVERLAY_LOGO", temporalState: "STABLE", riskFlags: [], shortReason: "controlled overlay" })),
          groups: [{ candidateIds, sameLogicalOverlay: true }], undetectedCornerOverlaySuspected: false });
      } });
    const routes = { LUNA: route("LUNA"), SOL: route("SOL"), MINIMAX: route("MINIMAX") };
    const semantic = await confirmHybridCornerTargets(evidence, tools, new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes, 180000, "CORNER"), signal, candidateEvidence);
    const assets = await ensureBuiltinStickerAssets(join(root, "stickers")), candidates = [{ id: "heart", asset: assets.heart }];
    const original = extraction.extractStaticConservativeMask;
    vi.spyOn(extraction, "extractStaticConservativeMask").mockImplementation(async (e, s) => {
      const r = await original(e, s);
      return e.target.receipt.targetEnvelopeBox.x < 80 ? { ...r, receipt: { ...r.receipt, mask: null } } : r;
    });
    const settings = { resolutionMode: "source" as const, frameRateMode: "source" as const, quality: "balanced" as const };
    const a = await prepareHybridCornerOverlays(input, evidence, semantic, candidates, settings, join(root, "a"), candidateEvidence);
    expect(a.sourceErrors).toEqual([]); expect(a.status).toBe("PARTIAL");
    expect(a.corners.find(c => c.corner === "TOP_LEFT")).toMatchObject({ status: "SKIPPED", reason: "MASK_UNAVAILABLE" });
    expect(a.corners.find(c => c.corner === "TOP_RIGHT")).toMatchObject({ status: "FROZEN", motion: { status: "STATIC_SUPPORTED" } });
    const frozenA = await readHybridFrozenOverlay(a, "TOP_RIGHT", tools);
    expect(frozenA.overlay.coverage).toMatchObject({ uncoveredPixels: 0, coverageFraction: 1 });
    expect(frozenA.overlay.contentSafety).toBe("NOT_EVALUATED"); expect(frozenA.overlay.productState).toBe("PRODUCT_DISABLED");
    const b = await prepareHybridCornerOverlays(input, evidence, semantic, candidates, settings, join(root, "b"), candidateEvidence);
    const frozenB = await readHybridFrozenOverlay(b, "TOP_RIGHT", tools);
    expect(frozenA.png.equals(frozenB.png)).toBe(true); expect(frozenA.overlay.bindingDigest).toBe(frozenB.overlay.bindingDigest);
    if (candidateEvidence) {
      await candidateEvidence.verifyFresh(); // H3 must not close the caller's live evidence.
      const wrongPopulation = await prepareHybridCornerOverlays(input, evidence, semantic, candidates, settings, join(root, "wrong"), evidence);
      expect(wrongPopulation).toMatchObject({ status: "BLOCKED", sourceErrors: ["DISCOVERY_SAMPLE_BINDING"] });
      const copied = await prepareHybridCornerOverlays(input, evidence, semantic, candidates, settings, join(root, "copied"), { ...candidateEvidence });
      expect(copied.status).toBe("BLOCKED"); expect(copied.corners).toEqual([]);
    }
    await expect(readHybridFrozenOverlay({ ...a }, "TOP_RIGHT", tools)).rejects.toThrow("HYBRID_H3_RESULT_BINDING");
    const cloneSemantic = { ...semantic };
    const cloned = await prepareHybridCornerOverlays(input, evidence, cloneSemantic, candidates, settings, join(root, "clone"), candidateEvidence);
    expect(cloned.status).toBe("BLOCKED"); expect(cloned.corners).toEqual([]);
    await appendFile(frozenA.overlay.pngPath, Buffer.from([1])); await expect(readHybridFrozenOverlay(a, "TOP_RIGHT", tools)).rejects.toThrow(/fingerprint/);
    await appendFile(sourcePath, Buffer.from([1])); await expect(b.verifyFresh()).rejects.toThrow(/generation/);
  } finally { vi.restoreAllMocks(); await candidateEvidence?.close(); await evidence?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
