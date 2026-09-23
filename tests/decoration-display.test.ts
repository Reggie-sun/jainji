import { describe, expect, it, vi } from "vitest";
import { AgentProvider, materializePlan } from "../src/main/agent-provider";
import { DEFAULT_PRESET, EditTemplateSchema, type MediaItem } from "../src/main/domain";
import { TemplateCompiler } from "../src/main/compiler";
import { DecorationSchema, ProductionDecorationSchema } from "../src/shared/decorations";

const plan = { summary: "保留原画面", captions: [], filter: "cool", intensity: 0.3 };
const asset = { assetPath: "/tmp/sticker.png", assetFingerprint: "fixture" };
const assets = { sparkle: asset, arrow: asset, heart: asset, burst: asset };
const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "fixture", fingerprint: "fixture", sizeBytes: 1, durationMs: 5000, width: 320, height: 240, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };

describe("decoration display timing", () => {
  it("rejects unsupported timing and preserves the choice in automatic normalization", () => {
    expect(DecorationSchema.safeParse({ displayMode: "3" }).success).toBe(false);
    expect(DecorationSchema.parse({ mode: "agent", displayMode: "first-3s" }).displayMode).toBe("first-3s");
    expect(ProductionDecorationSchema.parse({ mode: "agent", displayMode: "first-3s" }).displayMode).toBe("first-5s");
    expect(DecorationSchema.parse({}).displayMode).toBeUndefined();
  });

  it.each(["manual", "agent"] as const)("freezes the %s choice through template serialization", mode => {
    const catalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
    const automaticPlan = { ...plan, priceStyle: "classic", stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) };
    const template = materializePlan(mode === "agent" ? automaticPlan : plan, "clean", media, assets, { mode, productPrice: "9.9元\n两支", displayMode: "first-3s" }, mode === "agent" ? catalog : undefined);
    expect(EditTemplateSchema.parse(JSON.parse(JSON.stringify(template))).decorationDisplayMode).toBe("first-5s");
    expect(EditTemplateSchema.parse(JSON.parse(JSON.stringify(template)))).toHaveProperty("stickerDisplayMode", "full");
    expect(template.layers.find(layer => layer.type === "text")).toMatchObject({ content: "9.9元\n两支" });
  });

  it.each(["manual", "agent"] as const)("tells the brief Agent the selected time in %s mode", async mode => {
    const complete = vi.fn().mockResolvedValue("使用已有素材");
    const provider = new AgentProvider(); provider.useChatGPT("fixture", complete);
    await provider.generateBrief({ ruleId: "clean", decorations: { mode, productPrice: "9.9元", displayMode: "first-3s" } }, new AbortController().signal);
    expect(JSON.stringify(complete.mock.calls[0][0])).toContain("仅在视频前 5 秒显示");
  });

  it.each([undefined, "full", "first-3s", "first-5s"] as const)("compiles %s timing with corner gaps, static covers and moving covers", async displayMode => {
    const template = materializePlan(plan, "clean", media, assets, { productPrice: "9.9元\n两支", displayMode });
    const sticker = template.layers.find(layer => layer.type === "sticker")!;
    if (sticker.type !== "sticker") throw Error("missing sticker");
    sticker.activeRanges = [{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 5000 }];
    const rectangle = { x: 0.4, y: 0.5, width: 0.1, height: 0.1 };
    template.layers.push({ ...sticker, x: rectangle.x, y: rectangle.y, width: rectangle.width, id: crypto.randomUUID(), activeRanges: undefined, opacity: 1, rotationDeg: 0, cover: { stickerId: "heart", regionId: crypto.randomUUID(), height: rectangle.height } });
    const staticCover = template.layers.at(-1)!;
    if (staticCover.type !== "sticker") throw Error("missing cover");
    template.layers.push({ ...staticCover, id: crypto.randomUUID(), cover: { ...staticCover.cover!, regionId: crypto.randomUUID(), motion: { startMs: 1000, endMs: 5000, keyframes: [{ timeMs: 1000, rectangle }] } } });
    const options = { ffmpegPath: "/fake", fontResolver: { resolve: async () => "/tmp/font.ttf" }, textFilePath: (id: string) => `/tmp/${id}.txt` };
    const compiled = await new TemplateCompiler().compile(template, media, DEFAULT_PRESET, options);
    const graph = compiled.textFiles.find(file => file.layerId === "cover-graph")!.content;
    expect(graph).toContain("gte(t,0)*lt(t,1)+gte(t,2)*lt(t,5)");
    expect(graph).toContain("gte(t,1)*lt(t,5)");
    expect(graph.match(/lt\(t,5\)/g)?.length ?? 0).toBe(displayMode?.startsWith("first-") ? 4 : 2);
    expect(graph).not.toContain("lt(t,3)");
    expect(graph.match(/\[base\d+Text\]fade=t=out/g)?.length ?? 0).toBe(displayMode?.startsWith("first-") ? 2 : 0);
    expect(graph).not.toContain("sticker1Faded");
    expect(await new TemplateCompiler().compile(JSON.parse(JSON.stringify(template)), media, DEFAULT_PRESET, options)).toEqual(compiled);
    const legacy = JSON.parse(JSON.stringify(template)); delete legacy.stickerDisplayMode;
    if (displayMode?.startsWith("first-")) legacy.decorationDisplayMode = "first-3s";
    const historical = await new TemplateCompiler().compile(legacy, media, DEFAULT_PRESET, options);
    expect(historical.textFiles.find(file => file.layerId === "cover-graph")!.content.match(/lt\(t,3\)/g)?.length ?? 0).toBe(displayMode?.startsWith("first-") ? 5 : 0);
  });
});
