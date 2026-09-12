import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetLibrary } from "../src/main/asset-library";
import { LIBRARY_FONTS, LIBRARY_STICKERS } from "../src/shared/asset-library";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { materializePlan } from "../src/main/agent-provider";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET } from "../src/main/domain";
import { FfmpegAdapter, runCommand } from "../src/main/ffmpeg";
import { ApplicationService } from "../src/main/application";

// Opt-in real public downloads; never calls a model/provider or touches user media.
describe.skipIf(process.env.JIANJI_LIVE_ASSETS !== "1")("live library export", () => {
  it("downloads official assets, loads an offline font and renders a real corner sticker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jianji-library-proof-"));
    const library = new AssetLibrary(path.join(root, "cache"));
    const font = LIBRARY_FONTS[0];
    const sticker = LIBRARY_STICKERS.find((entry) => entry.label === "蝴蝶")!;
    const options = { sticker: sticker.id, fontFamily: font.family! };
    try {
      const assets = await library.prepare(options, await ensureBuiltinStickerAssets(path.join(root, "builtins")));
      const offline = new AssetLibrary(path.join(root, "cache"), async () => { throw new Error("offline"); });
      const fontPath = await offline.resolveFont(font.family!);
      expect(fontPath).toBeTruthy();
      expect((await offline.preview(sticker.id)).url).toMatch(/^data:image\/png;base64,/);
      const adapter = new FfmpegAdapter("ffmpeg", "ffprobe");
      const source = path.join(root, "source.mp4");
      expect((await runCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xc8d9cc:s=720x1280:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]).promise).code).toBe(0);
      const service = new ApplicationService(adapter, { resolve: (family) => offline.resolveFont(family) });
      await service.addMedia([source]);
      const media = service.currentProject.mediaItems[0];
      const template = materializePlan({ summary: "proof", captions: [{ text: "19.9元30贴", size: 0.026, corner: "top-left" }], filter: "cool", intensity: 0.3 }, "clean", media, assets, options);
      const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, { ffmpegPath: "ffmpeg", fontResolver: { resolve: (family) => offline.resolveFont(family) }, textFilePath: (id) => path.join(root, `${id}.txt`) });
      expect(compiled.args.join(" ")).toContain(fontPath!);
      expect(compiled.args).toContain(assets[sticker.id]!.assetPath);
      for (const file of compiled.textFiles) await writeFile(file.path, file.content);
      const output = path.join(root, "proof.mp4");
      const rendered = await adapter.run([...compiled.args, output]).promise;
      expect(rendered.code, rendered.stderr).toBe(0);
      expect((await adapter.probe(output)).streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 720, height: 1280, codec_name: "h264" });
      expect((await readFile(output)).length).toBeGreaterThan(1000);
      console.log(`Real asset export: ${output}`);
    } finally {
      if (process.env.JIANJI_KEEP_ASSET_PROOF !== "1") await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});
