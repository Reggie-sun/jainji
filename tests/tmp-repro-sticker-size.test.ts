import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { TemplateCompiler } from "../src/main/compiler";
import { DEFAULT_PRESET, type EditTemplate, type MediaItem } from "../src/main/domain";

it("prints sticker scale args for today's frozen template", async () => {
  const project = JSON.parse(await readFile("/home/reggie/jianji-output/再次3x50二轮-20260922-120608/antang-70/氨糖膏再次50条文字5秒贴纸全程.jianji-project.json", "utf8"));
  const done = project.exportBatches.filter((b: { status?: string; templateSnapshot?: { layers?: { type: string; cover?: unknown }[] } }) =>
    b.status === "completed" && b.templateSnapshot?.layers?.some(l => l.type === "sticker" && !l.cover));
  const template = done[done.length - 1].templateSnapshot as EditTemplate;
  const media: MediaItem = { id: "m", sourcePath: "/tmp/nonexistent.mp4", displayName: "m", fingerprint: "f", sizeBytes: 1, durationMs: 69776, width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  const compiler = new TemplateCompiler();
  const compiled = await compiler.compile(template, media, { ...DEFAULT_PRESET, resolutionMode: "720p" }, {
    ffmpegPath: "ffmpeg",
    fontResolver: { resolve: async () => "/tmp/font.ttf" },
    textFilePath: (id: string) => `/tmp/${id}.txt`,
  });
  const graph = compiled.args.join(" ") + "\n" + compiled.textFiles.map(f => f.content).join("\n");
  const scaleMatches = graph.match(/scale=[^',\]\n]+/g) ?? [];
  const overlayMatches = graph.match(/overlay=[^'\]\n]+/g) ?? [];
  const rotateMatches = graph.match(/rotate=[^,\]\n]+/g) ?? [];
  console.info("FULLGRAPH:\n" + compiled.textFiles.map(f => f.content).join("\n"));
  expect(true).toBe(true);
});
