import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverBinary, runCommand } from "../src/main/ffmpeg";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, createDefaultTemplate, type MediaItem } from "../src/main/domain";

it.each(["static", "motion", "edge", "artwork", "legacy"])("keeps the entire fractional cover rectangle opaque in %s rendering", async (mode) => {
  const binary = await discoverBinary("ffmpeg");
  if (!binary) throw new Error("FFmpeg is required for cover accuracy verification");
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-accuracy-"));
  try {
    const sourcePath = path.join(directory, "source.mp4"), assetPath = path.join(directory, "sticker.png");
    const rgba = Buffer.alloc(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const index = (y * 64 + x) * 4;
      rgba[index + 2] = 255;
      if (mode === "artwork" && (y < 8 || y >= 56)) {
        rgba[index + 1] = 255; rgba[index + 2] = 0; rgba[index + 3] = 255;
        continue;
      }
      rgba[index + 3] = x >= 16 && x < 48 && y >= 16 && y < 48 ? 128 : 0;
    }
    await writeFile(path.join(directory, "sticker.rgba"), rgba);
    for (const args of [
      ["-f", "lavfi", "-i", "color=c=red:s=160x90:r=24:d=0.5", "-c:v", "libx264", "-crf", "0", sourcePath],
      ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "64x64", "-i", path.join(directory, "sticker.rgba"), "-frames:v", "1", assetPath],
    ]) {
      const result = await runCommand(binary, ["-v", "error", ...args]).promise;
      expect(result.code, result.stderr).toBe(0);
    }
    const rectangle = mode === "artwork" ? { x: 0.1, y: 0.1, width: 0.7, height: 0.7 } : mode === "edge" ? { x: 137.9 / 160, y: 78.9 / 90, width: 22.1 / 160, height: 11.1 / 90 } : { x: 37.9 / 160, y: 21.9 / 90, width: 30.2 / 160, height: 20.2 / 90 };
    const template = createDefaultTemplate();
    template.layers = [{ id: crypto.randomUUID(), type: "sticker", assetPath, assetFingerprint: "fixture", x: rectangle.x, y: rectangle.y, width: rectangle.width, rotationDeg: 0, opacity: 1, visible: true, zIndex: 1,
      cover: { stickerId: `uploaded-${"a".repeat(64)}`, height: rectangle.height, ...(mode !== "legacy" ? { opaqueBackground: true } : {}),
        ...(mode === "motion" ? { motion: { startMs: 0, endMs: 500, keyframes: [{ timeMs: 0, rectangle }, { timeMs: 250, rectangle: { ...rectangle, x: 39.9 / 160 } }] } } : {}),
      },
    }];
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", fingerprint: "fixture", sizeBytes: 1, width: 160, height: 90, durationMs: 500, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: binary, fontResolver: { resolve: async () => null }, textFilePath: () => path.join(directory, "graph.txt") });
    await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content)));
    const output = path.join(directory, "output.mp4");
    const result = await runCommand(binary, [...compiled.args, output]).promise;
    expect(result.code, result.stderr).toBe(0);
    const raw = path.join(directory, "output.rgb");
    const decoded = await runCommand(binary, ["-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]).promise;
    expect(decoded.code, decoded.stderr).toBe(0);
    const pixels = await readFile(raw);
    expect(pixels.length).toBe(12 * 160 * 90 * 3);
    for (let frame = 0; frame < 12; frame++) {
      let red = 0;
      const green = [0, 0];
      const left = rectangle.x * 160 + (mode === "motion" ? 2 * Math.min(1, frame / 6) : 0);
      for (let y = Math.ceil(rectangle.y * 90); y < Math.min(90, Math.ceil((rectangle.y + rectangle.height) * 90)); y++) for (let x = Math.ceil(left); x < Math.min(160, Math.ceil(left + rectangle.width * 160)); x++) {
        const i = (frame * 160 * 90 + y * 160 + x) * 3;
        if (pixels[i + 1] > pixels[i] + 70 && pixels[i + 1] > pixels[i + 2] + 70) green[y < (rectangle.y + rectangle.height / 2) * 90 ? 0 : 1]++;
        if (pixels[i] > pixels[i + 1] + 70 && pixels[i] > pixels[i + 2] + 70) red++;
      }
      if (mode === "artwork") for (const count of green) expect(count, "top and bottom artwork edges survive fitting").toBeGreaterThan(100);
      if (mode === "legacy") expect(red).toBeGreaterThan(100);
      else expect(red, `visible source pixels at frame ${frame}`).toBe(0);
      const center = (frame * 160 * 90 + Math.floor((rectangle.y + rectangle.height / 2) * 90) * 160 + Math.floor(left + rectangle.width * 80)) * 3;
      if (mode !== "legacy") expect(pixels[center + 2]).toBeGreaterThan(pixels[center] + 50);
      const outside = (frame * 160 * 90 + 5 * 160 + 5) * 3;
      expect(pixels[outside]).toBeGreaterThan(pixels[outside + 1] + 150);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
