import { describe, expect, it, vi } from "vitest";
import { parseCandidateDecision, parsePreviewDecision, previewVerdict, resolvePreviewReviews } from "../src/main/shape-cover-vision-schema.js";
import { createVisionPacket, VISION_PACKET_LIMITS, type VisionImageInput } from "../src/main/shape-cover-vision-packet.js";
import { ShapeCoverVisionSession, type VisionRoute } from "../src/main/shape-cover-vision-router.js";
import { createHybridVisionRoutes, HYBRID_GPT_MODELS, HYBRID_REQUESTED_GPT_MODELS } from "../src/main/shape-cover-vision-provider.js";
import type { ModelConnections } from "../src/main/model-connections.js";

const packetDigest = "a".repeat(64);
const candidate = (decision = "UNKNOWN") => ({ packetDigest, decisions: [{ candidateId: "c1", decision,
  class: decision === "CONFIRM" ? "OVERLAY_STICKER" : "UNKNOWN", temporalState: "UNCERTAIN", riskFlags: [], shortReason: "uncertain" }], groups: [], undetectedOverlaySuspected: false });
const preview = () => ({ packetDigest, oldOverlayResidual: "PASS", unintendedOcclusion: "PASS", unnaturalPlacement: "PASS", temporalMismatch: "PASS", riskFlags: [], shortReason: "clear" });

describe("Hybrid vision strict responses", () => {
  it("preserves UNKNOWN and binds the exact packet and candidate set", () => {
    expect(parseCandidateDecision(JSON.stringify(candidate()), packetDigest, ["c1"]).decisions[0].decision).toBe("UNKNOWN");
    expect(() => parseCandidateDecision(JSON.stringify(candidate()), "b".repeat(64), ["c1"])).toThrow();
    expect(() => parseCandidateDecision(JSON.stringify(candidate()), packetDigest, ["other"])).toThrow();
  });
  it("rejects unknown fields and malformed/free-form output", () => {
    expect(() => parseCandidateDecision(JSON.stringify({ ...candidate(), extra: 1 }), packetDigest, ["c1"])).toThrow();
    expect(() => parseCandidateDecision("```json\n{}\n```", packetDigest, ["c1"])).toThrow();
    expect(() => parsePreviewDecision(JSON.stringify({ ...preview(), alpha: [] }), packetDigest)).toThrow();
  });
  it("rejects invented, omitted, repeated and rejected grouping members", () => {
    const c = candidate("CONFIRM");
    expect(() => parseCandidateDecision(JSON.stringify(c), packetDigest, ["c1"])).toThrow();
    for (const ids of [["invented"], ["c1", "c1"]]) {
      expect(() => parseCandidateDecision(JSON.stringify({ ...c, groups: [{ candidateIds: ids, sameLogicalOverlay: true }] }), packetDigest, ["c1"])).toThrow();
    }
    expect(parseCandidateDecision(JSON.stringify({ ...c, groups: [{ candidateIds: ["c1"], sameLogicalOverlay: true }] }), packetDigest, ["c1"]).groups).toHaveLength(1);
    expect(() => parseCandidateDecision(JSON.stringify({ ...candidate(), groups: [{ candidateIds: ["c1"], sameLogicalOverlay: true }] }), packetDigest, ["c1"])).toThrow();
  });
  it("does not use confidence and refuses high-risk Sol/MiniMax disagreement", () => {
    const p = parsePreviewDecision(JSON.stringify(preview()), packetDigest);
    expect(previewVerdict(p)).toBe("PASS");
    expect(resolvePreviewReviews({ ...p, oldOverlayResidual: "FAIL" }, p)).toBe("UNSAFE");
    expect(resolvePreviewReviews({ ...p, unintendedOcclusion: "UNKNOWN" }, { ...p, unintendedOcclusion: "UNKNOWN" })).toBe("UNSAFE");
    expect(resolvePreviewReviews({ ...p, unnaturalPlacement: "UNKNOWN" }, p)).toBe("PASS");
  });
});

const sourceKey = "b".repeat(64);
function packet(kind: "CANDIDATE" | "PREVIEW" = "CANDIDATE", fresh: () => Promise<void> = async () => {}) {
  const png = Buffer.alloc(24); png.write("89504e470d0a1a0a", "hex"); png.writeUInt32BE(8, 16); png.writeUInt32BE(8, 20);
  const crop = { x: 0, y: 0, width: 8, height: 8 };
  const input = { kind, sourceKey, sourceWidth: 8, sourceHeight: 8, timeBase: "1/30", candidates: [{ candidateId: "c1", gridBox: crop, sourceBox: crop,
    signals: { stablePixels: 20, meanMaxChannelStd: 0, edgePixels: 8, meanAdjacentPersistence: 1, sampledScreenCoordinateConsistency: 1 } }] };
  const images: VisionImageInput[] = [0, 15, 29].flatMap(ordinal => [kind === "CANDIDATE" ? "CONTEXT" as const : "ORIGINAL" as const,
    kind === "CANDIDATE" ? "CROP" as const : "COVERED" as const].map(imageKind => ({ sourceKey, ordinal, pts: ordinal,
      pixelSha256: "c".repeat(64), crop, candidateIds: ["c1"], kind: imageKind, png })));
  return { input, images, build: () => createVisionPacket(input, images, fresh) };
}
function routes(output: (role: string, digest: string) => unknown) {
  return Object.fromEntries(["LUNA", "SOL", "MINIMAX"].map(role => [role, { provider: "fixture", model: role === "LUNA" ? HYBRID_GPT_MODELS.LUNA : role === "SOL" ? HYBRID_GPT_MODELS.SOL : "MiniMax-M3",
    imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: vi.fn(async messages => {
      const text = (messages[1].content as { type: string; text?: string }[])[0].text!;
      return JSON.stringify(output(role, JSON.parse(text).packetDigest));
    }) } satisfies VisionRoute])) as unknown as Record<"LUNA" | "SOL" | "MINIMAX", VisionRoute>;
}

