import { describe, expect, it, vi } from "vitest";
import type { StationaryDiscoveryResult } from "../src/main/shape-cover-stationary-discovery.js";
import { HYBRID_SEMANTIC_LIMITS, planHybridSemanticBatches, reviewHybridSemanticPlan } from "../src/main/shape-cover-vision-semantic.js";
import { ShapeCoverVisionSession, H2_PROMPT_VERSION, type VisionRoute } from "../src/main/shape-cover-vision-router.js";
import { createVisionPacket, type VisionImageInput } from "../src/main/shape-cover-vision-packet.js";
import { HYBRID_GPT_MODELS } from "../src/main/shape-cover-vision-provider.js";
import type { CandidateDecision } from "../src/main/shape-cover-vision-schema.js";

const sourceKey = "b".repeat(64), signal = new AbortController().signal;
function discovery(count: number, related = false): StationaryDiscoveryResult {
  return { status: "CANDIDATES_REQUIRE_CONFIRMATION", evidence: { sourceKey }, mapping: { sourceWidth: 600, sourceHeight: 600 },
    components: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, state: "CANDIDATE", sourceBox: { x: related ? 20 + i * 12 : 10 + i % 4 * 150,
      y: related ? 20 : 10 + Math.floor(i / 4) * 150, width: 8, height: 8 }, gridBox: { x: 0, y: 0, width: 8, height: 8 },
      signals: { stablePixels: 20, meanMaxChannelStd: 0, edgePixels: 8, meanAdjacentPersistence: 1, sampledScreenCoordinateConsistency: 1 } })) } as unknown as StationaryDiscoveryResult;
}
function response(ids: string[], digest: string, decision = "CONFIRM", classification = "OVERLAY_LOGO"): CandidateDecision {
  return { packetDigest: digest, decisions: ids.map(candidateId => ({ candidateId, decision, class: classification,
    temporalState: "STABLE", riskFlags: [], shortReason: "construction fixture observation" })),
    groups: decision === "CONFIRM" ? ids.map(id => ({ candidateIds: [id], sameLogicalOverlay: true })) : [],
    undetectedOverlaySuspected: false, crossBatchGroupingSuspected: false } as CandidateDecision;
}
type Output = (role: string, ids: string[], digest: string) => unknown;
function setup(result = discovery(1), output: Output = (_, ids, digest) => response(ids, digest), fresh: () => Promise<void> = async () => {}, timeout = 180000) {
  const plan = planHybridSemanticBatches(result);
  const routes = Object.fromEntries(["LUNA", "SOL", "MINIMAX"].map(role => [role, {
    provider: "fixture", model: role === "LUNA" ? HYBRID_GPT_MODELS.LUNA : role === "SOL" ? HYBRID_GPT_MODELS.SOL : "MiniMax-M3",
    imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: vi.fn(async messages => {
      const metadata = JSON.parse((messages[1].content as { text: string }[])[0].text);
      return JSON.stringify(output(role, metadata.candidates.map((c: { candidateId: string }) => c.candidateId), metadata.packetDigest));
    }),
  } satisfies VisionRoute])) as unknown as Record<"LUNA" | "SOL" | "MINIMAX", VisionRoute>;
  const session = new ShapeCoverVisionSession(sourceKey, routes, timeout);
  const build = async (ids: readonly string[]) => {
    const candidates = ids.map(id => plan.allCandidates.find(c => c.candidateId === id)!);
    const png = (w: number, h: number) => { const b = Buffer.alloc(24); b.write("89504e470d0a1a0a", "hex"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
    const full = { x: 0, y: 0, width: 600, height: 600 };
    const images: VisionImageInput[] = [0, 10, 20].flatMap(ordinal => {
      const binding = { sourceKey, ordinal, pts: ordinal, pixelSha256: "c".repeat(64) };
      return [{ ...binding, kind: "CONTEXT" as const, candidateIds: [...ids], crop: full, png: png(600, 600) },
        ...candidates.map(c => ({ ...binding, kind: "CROP" as const, candidateIds: [c.candidateId], crop: c.sourceBox, png: png(8, 8) }))];
    });
    return createVisionPacket({ kind: "CANDIDATE", sourceKey, sourceWidth: 600, sourceHeight: 600, timeBase: "1/30", candidates }, images, fresh);
  };
  const run = (runSignal = signal) => reviewHybridSemanticPlan(plan, session, build, fresh, runSignal);
  return { plan, routes, session, build, run };
}
function completePartition(r: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) {
  const ids = [...r.confirmedGroups.flatMap(g => g.candidateIds), ...r.rejectedCandidates.map(c => c.candidateId), ...r.unresolvedCandidates.map(c => c.candidateId)];
  expect(ids.slice().sort()).toEqual(r.allCandidateIds.slice().sort()); expect(new Set(ids).size).toBe(ids.length);
}

describe("H2 complete deterministic atomic batches", () => {
  it.each([1, 3, 4, 12])("reviews all %i candidates once without model-confidence sorting", async count => {
    const s = setup(discovery(count)), r = await s.run();
    expect(r.status).toBe("SEMANTIC_CONFIRMED"); expect(r.confirmedGroups).toHaveLength(count);
    expect(r.requestCounts).toEqual({ LUNA: Math.ceil(count / 3), SOL: 0, MINIMAX: 0 }); completePartition(r);
    const reversed = discovery(count); reversed.components.reverse();
    expect(planHybridSemanticBatches(reversed)).toEqual(s.plan);
    expect(r.receipts.every(x => x.promptVersion === H2_PROMPT_VERSION && x.imageHashes.length >= 6 && x.candidateIds.length > 0)).toBe(true);
    expect(r.receiptDigests).toHaveLength(Math.ceil(count / 3));
  });
  it("fails closed above the envelope without truncation or provider calls", async () => {
    const s = setup(discovery(HYBRID_SEMANTIC_LIMITS.candidates + 1)), r = await s.run();
    expect(r.reasons).toContain("SEMANTIC_CANDIDATE_LIMIT_EXCEEDED"); expect(r.unresolvedCandidates).toHaveLength(13);
    expect(r.requestCounts.LUNA).toBe(0); completePartition(r);
  });
  it("keeps related components together and rejects a >3 cluster, including overlap chains", async () => {
    expect(planHybridSemanticBatches(discovery(3, true)).batches).toEqual([["c0", "c1", "c2"]]);
    const s = setup(discovery(4, true)), r = await s.run();
    expect(r.reasons).toContain("COMPLEX_GROUPING"); expect(r.confirmedGroups).toHaveLength(0); expect(s.session.modelRequests).toBe(0); completePartition(r);
  });
  it("never promotes M1 UNKNOWN through a vision packet", async () => {
    const d = discovery(2); d.components[1].state = "UNKNOWN";
    const s = setup(d), r = await s.run(); expect(r.allCandidateIds).toEqual(["c0"]); expect(r.unknownCandidateIds).toEqual(["c1"]); completePartition(r);
  });
  it("fails closed when atomic two-component clusters need more than four packets", async () => {
    const d = discovery(10);
    d.components.forEach((c, i) => { c.sourceBox.x = 20 + Math.floor(i / 2) % 3 * 190 + i % 2 * 12; c.sourceBox.y = 20 + Math.floor(i / 6) * 200; });
    const s = setup(d), r = await s.run(); expect(r.reasons).toContain("SEMANTIC_BATCH_LIMIT_EXCEEDED");
    expect(r.unresolvedCandidates).toHaveLength(10); expect(s.session.modelRequests).toBe(0); completePartition(r);
  });
  it("rejects forged omission or split atomic clusters before any request", async () => {
    const s = setup(discovery(4)); s.plan.batches = [["c0", "c1", "c2"]];
    const r = await s.run(); expect(r.reasons).toContain("SEMANTIC_BATCH_COMPLETENESS"); expect(r.unresolvedCandidates).toHaveLength(4);
    const related = setup(discovery(3, true)); related.plan.batches = [["c0"], ["c1", "c2"]];
    expect((await related.run()).reasons).toContain("SEMANTIC_BATCH_COMPLETENESS");
  });
  it("cross-batch grouping suspicion prevents silently independent singletons", async () => {
    const s = setup(discovery(4), (_, ids, digest) => ({ ...response(ids, digest), crossBatchGroupingSuspected: true }));
    const r = await s.run(); expect(r.status).toBe("SEMANTIC_UNRESOLVED"); expect(r.confirmedGroups).toHaveLength(0);
    expect(r.reasons).toContain("CROSS_BATCH_GROUPING_UNRESOLVED"); completePartition(r);
  });
});

describe("H2 semantic decisions and group partition", () => {
  it.each(["PRODUCT_PRINT", "SUBTITLE", "BACKGROUND_GRAPHIC", "PERSON", "OTHER"])("rejects %s without mask evidence", async classification => {
    const r = await setup(discovery(1), (_, ids, digest) => response(ids, digest, "REJECT", classification)).run();
    expect(r.rejectedCandidates[0].classification).toBe(classification); expect(r.confirmedGroups).toHaveLength(0); completePartition(r);
  });
  it.each(["OVERLAY_LOGO", "OVERLAY_STICKER"])("confirms only supplied %s", async classification => {
    expect((await setup(discovery(1), (_, ids, digest) => response(ids, digest, "CONFIRM", classification)).run()).confirmedGroups[0].classification).toBe(classification);
  });
  it("Luna UNKNOWN escalates with original images and untrusted summary to Sol", async () => {
    const s = setup(discovery(1), (role, ids, digest) => response(ids, digest, role === "LUNA" ? "UNKNOWN" : "CONFIRM", role === "LUNA" ? "UNKNOWN" : "OVERLAY_STICKER"));
    const r = await s.run(); expect(r.status).toBe("SEMANTIC_CONFIRMED"); expect(r.confirmedGroups[0].semanticSource).toBe("SOL");
    const messages = vi.mocked(s.routes.SOL.complete).mock.calls[0][0];
    expect(JSON.stringify(messages)).toContain("lunaSummary"); expect(JSON.stringify(messages)).toContain("data:image/png;base64,"); completePartition(r);
  });
  it("resolves multi-component one logical group in both Luna output and Sol escalation", async () => {
    const s = setup(discovery(2, true), (_, ids, digest) => ({ ...response(ids, digest, "CONFIRM", "OVERLAY_STICKER"), groups: [{ candidateIds: ids, sameLogicalOverlay: true }] }));
    const r = await s.run(); expect(r.receipts[0].output).toMatchObject({ groups: [{ candidateIds: ["c0", "c1"], sameLogicalOverlay: true }] });
    expect(r.confirmedGroups).toHaveLength(1); expect(r.confirmedGroups[0].candidateIds).toEqual(["c0", "c1"]);
    expect(r.confirmedGroups[0].semanticSource).toBe("SOL"); completePartition(r);
  });
  it("adjacent overlay and product print are never grouped", async () => {
    const r = await setup(discovery(2, true), (_, ids, digest) => { const r = response(ids, digest); r.decisions[1].decision = "REJECT";
      r.decisions[1].class = "PRODUCT_PRINT"; r.groups = [r.groups[0]]; return r; }).run();
    expect(r.confirmedGroups[0].candidateIds).toEqual(["c0"]); expect(r.rejectedCandidates[0].candidateId).toBe("c1"); completePartition(r);
  });
  it("false grouping explicitly partitions; uncertain grouping leaves all members unresolved", async () => {
    for (const sameLogicalOverlay of [false, "UNCERTAIN"] as const) {
      const s = setup(discovery(2, true), (_, ids, digest) => ({ ...response(ids, digest), groups: [{ candidateIds: ids, sameLogicalOverlay }] }));
      const r = await s.run(); expect(r.confirmedGroups).toHaveLength(sameLogicalOverlay === false ? 2 : 0);
      expect(r.status).toBe(sameLogicalOverlay === false ? "SEMANTIC_CONFIRMED" : "SEMANTIC_UNRESOLVED"); completePartition(r);
    }
  });
  it("Sol cannot erase a Luna CONFIRM versus PRODUCT_PRINT reject disagreement", async () => {
    const r = await setup(discovery(1), (role, ids, digest) => { const r = response(ids, digest, role === "SOL" ? "REJECT" : "CONFIRM", role === "SOL" ? "PRODUCT_PRINT" : "OVERLAY_LOGO");
      if (role === "LUNA") r.decisions[0].riskFlags = ["PRODUCT_PRINT_RISK"]; return r; }).run();
    expect(r.status).toBe("SEMANTIC_UNRESOLVED"); expect(r.reasons).toContain("SEMANTIC_MODEL_DISAGREEMENT"); expect(r.receipts).toHaveLength(2); completePartition(r);
  });
  it("Sol may resolve a risk-escalated Luna REJECT, retaining both reasons/receipts", async () => {
    const r = await setup(discovery(1), (role, ids, digest) => { const r = response(ids, digest, role === "LUNA" ? "REJECT" : "CONFIRM", role === "LUNA" ? "PRODUCT_PRINT" : "OVERLAY_LOGO");
      if (role === "LUNA") r.decisions[0].riskFlags = ["PRODUCT_PRINT_RISK"]; return r; }).run();
    expect(r.status).toBe("SEMANTIC_CONFIRMED"); expect(r.receipts).toHaveLength(2); expect(r.confirmedGroups[0].resolutionReason).toContain("SOL_HARD_CASE");
  });
  it.each(["LUNA", "SOL"])("%s undetected overlay makes entire source unsafe, clearing all target groups", async reviewer => {
    const r = await setup(discovery(4), (role, ids, digest) => { const r = response(ids, digest);
      if (reviewer === "SOL" && role === "LUNA") r.decisions[0].riskFlags = ["ALGORITHM_CONFLICT"];
      r.undetectedOverlaySuspected = role === reviewer; return r; }).run();
    expect(r.status).toBe("SEMANTIC_UNSAFE"); expect(r.confirmedGroups).toHaveLength(0); expect(r.reasons).toContain("UNDETECTED_OVERLAY_SUSPECTED"); completePartition(r);
  });
  it.each(["MOVED", "DISAPPEARED", "CHANGED"] as const)("explicit Luna %s cannot be overridden by Sol STABLE", async temporalState => {
    const s = setup(discovery(1), (role, ids, digest) => { const r = response(ids, digest); if (role === "LUNA") r.decisions[0].temporalState = temporalState; return r; });
    const r = await s.run(); expect(r.semanticTemporalConflict).toBe(true); expect(r.confirmedGroups).toHaveLength(0);
    expect(s.routes.SOL.complete).not.toHaveBeenCalled(); completePartition(r);
  });
  it("persistent UNKNOWN and exhausted two-Sol budget are unresolved with no hidden retry", async () => {
    const s = setup(discovery(12), (_, ids, digest) => response(ids, digest, "UNKNOWN", "UNKNOWN")), r = await s.run();
    expect(r.status).toBe("SEMANTIC_UNRESOLVED"); expect(r.requestCounts).toEqual({ LUNA: 4, SOL: 2, MINIMAX: 0 });
    expect(r.reasons).toContain("SEMANTIC_SOL_BUDGET_EXHAUSTED"); completePartition(r);
  });
  it.each(["invented", "missing", "duplicate", "missing-cross-batch-field"])("strictly rejects %s output", async bad => {
    const r = await setup(discovery(2), (_, ids, digest) => { const r = response(ids, digest);
      if (bad === "invented") r.decisions[0].candidateId = "invented";
      if (bad === "missing") r.decisions.pop();
      if (bad === "duplicate") r.groups.push(r.groups[0]);
      if (bad === "missing-cross-batch-field") delete r.crossBatchGroupingSuspected;
      return r; }).run();
    expect(r.status).toBe("SEMANTIC_UNRESOLVED"); expect(r.confirmedGroups).toHaveLength(0); expect(r.reasons).toContain("VISION_INVALID_OUTPUT"); completePartition(r);
  });
});

describe("H2 source/session lifetime", () => {
  it("provider unavailable is zero generation and no fallback", async () => {
    const s = setup(); s.routes.LUNA.imageCapability = "MODEL_IMAGE_CAPABILITY_UNAVAILABLE";
    const r = await s.run(); expect(r.status).toBe("SEMANTIC_UNRESOLVED"); expect(s.session.modelRequests).toBe(0);
    expect(r.receipts[0].status).toBe("UNAVAILABLE"); expect(s.routes.SOL.complete).not.toHaveBeenCalled(); completePartition(r);
  });
  it("stale after dispatch is rejected; a result becomes stale when its source changes", async () => {
    let fresh = true;
    const s = setup(discovery(1), undefined, async () => { if (!fresh) throw Error("generation drift"); });
    const r = await s.run(); await r.verifyFresh(); fresh = false; await expect(r.verifyFresh()).rejects.toThrow();
    const stale = setup(discovery(1), (_, ids, digest) => { fresh = false; return response(ids, digest); }, async () => { if (!fresh) throw Error("generation drift"); });
    fresh = true; const failure = await stale.run(); expect(failure.reasons).toContain("VISION_STALE_BINDING"); completePartition(failure);
  });
  it("cancellation, timeout and exhausted shared Luna budget preserve complete unresolved sets", async () => {
    const cancelled = setup(); cancelled.routes.LUNA.complete = () => new Promise(() => {});
    const controller = new AbortController(), pending = cancelled.run(controller.signal); setTimeout(() => controller.abort(), 5);
    const c = await pending; expect(c.reasons).toContain("VISION_CANCELLED"); expect(c.requestCounts.LUNA).toBe(1); completePartition(c);
    const timed = setup(discovery(1), undefined, async () => {}, 5); timed.routes.LUNA.complete = () => new Promise(() => {});
    const t = await timed.run(); expect(t.reasons).toContain("VISION_TIMEOUT"); completePartition(t);
    const exhausted = setup(discovery(12)); await exhausted.run(); const e = await exhausted.run();
    expect(e.reasons).toContain("VISION_REQUEST_BOUND"); expect(e.unresolvedCandidates).toHaveLength(12); completePartition(e);
  });
  it("returned decisions cannot be mutated into an adoptable target", async () => {
    const r = await setup().run(); expect(() => { r.confirmedGroups[0].candidateIds.push("invented"); }).toThrow();
  });
});
