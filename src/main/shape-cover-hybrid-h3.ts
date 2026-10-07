import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ExportSettingsSchema, type ExportSettings } from "../shared/export-settings.js";
import { CoverStickerIdSchema, isCoverPoolStickerId } from "../shared/cover-sticker.js";
import { isAutomaticStickerAllowed } from "../shared/automatic-stickers.js";
import { freezeAI } from "./source-fact-ai-contract.js";
import { assertOwnedDiscoveryEvidence, assertDefaultDiscoveryPopulation, verifyMatchingDiscoveryEvidence, prepareDiscoveryEvidence, discoveryHash, type DiscoveryEvidence } from "./source-fact-discovery-evidence.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence } from "./source-mask-static-target.js";
import { extractStaticConservativeMask } from "./source-mask-static-extraction.js";
import { getConfirmedCornerTargets, type HybridCornerSemanticSet } from "./shape-cover-vision-corner-semantic.js";
import { createCornerScopePlan, cornerScopeRect, type Corner } from "./shape-cover-vision-corner-policy.js";
import { discoverStationaryTargets } from "./shape-cover-stationary-discovery.js";
import { measureShapeCoverOutput, readShapeCoverAsset, decodeShapeCoverPng, type ShapeCoverPlacement } from "./shape-cover-alpha.js";
import { decodeSourceMask, projectSourceMask, SHAPE_COVER_PIXEL_CONTRACT, type SourceToOutput } from "./shape-cover-pixel-gate.js";
import { freezeShapeCoverRaster, publishShapeCoverPng } from "./shape-cover-freeze.js";
import { checkHybridCornerMotion, type HybridMotionResult } from "./shape-cover-hybrid-motion.js";
import { searchHybridCornerShape, HYBRID_SHAPE_SEARCH, type HybridStickerCandidate } from "./shape-cover-hybrid-shape.js";
import type { FullSourceCensusInput } from "./source-fact-census.js";
import type { AutoContourBitmap } from "./source-mask-auto-extraction.js";

