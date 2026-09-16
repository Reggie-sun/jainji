import { describe, expect, it } from "vitest";
import { runIndependentCoverReview } from "../src/main/cover-review-provider";
describe("independent review budget", () => it("rejects plans below the frozen blind plus compare count", async () => {
  const frame = { id: "00000000-0000-4000-8000-000000000001", pts: 0, timeBase: 1, width: 1, height: 1, rotation: 0, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, url: "data:image/jpeg;base64,AA==" };
  await expect(runIndependentCoverReview(async () => "{}", { revision: 1, model: "x", maxRequests: 1, media: [{ mediaId: "x", frames: [frame], candidates: [] }] }, new AbortController().signal, async () => undefined)).rejects.toThrow(/预算/);
}));
