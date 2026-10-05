import { expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { discoveryHash as hash } from "../src/main/source-fact-discovery-evidence.js";
import { encodeShapeCoverPng, decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";
import { decodeSourceMask, projectSourceMask } from "../src/main/shape-cover-pixel-gate.js";
import { openHybridPreviewInput, renderHybridPreview, buildHybridPreviewPacket, reviewHybridPreview } from "../src/main/shape-cover-hybrid-preview.js";
import type { VisionRoute, VisionRole } from "../src/main/shape-cover-vision-router.js";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin.js";

it("archived geometry renders exact PNG for the full clock, preserves audio, binds pairs and rejects tamper/clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "h4-preview-")), signal = AbortSignal.timeout(90000), ffmpeg = { ffmpegPath: ffmpegBin, ffprobePath: ffprobeBin };
  try {
    const sourcePath = join(root, "source.mp4");
    const result = spawnSync(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x160:r=6:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-video_track_timescale", "6000", "-n", sourcePath], { timeout: 20000 });
    expect(result.status, result.stderr.toString()).toBe(0);
    const source = await identifySource(sourcePath, { width: 160, height: 160, rotation: 0, durationMs: 2000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    const maskBytes = Buffer.alloc(13, 255); maskBytes[12] = 15;
    const mask = { bbox: { x: 140, y: 0, width: 10, height: 10 }, encoding: "bitpack-lsb-row-major-v1" as const, dataBase64: maskBytes.toString("base64"), sha256: hash(maskBytes), markedPixels: 100 };
    const projection = { width: 160, height: 160, scaledWidth: 160, scaledHeight: 160, padLeft: 0, padTop: 0 };
    const projected = projectSourceMask(decodeSourceMask({ ...mask, kind: "static-binary-v1" }, source)!, source, projection)!;
    const rgba = Buffer.alloc(160 * 160 * 4); for (let i = 0; i < projected.length; i++) if (projected[i]) rgba.set([255, 0, 0, 255], i * 4);
    const png = await encodeShapeCoverPng(rgba, source, ffmpeg), pngPath = join(root, "frozen.png"); await writeFile(pngPath, png);
    const body = { version: "HybridCornerFrozenOverlay/v1", verification: "geometry-only", contentSafety: "NOT_EVALUATED", authority: "none", productState: "PRODUCT_DISABLED",
      source, settings: { resolutionMode: "source", frameRateMode: "source", quality: "balanced" },
      mask,
      motion: { status: "STATIC_SUPPORTED", samples: [0, 2, 4, 7, 9, 11].map(index => ({ index, stationaryMatch: 1 })) },
      range: { startFrame: 0, endFrame: 12, startMs: 0, endMs: 2000 }, projection,
      semanticTarget: { candidateIds: ["fixture_logo"] }, maskConfirmation: { sourceBoxes: [{ x: 140, y: 0, width: 10, height: 10 }] },
      coverage: { oldPixels: projected.reduce((n, p) => n + p, 0), uncoveredPixels: 0, coverageFraction: 1 }, rgbaSha256: hash(rgba), finalAlphaSha256: hash(Uint8Array.from({ length: 25600 }, (_, i) => rgba[i * 4 + 3])), pngSha256: hash(png) };
    const archive = { ...body, bindingDigest: hash(JSON.stringify(body)), pngPath }, input = { sourcePath, source, ffmpeg, signal };
    await expect(openHybridPreviewInput({ ...archive, range: { ...archive.range, endMs: 1 } }, input)).rejects.toThrow("H4_ARCHIVE_BINDING");
    const preview = await openHybridPreviewInput(archive, input);
    await expect(renderHybridPreview({ ...preview }, root)).rejects.toThrow("H4_PREVIEW_INPUT_BINDING");
    const render = await renderHybridPreview(preview, root);
    expect(render.technical).toMatchObject({ frames: 12, uncoveredPixels: 0, durationMs: 2000, clock: "PASS", fullDecode: "PASS", productState: "PRODUCT_DISABLED" });
    expect(render.technical.audioPacketHash).toMatch(/SHA256=/);
    const packet = await buildHybridPreviewPacket(preview, render);
    expect(packet.manifest.images).toHaveLength(12); expect(packet.manifest.images.at(-1)?.ordinal).toBe(11);
    for (const ordinal of [0, 11]) {
      const covered = await decodeShapeCoverPng(await readFile(join(render.operation, `frame-${ordinal}-COVERED.png`)), source, ffmpeg);
      const p = (4 * 160 + 144) * 4;
      expect(covered[p]).toBeGreaterThan(220); expect(covered[p + 2]).toBeLessThan(30);
      expect(covered[(80 * 160 + 80) * 4 + 2]).toBeGreaterThan(220);
    }
    expect(packet.manifest.reviewScope).toContain("frozen H3");
    expect(packet.manifest.candidates[0]).not.toHaveProperty("signals");
    const calls: string[] = [], route = (role: VisionRole, failed = false): VisionRoute => ({ provider: "fixture", model: role === "SOL" ? "gpt-6.1-sol" : role,
      imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: async () => {
        calls.push(role); return JSON.stringify({ packetDigest: packet.packetDigest, oldOverlayResidual: "PASS", unintendedOcclusion: "PASS", unnaturalPlacement: failed ? "UNKNOWN" : "PASS", temporalMismatch: "PASS", riskFlags: [], shortReason: "controlled fixture" });
      } });
    const routes = { LUNA: route("LUNA"), SOL: route("SOL"), MINIMAX: route("MINIMAX") };
    expect((await reviewHybridPreview(packet, routes, signal)).verdict).toBe("PASS"); expect(calls).toEqual(["MINIMAX"]);
    calls.length = 0; expect((await reviewHybridPreview(packet, { ...routes, MINIMAX: route("MINIMAX", true) }, signal)).verdict).toBe("PASS"); expect(calls).toEqual(["MINIMAX", "SOL"]);
    const alternate = { ...routes.SOL, model: "gpt-5.6-sol", complete: vi.fn(routes.SOL.complete) };
    const second = await reviewHybridPreview(packet, { ...routes, MINIMAX: route("MINIMAX", true), SOL: alternate }, signal);
    expect(second.verdict).toBe("PASS"); expect(alternate.complete).toHaveBeenCalledOnce(); expect(second.receipts.at(-1)).toMatchObject({ model: "gpt-5.6-sol", status: "PARSED" });
    const failed = await reviewHybridPreview(packet, { ...routes, MINIMAX: { ...routes.MINIMAX, complete: async () => { throw Error("transport"); } } }, signal);
    expect(failed.verdict).toBe("UNSAFE"); expect(failed.requestCounts).toMatchObject({ MINIMAX: 1, SOL: 0 });
    const invalid = await reviewHybridPreview(packet, { ...routes, MINIMAX: { ...routes.MINIMAX, complete: async () => "{}" }, SOL: alternate }, signal);
    expect(invalid.verdict).toBe("PASS"); expect(invalid.receipts.map(r => [r.role, r.status])).toEqual([["MINIMAX", "FAILED"], ["SOL", "PARSED"]]);
    expect(invalid.requestCounts).toEqual({ LUNA: 0, MINIMAX: 1, SOL: 1 });
    expect(invalid.result?.sol).toMatchObject({ oldOverlayResidual: "PASS" });
    await appendFile(render.technical.previewPath, Buffer.from([1])); await expect(packet.verifyFresh()).rejects.toThrow("H4_PREVIEW_CHANGED");
    await appendFile(pngPath, Buffer.from([1])); await expect(preview.verifyFresh()).rejects.toThrow(/fingerprint/);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90000);
