import { describe, expect, it, vi } from "vitest";
import { calculateProductionQuantity } from "../src/shared/agent";
import { AgentRunner } from "../src/main/agent-runner";
import { DEFAULT_PRESET, type EditTemplate, type MediaItem, now } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import { AgentProvider, ProviderError, type PackagingPlan, type AgentSelectionContext } from "../src/main/agent-provider";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DecorationSchema } from "../src/shared/decorations";
import { executionLimits } from "../src/main/execution-limits";
import { knowledgeFixture } from "./helpers/knowledge-session";
import type { KnowledgeOutcome } from "../src/shared/source-sticker-knowledge-audit";

function media(name: string): MediaItem {
  return { id: crypto.randomUUID(), sourcePath: `/tmp/${name}`, displayName: name, fingerprint: name, width: 640, height: 480, durationMs: 1000, sizeBytes: 10, rotation: 0, importedAt: now(), probeStatus: "ready" };
}
function plan(summary: string): PackagingPlan {
  return { summary, captions: [], filter: "cool", intensity: 0.3 };
}
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("supervisor production admission", () => {
  it.each(["knowledge", "creative", "reconcile", "enqueue", "queued", "cancelled"] as const)("records terminal %s outcomes even without an exported task", async failure => {
    const records: KnowledgeOutcome[] = [];
    const knowledge = knowledgeFixture();
    const acquire = knowledge.acquire;
    knowledge.acquire = async (...args) => {
      args[4]?.({ phase: "reusing", origin: "warm", lookupReason: "hit", recognitionRequests: 0, executorRequests: 0, recognitionSupervisorRequests: 0, previewRequests: 0, renders: 0, revisions: 0, elapsedMs: 1 });
      if (failure === "knowledge") throw new Error("private path/key must not be logged");
      return acquire(...args);
    };
    if (failure === "reconcile") knowledge.reconcile = async () => { throw new Error("reconcile"); };
    const runner = new AgentRunner({ frames: async () => [], plan: async () => {
      if (failure === "cancelled") { runner.cancel(); throw new Error("cancelled"); }
      if (failure === "creative") throw new Error("creative"); return plan("设计");
    }, enqueue: async () => { if (failure === "enqueue") throw new Error("enqueue"); return "task"; },
    stickerAssets, knowledge, recordOutcome: async record => { records.push(record); }, onChange: () => {} });
    runner.start("project", "clean", "", [media("one")], failure === "cancelled" ? 2 : 1); await runner.settled();
    expect(records).toHaveLength(failure === "cancelled" ? 2 : 1);
    expect(records[0]).toMatchObject({ result: failure === "queued" ? "queued" : failure === "cancelled" ? "cancelled" : "failed", stage: failure === "queued" ? "enqueue" : failure === "cancelled" ? "creative" : failure, lookup: "hit", quality: "not-evaluated" });
    expect(JSON.stringify(records)).not.toContain("private");
    if (failure === "cancelled") expect(records[1]).toMatchObject({ result: "cancelled", stage: "waiting", lookup: "not-started" });
  });
  it.each(["creative", "reconcile", "enqueue"])("ends the knowledge progress when %s fails outside recognition", async (failure) => {
    let clock = 100;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const knowledge = knowledgeFixture();
    const acquire = knowledge.acquire;
    knowledge.acquire = async (...args) => {
      const binding = await acquire(...args);
      args[4]?.({ phase: "reusing", origin: "warm", recognitionRequests: 0, previewRequests: 0, renders: 0, revisions: 0, elapsedMs: 1 });
      return binding;
    };
    if (failure === "reconcile") knowledge.reconcile = async () => { throw new Error("reconcile failed"); };
    const runner = new AgentRunner({ frames: async () => [], plan: async () => { clock = 5100; if (failure === "creative") throw new Error("creative failed"); return plan("设计"); },
      enqueue: async () => { if (failure === "enqueue") throw new Error("enqueue failed"); return crypto.randomUUID(); }, stickerAssets, knowledge, onChange: () => {} });
    try { runner.start("project", "clean", "", [media("one")]); await runner.settled(); } finally { now.mockRestore(); }
    expect(runner.snapshot()?.items[0]).toMatchObject({ status: "failed", sourceKnowledge: { phase: "blocked" } });
    expect(runner.snapshot()?.items[0].sourceKnowledge?.reason).not.toContain("正在");
    expect(runner.snapshot()?.items[0].sourceKnowledge?.elapsedMs).toBe(5000);
  });
  it("does not retain an invalid corner correction when a later track-only revision succeeds", async () => {
    const enqueue = vi.fn(async () => crypto.randomUUID());
    const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ ...plan("设计"), stickers: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })), priceStyle: "classic" }),
      enqueue, stickerAssets, decorations: DecorationSchema.parse({ mode: "agent", productPrice: "手动展示" }),
      autoCatalog: { fonts: [], stickers: [{ id: "heart", label: "爱心" }] },
      knowledge: knowledgeFixture(undefined, async (_template, _source, _tracks, rebuild) => {
        expect(() => rebuild({ action: "revise", reason: "非法总面积", tracks: [], corners: (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => ({ corner, width: 0.1, rotationDeg: 0 })) })).toThrow();
        return rebuild({ action: "revise", reason: "仅修正轨迹", tracks: [] });
      }), onChange: () => {} });
    runner.start("project", "clean", "", [media("one")]); await runner.settled();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(runner.snapshot()?.items[0].error).toBeUndefined();
  });
  it("finishes every preview before enqueueing any formal output and retains frozen text", async () => {
    const events: string[] = [];
    const enqueue = vi.fn(async (template: EditTemplate) => { events.push("enqueue"); expect(template.layers.find(layer => layer.type === "text")?.content).toBe("手动展示"); return crypto.randomUUID(); });
    const runner = new AgentRunner({ frames: async () => [], plan: async () => plan("设计"), enqueue, stickerAssets,
      decorations: DecorationSchema.parse({ productPrice: "手动展示", sticker: "heart" }),
      knowledge: knowledgeFixture(undefined, async (template, _source, _tracks, rebuild) => {
        events.push("preview");
        const revised = rebuild({ action: "revise", reason: "检查", tracks: [] });
        expect(revised.layers.find(layer => layer.type === "text")).toEqual(template.layers.find(layer => layer.type === "text"));
        return revised;
      }), onChange: () => {} });
    runner.start("project", "clean", "", [media("one"), media("two")]);
    await runner.settled();
    expect(events).toEqual(["preview", "preview", "enqueue", "enqueue"]);
    expect(runner.snapshot()?.items.every(item => item.status === "exporting")).toBe(true);
  });
  it("does not enqueue a failed review and cancels previously prepared versions before submission", async () => {
    const enqueue = vi.fn(); let count = 0;
    const runner = new AgentRunner({ frames: async () => [], plan: async () => plan("设计"), enqueue, stickerAssets,
      knowledge: knowledgeFixture(undefined, async template => { if (++count === 2) { runner.cancel(); throw new Error("cancelled"); } return template; }), onChange: () => {} });
    runner.start("project", "clean", "", [media("one"), media("two")]);
    await runner.settled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(runner.snapshot()?.items.every(item => item.status === "cancelled")).toBe(true);
    const failing = new AgentRunner({ frames: async () => [], plan: async () => plan("设计"), enqueue, stickerAssets,
      knowledge: knowledgeFixture(undefined, async () => { throw new ProviderError("主管未通过"); }), onChange: () => {} });
    failing.start("project", "clean", "", [media("one")]); await failing.settled();
    expect(enqueue).not.toHaveBeenCalled(); expect(failing.snapshot()?.items[0].error).toBe("主管未通过");
  });
});
const automaticHeartStickers = () => [
  { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
  { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
];

describe("agent run lifecycle", () => {
  it.each(["source", "720p", "1080p"] as const)("freezes text size for %s output before compiling nonstandard sources", async (resolutionMode) => {
    const productPrice = "一二三四五六七八九十一二\n春日新品";
    for (const size of [{ width: 1080, height: 1350 }, { width: 2560, height: 1080 }]) {
      const source = { ...media("source.mp4"), ...size };
      const enqueue = vi.fn(async (template: EditTemplate) => {
        const frozen = JSON.parse(JSON.stringify(template));
        const before = JSON.stringify(frozen);
        const compiled = await new TemplateCompiler().compile(frozen, source, { ...DEFAULT_PRESET, resolutionMode }, { ffmpegPath: "ffmpeg", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: (id) => `/tmp/${id}.txt` });
        expect(compiled.textFiles.map((entry) => entry.content)).toEqual(productPrice.split("\n"));
        expect(JSON.stringify(frozen)).toBe(before);
        return "task";
      });
      const runner = new AgentRunner({ frames: async () => [], plan: async () => plan("包装"), enqueue, stickerAssets, decorations: DecorationSchema.parse({ productPrice, sticker: "none" }), resolutionMode, onChange: () => {} });
      runner.start("project", "clean", "", [source]);
      await runner.settled();
      expect(enqueue).toHaveBeenCalledOnce();
      expect(runner.snapshot()?.items[0].status).toBe("exporting");
    }
  });

  it("preserves the validation reason and never enqueues or retries an invalid model plan", async () => {
    const provider = new AgentProvider();
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...plan("保留主体"), intensity: 0.9 }));
    provider.useChatGPT("test-model", complete);
    const enqueue = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: provider.plan.bind(provider), enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a.mp4")]);
    await runner.settled();
    expect(runner.snapshot()?.items[0]).toMatchObject({ status: "failed", error: expect.stringContaining("滤镜强度必须在 0.25 到 0.4 之间") });
    expect(enqueue).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("extracts a source once across worker waves but plans every version and refreshes on the next run", async () => {
    const frames = vi.fn().mockResolvedValue(["frame"]);
    const provider = vi.fn().mockResolvedValue(plan("包装"));
    const enqueue = vi.fn().mockResolvedValue("task");
    const runner = new AgentRunner({ frames, plan: provider, enqueue, stickerAssets, onChange: () => {} });
    const sources = [media("a"), media("b")];
    const versions = executionLimits().analysis + 1;
    runner.start("project", "clean", "", sources, versions);
    await runner.settled();
    expect(frames).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(2 * versions);
    expect(enqueue).toHaveBeenCalledTimes(2 * versions);
    runner.start("project", "clean", "", sources, versions);
    await runner.settled();
    expect(frames).toHaveBeenCalledTimes(4);
    expect(provider).toHaveBeenCalledTimes(4 * versions);
  });

  it("does not retain failed extraction for later versions of the same source", async () => {
    const frames = vi.fn().mockRejectedValueOnce(new Error("unreadable source")).mockResolvedValue(["frame"]);
    const provider = vi.fn().mockResolvedValue(plan("包装"));
    const enqueue = vi.fn().mockResolvedValue("task");
    const runner = new AgentRunner({ frames, plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")], executionLimits().analysis + 1);
    await runner.settled();
    expect(frames).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(runner.snapshot()?.items.filter((item) => item.status === "failed")).toHaveLength(executionLimits().analysis);
  });

  it("supplies independent batch positions and immutable usage snapshots, resetting between runs", async () => {
    const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
    const contexts: AgentSelectionContext[] = [];
    const releases: (() => void)[] = [];
    const provider = vi.fn(async (_rule, _brief, _frames, _signal, _catalog, context) => {
      contexts.push(context);
      await new Promise<void>((resolve) => releases.push(resolve));
      return { ...plan("包装"), priceStyle: "classic", stickers: automaticHeartStickers() };
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
    expect(contexts[firstWave].stickerUsage).toEqual([{ id: "heart", count: 4 }]);
    expect(contexts[0].stickerUsage).toEqual([]);
    expect(contexts[firstWave].priceStyleUsage).toEqual([{ id: "classic", count: 1 }]);
    expect(contexts[0].priceStyleUsage).toEqual([]);
    expect(new Set(contexts.map(context => context.catalogSeed)).size).toBe(1);
    while (runner.running) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await runner.settled();
    runner.start("project", "clean", "", [media("b")]);
    await vi.waitFor(() => expect(contexts.length).toBe(11));
    expect(contexts[10]).toMatchObject({ outputIndex: 0, totalOutputs: 1, stickerUsage: [], priceStyleUsage: [] });
    expect(contexts[10].catalogSeed).toBeTruthy();
    expect(contexts[10].catalogSeed).not.toBe(contexts[0].catalogSeed);
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
    const provider = vi.fn().mockResolvedValue({ ...plan("无效方案"), priceStyle: "classic", intensity: 1.1, stickers: automaticHeartStickers() });
    const enqueue = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, decorations: DecorationSchema.parse({ mode: "agent" }), autoCatalog: catalog, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")], 10);
    await runner.settled();
    expect(provider).toHaveBeenCalledTimes(10);
    expect(provider.mock.calls.every((call) => call[5].stickerUsage.length === 0 && call[5].priceStyleUsage.length === 0)).toBe(true);
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
    const provider = vi.fn().mockResolvedValue({ summary: "仅贴纸", captions: [], priceStyle: "classic", stickers: automaticHeartStickers(), filter: "cool", intensity: 0.3 });
    const enqueue = vi.fn().mockResolvedValue("task");
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, decorations: DecorationSchema.parse({ mode: "agent" }), autoCatalog: catalog, onChange: () => {} });
    runner.start("project", "clean", "", [media("agent.mp4")]);
    await runner.settled();
    expect(provider.mock.calls[0][4]).toEqual(catalog);
    expect(enqueue.mock.calls[0][0].layers).toHaveLength(4);
    expect(enqueue.mock.calls[0][0].layers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "sticker", assetPath: "/tmp/heart.png" })]));
  });
});
