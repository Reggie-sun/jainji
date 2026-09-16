import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runIndependentCoverReview } from "../src/main/cover-review-provider";
const frame = () => ({ id: randomUUID(), pts: 0, timeBase: .001, width: 10, height: 10, rotation: 0, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, url: "data:image/jpeg;base64,AA==" });
const input = () => { const frames = Array.from({ length: 9 }, frame); return { revision: 1, model: "fixture", maxRequests: 4, media: [{ mediaId: randomUUID(), frames, candidates: [{ id: randomUUID(), semantics: "unknown", observations: [], segments: [] }] }] }; };
describe("independent cover review", () => {
  it("persists every blind success before compare and hides candidates from blind requests", async () => {
    const value = input(), attempts: any[] = []; const complete = vi.fn(async (messages: any[]) => JSON.stringify({ status: "no_issue_observed", findings: [] }));
    const result = await runIndependentCoverReview(complete, value, new AbortController().signal, async (attempt) => { attempts.push(attempt); });
    expect(result.status).toBe("complete"); expect(complete).toHaveBeenCalledTimes(4); expect(JSON.stringify(complete.mock.calls[0])).not.toContain(value.media[0].candidates[0].id); expect(attempts.filter((a) => a.phase === "blind" && a.status === "success")).toHaveLength(2);
    const system = complete.mock.calls[0][0][0].content;
    expect(system).toContain("post-added graphic stickers");
    expect(system).toContain("blind phase");
    expect(system).toContain("normalized to the full displayed frame");
  });
  it("returns incomplete for malicious extra fields without retrying", async () => {
    const value = input(), complete = vi.fn(async () => '{"status":"issues","findings":[],"tool":"run"}');
    const result = await runIndependentCoverReview(complete, value, new AbortController().signal, async () => undefined);
    expect(result.status).toBe("incomplete"); expect(complete).toHaveBeenCalledTimes(1);
  });

  it("sends contextual crops as images, retains blind findings, and includes keyframe geometry only in compare", async () => {
    const evidence = frame(), identityId = randomUUID(), segmentId = randomUUID();
    const crop = { ...evidence, url: "data:image/jpeg;base64,AQ==" };
    const value = {
      revision: 1, model: "fixture", maxRequests: 2,
      media: [{
        mediaId: randomUUID(), frames: [evidence],
        candidates: [{
          id: identityId, semantics: "sticker",
          observations: [{ evidenceId: evidence.id, rectangle: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 } }],
          segments: [{ id: segmentId, identityId, track: { startMs: 0, endMs: 1, keyframes: [{ timeMs: 0, rectangle: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 } }] } }],
          crops: [crop],
        }],
      }],
    };
    let count = 0;
    const complete = vi.fn(async (..._messages: any[]) => {
      count++;
      return count === 1 ? JSON.stringify({ status: "issues", findings: [{ kind: "uncertain_presence", evidenceIds: [evidence.id], reason: "sampled" }] }) : "not-json";
    });
    const result = await runIndependentCoverReview(complete, value, new AbortController().signal, async () => undefined);
    expect(result.status).toBe("incomplete");
    expect(result.findings).toHaveLength(1);
    const blind = JSON.stringify(complete.mock.calls[0][0]);
    const compare = complete.mock.calls[1][0];
    expect(blind).not.toContain(identityId);
    const user = compare[1].content as any[];
    const metadata = user.find((item) => item.type === "text").text;
    expect(metadata).toContain(segmentId);
    expect(metadata).toContain("keyframes");
    expect(metadata).not.toContain("data:image");
    expect(user.filter((item) => item.type === "image_url")).toHaveLength(2);
  });

  it("rejects references outside the exact compare batch without making another request", async () => {
    const value = input(), wrongIdentity = randomUUID();
    const complete = vi.fn(async () => JSON.stringify({ status: "issues", findings: [{ kind: "wrong_semantics", evidenceIds: [value.media[0].frames[0].id], identityId: wrongIdentity, reason: "fixture" }] }));
    const result = await runIndependentCoverReview(complete, value, new AbortController().signal, async () => undefined);
    expect(result.status).toBe("incomplete");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not call the model after cancellation during started-attempt persistence", async () => {
    const value = input(), controller = new AbortController(), complete = vi.fn(async () => JSON.stringify({ status: "no_issue_observed", findings: [] }));
    const result = await runIndependentCoverReview(complete, value, controller.signal, async () => { controller.abort(); });
    expect(result.status).toBe("incomplete");
    expect(complete).not.toHaveBeenCalled();
  });

  it("includes a manual segment that is visible in the compare batch without an observation", async () => {
    const evidence = frame(), identityId = randomUUID(), segmentId = randomUUID();
    const value = { revision: 1, model: "fixture", maxRequests: 2, media: [{ mediaId: randomUUID(), frames: [evidence], candidates: [{ id: identityId, semantics: "sticker", observations: [], segments: [{ id: segmentId, identityId, track: { startMs: 0, endMs: 1, keyframes: [{ timeMs: 0, rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } }] } }] }] }] };
    const complete = vi.fn(async (..._messages: any[]) => JSON.stringify({ status: "no_issue_observed", findings: [] }));
    await expect(runIndependentCoverReview(complete, value, new AbortController().signal, async () => undefined)).resolves.toMatchObject({ status: "complete" });
    expect(JSON.stringify(complete.mock.calls[1][0])).toContain(segmentId);
  });
});
