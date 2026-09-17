import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DecorationSchema } from "../src/shared/decorations";

it.for(["manual", "agent"] as const)("renders %s stickers and only a local center price with real FFmpeg", { timeout: 60_000 }, async (mode, context) => {
  const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-corners-"));
  const sourcePath = path.join(directory, "source.mp4");
  const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=720x1280:r=24:d=0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]).promise;
  expect(source.code, source.stderr).toBe(0);
  const assets = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
  const template = mode === "manual"
    ? materializePlan({ summary: "fixture", captions: [], filter: "warm", intensity: 0.4 }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ productPrice: "19.90", corners: {
      "top-left": { type: "sticker", sticker: "heart" },
      "top-right": { type: "sticker", sticker: "arrow" },
      "bottom-left": { type: "none" },
      "bottom-right": { type: "sticker", sticker: "burst" },
    } }))
    : materializePlan({ summary: "按需装饰", captions: [], priceStyle: "classic", stickers: [
      { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
      { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
      { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
      { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
    ], filter: "warm", intensity: 0.4 }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ mode: "agent", productPrice: "19.90" }), { fonts: [DEFAULT_TEXT_FONT_FAMILY], stickers: [{ id: "heart", label: "爱心" }] });
  expect(template.layers.filter((layer) => layer.type === "text")).toEqual([expect.objectContaining({ content: "¥ 19.90", textAlign: "center" })]);
  expect(template.layers.filter((layer) => layer.type === "sticker")).toHaveLength(mode === "manual" ? 3 : 4);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 250, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath, fontResolver: { resolve: resolveFont }, textFilePath: (id) => path.join(directory, `${id}.txt`) });
  expect(compiled.textFiles.map((entry) => entry.content)).toEqual(["¥ 19.90"]);
  await Promise.all(compiled.textFiles.map((entry) => writeFile(entry.path, entry.content)));
  const output = path.join(directory, "corners.mp4");
  const rendered = await runCommand(compiled.binary, [...compiled.args, output]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const probe = await new FfmpegAdapter(ffmpegPath, ffprobePath).probe(output);
  expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 720, height: 1280 });
});
