import { describe, expect, it, vi, afterEach } from "vitest";
import { AgentController } from "../src/main/agent-controller";
import { resolveFont, FfmpegAdapter } from "../src/main/ffmpeg";
import { ApplicationService } from "../src/main/application";
import type { ExportQueue } from "../src/main/queue";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import { DecorationSchema } from "../src/shared/decorations";

vi.mock("../src/main/ffmpeg", async (original) => ({ ...await original<typeof import("../src/main/ffmpeg")>(), resolveFont: vi.fn() }));
vi.mock("../src/main/sticker-preview", () => ({ stickerPreview: vi.fn(async () => "data:image/jpeg;base64,aA==") }));
afterEach(() => vi.clearAllMocks());
describe("font admission before provider", () => {
  it.each([{ productPrice: "19.90" }, { mode: "manual", productPrice: "19.90", fontFamily: "Noto Serif CJK SC" }, { mode: "agent", productPrice: "19.90" }])("checks the required default font before provider work: %j", async (decorations) => {
    vi.mocked(resolveFont).mockImplementation(async (family) => family === "Noto Serif CJK SC" ? "/tmp/serif.ttf" : null);
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: resolveFont });
    const queue = { snapshot: () => ({ batches: [] }) } as unknown as ExportQueue;
    const assets = Object.fromEntries(["sparkle", "arrow", "heart", "burst", `uploaded-${"a".repeat(64)}`].map((id) => [id, { assetPath: "/tmp/fixture.png", assetFingerprint: "fixture" }])) as BuiltinStickerAssets;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, assets);
    controller.provider.configure({ baseUrl: "https://example.test", apiKey: "fixture", model: "fixture" });
    controller.visionProvider.configure({ baseUrl: "https://example.test", apiKey: "fixture", model: "detector" });
    controller.reviewerProvider.configure({ baseUrl: "https://example.test", apiKey: "fixture", model: "detector" });
    const plan = vi.spyOn(controller.provider, "plan");
    await expect(controller.start({ ruleId: "clean", mediaIds: [crypto.randomUUID()], outputDirectory: "relative", brief: "", decorations: decorations ? DecorationSchema.parse(decorations) : undefined }, new Set())).rejects.toThrow("所选字体不可用");
    expect(resolveFont).toHaveBeenCalledWith("Noto Sans CJK SC");
    expect(plan).not.toHaveBeenCalled();
  });
});
