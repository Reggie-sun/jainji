import { describe, expect, it, vi } from "vitest";
import { AgentProvider, validatePlan } from "../src/main/agent-provider";
import { AgentRunner } from "../src/main/agent-runner";
import { DEFAULT_PRESET, EditTemplateSchema, type EditTemplate, type MediaItem, type StickerLayer } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import { DecorationSchema } from "../src/shared/decorations";
import type { AutomaticCoverTrack } from "../src/main/automatic-cover-tracks";

const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const asset = { assetPath: "/tmp/heart.png", assetFingerprint: "heart" };
const assets = { heart: asset, sparkle: asset, arrow: asset, burst: asset };
const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
const plan = { summary: "四角包装", captions: [], filter: "none" as const, intensity: 0, priceStyle: "classic" as const,
  stickers: corners.map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) };
const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "source", sizeBytes: 1,
  durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const rectangle = { x: 0, y: 0, width: 0.12, height: 0.1 };
const track = (startMs: number, endMs: number): AutomaticCoverTrack => ({ targetId: `target-${startMs}`,
  track: { startMs, endMs, keyframes: [{ timeMs: startMs, rectangle }] } });

async function produce(tracks?: AutomaticCoverTrack[], mode: "agent" | "manual" = "agent") {
  const queued: EditTemplate[] = [];
  const detect = vi.fn(async () => tracks!);
  const runner = new AgentRunner({ frames: async () => [],
    plan: async () => mode === "agent" ? plan : { summary: "手动", captions: [], filter: "cool", intensity: 0.3 },
    stickerAssets: assets, decorations: DecorationSchema.parse({ mode, productPrice: "用户内容", sticker: "none" }),
    autoCatalog: mode === "agent" ? catalog : undefined,
    coverSticker: tracks ? { stickerId: "heart", ...asset, rectangle, automatic: true } : undefined,
    detectCoverTracks: detect, enqueue: async template => { queued.push(template); return crypto.randomUUID(); }, onChange: () => {} });
  runner.start("project", "clean", "", [source]); await runner.settled();
  expect(runner.snapshot()?.items[0].error).toBeUndefined();
  expect(queued).toHaveLength(1);
  return { template: queued[0], detect };
}
const decorations = (template: EditTemplate) => template.layers.filter((l): l is StickerLayer => l.type === "sticker" && !l.cover);