describe("Hybrid bounded image packets", () => {
  it("binds deterministic image/source/time/crop identity without serializing local paths", () => {
    const a = packet(), p = a.build();
    expect(p.packetDigest).toBe(a.build().packetDigest);
    expect(p.manifest.images).toHaveLength(6);
    expect(JSON.stringify(p.content())).not.toMatch(/sourcePath|filename|\/home\/|file:\/\//);
    a.images[0].png.fill(0);
    expect(p.content().filter(i => i.type === "image_url")).toHaveLength(6);
    p.manifest.images[0].pts = 500;
    expect(p.manifest.images[0].pts).toBe(0);
    const b = packet(); b.images[0].pts++; b.images[1].pts++;
    expect(b.build().packetDigest).not.toBe(p.packetDigest);
  });
  it("rejects oversized image/count/aggregate, wrong source/crop and missing context or paired preview", () => {
    const a = packet();
    expect(() => createVisionPacket(a.input, Array(13).fill(a.images[0]), async () => {})).toThrow(/BUDGET/);
    expect(() => createVisionPacket(a.input, [{ ...a.images[0], png: Buffer.alloc(VISION_PACKET_LIMITS.imageBytes + 1) }], async () => {})).toThrow(/BUDGET/);
    expect(() => createVisionPacket(a.input, Array(5).fill({ ...a.images[0], png: Buffer.alloc(VISION_PACKET_LIMITS.imageBytes) }), async () => {})).toThrow(/BUDGET/);
    a.images[0].sourceKey = "d".repeat(64); expect(() => a.build()).toThrow(/BINDING/);
    const b = packet(); b.images[0].crop.x = 1; expect(() => b.build()).toThrow(/MAPPING/);
    const c = packet(); expect(() => createVisionPacket(c.input, c.images.filter(i => i.kind === "CROP"), async () => {})).toThrow(/CONTEXT/);
    const d = packet("PREVIEW"); d.images[1].pts++;
    expect(() => d.build()).toThrow(/PAIRS/);
  });
});

describe("Hybrid finite role routing", () => {
  it("prefers requested exact GPT6 IDs, using only the explicitly authorized Hybrid alternates when absent", () => {
    const models: { model: string; defaultReasoningEffort: string }[] = Object.values(HYBRID_REQUESTED_GPT_MODELS).map(model => ({ model, defaultReasoningEffort: "high" }));
    const connections = { chatgpt: { assertModel: (model: string) => { if (!models.some(m => m.model === model)) throw Error("absent"); },
      status: () => ({ models, email: "fixture" }) }, reviewProvider: () => ({ completeStructuredVision: vi.fn() }) } as unknown as ModelConnections;
    expect(createHybridVisionRoutes(connections).LUNA.model).toBe("gpt-6-luna");
    expect(createHybridVisionRoutes(connections).SOL.model).toBe("gpt-6.1-sol");
    models.splice(0, 2, ...Object.values(HYBRID_GPT_MODELS).map(model => ({ model, defaultReasoningEffort: "high" })));
    expect(createHybridVisionRoutes(connections).LUNA.model).toBe("gpt-5.6-luna");
    expect(createHybridVisionRoutes(connections).SOL.model).toBe("gpt-5.6-sol");
  });
  it("escalates Luna UNKNOWN to Sol, preserving structured receipts and source bounds", async () => {
    const p = packet().build(), r = routes((role, digest) => ({ ...candidate(), packetDigest: digest,
      decisions: role === "SOL" ? [{ ...candidate("CONFIRM").decisions[0], temporalState: "STABLE" }] : candidate().decisions,
      groups: role === "SOL" ? [{ candidateIds: ["c1"], sameLogicalOverlay: true }] : [] }));
    const session = new ShapeCoverVisionSession(sourceKey, r);
    expect((await session.classify(p, new AbortController().signal)).decisions[0].decision).toBe("CONFIRM");
    expect(session.modelRequests).toBe(2); expect(session.receipts.map(x => x.role)).toEqual(["LUNA", "SOL"]);
    expect(session.receipts.every(x => x.packetDigest === p.packetDigest && x.requestId === null)).toBe(true);
    await session.classify(p, new AbortController().signal);
    await session.request("LUNA", p, new AbortController().signal);
    await session.request("LUNA", p, new AbortController().signal);
    await expect(session.request("LUNA", p, new AbortController().signal)).rejects.toThrow(/BOUND/);
    const history = session.receipts; history[0].model = "other"; expect(session.receipts[0].model).toBe(HYBRID_GPT_MODELS.LUNA);
  });
  it("routes MiniMax preview review and fails high-risk disagreement without majority voting", async () => {
    const r = routes((role, digest) => ({ ...preview(), packetDigest: digest, unintendedOcclusion: role === "MINIMAX" ? "FAIL" : "PASS" }));
    const session = new ShapeCoverVisionSession(sourceKey, r);
    expect((await session.reviewPreview(packet("PREVIEW").build(), new AbortController().signal)).verdict).toBe("UNSAFE");
    expect(session.receipts.map(x => x.role)).toEqual(["MINIMAX", "SOL"]);
    await expect(session.request("LUNA", packet("PREVIEW").build(), new AbortController().signal)).rejects.toThrow(/REVIEWER/);
  });
  it("reports unavailable explicitly without transport or replacement requests", async () => {
    const r = routes(() => candidate()); r.LUNA.imageCapability = "MODEL_IMAGE_CAPABILITY_UNAVAILABLE";
    const session = new ShapeCoverVisionSession(sourceKey, r);
    await expect(session.classify(packet().build(), new AbortController().signal)).rejects.toThrow(/UNAVAILABLE/);
    expect(session.modelRequests).toBe(0); expect(session.receipts[0].status).toBe("UNAVAILABLE");
    expect(r.SOL.complete).not.toHaveBeenCalled();
    const connections = { chatgpt: { assertModel: () => { throw Error("not in catalog"); } } } as unknown as ModelConnections;
    expect(createHybridVisionRoutes(connections).LUNA.imageCapability).toBe("MODEL_IMAGE_CAPABILITY_UNAVAILABLE");
  });
  it("rejects malformed output without semantic retries and keeps provider errors private", async () => {
    const r = routes(() => ({ arbitrary: true })), session = new ShapeCoverVisionSession(sourceKey, r);
    await expect(session.classify(packet().build(), new AbortController().signal)).rejects.toThrow(/INVALID_OUTPUT/);
    expect(session.modelRequests).toBe(1); expect(r.SOL.complete).not.toHaveBeenCalled();
    r.SOL.complete = async () => { throw Error("private-key and /home/private"); };
    await expect(session.request("SOL", packet().build(), new AbortController().signal)).rejects.toThrow("VISION_PROVIDER_ERROR");
    expect(JSON.stringify(session.receipts)).not.toMatch(/private-key|\/home\/private/);
  });
  it("rejects stale images before dispatch and after a delayed provider response", async () => {
    const r = routes((_, digest) => ({ ...candidate(), packetDigest: digest })), session = new ShapeCoverVisionSession(sourceKey, r);
    await expect(session.request("LUNA", packet("CANDIDATE", async () => { throw Error("stale"); }).build(), new AbortController().signal)).rejects.toThrow(/STALE/);
    expect(session.modelRequests).toBe(0);
    let fresh = true; r.LUNA.complete = async messages => { fresh = false; return JSON.stringify({ ...candidate(), packetDigest: JSON.parse((messages[1].content as { text: string }[])[0].text).packetDigest }); };
    await expect(session.request("LUNA", packet("CANDIDATE", async () => { if (!fresh) throw Error("changed"); }).build(), new AbortController().signal)).rejects.toThrow(/STALE/);
    expect(session.modelRequests).toBe(1);
    await expect(new ShapeCoverVisionSession("d".repeat(64), r).request("LUNA", packet().build(), new AbortController().signal)).rejects.toThrow(/BINDING/);
  });
  it("honors cancellation and timeout even when a provider ignores AbortSignal, with no hidden retry", async () => {
    const r = routes(() => candidate()); r.LUNA.complete = () => new Promise(() => {});
    const controller = new AbortController(), session = new ShapeCoverVisionSession(sourceKey, r);
    const pending = session.request("LUNA", packet().build(), controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow(/CANCELLED/); expect(session.modelRequests).toBe(1);
    const timed = new ShapeCoverVisionSession(sourceKey, r, 5);
    await expect(timed.request("LUNA", packet().build(), new AbortController().signal)).rejects.toThrow(/TIMEOUT/);
    expect(timed.modelRequests).toBe(1);
    for (let n = 1; n < 4; n++) await expect(timed.request("LUNA", packet().build(), new AbortController().signal)).rejects.toThrow(/TIMEOUT/);
    expect(timed.modelRequests).toBe(4);
    await expect(timed.request("LUNA", packet().build(), new AbortController().signal)).rejects.toThrow(/BOUND/);
  });
});
