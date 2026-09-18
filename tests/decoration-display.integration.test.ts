import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { materializePlan } from "../src/main/agent-provider";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";

for (const { duration, mode, animated } of [{ duration: 4, mode: "first-3s", animated: false }, { duration: 1, mode: "first-3s", animated: false }, { duration: 4, mode: "full", animated: false }, { duration: 4, mode: "first-3s", animated: true }] as const) it(`renders ${mode} with ${animated ? "2fps GIF" : "PNG"} on a ${duration} second source with original content and audio intact`, { timeout: 60_000 }, async context => {
  const [ffmpeg, ffprobe, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpeg || !ffprobe || !font) { context.skip(); return; }
  const root = await mkdtemp(path.join(tmpdir(), "jianji-display-timing-"));
  const sourcePath = path.join(root, "source.mp4"), stickerPath = path.join(root, animated ? "sticker.gif" : "sticker.png");
  const run = async (args: string[]) => { const result = await runCommand(ffmpeg, ["-v", "error", "-y", ...args]).promise; expect(result.code, result.stderr).toBe(0); };
  await run(["-f", "lavfi", "-i", `color=c=black:s=320x240:r=10:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`, "-vf", "drawbox=x=140:y=180:w=40:h=30:color=yellow:t=fill", "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath]);
  await run(["-f", "lavfi", "-i", "color=c=blue:s=16x32:r=2:d=1", ...(animated ? ["-loop", "0"] : ["-frames:v", "1"]), stickerPath]);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "fixture", fingerprint: "fixture", sizeBytes: 1, durationMs: duration * 1000, width: 320, height: 240, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const asset = { assetPath: stickerPath, assetFingerprint: "fixture" };
  const template = materializePlan({ summary: "四角", captions: [], priceStyle: duration > 3 ? "label" : "classic", filter: "none", intensity: 0, stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) }, "clean", media, { heart: asset, sparkle: asset, arrow: asset, burst: asset }, { mode: "agent", productPrice: "9.9元", displayMode: mode }, { fonts: [], stickers: [{ id: "heart", label: "爱心" }] });
  const base = template.layers.find(layer => layer.type === "sticker")!;
  if (base.type !== "sticker") throw Error("missing sticker");
  const rectangle = { x: 0.4, y: 0.45, width: 0.1, height: 0.1 };
  template.layers.push({ ...base, opacity: 1, id: crypto.randomUUID(), x: rectangle.x, y: rectangle.y, width: rectangle.width, cover: { stickerId: "heart", regionId: crypto.randomUUID(), height: rectangle.height, opaqueBackground: true, motion: { startMs: 0, endMs: duration * 1000, keyframes: [{ timeMs: 0, rectangle }] } } });
  template.layers.push({ ...base, opacity: 1, id: crypto.randomUUID(), x: 0.7, y: 0.45, cover: { stickerId: "heart", regionId: crypto.randomUUID(), height: 0.1, opaqueBackground: true } });
  const options = { ffmpegPath: ffmpeg, fontResolver: { resolve: async () => font }, textFilePath: (id: string) => path.join(root, `${id}.txt`), threads: 1 };
  const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, options);
  await Promise.all(compiled.textFiles.map(file => writeFile(file.path, file.content)));
  const output = path.join(root, "output.mp4");
  const rendered = await runCommand(ffmpeg, [...compiled.args, output]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const probe = await new FfmpegAdapter(ffmpeg, ffprobe).probe(output);
  expect(Number(probe.format?.duration)).toBeCloseTo(duration, 1);
  expect(probe.streams?.some(stream => stream.codec_type === "audio")).toBe(true);
  const textStrengths: number[] = [];
  for (const frame of duration > 3 ? [24, 27, 29, 30, 39] : [0, 7, 9]) {
    const file = path.join(root, `${frame}.rgb`);
    await run(["-i", output, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", file]);
    const pixels = await readFile(file);
    const pixel = (x: number, y: number) => pixels.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3);
    const visible = frame < 30 || mode === "full";
    for (const [x, y] of [[10, 10], [308, 10], [10, 228], [308, 228], [144, 120], [236, 120]]) {
      const rgb = pixel(x, y);
      expect(rgb[2]).toBeGreaterThan(rgb[0] + 150);
    }
    let textPeak = 0;
    for (let y = 30; y < 75; y++) for (let x = 80; x < 240; x++) textPeak = Math.max(textPeak, ...pixel(x, y));
    expect(textPeak > 25).toBe(visible);
    textStrengths.push(textPeak);
    const original = pixel(160, 190);
    expect(original[0]).toBeGreaterThan(200); expect(original[1]).toBeGreaterThan(200); expect(original[2]).toBeLessThan(30);
  }
  if (mode === "first-3s") {
    // Text and its background blend separately, so their combined brightness is nonlinear.
    expect(textStrengths[0]).toBeGreaterThan(textStrengths[1] + 20);
    expect(textStrengths[1]).toBeGreaterThan(textStrengths[2] + 20);
  }
  expect(await new TemplateCompiler().compile(JSON.parse(JSON.stringify(template)), media, { ...DEFAULT_PRESET, resolutionMode: "source" }, options)).toEqual(compiled);
  console.info(`decoration timing evidence: ${output}`);
});
