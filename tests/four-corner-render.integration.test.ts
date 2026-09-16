import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentRunner } from "../src/main/agent-runner";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, DEFAULT_TEXT_FONT_FAMILY, type EditTemplate, type MediaItem } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { DecorationSchema } from "../src/shared/decorations";

it("renders frozen corner gap intervals, opaque source coverage, and unchanged other corners with audio", { timeout: 60_000 }, async context => {
  const [ffmpeg, ffprobe, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
  if (!ffmpeg || !ffprobe || !font) { context.skip(); return; }
  const root = await mkdtemp(path.join(tmpdir(), "jianji-four-corner-render-"));
  const sourcePath = path.join(root, "source.mp4"), normalPath = path.join(root, "normal.png"), coverPath = path.join(root, "cover.png");
  const run = async (args: string[]) => { const result = await runCommand(ffmpeg, ["-v", "error", "-y", ...args]).promise; expect(result.code, result.stderr).toBe(0); };
  await run(["-f", "lavfi", "-i", "color=c=black:s=320x240:r=10:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-vf", "drawbox=x=0:y=0:w=32:h=24:color=yellow:t=fill:enable='gte(t,0.2)*lt(t,0.6)'", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath]);
  await run(["-f", "lavfi", "-i", "color=c=blue:s=32x32", "-frames:v", "1", normalPath]);
  await run(["-f", "lavfi", "-i", "color=c=red:s=4x20", "-frames:v", "1", coverPath]);
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath, displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 320, height: 240, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const normal = { assetPath: normalPath, assetFingerprint: "normal" };
  const rectangle = { x: 0, y: 0, width: 0.1, height: 0.1 };
  let frozen!: EditTemplate;
  const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ summary: "四角", captions: [], priceStyle: "classic", filter: "none", intensity: 0,
    stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.12, rotationDeg: 0 })) }),
    stickerAssets: { heart: normal, sparkle: normal, arrow: normal, burst: normal }, autoCatalog: { fonts: [], stickers: [{ id: "heart", label: "爱心" }] },
    decorations: DecorationSchema.parse({ mode: "agent", productPrice: "用户内容" }), resolutionMode: "source",
    coverSticker: { stickerId: "sparkle", assetPath: coverPath, assetFingerprint: "cover", rectangle, automatic: true },
    detectCoverTracks: async () => [{ targetId: "original", track: { startMs: 200, endMs: 600, keyframes: [{ timeMs: 200, rectangle }] } }],
    enqueue: async template => { frozen = JSON.parse(JSON.stringify(template)); return crypto.randomUUID(); }, onChange: () => {} });
  runner.start("project", "clean", "", [media]); await runner.settled();
  expect(runner.snapshot()?.items[0].status).toBe("exporting");
  const compiler = new TemplateCompiler();
  const options = { ffmpegPath: ffmpeg, fontResolver: { resolve: async () => font }, textFilePath: (id: string) => path.join(root, `${id}.txt`), threads: 1 };
  const compiled = await compiler.compile(frozen, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, options);
  await Promise.all(compiled.textFiles.map(f => writeFile(f.path, f.content)));
  const output = path.join(root, "four-corners.mp4");
  const rendered = await runCommand(ffmpeg, [...compiled.args, output]).promise;
  expect(rendered.code, rendered.stderr).toBe(0);
  const probe = await new FfmpegAdapter(ffmpeg, ffprobe).probe(output);
  expect(probe.streams?.find(s => s.codec_type === "video")).toMatchObject({ width: 320, height: 240 });
  expect(probe.streams?.some(s => s.codec_type === "audio")).toBe(true);
  const pixels = async (frame: number, x: number, y: number) => {
    const file = path.join(root, `${frame}-${x}-${y}.rgb`);
    await run(["-i", output, "-vf", `select=eq(n\\,${frame}),crop=2:2:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", file]);
    return readFile(file);
  };
  for (const frame of [1, 6, 8]) { const pixel = await pixels(frame, 30, 30); expect(pixel[2]).toBeGreaterThan(pixel[0]+100); }
  const gap = await pixels(4, 30, 30); expect(Math.max(...gap)).toBeLessThan(20);
  const white = await pixels(4, 4, 4); expect(Math.min(...white)).toBeGreaterThan(225);
  for (const frame of [1, 4, 8]) { const pixel = await pixels(frame, 290, 20); expect(pixel[2]).toBeGreaterThan(pixel[0]+100); }
  // A retry compiler consumes the saved intervals unchanged, without the runner or any model.
  const retry = await compiler.compile(JSON.parse(JSON.stringify(frozen)), media, { ...DEFAULT_PRESET, resolutionMode: "source" }, options);
  expect(retry.args).toEqual(compiled.args);
  expect(retry.textFiles).toEqual(compiled.textFiles);
  console.info(`four-corner render evidence: ${output}`);
});
