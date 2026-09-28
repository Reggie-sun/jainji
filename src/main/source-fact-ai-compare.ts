import { z } from "zod";
import { AI_CRITERIA, AIDeclarationSchema, AI_INTEGER, aiDigest, assertAIPackage, aiCoverage, freezeAI, type AIDeclaration } from "./source-fact-ai-contract.js";

type TruthFrame = { ordinal: number; state: "KNOWN"; targets: { id: string; category: "static" | "moving" | "animated" }[] }
  | { ordinal: number; state: "TRUTH_AMBIGUOUS" };
const Correspondence = z.object({ ordinal: AI_INTEGER, reviewTargetId: z.string().uuid(), truthTargetId: z.string().min(1).nullable() }).strict();
const METRICS = ["frameCount", "clearFrameCount", "targetFrameCount", ...AI_CRITERIA.zeroTolerance, "unnecessaryUnknownCount",
  "declaredTargetFrameCount", "unnecessaryUnknownRate", "targetFrameRecall", "falsePositiveRate"] as const;
export type AIMetrics = Record<typeof METRICS[number], number | null>;
const absentMetrics = (): AIMetrics => Object.fromEntries(METRICS.map(k => [k, null])) as AIMetrics;

/** Pure deterministic diagnostics. It does not verify provider provenance or issue qualification. */
export function compareAIFrames(truth: TruthFrame[], rawDeclarations: unknown, rawCorrespondence: unknown, evaluateUsability = true) {
  let metrics = absentMetrics(), metricsComplete = false;
  const failures: string[] = [];
  const finish = (status: "MATCH" | "NOT_QUALIFIED" | "INCOMPLETE") => freezeAI({ status, metrics, metricsComplete, failures,
    unevaluatedMetrics: METRICS.filter(k => metrics[k] === null), authority: "none" as const, eligible: false as const });
  try {
    const ds = z.array(AIDeclarationSchema).max(100_000).parse(rawDeclarations);
    const declarations = new Map(ds.map(d => [d.ordinal, d]));
    if (declarations.size !== ds.length || ds.some(d => !truth.some(t => t.ordinal === d.ordinal))
      || new Set(truth.map(f => f.ordinal)).size !== truth.length || truth.some((t, i) => t.ordinal !== i)) throw Error("frame ordinal binding");
    // Stop immediately without inspecting mapping or the rest of the incomplete run.
    for (const t of truth) if (t.state === "KNOWN" && t.targets.length && declarations.get(t.ordinal)?.type === "EMPTY") {
      metrics.falseEmptyCount = 1; failures.push(`FALSE_EMPTY:${t.ordinal}`); return finish("NOT_QUALIFIED");
    }
    const missedUnknown = truth.filter(t => t.state === "TRUTH_AMBIGUOUS" && declarations.has(t.ordinal) && declarations.get(t.ordinal)!.type !== "UNKNOWN").length;
    if (missedUnknown) { metrics.missedUnknown = missedUnknown; failures.push("missedUnknown"); return finish("NOT_QUALIFIED"); }
    if (ds.length !== truth.length) throw Error("missing declared ordinal");
    const mapping = z.array(Correspondence).max(200_000).parse(rawCorrespondence), matches = new Map<string, string | null>();
    const knownIds = new Set(truth.flatMap(t => t.state === "KNOWN" ? t.targets.map(x => x.id) : []));
    for (const m of mapping) {
      const d = declarations.get(m.ordinal), key = `${m.ordinal}:${m.reviewTargetId}`;
      if (matches.has(key) || d?.type !== "TARGETS" || !d.targets.some(t => t.id === m.reviewTargetId)
        || (m.truthTargetId !== null && !knownIds.has(m.truthTargetId))) throw Error("unknown/duplicate correspondence");
      matches.set(key, m.truthTargetId);
    }
    metrics = Object.fromEntries(METRICS.map(k => [k, 0])) as AIMetrics;
    const inc = (key: typeof METRICS[number], n = 1) => { metrics[key] = metrics[key]! + n; };
    const actual = new Map<string, Set<number>>(), claimed = new Map<string, Set<number>>();
    const reviewToTruth = new Map<string, Set<string>>(), truthToReview = new Map<string, Set<string>>();
    const activity = (map: Map<string, Set<number>>, id: string, i: number) => { const set = map.get(id) ?? new Set(); set.add(i); map.set(id, set); };
    for (const t of truth) {
      const d = declarations.get(t.ordinal)!; inc("frameCount");
      if (t.state !== "KNOWN") continue;
      inc("clearFrameCount"); inc("targetFrameCount", t.targets.length);
      if (d.type === "UNKNOWN") inc("unnecessaryUnknownCount");
      for (const x of t.targets) activity(actual, x.id, t.ordinal);
      const matched = new Set<string>();
      if (d.type === "TARGETS") for (const x of d.targets) {
        inc("declaredTargetFrameCount"); const key = `${t.ordinal}:${x.id}`;
        if (!matches.has(key)) throw Error("unresolved truth correspondence");
        const id = matches.get(key);
        if (id === null) { inc("falsePositiveTargetFrames"); continue; }
        const target = t.targets.find(x => x.id === id);
        if (!target || matched.has(id!)) inc("falsePositiveTargetFrames");
        if (target && target.category !== x.category) inc("categoryMismatchTargetFrames");
        matched.add(id!); activity(claimed, id!, t.ordinal);
        const ids = reviewToTruth.get(x.id) ?? new Set(); ids.add(id!); reviewToTruth.set(x.id, ids);
        const uuids = truthToReview.get(id!) ?? new Set(); uuids.add(x.id); truthToReview.set(id!, uuids);
      }
      const missed = t.targets.filter(x => !matched.has(x.id)).length;
      inc("missedTargetFrames", missed); if (t.targets.length > 1 && missed) inc("multiTargetMissCount");
    }
    for (const ids of reviewToTruth.values()) inc("identityMergeErrors", Math.max(0, ids.size - 1));
    for (const ids of truthToReview.values()) inc("identitySplitErrors", Math.max(0, ids.size - 1));
    for (const id of new Set([...actual.keys(), ...claimed.keys()])) {
      const a = actual.get(id) ?? new Set<number>(), b = claimed.get(id) ?? new Set<number>();
      for (const i of new Set([...a, ...b])) if (a.has(i) !== b.has(i)) inc("boundaryErrorFrames");
      for (const i of a) if (!a.has(i - 1) && !a.has(i + 1) && !b.has(i)) inc("singleFrameAppearanceMisses");
      const sequence = [...a].sort((a, b) => a - b);
      for (let i = 1; i < sequence.length; i++) if (sequence[i] > sequence[i - 1] + 1) {
        const first = sequence[i - 1], last = sequence[i];
        if (b.has(first) && b.has(last) && Array.from({ length: last - first - 1 }, (_, k) => k + first + 1).every(j => b.has(j))) inc("bridgedAbsenceIntervals");
      }
    }
    metrics.unnecessaryUnknownRate = metrics.clearFrameCount ? metrics.unnecessaryUnknownCount! / metrics.clearFrameCount : null;
    metrics.targetFrameRecall = metrics.targetFrameCount ? (metrics.targetFrameCount - metrics.missedTargetFrames!) / metrics.targetFrameCount : null;
    metrics.falsePositiveRate = metrics.declaredTargetFrameCount ? metrics.falsePositiveTargetFrames! / metrics.declaredTargetFrameCount : null;
    metricsComplete = true;
    for (const gate of AI_CRITERIA.zeroTolerance) if (metrics[gate]! > 0) failures.push(gate);
    if (failures.length) return finish("NOT_QUALIFIED");
    if (evaluateUsability && metrics.clearFrameCount! < AI_CRITERIA.minimumClearFrames) { failures.push("INSUFFICIENT_CLEAR_FRAMES"); return finish("INCOMPLETE"); }
    if (evaluateUsability && metrics.unnecessaryUnknownCount! * 100 > metrics.clearFrameCount! * AI_CRITERIA.unnecessaryUnknownPercent) {
      failures.push("unnecessaryUnknownRate"); return finish("NOT_QUALIFIED");
    }
    return finish("MATCH");
  } catch (e) {
    // A partial arithmetic pass cannot publish default zero metrics.
    metrics = absentMetrics(); failures.push(e instanceof Error ? e.message : "evidence unavailable"); return finish("INCOMPLETE");
  }
}

