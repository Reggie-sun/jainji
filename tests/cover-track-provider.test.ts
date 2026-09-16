import { describe, expect, it, vi } from "vitest";
import { AgentProvider, ProviderError } from "../src/main/agent-provider";

const image = (timeMs: number) => ({ timeMs, url: "data:image/jpeg;base64,aGVsbG8=" });
const target = (id: string, x = 0.1) => ({ id, rectangle: { x, y: 0.2, width: 0.2, height: 0.1 } });
const frame = (timeMs: number, targets = [target("badge-1")]) => ({ timeMs, targets });
const detected = (frames = [frame(0), frame(250, [target("badge-1", 0.2), target("badge-2", 0.6)])]) => JSON.stringify({ status: "ok", frames });

describe("automatic cover tracking provider", () => {
  it("reports the uncertain source time window without retrying or treating it as no targets", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ status: "uncertain", frames: [frame(1750), frame(2000)] }));
    const provider = new AgentProvider(); provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(1750), image(2000)], undefined, new AbortController().signal)).rejects.toThrow("1.75–2.00 秒");
    expect(complete).toHaveBeenCalledTimes(1);
  });
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
    expect(user.content).toContainEqual({ type: "image_url", image_url: { url: image(0).url, detail: "high" } });
  });

  it("accepts an empty target list", async () => {
    const complete = vi.fn().mockResolvedValue(detected([frame(500, [])]));
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(500)], undefined, new AbortController().signal)).resolves.toEqual([frame(500, [])]);
  });

  it("scopes completeness to supplied images and handles sticker visibility across a cut", async () => {
    const previous = frame(3500);
    const frames = [previous, frame(3750, []), frame(4000, [target("badge-1"), target("badge-2", 0.6)])];
    const complete = vi.fn().mockResolvedValue(detected(frames));
    const provider = new AgentProvider(); provider.useChatGPT("vision", complete);
    const result = await provider.detectCovers(frames.map(({ timeMs }) => image(timeMs)), previous, new AbortController().signal);
    expect(result.map((frame) => frame.targets.map(({ rectangle }) => rectangle))).toEqual(frames.map((frame) => frame.targets.map(({ rectangle }) => rectangle)));
    expect(result[2].targets[0].id).toBe(previous.targets[0].id);
    expect(result[2].targets[1].id).not.toBe(previous.targets[0].id);
    const instructions = complete.mock.calls[0][0][0].content;
    expect(instructions).toContain("只判断本次实际提供的抽帧");
    expect(instructions).toContain("不要因为未提供的帧不可见而返回 uncertain");
    expect(instructions).toContain("普通口播字幕、字幕条不属于贴纸");
    expect(instructions).toContain("贴纸内部的文字仍属于贴纸图案");
    expect(instructions).toContain("目标消失的帧不要返回该目标");
    expect(instructions).toContain("切镜本身不代表识别不确定");
    expect(instructions).toContain("无法可靠区分、定位或穷尽可见贴纸时，返回 status=uncertain");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("rejects added or omitted overlap targets without feeding old detections back to the model", async () => {
    const complete = vi.fn().mockResolvedValue(detected([frame(250, []), frame(500)]));
    const provider = new AgentProvider(); provider.useChatGPT("vision", complete);
    const result = await provider.detectCovers([image(250), image(500)], frame(250, []), new AbortController().signal);
    expect(result[0]).toEqual(frame(250, []));
    expect(result[1].targets).toHaveLength(1);
    const context = complete.mock.calls[0][0][1].content[0].text as string;
    expect(context).toContain("独立检查本窗口每张画面");
    expect(context).not.toContain("上一窗口");
    complete.mockResolvedValueOnce(detected([frame(250), frame(500)]));
    await expect(provider.detectCovers([image(250), image(500)], frame(250, []), new AbortController().signal)).rejects.toThrow("重叠抽帧");
    complete.mockResolvedValueOnce(detected([frame(250, []), frame(500, [])]));
    await expect(provider.detectCovers([image(250), image(500)], frame(250), new AbortController().signal)).rejects.toThrow("重叠抽帧");
    expect(complete).toHaveBeenCalledTimes(3);
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
    expect(JSON.stringify(complete.mock.calls[0][0])).not.toContain("badge-1");

    complete.mockResolvedValueOnce(detected([frame(250, [target("different", 0.2)]), frame(500, [target("different", 0.3)])]));
    await expect(provider.detectCovers([image(250), image(500)], previous, new AbortController().signal)).resolves.toEqual([frame(250, [target("badge-1", 0.2)]), frame(500, [target("badge-1", 0.3)])]);
  });

  it("aligns window-local IDs by geometry and tolerates small detection jitter", async () => {
    const previous = frame(250, [target("a", 0.1), target("b", 0.7)]);
    const complete = vi.fn().mockResolvedValue(detected([frame(250, [target("a", 0.7), target("b", 0.1)])]));
    const provider = new AgentProvider();
    provider.useChatGPT("vision", complete);
    await expect(provider.detectCovers([image(250)], previous, new AbortController().signal)).resolves.toEqual([frame(250, [target("b", 0.7), target("a", 0.1)])]);
    complete.mockResolvedValueOnce(detected([frame(250, [target("a", 0.102), target("b", 0.698)])]));
    await expect(provider.detectCovers([image(250)], previous, new AbortController().signal)).resolves.toHaveLength(1);
  });

  it("rejects ambiguous, duplicate or substantially displaced overlap matches", async () => {
    const provider = new AgentProvider();
    const complete = vi.fn(); provider.useChatGPT("vision", complete);
    for (const [previous, next] of [
      [frame(250, [target("a", 0.1), target("b", 0.11)]), frame(250, [target("x", 0.1), target("y", 0.11)])],
      [frame(250, [target("a", 0.1), target("b", 0.7)]), frame(250, [target("x", 0.1), target("y", 0.102)])],
      [frame(250), frame(250, [target("x", 0.6)])],
    ]) {
      complete.mockResolvedValueOnce(detected([next]));
      await expect(provider.detectCovers([image(250)], previous, new AbortController().signal)).rejects.toThrow("重叠抽帧");
    }
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("does not give a new target the continuing target's ID after local renumbering", async () => {
    const previous = frame(250, [target("a")]);
    const complete = vi.fn().mockResolvedValue(detected([frame(250, [target("b")]), frame(500, [target("b"), target("a", 0.6)])]));
    const provider = new AgentProvider(); provider.useChatGPT("vision", complete);
    const result = await provider.detectCovers([image(250), image(500)], previous, new AbortController().signal);
    expect(result[0].targets[0].id).toBe("a");
    expect(result[1].targets[0].id).toBe("a");
    expect(result[1].targets[1].id).not.toBe("a");
    complete.mockResolvedValueOnce(detected([frame(500, [target("x"), target("y", 0.6)]), frame(750, [target("y", 0.62)])]));
    const next = await provider.detectCovers([image(500), image(750)], result[1], new AbortController().signal);
    expect(next[1].targets[0].id).toBe(result[1].targets[1].id);
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
