import { describe, expect, it, vi } from "vitest";
import type { StationaryDiscoveryResult } from "../src/main/shape-cover-stationary-discovery.js";
import { CORNERS, CORNER_SCOPE_POLICY, assignCandidateCorner, createCornerScopePlan } from "../src/main/shape-cover-vision-corner-policy.js";
import { parseCornerDecision, type CornerDecision } from "../src/main/shape-cover-vision-corner-schema.js";
import { reviewHybridCornerPlan, getConfirmedCornerTargets } from "../src/main/shape-cover-vision-corner-semantic.js";
import { ShapeCoverVisionSession, type VisionRoute, type VisionRole } from "../src/main/shape-cover-vision-router.js";
import { createVisionPacket, type VisionImageInput } from "../src/main/shape-cover-vision-packet.js";

const key = "a".repeat(64), signal = new AbortController().signal;
type Box = { x: number; y: number; width: number; height: number };
const box = (x: number, y: number, width = 20, height = 20): Box => ({ x, y, width, height });
function discovery(boxes: Box[] = [box(750, 10)]): StationaryDiscoveryResult {
  return { status: "CANDIDATES_REQUIRE_CONFIRMATION", evidence: { sourceKey: key }, mapping: { sourceWidth: 1000, sourceHeight: 1000 },
    components: boxes.map((sourceBox, i) => ({ id: `c${i}`, state: "CANDIDATE", sourceBox, gridBox: sourceBox,
      signals: { stablePixels: 20, meanMaxChannelStd: 0, edgePixels: 8, meanAdjacentPersistence: 1, sampledScreenCoordinateConsistency: 1 } })) } as unknown as StationaryDiscoveryResult;
}
function response(p: { packetDigest: string; candidates: { candidateId: string }[] }, corner: string): CornerDecision {
  const ids = p.candidates.map(c => c.candidateId);
  return { packetDigest: p.packetDigest, corner, decisions: ids.map(candidateId => ({ candidateId, decision: "CONFIRM", class: "OVERLAY_LOGO",
    temporalState: "STABLE", riskFlags: [], shortReason: "controlled observation" })), groups: [{ candidateIds: ids, sameLogicalOverlay: true }],
    undetectedCornerOverlaySuspected: false } as CornerDecision;
}
function setup(d = discovery(), output = (r: CornerDecision, _role: VisionRole): unknown => r, fresh = async () => {}, timeout = 180000) {
  const plan = createCornerScopePlan(d);
  const routes = Object.fromEntries((["LUNA", "SOL", "MINIMAX"] as const).map(role => [role, {
    provider: "fixture", model: role, imageCapability: "AVAILABLE", verifyFresh: async () => {}, complete: vi.fn(async messages => {
      const content = messages[1].content as { text: string }[];
      const metadata = JSON.parse(content[0].text), context = JSON.parse(content.at(-1)!.text);
      expect(JSON.stringify(messages[0])).toContain("ONLY the specified screen corner");
      expect(JSON.stringify(messages[0])).toContain("exactly once");
      expect(JSON.stringify(messages)).not.toContain("crossBatchGroupingSuspected");
      return JSON.stringify(output(response(metadata, context.corner), role));
    }),
  } satisfies VisionRoute])) as unknown as Record<VisionRole, VisionRoute>;
  const session = new ShapeCoverVisionSession(key, routes, timeout, "CORNER");
  const build = async (ids: readonly string[]) => {
    const candidates = ids.map(id => plan.allCandidates.find(c => c.candidateId === id)!);
    const png = (w: number, h: number) => { const b = Buffer.alloc(24); b.write("89504e470d0a1a0a", "hex"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
    const full = box(0, 0, 1000, 1000);
    const images: VisionImageInput[] = [0, 10, 20].flatMap(ordinal => {
      const binding = { sourceKey: key, ordinal, pts: ordinal, pixelSha256: "b".repeat(64) };
      return [{ ...binding, kind: "CONTEXT" as const, candidateIds: [...ids], crop: full, png: png(1000, 1000) },
        ...candidates.map(c => ({ ...binding, kind: "CROP" as const, candidateIds: [c.candidateId], crop: c.sourceBox, png: png(c.sourceBox.width, c.sourceBox.height) }))];
    });
    return createVisionPacket({ kind: "CANDIDATE", sourceKey: key, sourceWidth: 1000, sourceHeight: 1000, timeBase: "1/30", candidates }, images, fresh);
  };
  return { plan, routes, session, build, run: (s = signal) => reviewHybridCornerPlan(plan, session, build, fresh, s) };
}

describe("CornerScopePolicy/v1", () => {
  it.each([[10, 10, "TOP_LEFT"], [750, 10, "TOP_RIGHT"], [10, 750, "BOTTOM_LEFT"], [750, 750, "BOTTOM_RIGHT"]])("assigns exact %s/%s", (x, y, corner) => {
    expect(assignCandidateCorner(box(Number(x), Number(y)), 1000, 1000)).toMatchObject({ corner, reason: null, areaInsideRatio: 1 });
  });
  it.each([box(450, 450), box(295, 450), box(280, 10, 40, 20), box(265, 265, 60, 60)])("excludes center/edge or insufficient area %j", b => {
    expect(assignCandidateCorner(b, 1000, 1000).reason).toBe("OUT_OF_CORNER_SCOPE");
  });
  it("freezes parameters; deterministic assignment and never duplicate candidates", () => {
    expect(CORNER_SCOPE_POLICY).toMatchObject({ version: "CornerScopePolicy/v1", outerWidthFraction: 0.30, outerHeightFraction: 0.30, minimumAreaInside: 0.60 });
    const d = discovery([box(10, 10), box(750, 10), box(10, 750), box(750, 750), box(400, 400)]), a = createCornerScopePlan(d);
    d.components.reverse(); const b = createCornerScopePlan(d); expect(a).toEqual(b);
    const ids = CORNERS.flatMap(c => a.corners[c].candidateIds); expect(new Set(ids).size).toBe(ids.length); expect(ids).toHaveLength(4);
    expect(a.outOfScopeCandidateIds).toEqual(["c4"]);
  });
  it("M1 UNKNOWN remains UNKNOWN_NOT_PROPOSED and never enters a packet", async () => {
    const d = discovery(); d.components[0].state = "UNKNOWN";
    const s = setup(d), r = await s.run(); expect(r.unknownCandidateIds).toEqual(["c0"]);
    expect(r.unknownReason).toBe("UNKNOWN_NOT_PROPOSED"); expect(r.status).toBe("CORNER_SEMANTIC_EMPTY"); expect(s.session.modelRequests).toBe(0);
  });
});

describe("per-corner decisions and partial success", () => {
  it("zero candidates is NO_CANDIDATE, no absence proof", async () => {
    const r = await setup(discovery([])).run(); expect(CORNERS.map(c => r.corners[c].status)).toEqual(Array(4).fill("NO_CANDIDATE"));
    expect(await getConfirmedCornerTargets(r)).toEqual([]);
  });
  it.each([1, 2, 3])("%i clear components form one target without unnecessary escalation", async count => {
    const s = setup(discovery(Array.from({ length: count }, (_, i) => box(730 + i * 30, 10))));
    const r = await s.run(); expect(r.status).toBe("CORNER_SEMANTIC_READY"); expect(r.corners.TOP_RIGHT.confirmedTarget?.candidateIds).toHaveLength(count);
    expect(r.requestCounts).toEqual({ LUNA: 1, SOL: 0, MINIMAX: 0 }); expect(await getConfirmedCornerTargets(r)).toHaveLength(1);
  });
  it("four candidates skips only that corner, preserves a different confirmed corner", async () => {
    const s = setup(discovery([box(10, 10), ...Array.from({ length: 4 }, (_, i) => box(730 + i * 30, 10))]));
    const r = await s.run(); expect(r.status).toBe("CORNER_SEMANTIC_PARTIAL"); expect(r.corners.TOP_RIGHT.reasons).toContain("CORNER_COMPLEX_UNRESOLVED");
    expect((await getConfirmedCornerTargets(r)).map(t => t.corner)).toEqual(["TOP_LEFT"]); expect(r.requestCounts.LUNA).toBe(1);
  });
  it.each(["PRODUCT_PRINT", "SUBTITLE", "BACKGROUND_GRAPHIC", "PERSON", "OTHER"])("rejects %s as NO_OVERLAY", async cls => {
    const r = await setup(undefined, r => ({ ...r, decisions: r.decisions.map(d => ({ ...d, decision: "REJECT", class: cls })), groups: [] })).run();
    expect(r.corners.TOP_RIGHT.status).toBe("NO_OVERLAY"); expect(r.corners.TOP_RIGHT.rejectedCandidates[0].classification).toBe(cls);
    expect(r.status).toBe("CORNER_SEMANTIC_EMPTY");
  });
  it("UNKNOWN escalates once using original images and untrusted summary", async () => {
    const s = setup(undefined, (r, role) => role === "LUNA" ? { ...r, decisions: r.decisions.map(d => ({ ...d, decision: "UNKNOWN", class: "UNKNOWN" })), groups: [] } : r);
    const r = await s.run(); expect(r.corners.TOP_RIGHT.confirmedTarget?.semanticSource).toBe("SOL");
    const messages = vi.mocked(s.routes.SOL.complete).mock.calls[0][0]; expect(JSON.stringify(messages)).toContain("lunaSummary"); expect(JSON.stringify(messages)).toContain("data:image/png;base64,");
  });
  it("persistent UNKNOWN and one unresolved corner preserve another target", async () => {
    const r = await setup(discovery([box(10, 10), box(750, 10)]), r => r.corner === "TOP_LEFT" ? { ...r, decisions: r.decisions.map(d => ({ ...d, decision: "UNKNOWN", class: "UNKNOWN" })), groups: [] } : r).run();
    expect(r.corners.TOP_LEFT.status).toBe("UNRESOLVED"); expect(r.corners.TOP_RIGHT.status).toBe("CONFIRMED"); expect(r.status).toBe("CORNER_SEMANTIC_PARTIAL");
  });
  it.each(["MOVED", "DISAPPEARED", "CHANGED"])("explicit %s cannot be erased by Sol", async motion => {
    const s = setup(undefined, r => ({ ...r, decisions: r.decisions.map(d => ({ ...d, temporalState: motion })) })), r = await s.run();
    expect(r.corners.TOP_RIGHT.reasons).toContain("UNRESOLVED_FOR_STATIC_V1"); expect(s.routes.SOL.complete).not.toHaveBeenCalled();
  });
  it("undetected risk is restricted to current corner", async () => {
    const r = await setup(discovery([box(10, 10), box(750, 10)]), r => ({ ...r, undetectedCornerOverlaySuspected: r.corner === "TOP_LEFT" })).run();
    expect(r.corners.TOP_LEFT.reasons).toContain("UNDETECTED_CORNER_OVERLAY_SUSPECTED"); expect(r.corners.TOP_RIGHT.status).toBe("CONFIRMED");
  });
  it("group UNCERTAIN escalates; unresolved multiple overlays never selects one", async () => {
    for (const mode of ["UNCERTAIN", "multiple", "false"]) {
      const r = await setup(discovery([box(730, 10), box(780, 10)]), r => ({ ...r, groups: mode === "multiple" ? r.decisions.map(d => ({ candidateIds: [d.candidateId], sameLogicalOverlay: true })) :
        [{ candidateIds: ["c0", "c1"], sameLogicalOverlay: mode === "false" ? false : "UNCERTAIN" }] })).run();
      expect(r.corners.TOP_RIGHT.status).toBe("UNRESOLVED"); expect(await getConfirmedCornerTargets(r)).toEqual([]);
    }
  });
  it.each(["PRODUCT_PRINT_RISK", "TEMPORAL_INCONSISTENCY", "COMPLEX_GROUPING", "ALGORITHM_CONFLICT"])("%s escalates once", async flag => {
    const r = await setup(undefined, (r, role) => ({ ...r, decisions: r.decisions.map(d => ({ ...d, riskFlags: role === "LUNA" ? [flag] : [] })) })).run();
    expect(r.requestCounts.SOL).toBe(1); expect(r.corners.TOP_RIGHT.status).toBe("CONFIRMED");
  });
  it("Luna overlay/Sol print disagreement is corner-local, no vote", async () => {
    const r = await setup(discovery([box(10, 10), box(750, 10)]), (r, role) => r.corner === "TOP_LEFT" ? { ...r,
      decisions: r.decisions.map(d => ({ ...d, decision: role === "SOL" ? "REJECT" : "CONFIRM", class: role === "SOL" ? "PRODUCT_PRINT" : "OVERLAY_LOGO", riskFlags: role === "LUNA" ? ["PRODUCT_PRINT_RISK"] : [] })), groups: role === "SOL" ? [] : r.groups } : r).run();
    expect(r.corners.TOP_LEFT.reasons).toContain("CORNER_MODEL_DISAGREEMENT"); expect(r.corners.TOP_RIGHT.status).toBe("CONFIRMED");
  });
  it("Sol explicit motion and print-to-overlay conflict are unresolved", async () => {
    for (const mode of ["motion", "print"]) {
      const r = await setup(undefined, (r, role) => ({ ...r, decisions: r.decisions.map(d => ({ ...d,
        decision: mode === "print" && role === "LUNA" ? "REJECT" : "CONFIRM", class: mode === "print" && role === "LUNA" ? "PRODUCT_PRINT" : "OVERLAY_LOGO",
        temporalState: mode === "motion" && role === "SOL" ? "MOVED" : "STABLE", riskFlags: role === "LUNA" ? ["PRODUCT_PRINT_RISK"] : [] })),
        groups: mode === "print" && role === "LUNA" ? [] : r.groups })).run();
      expect(r.corners.TOP_RIGHT.reasons).toContain(mode === "motion" ? "UNRESOLVED_FOR_STATIC_V1" : "CORNER_MODEL_DISAGREEMENT");
    }
  });
  it("four corners require at most four Luna and four Sol; no preview or MiniMax in this session", async () => {
    const s = setup(discovery([box(10, 10), box(750, 10), box(10, 750), box(750, 750)]), (r, role) => role === "LUNA" ? { ...r,
      decisions: r.decisions.map(d => ({ ...d, decision: "UNKNOWN", class: "UNKNOWN" })), groups: [] } : r);
    const r = await s.run(); expect(r.requestCounts).toEqual({ LUNA: 4, SOL: 4, MINIMAX: 0 });
    const packet = await s.build(["c0"]); await expect(s.session.request("MINIMAX", packet, signal)).rejects.toThrow();
    expect(s.routes.MINIMAX.complete).not.toHaveBeenCalled();
  });
  it("same corner cannot make a second Luna or Sol request even with source budget remaining", async () => {
    const s = setup(undefined, (r, role) => role === "LUNA" ? { ...r, decisions: r.decisions.map(d => ({ ...d, decision: "UNKNOWN", class: "UNKNOWN" })), groups: [] } : r);
    await s.run(); const p = await s.build(["c0"]), ctx = { corner: "TOP_RIGHT" as const, cornerScopeRect: s.plan.corners.TOP_RIGHT.scopeRect,
      policyVersion: s.plan.policyVersion, policyDigest: s.plan.policyDigest, scopeDigest: s.plan.scopeDigest };
    for (const role of ["LUNA", "SOL"] as const) await expect(s.session.request(role, p, signal, ctx)).rejects.toThrow("VISION_REQUEST_BOUND");
    expect(s.session.requestCounts).toEqual({ LUNA: 1, SOL: 1, MINIMAX: 0 });
  });
});

describe("binding and output diagnostics", () => {
  it("incorrect corner scope context refuses dispatch without consuming requests", async () => {
    for (const bad of ["rect", "policy", "corner"]) {
      const s = setup(), p = await s.build(["c0"]), context = { corner: "TOP_RIGHT" as "TOP_RIGHT" | "TOP_LEFT", cornerScopeRect: s.plan.corners.TOP_RIGHT.scopeRect,
        policyVersion: s.plan.policyVersion, policyDigest: s.plan.policyDigest, scopeDigest: s.plan.scopeDigest };
      if (bad === "rect") context.cornerScopeRect = { ...context.cornerScopeRect, x: 0 };
      if (bad === "policy") context.policyDigest = "f".repeat(64);
      if (bad === "corner") context.corner = "TOP_LEFT";
      await expect(s.session.request("LUNA", p, signal, context)).rejects.toThrow("VISION_CORNER_CONTEXT_BINDING"); expect(s.session.modelRequests).toBe(0);
    }
  });
  it.each(["packet", "corner", "candidate", "group-candidate", "group", "missing", "json", "class"])("strictly rejects %s without repair", async bad => {
    const s = setup(); const p = await s.build(["c0"]), r = response(p.manifest as never, "TOP_RIGHT"); r.packetDigest = p.packetDigest;
    if (bad === "packet") r.packetDigest = "f".repeat(64);
    if (bad === "corner") r.corner = "TOP_LEFT";
    if (bad === "candidate") r.decisions[0].candidateId = "invented";
    if (bad === "group-candidate") r.groups[0].candidateIds = ["invented"];
    if (bad === "group") r.groups = [];
    if (bad === "missing") delete (r as Partial<CornerDecision>).undetectedCornerOverlaySuspected;
    if (bad === "class") r.decisions[0].class = "PRODUCT_PRINT";
    s.routes.LUNA.complete = async () => bad === "json" ? "broken JSON" : JSON.stringify(r);
    const result = await s.run(), receipt = result.receipts[0]; expect(receipt.failureCode).toBe("VISION_INVALID_OUTPUT");
    expect(receipt.rawResponseSha256).toMatch(/^[a-f0-9]{64}$/); expect(receipt.rawResponseByteLength).toBeGreaterThan(0);
    expect(receipt.parseFailureCategory).toBe(bad === "json" ? "JSON_PARSE" : bad === "packet" ? "PACKET_MISMATCH" : bad === "group" ? "GROUP_MISMATCH" : bad === "missing" ? "MISSING_REQUIRED_FIELD" : "SCHEMA_VALIDATION");
    expect(JSON.stringify(receipt)).not.toContain("broken JSON"); expect(result.corners.TOP_RIGHT.status).toBe("UNRESOLVED");
    if (["packet", "corner", "candidate", "group-candidate"].includes(bad)) expect(result.status).toBe("CORNER_SEMANTIC_BLOCKED");
  });
  it("REJECT/UNKNOWN cannot enter groups and CONFIRM needs singleton", () => {
    const p = { packetDigest: key, candidates: [{ candidateId: "c0" }] }, r = response(p, "TOP_RIGHT");
    r.decisions[0].decision = "REJECT"; r.decisions[0].class = "PRODUCT_PRINT";
    expect(() => parseCornerDecision(JSON.stringify(r), key, "TOP_RIGHT", ["c0"])).toThrow("VISION_GROUP_MISMATCH");
  });
  it("wrong packet candidate/source invalidates all before dispatch", async () => {
    const s = setup(discovery([box(10, 10), box(750, 10)]));
    const r = await reviewHybridCornerPlan(s.plan, s.session, () => s.build(["c0"]), async () => {}, signal);
    expect(r.status).toBe("CORNER_SEMANTIC_BLOCKED"); expect(await getConfirmedCornerTargets(r)).toEqual([]);
  });
  it("an invented group member clears a previously confirmed corner", async () => {
    const s = setup(discovery([box(10, 10), box(750, 10)]), r => {
      if (r.corner === "TOP_RIGHT") r.groups[0].candidateIds = ["invented"];
      return r;
    });
    const r = await s.run(); expect(r.status).toBe("CORNER_SEMANTIC_BLOCKED");
    expect(r.corners.TOP_LEFT.status).toBe("UNRESOLVED"); expect(await getConfirmedCornerTargets(r)).toEqual([]);
    expect(r.receipts.at(-1)?.outputFailureCode).toBe("VISION_CANDIDATE_MISMATCH");
  });
  it("source stale, unavailable route or provider failure clears previously confirmed corners", async () => {
    for (const fail of ["stale", "unavailable", "provider"]) {
      let count = 0;
      const s = setup(discovery([box(10, 10), box(750, 10)]), (r, role) => {
        if (++count === 2 && fail === "provider") throw Error("provider error");
        if (count === 1 && fail === "unavailable") s.routes.LUNA.imageCapability = "MODEL_IMAGE_CAPABILITY_UNAVAILABLE";
        return r;
      }, async () => { if (count >= 2 && fail === "stale") throw Error("generation drift"); });
      const r = await s.run(); expect(r.status).toBe("CORNER_SEMANTIC_BLOCKED"); expect(await getConfirmedCornerTargets(r)).toEqual([]);
    }
  });
  it("invalid JSON only skips that corner; the other corner remains consumable", async () => {
    const s = setup(discovery([box(10, 10), box(750, 10)]));
    const complete = s.routes.LUNA.complete;
    s.routes.LUNA.complete = async (...args) => {
      const content = args[0][1].content as { text: string }[];
      return JSON.parse(content.at(-1)!.text).corner === "TOP_LEFT" ? "invalid" : complete(...args);
    };
    const r = await s.run(); expect(r.status).toBe("CORNER_SEMANTIC_PARTIAL"); expect((await getConfirmedCornerTargets(r)).map(t => t.corner)).toEqual(["TOP_RIGHT"]);
  });
  it("timeout/cancel consume the in-flight request, block source, and do not replay", async () => {
    for (const cancelled of [true, false]) {
      const s = setup(undefined, undefined, undefined, 15); s.routes.LUNA.complete = () => new Promise(() => {});
      const c = new AbortController(), pending = s.run(c.signal); if (cancelled) setTimeout(() => c.abort(), 5);
      const r = await pending; expect(r.status).toBe("CORNER_SEMANTIC_BLOCKED"); expect(r.requestCounts.LUNA).toBe(1);
      expect(r.sourceErrors).toContain(cancelled ? "VISION_CANCELLED" : "VISION_TIMEOUT"); expect(s.routes.SOL.complete).not.toHaveBeenCalled();
    }
  });
  it("freshness/ownership survive only in the original immutable result", async () => {
    let fresh = true; const r = await setup(undefined, undefined, async () => { if (!fresh) throw Error("stale"); }).run();
    expect(() => r.corners.TOP_RIGHT.confirmedTarget!.candidateIds.push("fake")).toThrow();
    await expect(getConfirmedCornerTargets(JSON.parse(JSON.stringify(r)))).rejects.toThrow();
    fresh = false; await expect(getConfirmedCornerTargets(r)).rejects.toThrow("stale");
  });
});
