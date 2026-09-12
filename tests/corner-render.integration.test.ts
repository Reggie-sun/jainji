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

it("renders independent text and stickers in four corners with real FFmpeg", async (context) => {
  const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-corners-"));
  const sourcePath = path.join(directory, "source.mp4");
  const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=720x1280:r=24:d=0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]).promise;
  expect(source.code, source.stderr).toBe(0);
  const assets = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
  const template = materializePlan({ summary: "fixture", captions: [{ text: "自动文案", size: 0.026, corner: "top-left" }], filter: "warm", intensity: 0.4 }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ corners: {
    "top-left": { type: "text", text: "左上好物", fontFamily: DEFAULT_TEXT_FONT_FAMILY },
    "top-right": { type: "sticker", sticker: "heart" },
    "bottom-left": { type: "sticker", sticker: "arrow" },
    "bottom-right": { type: "text", text: "右下精选", fontFamily: DEFAULT_TEXT_FONT_FAMILY },
  } }));
  expect(template.layers).toHaveLength(4);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 250, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath, fontResolver: { resolve: resolveFont }, textFilePath: (id) => path.join(directory, `${id}.txt`) });
  expect(compiled.textFiles.map((entry) => entry.content).sort()).toEqual(["右下精选", "左上好物"].sort());
  await Promise.all(compiled.textFiles.map((entry) => writeFile(entry.path, entry.content)));
  const output = path.join(directory, "corners.mp4");
  const rendered = await runCommand(compiled.binary, [...compiled.args, output]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const probe = await new FfmpegAdapter(ffmpegPath, ffprobePath).probe(output);
  expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 720, height: 1280 });
}, 60_000);
