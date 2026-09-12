import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/main/agent-runner";
import { type MediaItem, now } from "../src/main/domain";
import { ProviderError, type PackagingPlan } from "../src/main/agent-provider";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

function media(name: string): MediaItem {
  return { id: crypto.randomUUID(), sourcePath: `/tmp/${name}`, displayName: name, fingerprint: name, width: 640, height: 480, durationMs: 1000, sizeBytes: 10, rotation: 0, importedAt: now(), probeStatus: "ready" };
}
function plan(text: string): PackagingPlan {
  return { summary: text, captions: [{ text, corner: "top-left", size: 0.026 }], filter: "cool", intensity: 0.3 };
}
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;

describe("agent run lifecycle", () => {
  it("isolates failed material and freezes an independent plan for every export", async () => {
    const sources = [media("a.mp4"), media("b.mp4"), media("c.mp4")];
    const enqueue = vi.fn().mockResolvedValue("task");
    const provider = vi.fn().mockResolvedValueOnce(plan("第一条")).mockRejectedValueOnce(new ProviderError("请求失败")).mockResolvedValueOnce(plan("第三条"));
    const runner = new AgentRunner({ frames: async () => [], plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", sources);
    sources[2].displayName = "changed.mp4";
    await runner.settled();
    expect(runner.snapshot()?.items.map((item) => item.status)).toEqual(["exporting", "failed", "exporting"]);
    expect(enqueue.mock.calls.map(([template]) => template.layers[0].content)).toEqual(["第一条", "第三条"]);
    expect(enqueue.mock.calls[1][1].displayName).toBe("c.mp4");
    expect(enqueue.mock.calls[0][0].id).not.toBe(enqueue.mock.calls[1][0].id);
  });

  it("blocks concurrent runs and stops before any further provider call or export", async () => {
    let release!: (images: string[]) => void;
    const frames = () => new Promise<string[]>((resolve) => { release = resolve; });
    const provider = vi.fn(); const enqueue = vi.fn();
    const runner = new AgentRunner({ frames, plan: provider, enqueue, stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a"), media("b")]);
    expect(() => runner.start("project", "clean", "", [media("c")])).toThrow("正在处理");
    runner.cancel(); release([]);
    await runner.settled();
    expect(provider).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(runner.snapshot()?.status).toBe("cancelled");
    expect(runner.snapshot()?.items.every((item) => item.status === "cancelled")).toBe(true);
  });

  it("does not publish arbitrary local errors to the frontend", async () => {
    const runner = new AgentRunner({ frames: async () => { throw new Error("private path or key"); }, plan: vi.fn(), enqueue: vi.fn(), stickerAssets, onChange: () => {} });
    runner.start("project", "clean", "", [media("a")]);
    await runner.settled();
    expect(JSON.stringify(runner.snapshot())).not.toContain("private path or key");
  });
});
