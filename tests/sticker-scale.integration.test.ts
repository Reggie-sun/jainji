import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TemplateCompiler } from "../src/main/compiler";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";

const ffmpeg = process.env.JIANJI_FFMPEG_PATH || "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!available)("sticker pre-scaling with real FFmpeg", () => {
  it.each([1, 10])("preserves a 4000 x %i thin sticker's pixels and dimensions", async (height) => {
    const template = createDefaultTemplate();
    template.layers.push({ id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/unused.png", assetFingerprint: "fixture", x: 0.04, y: 0.04, width: 0.12, rotationDeg: 7, opacity: 1, zIndex: 0, visible: true });
    const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/unused.mp4", displayName: "fixture", fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
    const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath: ffmpeg, fontResolver: { resolve: async () => null }, textFilePath: () => "/tmp/unused.txt" });
    const graph = compiled.args[compiled.args.indexOf("-filter_complex") + 1];
    const filter = graph.split("[1:v]")[1].split("[sticker1src]")[0];
    const original = filter.slice(filter.indexOf("format=rgba"));
    const render = (vf: string) => execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=red:s=4000x${height},format=rgba`, "-filter_threads", "1", "-vf", vf, "-frames:v", "1", "-threads", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1024 * 1024 });
    const expected = render(original);
    expect(expected.byteLength).toBeGreaterThan(0);
    expect(render(filter)).toEqual(expected);
  });
});
