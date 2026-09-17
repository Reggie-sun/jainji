import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/main/agent-runner";
import { knowledgeFixture } from "./helpers/knowledge-session";
import { EditTemplateSchema, type EditTemplate, type MediaItem, type StickerLayer } from "../src/main/domain";
import { DecorationSchema } from "../src/shared/decorations";
import { ProviderError } from "../src/main/api-transport";
import type { AutomaticCoverTrack } from "../src/main/automatic-cover-tracks";

const asset = { assetPath: "/tmp/sticker.png", assetFingerprint: "fixture" };
const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 4000, width: 320, height: 240, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const plan = { summary: "只补空缺", captions: [], filter: "none" as const, intensity: 0, priceStyle: "classic" as const, stickers: corners.map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) };
const track = (x = 0, y = 0, startMs = 0, endMs = 4000): AutomaticCoverTrack => ({ targetId: `${x}-${y}-${startMs}`, track: { startMs, endMs, keyframes: [{ timeMs: startMs, rectangle: { x, y, width: 0.1, height: 0.1 } }] } });
const stickers = (template: EditTemplate) => template.layers.filter((layer): layer is StickerLayer => layer.type === "sticker");

async function produce(tracks: AutomaticCoverTrack[], options: { fail?: boolean; versions?: number; resolutionMode?: "720p" | "source" } = {}) {
  const detect = vi.fn(async () => { if (options.fail) throw new ProviderError("原贴纸识别不确定"); return tracks; });
  const createPlan = vi.fn(async () => plan);
  const templates: EditTemplate[] = [];
  const runner = new AgentRunner({ frames: async () => [], plan: createPlan,
    stickerAssets: { heart: asset, sparkle: asset, arrow: asset, burst: asset },
    autoCatalog: { fonts: [], stickers: [{ id: "heart", label: "爱心" }] },
    decorations: DecorationSchema.parse({ mode: "agent", productPrice: "手动文字", displayMode: "first-3s" }),
    preserveSourceStickers: true, knowledge: knowledgeFixture(detect), resolutionMode: options.resolutionMode ?? "source",
    enqueue: async template => { templates.push(template); return crypto.randomUUID(); }, onChange: () => {} });
  runner.start("project", "clean", "", [source], options.versions ?? 1); await runner.settled();
  return { templates, detect, createPlan, run: runner.snapshot()! };
}

describe("preserving source corner stickers without covers", () => {
  it("omits extra stickers in occupied corners without creating a cover", async () => {
    const { templates, detect, run } = await produce([track()]);
    expect(run.items[0].status).toBe("exporting");
    expect(detect).toHaveBeenCalledTimes(1);
    expect(stickers(templates[0])).toHaveLength(3);
    expect(stickers(templates[0]).every(layer => !layer.cover && !(layer.x < 0.5 && layer.y < 0.5))).toBe(true);
    expect(run.items[0].summary).toContain("保留原贴纸");
  });
  it("adds none if all four corners are occupied but preserves price and display mode", async () => {
    const { templates } = await produce([track(), track(0.9), track(0, 0.9), track(0.9, 0.9)]);
    expect(stickers(templates[0])).toHaveLength(0);
    expect(templates[0].layers.find(layer => layer.type === "text")).toMatchObject({ content: "手动文字" });
    expect(templates[0].decorationDisplayMode).toBe("first-3s");
  });
  it("fills only missing time ranges and freezes them across serialization", async () => {
    const { templates } = await produce([track(0, 0, 500, 2500)]);
    expect(stickers(templates[0])[0].activeRanges).toEqual([{ startMs: 0, endMs: 500 }, { startMs: 2500, endMs: 4000 }]);
    expect(EditTemplateSchema.parse(JSON.parse(JSON.stringify(templates[0])))).toEqual(templates[0]);
  });
  it("leaves four corners available when originals are absent or only in the center", async () => {
    for (const tracks of [[], [track(0.4, 0.4)]]) expect(stickers((await produce(tracks)).templates[0])).toHaveLength(4);
  });
  it("follows a moving original between corner regions without adding beside it", async () => {
    const moving = track();
    moving.track.keyframes.push({ timeMs: 4000, rectangle: { x: 0, y: 0.9, width: 0.1, height: 0.1 } });
    const layers = stickers((await produce([moving])).templates[0]);
    expect(layers[0].activeRanges?.[0].startMs).toBeCloseTo(4000 * 0.105 / 0.9);
    expect(layers[2].activeRanges?.[0].endMs).toBeCloseTo(4000 * 0.795 / 0.9);
  });
  it("preserves original corner identity when export adds padding beside it", async () => {
    const { templates } = await produce([track()], { resolutionMode: "720p" });
    // A 4:3 source is centered in 16:9 output; do not add another top-left sticker in the padding.
    expect(stickers(templates[0])).toHaveLength(3);
  });
  it("shares recognition between versions and fails closed without creative calls on uncertainty", async () => {
    const success = await produce([track()], { versions: 3 });
    expect(success.detect).toHaveBeenCalledTimes(1); expect(success.templates).toHaveLength(3);
    const failure = await produce([], { versions: 3, fail: true });
    expect(failure.detect).toHaveBeenCalledTimes(1); expect(failure.createPlan).not.toHaveBeenCalled();
    expect(failure.templates).toHaveLength(0);
    expect(failure.run.items.every(item => item.status === "failed" && item.error === "原贴纸识别不确定")).toBe(true);
  });
});