const Pair = z.object({ ordinal: AI_INTEGER, a: z.string().uuid(), b: z.string().uuid() }).strict();
/** Post-freeze model mapping remains a declaration, never a truth correspondence. */
export function buildAIJoint(rawA: unknown, rawB: unknown, rawMapping: unknown) {
  const a = z.array(AIDeclarationSchema).parse(rawA), b = z.array(AIDeclarationSchema).parse(rawB), pairs = z.array(Pair).parse(rawMapping);
  if (a.length !== b.length || new Set(a.map(x => x.ordinal)).size !== a.length || a.some((x, i) => x.ordinal !== i || b[i].ordinal !== i)) throw Error("INCOMPLETE: joint ordinal binding");
  const activity = (ds: AIDeclaration[], id: string) => ds.filter(d => d.type === "TARGETS" && d.targets.some(t => t.id === id)).map(d => d.ordinal);
  const declarations = a.map((left, i): AIDeclaration => {
    const right = b[i], unknown = (): AIDeclaration => ({ ordinal: i, type: "UNKNOWN", reason: "Actor uncertainty or incomplete bijection/category/activity agreement" });
    if (left.type === "EMPTY" && right.type === "EMPTY") return left;
    if (left.type !== "TARGETS" || right.type !== "TARGETS") return unknown();
    const mapping = pairs.filter(p => p.ordinal === i);
    if (mapping.length !== left.targets.length || mapping.length !== right.targets.length || new Set(mapping.map(p => p.a)).size !== mapping.length || new Set(mapping.map(p => p.b)).size !== mapping.length) return unknown();
    for (const pair of mapping) {
      const x = left.targets.find(t => t.id === pair.a), y = right.targets.find(t => t.id === pair.b);
      if (!x || !y || x.category !== y.category || aiDigest(activity(a, pair.a)) !== aiDigest(activity(b, pair.b))) return unknown();
      if (pairs.some(p => (p.a === pair.a && p.b !== pair.b) || (p.b === pair.b && p.a !== pair.a))) return unknown();
    }
    return left;
  });
  if (pairs.some(p => !a[p.ordinal] || a[p.ordinal].type !== "TARGETS" || b[p.ordinal].type !== "TARGETS")) throw Error("INCOMPLETE: mapping outside target frames");
  return freezeAI({ declarations, mappingDigest: aiDigest(pairs), aDigest: aiDigest(a), bDigest: aiDigest(b), jointDigest: aiDigest(declarations) });
}

