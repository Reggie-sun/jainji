import { z } from "zod";
import { CoverStickerIdSchema } from "../shared/cover-sticker.js";
import { ExportSettingsSchema, type ExportSettings } from "../shared/export-settings.js";
import { ReviewedRangeSchema, SourceIdentitySchema, coversRanges, type SourceIdentity, type ReviewedRange, type SourcePixelMask } from "../shared/source-sticker-knowledge.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { fingerprintFile } from "./paths.js";
import { measureShapeCoverOutput, rasterizeShapeCoverAlpha, readShapeCoverAsset, type ShapeCoverMediaTools, type ShapeCoverPlacement } from "./shape-cover-alpha.js";
import { SHAPE_COVER_PIXEL_CONTRACT, decodeSourceMask, projectSourceMask, evaluateShapeCover, type ShapeCoverResult, type SourceToOutput } from "./shape-cover-pixel-gate.js";
import { sourceKey, type SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

export interface IntendedShapeCoverTarget {
  id: string;
  sourcePath: string;
  source: SourceIdentity;
  revisionId: string;
  targetId: string;
  segmentId: string;
  range: ReviewedRange;
  placements: Array<{ outputSettingId: string; rectangle: ShapeCoverPlacement }>;
}
export interface ShapeCoverCandidateRequest {
  intendedTargets: IntendedShapeCoverTarget[];
  outputSettings: Array<{ id: string; settings: ExportSettings }>;
  candidates: Array<{ id: string; asset: BuiltinStickerAsset }>;
}
export interface ShapeCoverCandidateEvaluation {
  candidateId: string;
  assetFingerprint: string;
  intendedTargetId: string;
  source: SourceIdentity;
  sourceRevisionId: string;
  factsDigest: string;
  targetId: string;
  segmentId: string;
  maskSha256: string;
  range: ReviewedRange;
  outputSettingId: string;
  settings: ExportSettings;
  projection: SourceToOutput;
  placement: ShapeCoverPlacement;
  pixelContract: typeof SHAPE_COVER_PIXEL_CONTRACT;
  alphaSha256?: string;
  rasterVersion?: string;
  artwork?: { width: number; height: number };
  verdict: ShapeCoverResult | { status: "UNSAFE"; reason: "asset-unusable" };
}
export interface CommonShapeCoverCandidates {
  status: "PASS" | "UNSAFE";
  verification: "geometry-only";
  contentSafety: "NOT_EVALUATED";
  reason?: "round-invalid-or-stale" | "no-common-candidate";
  commonSafeCandidateIds: string[];
  evaluations: ShapeCoverCandidateEvaluation[];
}

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const Pixel = z.number().int().nonnegative().safe();
const Placement = z.object({ x: Pixel, y: Pixel, width: Pixel.positive(), height: Pixel.positive() }).strict();
export const ShapeCoverCandidateRequestSchema = z.object({
  intendedTargets: z.array(z.object({ id: Id, sourcePath: z.string().min(1), source: SourceIdentitySchema, revisionId: Id, targetId: Id, segmentId: Id,
    range: ReviewedRangeSchema, placements: z.array(z.object({ outputSettingId: Id, rectangle: Placement }).strict()).min(1),
  }).strict()).min(1),
  outputSettings: z.array(z.object({ id: Id, settings: ExportSettingsSchema }).strict()).min(1),
  candidates: z.array(z.object({ id: CoverStickerIdSchema, asset: z.object({ assetPath: z.string().min(1), assetFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict() }).strict()).min(1),
}).strict().superRefine((input, ctx) => {
  for (const list of [input.intendedTargets, input.outputSettings, input.candidates]) if (new Set(list.map(item => item.id)).size !== list.length) ctx.addIssue({ code: "custom", message: "Duplicate round identity" });
  for (const target of input.intendedTargets) {
    if (target.placements.length !== input.outputSettings.length || new Set(target.placements.map(item => item.outputSettingId)).size !== input.outputSettings.length
      || target.placements.some(item => !input.outputSettings.some(output => output.id === item.outputSettingId))) ctx.addIssue({ code: "custom", message: "Every intended target needs every output setting" });
  }
  for (const candidate of input.candidates) if (candidate.id.startsWith("uploaded-") && candidate.asset.assetFingerprint !== `sha256:${candidate.id.slice(9)}`) ctx.addIssue({ code: "custom", message: "Uploaded sticker identity mismatch" });
});

type AdmittedTarget = { target: IntendedShapeCoverTarget; mask: SourcePixelMask; sourceMask: Uint8Array; factsDigest: string };
export async function readAdmittedShapeCoverTarget(target: IntendedShapeCoverTarget, store: SourceStickerKnowledgeStore): Promise<AdmittedTarget> {
  await store.verifySource(target.sourcePath, target.source);
  const head = await store.readHead(target.source);
  if (!head || head.revision.id !== target.revisionId || head.revision.state !== "reviewed" || head.revision.sourceKey !== sourceKey(target.source)
    || head.revision.verification !== "source-mask-only" || !("mode" in head.revision.proof) || head.revision.proof.mode !== "source-mask-only-v1"
    || target.source.rotation !== 0) throw new Error("Intended source mask is not admitted at the expected revision");
  const segment = head.revision.candidate.facts.targets.find(item => item.id === target.targetId)?.segments.find(item => item.id === target.segmentId);
  if (!segment?.mask || !coversRanges([segment.track], [target.range])) throw new Error("Intended target/segment/range lacks an admitted mask");
  const sourceMask = decodeSourceMask(segment.mask, target.source);
  if (!sourceMask) throw new Error("Admitted source mask cannot be decoded");
  return { target, mask: segment.mask, sourceMask, factsDigest: head.revision.factsDigest };
}

/** Purely local M4-B1 seam: no selection, knowledge writes, renderer or queue admission. */
export async function computeCommonShapeCoverCandidates(request: ShapeCoverCandidateRequest, store: SourceStickerKnowledgeStore, tools: ShapeCoverMediaTools): Promise<CommonShapeCoverCandidates> {
  const result: CommonShapeCoverCandidates = { status: "UNSAFE", verification: "geometry-only", contentSafety: "NOT_EVALUATED", commonSafeCandidateIds: [], evaluations: [] };
  try {
    tools.signal?.throwIfAborted();
    // Parse into detached inputs before I/O so caller mutation cannot change this round.
    const input = ShapeCoverCandidateRequestSchema.parse(request);
    const admitted: AdmittedTarget[] = [];
    for (const target of input.intendedTargets) {
      tools.signal?.throwIfAborted();
      admitted.push(await readAdmittedShapeCoverTarget(target, store));
    }
    // All intended masks are admitted before any candidate bytes/alpha are opened.
    const cells: Array<{ binding: Omit<ShapeCoverCandidateEvaluation, "candidateId" | "assetFingerprint" | "verdict">; oldFinal: Uint8Array; sourceScale: number }> = [];
    for (const { target, mask, sourceMask, factsDigest } of admitted) for (const output of input.outputSettings) {
      tools.signal?.throwIfAborted();
      const projection = await measureShapeCoverOutput(target.sourcePath, target.source, output.settings, tools);
      const placement = target.placements.find(item => item.outputSettingId === output.id)!.rectangle;
      if (placement.x + placement.width > projection.width || placement.y + placement.height > projection.height) throw new Error("Placement is outside final output");
      const oldFinal = projectSourceMask(sourceMask, target.source, projection);
      if (!oldFinal) throw new Error("Invalid final source projection");
      cells.push({ oldFinal, sourceScale: Math.min(projection.scaledWidth / target.source.width, projection.scaledHeight / target.source.height),
        binding: { intendedTargetId: target.id, source: target.source, sourceRevisionId: target.revisionId, factsDigest, targetId: target.targetId, segmentId: target.segmentId,
          maskSha256: mask.sha256, range: target.range, outputSettingId: output.id, settings: output.settings, projection, placement, pixelContract: SHAPE_COVER_PIXEL_CONTRACT } });
    }
    for (const candidate of input.candidates) {
      tools.signal?.throwIfAborted();
      let bytes: Buffer | undefined;
      try { bytes = await readShapeCoverAsset(candidate.asset, tools); } catch { tools.signal?.throwIfAborted(); }
      let safe = true;
      for (const { binding, oldFinal, sourceScale } of cells) {
        tools.signal?.throwIfAborted();
        const evaluation: ShapeCoverCandidateEvaluation = { ...binding, candidateId: candidate.id, assetFingerprint: candidate.asset.assetFingerprint, verdict: { status: "UNSAFE", reason: "asset-unusable" } };
        if (bytes) {
          try {
            const { alpha, ...raster } = await rasterizeShapeCoverAlpha(bytes, binding.projection, binding.placement, tools);
            Object.assign(evaluation, raster);
            evaluation.verdict = evaluateShapeCover(oldFinal, alpha, binding.projection, sourceScale);
          } catch { tools.signal?.throwIfAborted(); }
        }
        safe &&= evaluation.verdict.status === "PASS";
        result.evaluations.push(evaluation);
      }
      if (safe) result.commonSafeCandidateIds.push(candidate.id);
    }
    // Read-only computation is not a store transaction: recheck bindings before handing off.
    for (const { target, factsDigest } of admitted) {
      tools.signal?.throwIfAborted();
      const current = await readAdmittedShapeCoverTarget(target, store);
      if (current.factsDigest !== factsDigest) throw new Error("Source facts changed during candidate evaluation");
    }
    for (const candidate of input.candidates) if (result.commonSafeCandidateIds.includes(candidate.id)) {
      if (await fingerprintFile(candidate.asset.assetPath) !== candidate.asset.assetFingerprint) throw new Error("Candidate bytes changed during evaluation");
    }
    tools.signal?.throwIfAborted();
    if (result.commonSafeCandidateIds.length) result.status = "PASS";
    else result.reason = "no-common-candidate";
    return result;
  } catch {
    return { ...result, status: "UNSAFE", reason: "round-invalid-or-stale", commonSafeCandidateIds: [] };
  }
}