type SemanticTarget = Awaited<ReturnType<typeof getConfirmedCornerTargets>>[number];
export interface HybridFrozenOverlay {
  version: "HybridCornerFrozenOverlay/v1"; verification: "geometry-only"; contentSafety: "NOT_EVALUATED";
  authority: "none"; productState: "PRODUCT_DISABLED"; semanticTarget: SemanticTarget;
  source: FullSourceCensusInput["source"]; discoveryDigest: string; mask: AutoContourBitmap; maskReceiptDigest: string;
  maskConfirmation: { discoveryDigest: string; candidateIds: readonly string[]; sourceBoxes: readonly ShapeCoverPlacement[] };
  legacyMaskDiagnostics: { reasons: readonly string[]; anomalyCount: number };
  motion: HybridMotionResult; selectedSticker: { id: string; assetFingerprint: string; trimBox: ShapeCoverPlacement; trimmedSha256: string };
  settings: ExportSettings; projection: SourceToOutput; placement: ShapeCoverPlacement; radiusPx: number;
  range: { startFrame: number; endFrame: number; startMs: number; endMs: number };
  pixelContract: typeof SHAPE_COVER_PIXEL_CONTRACT; searchConfig: typeof HYBRID_SHAPE_SEARCH;
  searchMetrics: { candidates: number; rasters: number; trials: number; rejectedAssets: number };
  coverage: { oldPixels: number; uncoveredPixels: 0; coverageFraction: 1 };
  candidateAlphaSha256: string; finalAlphaSha256: string; rgbaSha256: string; pngSha256: string; bindingDigest: string; pngPath: string;
}
export interface HybridH3CornerResult {
  corner: Corner; status: "FROZEN" | "SKIPPED"; reason?: string; semanticTarget: SemanticTarget;
  mask?: AutoContourBitmap; motion?: HybridMotionResult; overlay?: HybridFrozenOverlay;
}
export interface HybridCornerH3Result {
  version: "HybridCornerH3/v1"; status: "READY" | "PARTIAL" | "EMPTY" | "BLOCKED";
  productState: "PRODUCT_DISABLED"; corners: HybridH3CornerResult[]; sourceErrors: string[];
  verifyFresh(): Promise<void>;
}
const owners = new WeakMap<HybridCornerH3Result, { masks: Map<HybridFrozenOverlay, Uint8Array> }>();
const targetUuid = (id: string) => {
  const h = discoveryHash(id); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Development H3 only. No knowledge publication, strict geometry/proof or production lifecycle. */
export async function prepareHybridCornerOverlays(input: FullSourceCensusInput, evidence: DiscoveryEvidence,
  semantic: HybridCornerSemanticSet, candidates: readonly HybridStickerCandidate[], settings: ExportSettings,
  directory: string, candidateEvidence?: DiscoveryEvidence): Promise<HybridCornerH3Result> {
  const signal = input.signal, tools = { ...input.ffmpeg, signal }, frozenInput = structuredClone({ source: input.source, candidates, settings: ExportSettingsSchema.parse(settings) });
  const sourceInput = { sourcePath: input.sourcePath, source: frozenInput.source, ffmpeg: { ...input.ffmpeg }, signal };
  const corners: HybridH3CornerResult[] = [], sourceErrors: string[] = [], masks = new Map<HybridFrozenOverlay, Uint8Array>(), directories: string[] = [];
  let maskDiscovery: DiscoveryEvidence | undefined;
  const fresh = async () => {
    signal.throwIfAborted(); assertOwnedDiscoveryEvidence(evidence); await evidence.verifyFresh(); await semantic.verifyFresh();
    if (candidateEvidence) await verifyMatchingDiscoveryEvidence(evidence, candidateEvidence);
    if (sourceKey(frozenInput.source) !== evidence.receipt.sourceKey || semantic.sourceKey !== evidence.receipt.sourceKey) throw Error("HYBRID_SOURCE_BINDING");
  };
  const freshCatalog = async () => {
    try { for (const c of frozenInput.candidates) await readShapeCoverAsset(c.asset, tools); }
    catch { signal.throwIfAborted(); throw Error("HYBRID_CATALOG_BINDING"); }
  };
  try {
    await fresh();
    const targets = await getConfirmedCornerTargets(semantic);
    if (candidateEvidence) assertDefaultDiscoveryPopulation(candidateEvidence);
    const plan = createCornerScopePlan(await discoverStationaryTargets(candidateEvidence ?? evidence, signal));
    if (plan.candidateSetDigest !== semantic.candidateSetDigest || plan.scopeDigest !== semantic.scopeDigest) throw Error("HYBRID_SEMANTIC_BINDING");
    if (new Set(frozenInput.candidates.map(c => c.id)).size !== frozenInput.candidates.length) throw Error("HYBRID_CATALOG_BINDING");
    for (const c of frozenInput.candidates) {
      CoverStickerIdSchema.parse(c.id);
      if (!isAutomaticStickerAllowed(c.id) && !isCoverPoolStickerId(c.id) ||
        c.id.startsWith("uploaded-") && c.asset.assetFingerprint !== `sha256:${c.id.slice(9)}`) throw Error("HYBRID_CATALOG_BINDING");
    }
    await freshCatalog();
    const sampling = evidence.receipt.frames;
    if (sampling.length > 32 || sampling.length < Math.min(16, evidence.receipt.frameCount) || sampling[0]?.index !== 0 ||
      sampling.at(-1)?.index !== evidence.receipt.frameCount - 1) throw Error("HYBRID_SAMPLE_BINDING");
    const projection = targets.length ? await measureShapeCoverOutput(sourceInput.sourcePath, frozenInput.source, frozenInput.settings, tools) : undefined;
    // Preserve the existing mask kernel's default representative population. H2's smaller image budget is semantic-only.
    maskDiscovery = targets.length ? candidateEvidence ?? await prepareDiscoveryEvidence(sourceInput) : undefined;
    if (maskDiscovery && (maskDiscovery.receipt.sourceKey !== evidence.receipt.sourceKey || maskDiscovery.receipt.clockDigest !== evidence.receipt.clockDigest ||
      JSON.stringify(maskDiscovery.receipt.decode) !== JSON.stringify(evidence.receipt.decode))) throw Error("HYBRID_MASK_SOURCE_BINDING");
    const maskPlan = maskDiscovery ? createCornerScopePlan(await discoverStationaryTargets(maskDiscovery, signal)) : undefined;
    for (const semanticTarget of targets) {
      await fresh();
      const result: HybridH3CornerResult = { corner: semanticTarget.corner, status: "SKIPPED", semanticTarget }; corners.push(result);
      let targetEvidence: Awaited<ReturnType<typeof prepareStaticTargetEvidence>> | undefined;
      let operation: string | undefined;
      try {
        // Aligned production consumes the exact H2-confirmed IDs. Legacy callers retain the old containment gate.
        const confirmedBoxes = semanticTarget.candidateIds.map(id => plan.allCandidates.find(c => c.candidateId === id)!.sourceBox);
        const maskMembers = candidateEvidence ? semanticTarget.candidateIds.map(id => maskPlan!.allCandidates.filter(c =>
          c.candidateId === id && maskPlan!.corners[semanticTarget.corner].candidateIds.includes(id))) : confirmedBoxes.map(box => maskPlan!.allCandidates.filter(c =>
          maskPlan!.corners[semanticTarget.corner].candidateIds.includes(c.candidateId) && c.sourceBox.x >= box.x && c.sourceBox.y >= box.y &&
          c.sourceBox.x + c.sourceBox.width <= box.x + box.width && c.sourceBox.y + c.sourceBox.height <= box.y + box.height));
        if (maskMembers.some(m => m.length !== 1) || new Set(maskMembers.map(m => m[0]?.candidateId)).size !== confirmedBoxes.length) {
          result.reason = "MASK_TARGET_AMBIGUOUS"; continue;
        }
        const target = await confirmStaticDiscoveryTarget(maskDiscovery!, { targetId: targetUuid(semanticTarget.logicalTargetId), candidateIds: maskMembers.map(m => m[0].candidateId),
          confirmedBy: `H2/${semanticTarget.semanticSource}`, description: semanticTarget.classification, decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY",
          range: { startFrame: 0, endFrame: evidence.receipt.frameCount } }, signal);
        targetEvidence = await prepareStaticTargetEvidence(sourceInput, target);
        const extracted = await extractStaticConservativeMask(targetEvidence, signal);
        if (!extracted.receipt.mask || extracted.receipt.reasons.some(r => r !== "FULL_RANGE_STATIC_CONTRADICTION")) { result.reason = "MASK_UNAVAILABLE"; continue; }
        result.mask = structuredClone(extracted.receipt.mask);
        const oldMask = decodeSourceMask({ ...result.mask, kind: "static-binary-v1" }, frozenInput.source);
        if (!oldMask) throw Error("HYBRID_MASK_BINDING");
        const roiMask = new Uint8Array(targetEvidence.roi.width * targetEvidence.roi.height), frames: { index: number; rgba: Buffer }[] = [];
        for (let y = 0; y < targetEvidence.roi.height; y++) roiMask.set(oldMask.subarray((y + targetEvidence.roi.y) * frozenInput.source.width + targetEvidence.roi.x,
          (y + targetEvidence.roi.y) * frozenInput.source.width + targetEvidence.roi.x + targetEvidence.roi.width), y * targetEvidence.roi.width);
        for (let i = 0; i < sampling.length; i++) {
          const full = await evidence.readFrame(i), roi = targetEvidence.roi, rgba = Buffer.alloc(roi.width * roi.height * 4);
          for (let y = 0; y < roi.height; y++) full.copy(rgba, y * roi.width * 4,
            ((roi.y + y) * frozenInput.source.width + roi.x) * 4, ((roi.y + y) * frozenInput.source.width + roi.x + roi.width) * 4);
          frames.push({ index: sampling[i].index, rgba });
        }
        const components = target.receipt.confirmedSourceBoxes.map(b => ({ ...b, x: b.x - targetEvidence!.roi.x, y: b.y - targetEvidence!.roi.y }));
        result.motion = checkHybridCornerMotion(frames, targetEvidence.roi, roiMask, components, signal);
        if (result.motion.status !== "STATIC_SUPPORTED") { result.reason = result.motion.status; continue; }
        const oldFinal = projectSourceMask(oldMask, frozenInput.source, projection!);
        if (!oldFinal) throw Error("HYBRID_MASK_BINDING");
        const corner = cornerScopeRect(semanticTarget.corner, projection!.width, projection!.height), x = Math.ceil(corner.x), y = Math.ceil(corner.y);
        const scope = { x, y, width: Math.floor(corner.x + corner.width) - x, height: Math.floor(corner.y + corner.height) - y };
        const sourceScale = Math.min(projection!.scaledWidth / frozenInput.source.width, projection!.scaledHeight / frozenInput.source.height);
        const selected = await searchHybridCornerShape(frozenInput.candidates, oldFinal, projection!, scope, sourceScale, tools);
        if (!selected) { result.reason = "NO_SHAPE_MATCH"; continue; }
        const frozen = await freezeShapeCoverRaster(selected.raster, oldFinal, projection!, selected.radiusPx, tools);
        await fresh(); await freshCatalog();
        const body = { version: "HybridCornerFrozenOverlay/v1" as const, verification: "geometry-only" as const, contentSafety: "NOT_EVALUATED" as const,
          authority: "none" as const, productState: "PRODUCT_DISABLED" as const, semanticTarget, source: frozenInput.source,
          discoveryDigest: evidence.receipt.evidenceDigest, mask: result.mask, maskReceiptDigest: extracted.receipt.receiptDigest,
          maskConfirmation: { discoveryDigest: maskDiscovery!.receipt.evidenceDigest, candidateIds: target.receipt.confirmedCandidateIds,
            sourceBoxes: target.receipt.confirmedSourceBoxes },
          legacyMaskDiagnostics: { reasons: extracted.receipt.reasons, anomalyCount: extracted.receipt.anomalies.length }, motion: result.motion,
          selectedSticker: { id: selected.candidate.id, assetFingerprint: selected.candidate.asset.assetFingerprint, trimBox: selected.trimBox, trimmedSha256: selected.trimmedSha256 },
          settings: frozenInput.settings, projection: projection!, placement: selected.placement, radiusPx: selected.radiusPx,
          range: { startFrame: 0, endFrame: evidence.receipt.frameCount, startMs: 0, endMs: frozenInput.source.durationMs },
          pixelContract: SHAPE_COVER_PIXEL_CONTRACT, searchConfig: HYBRID_SHAPE_SEARCH, searchMetrics: selected.metrics,
          coverage: frozen.coverage, candidateAlphaSha256: selected.alphaSha256, finalAlphaSha256: discoveryHash(frozen.finalAlpha),
          rgbaSha256: discoveryHash(frozen.decoded), pngSha256: discoveryHash(frozen.png) };
        await mkdir(path.resolve(directory), { recursive: true }); operation = path.resolve(directory, randomUUID());
        await mkdir(operation); directories.push(operation);
        const pngPath = await publishShapeCoverPng(operation, frozen.png);
        await fresh(); await freshCatalog();
        result.overlay = freezeAI({ ...body, bindingDigest: discoveryHash(JSON.stringify(body)), pngPath }); result.status = "FROZEN";
        masks.set(result.overlay, oldFinal);
      } catch (error) {
        // A local shape/tool/mask failure skips only its corner. Freshness, identity and cancellation remain source-wide.
        await fresh();
        const code = error instanceof Error ? error.message : "HYBRID_CORNER_FAILED";
        if (/BINDING|fingerprint mismatch|generation changed/.test(code)) throw error;
        result.reason = code === "HYBRID_SEARCH_LIMIT" ? code : "HYBRID_CORNER_FAILED";
      } finally {
        await targetEvidence?.close();
        if (operation && result.status !== "FROZEN") await rm(operation, { recursive: true, force: true });
      }
    }
    await fresh(); await freshCatalog();
  } catch (error) {
    sourceErrors.push(signal.aborted ? "HYBRID_CANCELLED" : error instanceof Error ? error.message : "HYBRID_SOURCE_FAILED");
    for (const c of corners) { c.status = "SKIPPED"; c.reason = "HYBRID_SOURCE_FAILED"; delete c.overlay; } masks.clear();
    for (const d of directories) await rm(d, { recursive: true, force: true });
  } finally { if (maskDiscovery && maskDiscovery !== candidateEvidence) await maskDiscovery.close(); }
  const hasFrozen = corners.some(c => c.status === "FROZEN"), hasSkipped = corners.some(c => c.status === "SKIPPED");
  const data = freezeAI({ version: "HybridCornerH3/v1" as const, status: sourceErrors.length ? "BLOCKED" as const : hasFrozen ? hasSkipped ? "PARTIAL" as const : "READY" as const : "EMPTY" as const,
    productState: "PRODUCT_DISABLED" as const, corners, sourceErrors });
  const result = Object.freeze({ ...data, verifyFresh: async () => {
    await fresh();
    await freshCatalog();
    for (const overlay of masks.keys()) await readShapeCoverAsset({ assetPath: overlay.pngPath, assetFingerprint: `sha256:${overlay.pngSha256}` }, tools);
  } });
  owners.set(result, { masks }); return result;
}

/** H4 gets exact frozen bytes after independent decoded-alpha recheck. JSON never restores this live seam. */
export async function readHybridFrozenOverlay(result: HybridCornerH3Result, corner: Corner, tools: FullSourceCensusInput["ffmpeg"]) {
  const owner = owners.get(result); if (!owner || result.status === "BLOCKED") throw Error("HYBRID_H3_RESULT_BINDING");
  await result.verifyFresh(); const overlay = result.corners.find(c => c.corner === corner && c.status === "FROZEN")?.overlay;
  if (!overlay) throw Error("HYBRID_OVERLAY_UNAVAILABLE");
  const oldFinal = owner.masks.get(overlay); if (!oldFinal) throw Error("HYBRID_H3_RESULT_BINDING");
  const png = await readShapeCoverAsset({ assetPath: overlay.pngPath, assetFingerprint: `sha256:${overlay.pngSha256}` }, tools);
  const decoded = await decodeShapeCoverPng(png, overlay.projection, tools);
  if (discoveryHash(decoded) !== overlay.rgbaSha256 || oldFinal.some((v, p) => v !== 0 && decoded[p * 4 + 3] !== 255)) throw Error("HYBRID_FROZEN_PIXEL_MISMATCH");
  await result.verifyFresh(); return { overlay, png };
}