/** Author-side offline arithmetic for all three actors. Serialized input has no trusted issuer. */
export function compareAIQualification(raw: unknown) {
  const results: (ReturnType<typeof compareAIFrames> & { fixtureId: string; actor: string; sourceKind: string })[] = [];
  let status = "INCOMPLETE";
  let aggregate: unknown = null, strata: unknown = null;
  const failures: string[] = [];
  try {
    const input = z.object({ package: z.unknown(), reviews: z.array(z.object({ fixtureId: z.string().uuid(), actor: z.enum(["A", "B", "joint"]),
      declarations: z.unknown(), correspondence: z.unknown() }).strict()).max(768) }).strict().parse(raw);
    const p = assertAIPackage(input.package); const used = new Set<string>();
    for (const r of input.reviews) {
      const key = `${r.fixtureId}:${r.actor}`, f = p.truth.fixtures.find(f => f.fixtureId === r.fixtureId);
      if (used.has(key) || !f) throw Error("duplicate/unknown fixture actor"); used.add(key);
      const result = { fixtureId: r.fixtureId, actor: r.actor, sourceKind: p.manifest.fixtures.find(t => t.fixtureId === r.fixtureId)!.sourceKind,
        ...compareAIFrames(f.frames.map(f => ({ ordinal: f.binding.ordinal, ...f })), r.declarations, r.correspondence, false) };
      results.push(result);
      if (result.status === "NOT_QUALIFIED") { status = "NOT_QUALIFIED"; break; }
    }
    // Per-fixture <100 clear is expected. Usability uses the full holdout per actor, never A+B.
    const summarize = (rs: typeof results, expected: number) => {
      if (!expected || rs.length !== expected || rs.some(r => !r.metricsComplete)) return { metrics: absentMetrics(), evaluation: "NOT_EVALUATED" };
      const metrics = Object.fromEntries(METRICS.map(k => [k, rs.reduce((n, r) => n + (r.metrics[k] ?? 0), 0)])) as AIMetrics;
      metrics.unnecessaryUnknownRate = metrics.clearFrameCount ? metrics.unnecessaryUnknownCount! / metrics.clearFrameCount : null;
      metrics.targetFrameRecall = metrics.targetFrameCount ? (metrics.targetFrameCount - metrics.missedTargetFrames!) / metrics.targetFrameCount : null;
      metrics.falsePositiveRate = metrics.declaredTargetFrameCount ? metrics.falsePositiveTargetFrames! / metrics.declaredTargetFrameCount : null;
      return { metrics, evaluation: "EVALUATED" };
    };
    aggregate = Object.fromEntries(["A", "B", "joint"].map(actor => [actor, summarize(results.filter(r => r.actor === actor), p.manifest.fixtures.length)]));
    strata = Object.fromEntries(["SYNTHETIC_CONTROLLED", "REAL_MEDIA_HUMAN_TRUTH"].map(kind => [kind,
      Object.fromEntries(["A", "B", "joint"].map(actor => [actor, summarize(results.filter(r => r.actor === actor && r.sourceKind === kind),
        p.manifest.fixtures.filter(f => f.sourceKind === kind).length)]))]));
    if (status === "NOT_QUALIFIED") { /* Monotonic hard failure; do not inspect later results. */ }
    else if (used.size !== p.manifest.fixtures.length * 3 || results.some(r => !r.metricsComplete) || !aiCoverage(p).sufficient) failures.push("INCOMPLETE_COVERAGE_OR_MAPPING");
    else {
      const actors = ["A", "B", "joint"].map(actor => {
        const rs = results.filter(r => r.actor === actor);
        const clear = rs.reduce((n, r) => n + r.metrics.clearFrameCount!, 0), unknown = rs.reduce((n, r) => n + r.metrics.unnecessaryUnknownCount!, 0);
        return { actor, clear, unknown, rate: clear ? unknown / clear : null };
      });
      status = actors.some(a => a.clear >= 100 && a.unknown * 100 > a.clear * 5) ? "NOT_QUALIFIED" : actors.every(a => a.clear >= 100) ? "MATCH" : "INCOMPLETE";
    }
  } catch (e) { failures.push(e instanceof Error ? e.message : "evidence unavailable"); }
  const body = { authority: "none", eligible: false, evidenceClass: "OFFLINE_AI_COMPARISON_NOT_QUALIFICATION", comparisonStatus: status,
    qualificationStatus: status === "NOT_QUALIFIED" ? status : "INCOMPLETE", qualificationRecord: null, results, aggregate, strata, failures };
  return freezeAI({ ...body, comparisonDigest: aiDigest(body) });
}