describe("automatic four-corner coverage", () => {
  it.each([0, 1, 2, 3])("rejects a model plan with only %i corners instead of silently filling it", count => {
    expect(() => validatePlan({ ...plan, stickers: plan.stickers.slice(0, count) }, "clean", catalog)).toThrow("四个角落");
  });
  it("allows reuse of a chosen sticker but never a duplicate corner", () => {
    expect(validatePlan(plan, "clean", catalog).summary).toBe("四角包装");
    expect(() => validatePlan({ ...plan, stickers: [plan.stickers[0], ...plan.stickers.slice(0, 3)] }, "clean", catalog)).toThrow("重复");
  });
  it("rejects an empty shortlist without retry and an empty catalog before requesting a plan", async () => {
    const complete = vi.fn(async () => '{"candidates":[]}');
    const provider = new AgentProvider(); provider.useChatGPT("test", complete);
    await expect(provider.shortlist("clean", "", [], new AbortController().signal, catalog)).rejects.toThrow("不得为空");
    expect(complete).toHaveBeenCalledTimes(1);
    await expect(provider.plan("clean", "", [], new AbortController().signal, { fonts: [], stickers: [] })).rejects.toThrow("候选");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("fills all four corners without invoking recognition when coverage is disabled", async () => {
    const { template, detect } = await produce();
    expect(decorations(template).map(l => [l.x, l.y])).toEqual([[0.015,0.015],[0.905,0.015],[0.015,0.88],[0.905,0.88]]);
    expect(detect).not.toHaveBeenCalled();
  });
  it("keeps four decorations when enabled recognition finds no originals", async () => {
    const { template, detect } = await produce([]);
    expect(decorations(template)).toHaveLength(4);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(template.layers.some(l => l.type === "sticker" && l.cover)).toBe(false);
  });
  it("freezes gap intervals instead of doubling a corner already occupied by a cover", async () => {
    const { template } = await produce([track(200, 600)]);
    const ordinary = decorations(template);
    expect(ordinary[0]).toMatchObject({ activeRanges: [{ startMs: 0, endMs: 200 }, { startMs: 600, endMs: 1000 }] });
    expect(ordinary.slice(1).every(l => !("activeRanges" in l))).toBe(true);
    expect(template.layers.find(l => l.type === "sticker" && l.cover)).toMatchObject({ cover: { opaqueBackground: true, motion: { startMs: 200, endMs: 600 } } });
    expect(EditTemplateSchema.parse(JSON.parse(JSON.stringify(template)))).toEqual(template);
  });
  it("merges overlapping cover intervals and omits a fully occupied corner's extra decoration", async () => {
    const { template } = await produce([track(0, 600), track(400, 1000)]);
    expect(decorations(template)).toHaveLength(3);
    expect(decorations(template).some(l => l.x < 0.5 && l.y < 0.5)).toBe(false);
  });
  it("does not count a center cover as a corner and leaves manual decoration unchanged", async () => {
    const middle = track(0, 1000); middle.track.keyframes[0].rectangle = { ...rectangle, x: 0.4, y: 0.4 };
    const { template } = await produce([middle]);
    expect(decorations(template)).toHaveLength(4);
    expect(decorations(template).every(l => !("activeRanges" in l))).toBe(true);
    expect(decorations((await produce([track(0, 1000)], "manual")).template)).toHaveLength(0);
  });
  it("uses each moving cover's corner occupancy, not only its first keyframe", async () => {
    const moving = track(0, 1000);
    moving.track.keyframes.push({ timeMs: 1000, rectangle: { ...rectangle, y: 0.9 } });
    const { template } = await produce([moving]);
    const ordinary = decorations(template);
    expect(ordinary[0]).toHaveProperty("activeRanges");
    expect(ordinary[2]).toHaveProperty("activeRanges");
    const top = ordinary[0] as StickerLayer & { activeRanges: { startMs: number; endMs: number }[] };
    const bottom = ordinary[2] as typeof top;
    expect(top.activeRanges[0].startMs).toBeCloseTo(1000 * 0.115 / 0.9);
    expect(top.activeRanges[0].endMs).toBe(1000);
    expect(bottom.activeRanges[0].startMs).toBe(0);
    expect(bottom.activeRanges[0].endMs).toBeCloseTo(1000 * 0.785 / 0.9);
  });
  it.each([
    [{ x: 0.04, y: 0.75, width: 0.12, height: 0.2 }, [2]],
    [{ x: 0.04, y: 0.04, width: 0.92, height: 0.06 }, [0, 1]],
  ] as const)("counts all corner regions intersected by a cover %j", async (rectangle, occupied) => {
    const cover = track(200, 600); cover.track.keyframes[0].rectangle = rectangle;
    const ordinary = decorations((await produce([cover])).template);
    ordinary.forEach((layer, index) => {
      expect(layer.activeRanges).toEqual((occupied as readonly number[]).includes(index)
        ? [{ startMs: 0, endMs: 200 }, { startMs: 600, endMs: 1000 }] : undefined);
    });
  });
  it("compiles the frozen gap ranges and rejects ranges beyond the source duration", async () => {
    const { template } = await produce([track(200, 600)]);
    const compiler = new TemplateCompiler();
    const options = { ffmpegPath: "/fake", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: (id: string) => `/tmp/${id}` };
    const command = await compiler.compile(template, source, DEFAULT_PRESET, options);
    expect(command.textFiles.find(f => f.layerId === "cover-graph")?.content).toContain("enable='gte(t,0)*lt(t,0.2)+gte(t,0.6)*lt(t,1)'");
    await expect(compiler.compile(template, { ...source, durationMs: 900 }, DEFAULT_PRESET, options)).rejects.toThrow("时长");
  });
  it("rejects ambiguous persisted timing instead of changing historical untimed templates", async () => {
    const { template } = await produce();
    for (const activeRanges of [[], [{ startMs: 200, endMs: 200 }], [{ startMs: -1, endMs: 100 }],
      [{ startMs: 0, endMs: 600 }, { startMs: 400, endMs: 1000 }],
      [{ startMs: 600, endMs: 1000 }, { startMs: 0, endMs: 200 }]]) {
      expect(EditTemplateSchema.safeParse({ ...template, layers: [{ ...decorations(template)[0], activeRanges }] }).success).toBe(false);
    }
    const legacy = { ...template, layers: [decorations(template)[0]] };
    expect(EditTemplateSchema.parse(legacy)).toEqual(legacy);
    const covered = (await produce([track(0, 1000)])).template;
    const cover = covered.layers.find(l => l.type === "sticker" && l.cover)!;
    expect(EditTemplateSchema.safeParse({ ...covered, layers: [{ ...cover, activeRanges: [{ startMs: 0, endMs: 1000 }] }] }).success).toBe(false);
  });
});
