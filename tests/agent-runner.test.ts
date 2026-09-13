import { describe, expect, it, vi } from "vitest";
import { calculateProductionQuantity } from "../src/shared/agent";
import { AgentRunner } from "../src/main/agent-runner";
import { type MediaItem, now } from "../src/main/domain";
import { ProviderError, type PackagingPlan, type AgentSelectionContext } from "../src/main/agent-provider";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DecorationSchema } from "../src/shared/decorations";
import { executionLimits } from "../src/main/execution-limits";

function media(name: string): MediaItem {
  return { id: crypto.randomUUID(), sourcePath: `/tmp/${name}`, displayName: name, fingerprint: name, width: 640, height: 480, durationMs: 1000, sizeBytes: 10, rotation: 0, importedAt: now(), probeStatus: "ready" };
}
function plan(summary: string): PackagingPlan {
  return { summary, captions: [], filter: "cool", intensity: 0.3 };
}
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("agent run lifecycle", () => {
  it("supplies independent batch positions and immutable usage snapshots, resetting between runs", async () => {
    const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
    const contexts: AgentSelectionContext[] = [];
    const releases: (() => void)[] = [];
    const provider = vi.fn(async (_rule, _brief, _frames, _signal, _catalog, context) => {
      contexts.push(context);
      await new Promise<void>((resolve) => releases.push(resolve));
      return { ...plan("包装"), stickers: [{ corner: "bottom-right", sticker: "heart" }] };
    });
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue: async () => "task", stickerAssets, decorations: DecorationSchema.parse({ mode: "agent" }), autoCatalog: catalog, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")], 10);
    await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
    const firstWave = contexts.length;
    expect(firstWave).toBe(executionLimits().analysis);
    expect(contexts.map((context) => context.outputIndex)).toEqual(Array.from({ length: firstWave }, (_, i) => i));
    expect(contexts.every((context) => context.totalOutputs === 10 && context.stickerUsage.length === 0)).toBe(true);
    releases.shift()!();
    await vi.waitFor(() => expect(contexts.length).toBe(firstWave + 1));
    expect(contexts[firstWave].stickerUsage).toEqual([{ id: "heart", count: 1 }]);
    expect(contexts[0].stickerUsage).toEqual([]);
    while (runner.running) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await runner.settled();
    runner.start("project", "clean", "", [media("b")]);
    await vi.waitFor(() => expect(contexts.length).toBe(11));
    expect(contexts[10]).toEqual({ outputIndex: 0, totalOutputs: 1, stickerUsage: [] });
    releases.shift()!();
    await runner.settled();
  });

  it("continues later versions after one version fails", async () => {
    const provider = vi.fn().mockRejectedValueOnce(new ProviderError("请求失败")).mockResolvedValue(plan("下一版"));
    const enqueue = vi.fn().mockImplementation(async () => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a.mp4")], 3);
    await runner.settled();
    expect(runner.snapshot()?.items.map((item) => item.status)).toEqual(["failed", "exporting", "exporting"]);
    expect(provider).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
  it("does not count rejected automatic plans as sticker usage or retry them", async () => {
    const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
    const provider = vi.fn().mockResolvedValue({ ...plan("无效方案"), intensity: 1, stickers: [{ corner: "bottom-right", sticker: "heart" }] });
    const enqueue = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, decorations: DecorationSchema.parse({ mode: "agent" }), autoCatalog: catalog, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")], 10);
    await runner.settled();
    expect(provider).toHaveBeenCalledTimes(10);
    expect(provider.mock.calls.every((call) => call[5].stickerUsage.length === 0)).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(runner.snapshot()?.items.every((item) => item.status === "failed")).toBe(true);
  });
  it("creates independently planned versions for each source while retaining the manual price", async () => {
    const sources = [media("a.mp4"), media("b.mp4")];
    const provider = vi.fn().mockResolvedValue(plan("通用短句"));
    const enqueue = vi.fn().mockImplementation(async () => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, decorations: DecorationSchema.parse({ productPrice: "19.90" }), onChange: () => {} });
    runner.start("project", "clean", "", sources, calculateProductionQuantity(sources.length, 5)!.multiplier);
    await runner.settled();
    const items = runner.snapshot()!.items;
    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.id)).size).toBe(6);
    expect(items.map((item) => item.version)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(items.map((item) => item.mediaId)).toEqual([sources[0].id, sources[0].id, sources[0].id, sources[1].id, sources[1].id, sources[1].id]);
    expect(provider).toHaveBeenCalledTimes(6);
    expect(new Set(enqueue.mock.calls.map(([template]) => template.id)).size).toBe(6);
    expect(enqueue.mock.calls.every(([template]) => template.layers.some((layer: { content?: string }) => layer.content === "¥ 19.90"))).toBe(true);
  });

  it("rejects invalid multipliers and excessive output counts before calling the model", () => {
    const provider = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue: vi.fn(), stickerAssets, onChange: () => {} });
    for (const multiplier of [0, -1, 1.5, 251, NaN]) expect(() => runner.start("project", "clean", "", [media("a")], multiplier)).toThrow();
    expect(() => runner.start("project", "clean", "", [media("a"), media("b")], 126)).toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it("independently plans and enqueues all 250 outputs", async () => {
    const provider = vi.fn().mockResolvedValue(plan("包装"));
    const enqueue = vi.fn().mockImplementation(async () => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")], 250);
    await runner.settled();
    expect(provider).toHaveBeenCalledTimes(250);
    expect(enqueue).toHaveBeenCalledTimes(250);
    expect(runner.snapshot()?.items).toHaveLength(250);
  });
  it("isolates failed material and freezes an independent plan for every export", async () => {
    const sources = [media("a.mp4"), media("b.mp4"), media("c.mp4")];
    const enqueue = vi.fn().mockResolvedValue("task");
    const provider = vi.fn().mockResolvedValueOnce(plan("第一条")).mockRejectedValueOnce(new ProviderError("请求失败")).mockResolvedValueOnce(plan("第三条"));
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", sources);
    sources[2].displayName = "changed.mp4";
    await runner.settled();
    expect(runner.snapshot()?.items.map((item) => item.status)).toEqual(["exporting", "failed", "exporting"]);
    expect(enqueue.mock.calls.map(([template]) => template.layers.filter((layer: { type: string }) => layer.type === "text"))).toEqual([[], []]);
    expect(enqueue.mock.calls[1][1].displayName).toBe("c.mp4");
    expect(enqueue.mock.calls[0][0].id).not.toBe(enqueue.mock.calls[1][0].id);
  });

  it("blocks concurrent runs and stops before any further provider call or export", async () => {
    const releases: ((images: string[]) => void)[] = [];
    const frames = () => new Promise<string[]>((resolve) => { releases.push(resolve); });
    const provider = vi.fn(); const enqueue = vi.fn();
    const runner = new AgentRunner({ frames, plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a"), media("b")], 3);
    expect(() => runner.start("project", "clean", "", [media("c")])).toThrow("正在处理");
    runner.cancel(); releases.forEach((release) => release([]));
    await runner.settled();
    expect(provider).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(runner.snapshot()?.status).toBe("cancelled");
    expect(runner.snapshot()?.items.every((item) => item.status === "cancelled")).toBe(true);
    expect(runner.snapshot()?.items).toHaveLength(6);
  });

  it("does not publish arbitrary local errors to the frontend", async () => {
    const runner = new AgentRunner({ frames: async () => { throw new Error("private path or key"); }, plan: vi.fn(), enqueue: vi.fn(), stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")]);
    await runner.settled();
    expect(JSON.stringify(runner.snapshot())).not.toContain("private path or key");
  });

  it("passes the agent decoration catalog through to plan materialization", async () => {
    const catalog = { fonts: ["Noto Sans CJK SC"], stickers: [{ id: "heart", label: "爱心" }] };
    const provider = vi.fn().mockResolvedValue({ summary: "仅贴纸", captions: [], stickers: [{ corner: "bottom-right", sticker: "heart" }], filter: "cool", intensity: 0.3 });
    const enqueue = vi.fn().mockResolvedValue("task");
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, decorations: DecorationSchema.parse({ mode: "agent" }), autoCatalog: catalog, onChange: () => {} });
    runner.start("project", "clean", "", [media("agent.mp4")]);
    await runner.settled();
    expect(provider.mock.calls[0][4]).toEqual(catalog);
    expect(enqueue.mock.calls[0][0].layers).toEqual([expect.objectContaining({ type: "sticker", assetPath: "/tmp/heart.png" })]);
  });
});
