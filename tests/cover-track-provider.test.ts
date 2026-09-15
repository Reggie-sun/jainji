import { describe, expect, it, vi } from "vitest";
import { AgentProvider, ProviderError } from "../src/main/agent-provider";

const image = (timeMs: number) => ({ timeMs, url: "data:image/jpeg;base64,aGVsbG8=" });
const target = (id: string, x = 0.1) => ({ id, rectangle: { x, y: 0.2, width: 0.2, height: 0.1 } });
const frame = (timeMs: number, targets = [target("badge-1")]) => ({ timeMs, targets });
const detected = (frames = [frame(0), frame(250, [target("badge-1", 0.2), target("badge-2", 0.6)])]) => JSON.stringify({ status: "ok", frames });

describe("automatic cover tracking provider", () => {
  it("returns every detected target for every submitted frame", async () => {
    const complete = vi.fn().mockResolvedValue(detected());
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);

    await expect(provider.detectCovers([image(0), image(250)], undefined, new AbortController().signal)).resolves.toEqual([
      frame(0), frame(250, [target("badge-1", 0.2), target("badge-2", 0.6)]),
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    const [system, user] = complete.mock.calls[0][0];
    expect(system.content).toContain("所有后期叠加的贴纸、图形价签和装饰覆盖物");
    expect(system.content).toContain("真实产品标签、人脸、实物");
    expect(user.content).toContainEqual({ type: "image_url", image_url: { url: image(0).url, detail: "low" } });
  });

  it("accepts an empty target list", async () => {
    const complete = vi.fn().mockResolvedValue(detected([frame(500, [])]));
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(500)], undefined, new AbortController().signal)).resolves.toEqual([frame(500, [])]);
  });

  it("makes an empty overlap explicit without allowing later targets to be moved into it", async () => {
    const complete = vi.fn().mockResolvedValue(detected([frame(250, []), frame(500)]));
    const provider = new AgentProvider(); provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(250), image(500)], frame(250, []), new AbortController().signal)).resolves.toEqual([frame(250, []), frame(500)]);
    const context = complete.mock.calls[0][0][1].content[0].text as string;
    expect(context).toContain("第一帧 targets 必须为空数组");
    expect(context).toContain("不得把后续帧新出现的目标提前到第一帧");
    expect(context).toContain("status=uncertain");
    complete.mockResolvedValueOnce(detected([frame(250), frame(500)]));
    await expect(provider.detectCovers([image(250), image(500)], frame(250, []), new AbortController().signal)).rejects.toThrow("重叠抽帧");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it.each([
    [JSON.stringify({ status: "uncertain", frames: [frame(0)] }), "无法可靠识别全部原贴纸"],
    ["not-json", "JSON 格式无效"],
    [JSON.stringify({ status: "ok", frames: [frame(0)], privateValue: "model-secret" }), "必须返回仅含 status 和 frames"],
    [detected([frame(1)]), "逐项返回"],
  ])("fails safely for uncertain or malformed results", async (response, reason) => {
    const complete = vi.fn().mockResolvedValue(response);
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    const error = await provider.detectCovers([image(0)], undefined, new AbortController().signal).catch((failure: unknown) => failure) as Error;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toContain(reason);
    expect(error.message).not.toContain("model-secret");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("accepts only image data URLs and matching frame times before dispatch", async () => {
    const complete = vi.fn();
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([{ timeMs: 0, url: "file:///tmp/source.jpg" }], undefined, new AbortController().signal)).rejects.toThrow("抽帧无效");
    await expect(provider.detectCovers([image(0), image(0)], undefined, new AbortController().signal)).rejects.toThrow("抽帧无效");
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses the selected ChatGPT completion and keeps overlap identities", async () => {
    const complete = vi.fn().mockResolvedValue(detected([frame(250, [target("badge-1", 0.2)]), frame(500, [target("badge-1", 0.3), target("badge-2", 0.6)])]));
    const provider = new AgentProvider();
    provider.useChatGPT("selected-vision", complete);
    const previous = frame(250, [target("badge-1", 0.2)]);

    await expect(provider.detectCovers([image(250), image(500)], previous, new AbortController().signal)).resolves.toHaveLength(2);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0][1].content[0]).toMatchObject({ type: "text", text: expect.stringContaining("badge-1") });

    complete.mockResolvedValueOnce(detected([frame(250, [target("different")]), frame(500, [target("different")])]));
    await expect(provider.detectCovers([image(250), image(500)], previous, new AbortController().signal)).rejects.toThrow("目标 ID 必须与上一窗口保持一致");
  });

  it("rejects exchanged target boxes on the identical overlap image but tolerates small detection jitter", async () => {
    const previous = frame(250, [target("a", 0.1), target("b", 0.7)]);
    const complete = vi.fn().mockResolvedValue(detected([frame(250, [target("a", 0.7), target("b", 0.1)])]));
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(250)], previous, new AbortController().signal)).rejects.toThrow("重叠抽帧");
    complete.mockResolvedValueOnce(detected([frame(250, [target("a", 0.102), target("b", 0.698)])]));
    await expect(provider.detectCovers([image(250)], previous, new AbortController().signal)).resolves.toHaveLength(1);
  });

  it("does not dispatch after cancellation", async () => {
    const complete = vi.fn();
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.detectCovers([image(0)], undefined, controller.signal)).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});
