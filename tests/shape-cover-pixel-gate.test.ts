import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { SourcePixelMask } from "../src/shared/source-sticker-knowledge";
import { checkOutputFrameCoverage, decodeSourceMask, evaluateShapeCover, growOpaqueContour, projectSourceMask } from "../src/main/shape-cover-pixel-gate";

const bytes = Buffer.from([255, 1]);
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const mask: SourcePixelMask = {
  kind: "static-binary-v1", bbox: { x: 1, y: 1, width: 3, height: 3 }, encoding: "bitpack-lsb-row-major-v1",
  dataBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), markedPixels: 9,
  creation: { method: "temporal-stability", version: 1 }, review: { method: "contact-sheet", version: 1, reviewer: "codex", at: "2026-09-24T00:00:00Z" },
  evidenceIds: ["first", "last"],
};

describe("shape cover final pixel gate", () => {
  it("decodes only intact, bounded source pixels", () => {
    const decoded = decodeSourceMask(mask, { width: 5, height: 5 });
    expect(decoded?.reduce((total, bit) => total + bit, 0)).toBe(9);
    expect(decoded?.[1 * 5 + 1]).toBe(1);
    expect(decodeSourceMask({ ...mask, sha256: "0".repeat(64) }, { width: 5, height: 5 })).toBeNull();
    expect(decodeSourceMask({ ...mask, dataBase64: Buffer.from([255, 255]).toString("base64") }, { width: 5, height: 5 })).toBeNull();
    expect(decodeSourceMask({ ...mask, bbox: { ...mask.bbox, x: 4 } }, { width: 5, height: 5 })).toBeNull();
  });

  it("projects all source pixels through odd padding and adds output safety pixels", () => {
    const source = new Uint8Array(9); source[4] = 1;
    const final = projectSourceMask(source, { width: 3, height: 3 }, { width: 8, height: 8, scaledWidth: 3, scaledHeight: 3, padLeft: 1, padTop: 1 })!;
    expect(final[2 * 8 + 2]).toBe(1);
    expect(final[3 * 8 + 3]).toBe(1);
    expect(final[4 * 8 + 4]).toBe(0);
    expect(final.reduce((total, bit) => total + bit, 0)).toBe(9);
    const upscaled = new Uint8Array(100); upscaled[5 * 10 + 5] = 1;
    const support = projectSourceMask(upscaled, { width: 10, height: 10 }, { width: 15, height: 15, scaledWidth: 15, scaledHeight: 15, padLeft: 0, padTop: 0 })!;
    expect(support[10 * 15 + 10]).toBe(1);
  });

  it("requires fully opaque pixels, finite expansion, and exact coverage", () => {
    const size = { width: 32, height: 32 };
    const old = new Uint8Array(1024), alpha = new Uint8Array(1024);
    for (let y = 8; y < 22; y += 1) for (let x = 8; x < 22; x += 1) alpha[y * 32 + x] = 255;
    old[15 * 32 + 22] = 1;
    alpha[15 * 32 + 22] = 1;
    const passing = evaluateShapeCover(old, alpha, size, 1);
    expect(passing).toMatchObject({ status: "PASS", radiusPx: 1, uncoveredPixels: 0 });
    expect(growOpaqueContour(alpha, size, 1)?.[15 * 32 + 22]).toBe(1);
    const tiny = new Uint8Array(1024); tiny[15 * 32 + 15] = 255;
    expect(evaluateShapeCover(old, tiny, size, 1)).toMatchObject({ status: "UNSAFE", reason: "no-shape-match" });
    expect(evaluateShapeCover(old, alpha.subarray(1), size, 1)).toMatchObject({ status: "UNSAFE", reason: "invalid-raster" });
  });

  it("checks real output timestamps including VFR gaps and half-open ends", () => {
    const frames = [0, 33.333, 66.667, 120, 180];
    const sourceSegments = [{ startMs: 0, endMs: 181 }];
    expect(checkOutputFrameCoverage(frames, sourceSegments, [{ startMs: 0, endMs: 181 }])).toEqual({ status: "PASS" });
    expect(checkOutputFrameCoverage(frames, sourceSegments, [{ startMs: 0, endMs: 180 }])).toEqual({ status: "UNSAFE", frameIndex: 4 });
    expect(checkOutputFrameCoverage(frames, sourceSegments, [{ startMs: 0, endMs: 90 }, { startMs: 121, endMs: 181 }])).toEqual({ status: "UNSAFE", frameIndex: 3 });
    expect(checkOutputFrameCoverage([], sourceSegments, sourceSegments)).toEqual({ status: "UNSAFE" });
  });

  it.skipIf(!ffmpegAvailable)("contains FFmpeg bicubic spill at 1.5x and with odd padding", () => {
    for (const config of [
      { source: { width: 10, height: 10 }, output: { width: 15, height: 15, scaledWidth: 15, scaledHeight: 15, padLeft: 0, padTop: 0 }, positions: [[0, 0], [5, 5], [8, 8]] },
      { source: { width: 9, height: 7 }, output: { width: 17, height: 15, scaledWidth: 15, scaledHeight: 11, padLeft: 1, padTop: 2 }, positions: [[0, 0], [4, 3], [8, 6]] },
    ]) {
      const render = (input: Buffer) => {
        const { source, output } = config;
        const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${source.width}x${source.height}`, "-i", "pipe:0",
          "-vf", `scale=${output.scaledWidth}:${output.scaledHeight}:flags=bicubic,pad=${output.width}:${output.height}:${output.padLeft}:${output.padTop}:color=black,format=gray`,
          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { input });
        expect(result.status).toBe(0);
        return result.stdout;
      };
      const baseline = render(Buffer.alloc(config.source.width * config.source.height));
      for (const [x, y] of config.positions) {
        const input = Buffer.alloc(config.source.width * config.source.height); input[y * config.source.width + x] = 255;
        const actual = render(input), one = new Uint8Array(input.length); one[y * config.source.width + x] = 1;
        const projected = projectSourceMask(one, config.source, config.output)!;
        expect([...actual].some((pixel, index) => pixel !== baseline[index] && !projected[index])).toBe(false);
      }
    }
  });

  it.skipIf(!ffmpegAvailable)("uses post-rotation source coordinates before scaling and padding", () => {
    const render = (input: Buffer) => {
      const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "7x9", "-i", "pipe:0",
        "-vf", "transpose=clock,scale=15:11:flags=bicubic,pad=17:15:1:2:color=black,format=gray",
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { input });
      expect(result.status).toBe(0);
      return result.stdout;
    };
    const baseline = render(Buffer.alloc(63));
    for (const [x, y] of [[2, 5], [0, 0], [6, 8]]) {
      const input = Buffer.alloc(63); input[y * 7 + x] = 255;
      const actual = render(input), oriented = new Uint8Array(63); oriented[x * 9 + 8 - y] = 1;
      const projected = projectSourceMask(oriented, { width: 9, height: 7 }, { width: 17, height: 15, scaledWidth: 15, scaledHeight: 11, padLeft: 1, padTop: 2 })!;
      expect([...actual].some((pixel, index) => pixel !== baseline[index] && !projected[index])).toBe(false);
    }
  });
});
