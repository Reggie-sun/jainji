import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FrozenShapeCoverSchema } from "../shared/shape-cover.js";
import { EditTemplateSchema, createDefaultTemplate, type StickerLayer } from "./domain.js";
import { decodeShapeCoverPng, encodeShapeCoverPng, rasterizeShapeCoverArtwork, readShapeCoverAsset, type ShapeCoverMediaTools } from "./shape-cover-alpha.js";
import { computeCommonShapeCoverCandidates, readAdmittedShapeCoverTarget, type ShapeCoverCandidateRequest } from "./shape-cover-candidates.js";
import { growOpaqueContour, projectSourceMask } from "./shape-cover-pixel-gate.js";
import { shapeCoverBindingDigest, shapeCoverDigest } from "./shape-cover-render.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

type FrozenCell = { intendedTargetId: string; outputSettingId: string; layer: StickerLayer };
export type FrozenShapeCoverResult = { status: "PASS"; verification: "geometry-only"; contentSafety: "NOT_EVALUATED"; layers: FrozenCell[] }
  | { status: "UNSAFE"; reason: "freeze-invalid-or-stale"; layers: [] };

async function publishPng(directory: string, png: Buffer): Promise<string> {
  const destination = path.join(directory, `shape-${shapeCoverDigest(png)}.png`);
  const temporary = path.join(directory, `.${randomUUID()}.partial`);
  try {
    await writeFile(temporary, png, { flag: "wx", mode: 0o600 });
    const file = await open(temporary, "r");
    try { await file.sync(); } finally { await file.close(); }
    try { await link(temporary, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(destination)).equals(png)) throw error;
    }
    return destination;
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** Freeze one shared selection only after rechecking the complete round. */
export async function freezeShapeCoverCandidate(request: ShapeCoverCandidateRequest, candidateId: string, store: SourceStickerKnowledgeStore, directory: string, tools: ShapeCoverMediaTools): Promise<FrozenShapeCoverResult> {
  let operationDirectory: string | undefined;
  try {
    tools.signal?.throwIfAborted();
    const input = structuredClone(request);
    const round = await computeCommonShapeCoverCandidates(input, store, tools);
    if (round.status !== "PASS" || !round.commonSafeCandidateIds.includes(candidateId)) throw new Error("Selected candidate is not common-safe");
    const candidate = input.candidates.find(item => item.id === candidateId)!;
    const bytes = await readShapeCoverAsset(candidate.asset, tools);
    const buffered: Array<{ cell: FrozenCell; png: Buffer }> = [];
    for (const evaluation of round.evaluations.filter(item => item.candidateId === candidateId)) {
      tools.signal?.throwIfAborted();
      const target = input.intendedTargets.find(item => item.id === evaluation.intendedTargetId)!;
      const admitted = await readAdmittedShapeCoverTarget(target, store);
      const oldFinal = projectSourceMask(admitted.sourceMask, target.source, evaluation.projection);
      const radius = evaluation.verdict.status === "PASS" ? evaluation.verdict.radiusPx : undefined;
      const raster = await rasterizeShapeCoverArtwork(bytes, evaluation.projection, evaluation.placement, tools);
      if (!oldFinal || radius === undefined || raster.alphaSha256 !== evaluation.alphaSha256 || admitted.factsDigest !== evaluation.factsDigest) throw new Error("Final shape state changed");
      const grown = growOpaqueContour(raster.alpha, evaluation.projection, radius)!;
      const rgba = raster.rgba;
      for (let i = 0; i < grown.length; i++) if (grown[i]) {
        const alpha = rgba[i * 4 + 3];
        for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = Math.round((rgba[i * 4 + channel] * alpha + 255 * (255 - alpha)) / 255);
        rgba[i * 4 + 3] = 255;
      }
      const png = await encodeShapeCoverPng(rgba, evaluation.projection, tools);
      const decoded = await decodeShapeCoverPng(png, evaluation.projection, tools);
      if (!decoded.equals(rgba)) throw new Error("Frozen PNG changed final pixels");
      const finalAlpha = new Uint8Array(grown.length);
      for (let i = 0; i < finalAlpha.length; i++) {
        finalAlpha[i] = decoded[i * 4 + 3];
        if (oldFinal[i] && finalAlpha[i] !== 255) throw new Error("Final frozen pixels leave uncovered source mask");
      }
      const binding = FrozenShapeCoverSchema.parse({ strategy: "shape-matched-frozen-rgba-v1", verification: "geometry-only", contentSafety: "NOT_EVALUATED",
        intendedTargetId: target.id, targetId: target.targetId, segmentId: target.segmentId, source: target.source, sourceRevisionId: target.revisionId,
        factsDigest: admitted.factsDigest, maskSha256: admitted.mask.sha256, range: target.range, candidateId, candidateAssetFingerprint: candidate.asset.assetFingerprint,
        outputSettingId: evaluation.outputSettingId, settings: evaluation.settings, projection: evaluation.projection, placement: evaluation.placement,
        pixelContractVersion: evaluation.pixelContract.version, rasterVersion: raster.rasterVersion, radiusPx: radius, candidateAlphaSha256: raster.alphaSha256,
        rgbaSha256: shapeCoverDigest(decoded), finalAlphaSha256: shapeCoverDigest(finalAlpha), pngSha256: shapeCoverDigest(png), bindingSha256: "0".repeat(64) });
      binding.bindingSha256 = shapeCoverBindingDigest(binding);
      const layer: StickerLayer = { id: randomUUID(), type: "sticker", assetPath: path.resolve(directory, `shape-${binding.pngSha256}.png`), assetFingerprint: `sha256:${binding.pngSha256}`,
        x: 0, y: 0, width: 1, rotationDeg: 0, opacity: 1, zIndex: 90, visible: true,
        cover: { stickerId: candidateId, height: 1, automatic: true, targetId: target.targetId, shapeMatched: binding,
          motion: { ...binding.range, keyframes: [{ timeMs: binding.range.startMs, rectangle: { x: 0, y: 0, width: 1, height: 1 } }] } } };
      EditTemplateSchema.parse({ ...createDefaultTemplate(), layers: [layer] });
      buffered.push({ cell: { intendedTargetId: target.id, outputSettingId: evaluation.outputSettingId, layer }, png });
    }
    const recheckBindings = async () => {
      for (const target of input.intendedTargets) {
        tools.signal?.throwIfAborted();
        const current = await readAdmittedShapeCoverTarget(target, store);
        if (buffered.some(({ cell }) => cell.intendedTargetId === target.id && cell.layer.cover!.shapeMatched!.factsDigest !== current.factsDigest)) throw new Error("Source revision changed during freeze");
      }
      await readShapeCoverAsset(candidate.asset, tools);
    };
    await recheckBindings();
    tools.signal?.throwIfAborted();
    await mkdir(path.resolve(directory), { recursive: true });
    const ownedDirectory = path.resolve(directory, randomUUID());
    await mkdir(ownedDirectory);
    operationDirectory = ownedDirectory;
    for (const { cell, png } of buffered) {
      tools.signal?.throwIfAborted();
      cell.layer.assetPath = await publishPng(operationDirectory, png);
    }
    await recheckBindings();
    tools.signal?.throwIfAborted();
    return { status: "PASS", verification: "geometry-only", contentSafety: "NOT_EVALUATED", layers: buffered.map(item => item.cell) };
  } catch {
    if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true }).catch(() => undefined);
    return { status: "UNSAFE", reason: "freeze-invalid-or-stale", layers: [] };
  }
}
