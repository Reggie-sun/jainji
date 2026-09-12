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

it.for(["manual", "agent-mixed", "agent-empty"] as const)("renders %s corner choices with real FFmpeg", { timeout: 60_000 }, async (mode, context) => {
  const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-corners-"));
  const sourcePath = path.join(directory, "source.mp4");
  const source = await runCommand(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=720x1280:r=24:d=0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]).promise;
  expect(source.code, source.stderr).toBe(0);
  const assets = await ensureBuiltinStickerAssets(path.join(directory, "stickers"));
  const manualTemplate = materializePlan({ summary: "fixture", captions: [{ text: "自动文案", size: 0.026, corner: "top-left" }], filter: "warm", intensity: 0.4 }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ productPrice: "19.90", corners: {
    "top-left": { type: "text", text: "左上好物", fontFamily: DEFAULT_TEXT_FONT_FAMILY },
    "top-right": { type: "sticker", sticker: "heart" },
    "bottom-left": { type: "sticker", sticker: "arrow" },
    "bottom-right": { type: "text", text: "右下精选", fontFamily: DEFAULT_TEXT_FONT_FAMILY },
  } }));
  const template = mode === "manual" ? manualTemplate : materializePlan({
    summary: "按需装饰", filter: "warm", intensity: 0.4,
    captions: mode === "agent-empty" ? [] : [{ text: "自动好物", corner: "top-left", size: 0.026, fontFamily: DEFAULT_TEXT_FONT_FAMILY }],
    stickers: mode === "agent-empty" ? [] : [{ corner: "bottom-right", sticker: "heart" }],
  }, "black-gold", { width: 720, height: 1280 }, assets, DecorationSchema.parse({ mode: "agent", productPrice: "19.90" }), { fonts: [DEFAULT_TEXT_FONT_FAMILY], stickers: [{ id: "heart", label: "爱心" }] });
  expect(template.layers).toHaveLength(mode === "manual" ? 5 : mode === "agent-empty" ? 1 : 3);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 1, durationMs: 250, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath, fontResolver: { resolve: resolveFont }, textFilePath: (id) => path.join(directory, `${id}.txt`) });
  expect(compiled.textFiles.map((entry) => entry.content).sort()).toEqual((mode === "manual" ? ["右下精选", "左上好物", "¥ 19.90"] : mode === "agent-empty" ? ["¥ 19.90"] : ["自动好物", "¥ 19.90"]).sort());
  await Promise.all(compiled.textFiles.map((entry) => writeFile(entry.path, entry.content)));
  const output = path.join(directory, "corners.mp4");
  const rendered = await runCommand(compiled.binary, [...compiled.args, output]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const probe = await new FfmpegAdapter(ffmpegPath, ffprobePath).probe(output);
  expect(probe.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 720, height: 1280 });
});
