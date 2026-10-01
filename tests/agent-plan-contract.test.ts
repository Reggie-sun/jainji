import { describe, expect, it, vi } from "vitest";
import { AgentProvider, ProviderError, materializePlan, validatePlan } from "../src/main/agent-provider";
import { AgentRunner } from "../src/main/agent-runner";
import { now, type MediaItem } from "../src/main/domain";
import { CORNER_SAFE_POLICY } from "../src/shared/layout-policy";

const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
const asset = { assetPath: "/tmp/simulated.png", assetFingerprint: "sha256:simulated" };
const stickerAssets = { sparkle: asset, arrow: asset, heart: asset, burst: asset };
const plan = {
  summary: "保留主体", captions: [], priceStyle: "classic", filter: "none", intensity: 0,
  stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })),
};

describe("packaging plan contract", () => {
  it("rejects individually valid widths whose combined area exceeds the template limit before materialization", async () => {
    const oversized = { ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, width: 0.1 })) };
    expect(() => validatePlan(oversized, "black-gold", catalog)).toThrow("贴纸总面积");
    const complete = vi.fn().mockResolvedValue(JSON.stringify(oversized));
    const provider = new AgentProvider(); provider.useChatGPT("simulated", complete);
    const result = provider.plan("black-gold", "", [], new AbortController().signal, catalog);
    await expect(result).rejects.toThrow(ProviderError);
    await expect(result).rejects.toThrow("贴纸总面积");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("retains the template area tolerance and accepts valid mixed sizes", () => {
    const atLimit = Math.sqrt(CORNER_SAFE_POLICY.maxTotalStickerAreaProxy / 4);
    expect(() => validatePlan({ ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, width: atLimit })) }, "black-gold", catalog)).not.toThrow();
    expect(() => validatePlan({ ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, width: Math.sqrt((CORNER_SAFE_POLICY.maxTotalStickerAreaProxy + 0.5e-9) / 4) })) }, "black-gold", catalog)).not.toThrow();
    expect(() => validatePlan({ ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, width: Math.sqrt((CORNER_SAFE_POLICY.maxTotalStickerAreaProxy + 2e-9) / 4) })) }, "black-gold", catalog)).toThrow("贴纸总面积");
  });

  it("sends a constrained ChatGPT plan schema while retaining local validation", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(plan));
    const provider = new AgentProvider(); provider.useChatGPT("simulated", complete);
    await provider.plan("black-gold", "", [], new AbortController().signal, catalog);
    const options = complete.mock.calls[0][2];
    expect(options?.chatgptOutputSchema).toMatchObject({
      type: "object", additionalProperties: false,
      properties: {
        captions: { type: "array", maxItems: 0 },
        stickers: { type: "array", minItems: 4, maxItems: 4, items: { additionalProperties: false, properties: {
          sticker: { enum: ["heart"] }, width: { maximum: CORNER_SAFE_POLICY.maxStickerWidth },
        } } },
      },
    });
    complete.mockResolvedValue(JSON.stringify({ ...plan, captions: ["未经确认的文字"] }));
    await expect(provider.plan("black-gold", "", [], new AbortController().signal, catalog)).rejects.toThrow("captions 必须为空数组");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("constrains legacy ChatGPT plans without requiring automatic stickers or price styles", async () => {
    const { stickers: _stickers, priceStyle: _priceStyle, ...legacy } = { ...plan, filter: "cool", intensity: 0.4 };
    const complete = vi.fn().mockResolvedValue(JSON.stringify(legacy));
    const provider = new AgentProvider(); provider.useChatGPT("simulated", complete);
    await provider.plan("clean", "", [], new AbortController().signal);
    const schema = complete.mock.calls[0][2]?.chatgptOutputSchema;
    expect(schema?.required).toEqual(["summary", "captions", "filter", "intensity"]);
    expect(schema?.properties).not.toHaveProperty("stickers");
    expect(schema?.properties).not.toHaveProperty("priceStyle");
  });

  it.each([
    [{ width: "private-value" }, "width 必须"],
    [{ rotationDeg: "private-value" }, "rotationDeg 必须"],
  ])("reports the invalid geometry field without exposing model values", async (geometry, reason) => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, ...geometry })) }));
    const provider = new AgentProvider(); provider.useChatGPT("simulated", complete);
    const result = provider.plan("black-gold", "", [], new AbortController().signal, catalog);
    await expect(result).rejects.toThrow(reason);
    await expect(result).rejects.not.toThrow("private-value");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("reports a missing local candidate as a safe provider error", () => {
    const id = `uploaded-${"a".repeat(64)}`;
    const missing = { ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, sticker: id })) };
    const candidates = { fonts: [], stickers: [{ id, label: "已缺失贴纸" }] };
    expect(() => materializePlan(missing, "black-gold", { width: 640, height: 480 }, stickerAssets, { mode: "agent" }, candidates)).toThrow(ProviderError);
    expect(() => materializePlan(missing, "black-gold", { width: 640, height: 480 }, stickerAssets, { mode: "agent" }, candidates)).toThrow("所选贴纸尚未下载");
  });

  it("preserves the specific rejection in the runner and never enqueues an oversized plan", async () => {
    const source: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/simulated.mp4", displayName: "simulated.mp4", fingerprint: "simulated", width: 640, height: 480, durationMs: 1000, sizeBytes: 10, rotation: 0, importedAt: now(), probeStatus: "ready" };
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ ...plan, stickers: plan.stickers.map(sticker => ({ ...sticker, width: 0.1 })) }));
    const provider = new AgentProvider(); provider.useChatGPT("simulated", complete);
    const enqueue = vi.fn();
    const runner = new AgentRunner({ frames: async () => [], plan: (rule, brief, frames, signal, candidates) => provider.plan(rule, brief, frames, signal, candidates),
      enqueue, autoCatalog: catalog, decorations: { mode: "agent", sticker: "template", fontFamily: "Noto Sans CJK SC" }, stickerAssets, onChange: () => {} });
    runner.start(crypto.randomUUID(), "black-gold", "", [source]); await runner.settled();
    expect(runner.snapshot()?.items[0]).toMatchObject({ status: "failed", error: expect.stringContaining("贴纸总面积") });
    expect(enqueue).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
  });
});
