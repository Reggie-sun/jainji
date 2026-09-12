import { describe, expect, it, vi, afterEach } from "vitest";
import { AgentController } from "../src/main/agent-controller";
import { resolveFont, FfmpegAdapter } from "../src/main/ffmpeg";
import { ApplicationService } from "../src/main/application";
import type { ExportQueue } from "../src/main/queue";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";

vi.mock("../src/main/ffmpeg", async (original) => ({ ...await original<typeof import("../src/main/ffmpeg")>(), resolveFont: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("font admission before provider", () => {
  it("checks default font even when old requests omit decorations", async () => {
    vi.mocked(resolveFont).mockResolvedValue(null);
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const service = new ApplicationService(ffmpeg, { resolve: resolveFont });
    const queue = { snapshot: () => ({ batches: [] }) } as unknown as ExportQueue;
    const controller = new AgentController(service, queue, ffmpeg, () => {}, {} as BuiltinStickerAssets);
    controller.provider.configure({ baseUrl: "https://example.test", apiKey: "fixture", model: "fixture" });
    const plan = vi.spyOn(controller.provider, "plan");
    await expect(controller.start({ ruleId: "clean", mediaIds: [crypto.randomUUID()], outputDirectory: "relative", brief: "" }, new Set())).rejects.toThrow("所选字体不可用");
    expect(resolveFont).toHaveBeenCalledWith("Noto Sans CJK SC");
    expect(plan).not.toHaveBeenCalled();
  });
});
