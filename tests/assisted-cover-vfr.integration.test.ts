import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runCommand } from "../src/main/ffmpeg";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { automaticCoverLayers } from "../src/main/cover-sticker";
import { ffmpegBin, ffprobeBin } from "./helpers/ffmpeg-bin";

it("keeps VFR frame clocks and excludes the gap between human visible segments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-assisted-vfr-"));
  const sourcePath = path.join(root, "source.mp4"), assetPath = path.join(root, "sticker.png"), outputPath = path.join(root, "output.mp4");
  const run = async (args: string[]) => { const result = await runCommand(ffmpegBin, ["-v", "error", ...args]).promise; expect(result.code, result.stderr).toBe(0); };
  await run(["-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1", "-vf", "select='eq(n,0)+eq(n,2)+eq(n,4)+eq(n,7)+eq(n,10)+eq(n,14)+eq(n,19)'", "-fps_mode", "vfr", "-c:v", "libx264", sourcePath]);
  await run(["-f", "lavfi", "-i", "color=c=white:s=16x16", "-frames:v", "1", assetPath]);
  const media = { id: crypto.randomUUID(), sourcePath, width: 64, height: 64, durationMs: 1000 } as MediaItem;
  const rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  const tracks = [[100, 250], [500, 700]].map(([startMs, endMs], index) => ({ targetId: String(index), track: { startMs, endMs, keyframes: [{ timeMs: startMs, rectangle: rect }] } }));
  const template = createDefaultTemplate();
  template.layers = automaticCoverLayers({ stickerId: "heart", assetPath, assetFingerprint: "fixture", rectangle: rect }, media, media, tracks);
  const compiled = await new TemplateCompiler().compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "source" }, { ffmpegPath: ffmpegBin, fontResolver: { resolve: async () => null }, textFilePath: (id) => path.join(root, `${id}.txt`), threads: 1 });
  await Promise.all(compiled.textFiles.map((file) => writeFile(file.path, file.content)));
  await run(compiled.args.concat(outputPath));
  const times = async (file: string) => { const result = await runCommand(ffprobeBin, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file]).promise; return JSON.parse(result.stdout).frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time)); };
  const sourceTimes = await times(sourcePath), outputTimes = await times(outputPath);
  expect(outputTimes).toEqual(sourceTimes);
  const pixels = path.join(root, "output.rgb"); await run(["-i", outputPath, "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", pixels]);
  const bytes = await readFile(pixels);
  outputTimes.forEach((time: number, index: number) => {
    const white = bytes[index * 64 * 64 * 3 + (24 * 64 + 24) * 3] > 200;
    expect(white, `presence at ${time}s`).toBe((time >= 0.1 && time < 0.25) || (time >= 0.5 && time < 0.7));
  });
});
