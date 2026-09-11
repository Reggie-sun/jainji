import { describe, expect, it } from "vitest";
import { createDefaultTemplate, DEFAULT_PRESET, type MediaItem } from "../src/main/domain";
import { escapeFilterValue, TemplateCompiler } from "../src/main/compiler";

const media: MediaItem = {
  id: crypto.randomUUID(), sourcePath: "/tmp/source;$(touch hacked).mp4", displayName: "source;$(touch hacked).mp4",
  fingerprint: "sha256:test", sizeBytes: 10, durationMs: 1_000, width: 1920, height: 1080, rotation: 0,
  probeStatus: "ready", importedAt: new Date().toISOString(),
};

describe("TemplateCompiler", () => {
  it("keeps hostile paths in argv and escapes filter values", async () => {
    const template = createDefaultTemplate();
    template.layers.push({
      id: crypto.randomUUID(), type: "text", content: "Unicode 演示; $(not a command)", fontFamily: "DejaVu Sans", fontSizeRatio: 0.06,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0.004,
      x: 0.1, y: 0.1, width: 0.7, opacity: 1, zIndex: 1, visible: true,
    });
    const command = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, {
      ffmpegPath: "/usr/bin/ffmpeg",
      fontResolver: { resolve: async () => "/usr/share/fonts/truetype/dejavu/DejaVu Sans.ttf" },
      textFilePath: () => "/tmp/jianji-text.txt",
    });
    expect(command.args).toContain(media.sourcePath);
    expect(command.args.join(" ")).not.toContain("shell=true");
    expect(command.textFiles[0].content).toContain("$(not a command)");
    expect(escapeFilterValue("a:b,c;[d]\\e")).toBe("a\\:b\\,c\\;\\[d\\]\\\\e");
  });
});
