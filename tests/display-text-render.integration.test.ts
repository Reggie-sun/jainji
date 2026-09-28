import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import type { StickerAssets } from "../src/main/builtin-stickers";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";

it("renders the frozen moved text and omits disabled text while preserving duration and audio", { timeout: 60_000 }, async context => {
  const font = await resolveFont(DEFAULT_TEXT_FONT_FAMILY);
  if (!font) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-display-text-render-"));
  try {
    const sourcePath = path.join(directory, "source.mp4");
    const generated = await runCommand(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "color=black:s=320x180:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-threads", "1", sourcePath]).promise;
    expect(generated.code, generated.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", width: 320, height: 180, durationMs: 1000, rotation: 0, fingerprint: "fixture", sizeBytes: 1, probeStatus: "ready", importedAt: new Date().toISOString() };
    for (const enabled of [true, false]) {
      const template = materializePlan({ summary: "包装", captions: [], filter: "cool", intensity: 0.3 }, "clean", media, {} as StickerAssets, { sticker: "none", productPrice: "手动价格\n第二行", displayText: { enabled, x: 0.65, y: 0.55 } });
      const compiled = await new TemplateCompiler().compile(JSON.parse(JSON.stringify(template)), media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: ffmpegBin, fontResolver: { resolve: async () => font }, textFilePath: id => path.join(directory, `${id}.txt`), threads: 1 });
      for (const file of compiled.textFiles) await writeFile(file.path, file.content);
      const output = path.join(directory, `${enabled}.mp4`);
      const rendered = await runCommand(ffmpegBin, [...compiled.args, output]).promise;
      expect(rendered.code, rendered.stderr).toBe(0);
      const probe = await new FfmpegAdapter(ffmpegBin, ffprobeBin).probe(output);
      expect(probe.streams?.some(stream => stream.codec_type === "audio")).toBe(true);
      expect(Number(probe.format?.duration)).toBeCloseTo(1, 1);
      const pixelsPath = path.join(directory, `${enabled}.rgb`);
      const decoded = await runCommand(ffmpegBin, ["-v", "error", "-i", output, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", pixelsPath]).promise;
      expect(decoded.code, decoded.stderr).toBe(0);
      const pixels = await readFile(pixelsPath);
      const rows: number[] = [];
      for (let pixel = 0; pixel < 320 * 180; pixel++) if (Math.max(pixels[pixel * 3], pixels[pixel * 3 + 1], pixels[pixel * 3 + 2]) > 100) rows.push(Math.floor(pixel / 320));
      if (enabled) {
        expect(rows.length).toBeGreaterThan(100);
        expect(Math.min(...rows)).toBeGreaterThan(90);
        expect(Math.max(...rows)).toBeLessThan(179);
        expect(compiled.textFiles.map(file => file.content)).toEqual(["手动价格", "第二行"]);
      } else {
        expect(rows).toEqual([]);
        expect(compiled.textFiles).toEqual([]);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
