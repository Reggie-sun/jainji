import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CoverStickerSchema, DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { CoverReviewDraftSchema } from "../src/shared/cover-review";
import { resolveCoverSticker } from "../src/main/cover-sticker";

describe("assisted cover contracts", () => {
  it("accepts an explicit assisted draft without manual artwork and never resolves it as manual", () => {
    const settings = { ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "assisted" };
    expect(CoverStickerSchema.parse(settings).trackingMode).toBe("assisted");
    expect(() => resolveCoverSticker(settings as never, {}, [])).toThrow(/审阅/);
    expect(resolveCoverSticker({ ...settings, enabled: false } as never, {}, [])).toBeUndefined();
  });
  it("rejects unknown modes", () => {
    expect(CoverStickerSchema.safeParse({ ...DEFAULT_COVER_STICKER, trackingMode: "future" }).success).toBe(false);
  });
  it("requires explicit resolution and rejects overlapping segments of an identity", () => {
    const identityId = randomUUID();
    const draft = { id: randomUUID(), runId: randomUUID(), projectId: randomUUID(), revision: 0,
      mode: "assisted", status: "needs_human", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      media: [{ mediaId: randomUUID(), sourceFingerprint: "source", durationMs: 1000, analysis: "not_started",
        identities: [{ id: identityId, label: "贴纸", semantics: "unknown", origin: "human" }],
        segments: [], evidence: [], observations: [], issues: [], decisions: [], disposition: "unresolved" }], frozen: [] };
    expect(CoverReviewDraftSchema.parse(draft).media[0].disposition).toBe("unresolved");
    const segment = { id: randomUUID(), identityId, origin: "human", track: { startMs: 0, endMs: 600, keyframes: [{ timeMs: 0, rectangle: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } }] } };
    expect(CoverReviewDraftSchema.safeParse({ ...draft, media: [{ ...draft.media[0], segments: [segment, { ...segment, id: randomUUID() }] }] }).success).toBe(false);
    expect(CoverReviewDraftSchema.safeParse({ ...draft, approved: true }).success).toBe(false);
  });
});
