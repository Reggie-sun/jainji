import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PRICE_STYLES } from "../src/shared/price-styles";
import { materializePlan } from "../src/main/agent-provider";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ArtifactVerifier } from "../src/main/artifact";

it("renders every price style with distinct pixels, preserving landscape and portrait video/audio", { timeout: 60_000 }, async (context) => {
  const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-price-styles-"));
  const assets = await ensureBuiltinStickerAssets(path.join(directory, "assets"));
  const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath);
  for (const [width, height] of [[360, 640], [640, 360]]) {
    const sourcePath = path.join(directory, `source-${width}.mp4`);
    const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", `color=c=0x809080:s=${width}x${height}:r=24:d=0.5`, "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]).promise;
    expect(source.code, source.stderr).toBe(0);
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "fixture", fingerprint: "fixture", sizeBytes: 1, durationMs: 500, width, height, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const hashes = new Set<string>();
    for (const style of PRICE_STYLES) {
      const template = materializePlan({ summary: "花字", captions: [], filter: "warm", intensity: 0.4 }, "black-gold", media, assets, { productPrice: "19.9元30贴", priceStyle: style.id, sticker: "none" });
      const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source", frameRateMode: "source" }, { ffmpegPath, fontResolver: { resolve: async () => font }, textFilePath: (id) => path.join(directory, `${id}.txt`), threads: 1 });
      await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content)));
      const output = path.join(directory, `${width}-${style.id}.mp4`);
      const result = await runCommand(ffmpegPath, [...compiled.args, output]).promise;
      expect(result.code, `${style.id}: ${result.stderr}`).toBe(0);
      await new ArtifactVerifier(adapter).verify(output, crypto.randomUUID());
      const probe = await adapter.probe(output);
      expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width, height, r_frame_rate: "24/1" });
      expect(probe.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
      expect(Number(probe.format?.duration)).toBeCloseTo(0.5, 1);
      const frame = await runCommand(ffmpegPath, ["-v", "error", "-i", output, "-map", "0:v:0", "-frames:v", "1", "-f", "md5", "-"]).promise;
      expect(frame.code, frame.stderr).toBe(0);
      hashes.add(frame.stdout.trim());
    }
    expect(hashes.size).toBe(PRICE_STYLES.length);
  }
});
