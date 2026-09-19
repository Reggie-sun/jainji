import { expect, it, vi } from "vitest";
import { coverPlacementMessages } from "../src/main/cover-placement-provider";
import { supervisePreview } from "../src/main/supervisor-provider";
import type { ModelMessage } from "../src/main/api-transport";

it("sends full-frame images with approximate placement semantics, not source-fact matching", () => {
  const messages = coverPlacementMessages({ durationMs: 6000, turn: 1, images: [
    { requestedTimeMs: 5500, timeMs: 5490, sourceUrl: "data:image/jpeg;base64,aA==", sourceEvidenceId: "frame" },
  ] });
  expect(messages[0].content).toContain("合理覆盖误差");
  expect(messages[0].content).toContain("propose");
  expect(messages[0].content).toContain("价格在5秒消失无关");
  expect(messages[0].content).toContain("白色不透明底板");
  expect(messages[0].content).toContain("免责声明");
  expect(messages[1].content).toEqual(expect.arrayContaining([
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,aA==", detail: "high" } },
    { type: "text", text: JSON.stringify({ timeMs: 5490 }) },
  ]));
});

it("gives the preview reviewer placement-specific instructions without source-fact requirements", async () => {
  const complete = vi.fn(async (_messages: ModelMessage[]) => "response");
  await supervisePreview(complete, { trackPurpose: "cover-placement", durationMs: 6000, trackHorizonMs: 6000,
    displayMode: "first-5s", stickerDisplayMode: "full", coverEnabled: true, automaticCorners: true,
    tracks: [], layers: [], evidence: [], turn: 1, revision: 0, remainingRevisions: 2, history: [],
  }, new AbortController().signal);
  const prompt = complete.mock.calls[0][0][0].content;
  expect(prompt).toContain("tracks 是拟放置的覆盖框");
  expect(prompt).toContain("不要返回 sourceFacts");
  expect(prompt).not.toContain("tracks 必须返回修正后的全部原贴纸轨迹");
  expect(prompt).toContain("每次有效修订都重新渲染");
  expect(prompt).toContain("opaqueBackground");
  expect(prompt).toContain("白色不透明底板");
  expect(prompt).toContain("未受影响");
  expect(prompt).toContain("inspect");
});
