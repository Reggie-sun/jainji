import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import { isCoverPoolStickerId } from "../shared/cover-sticker.js";
import { HumanRegionBindingSchema } from "../shared/human-region-cover.js";
import type { MediaItem, ExportPreset, StickerLayer } from "./domain.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { measureShapeCoverOutput } from "./shape-cover-alpha.js";
import { searchHybridCornerShape, hybridMaskBounds } from "./shape-cover-hybrid-shape.js";
import { freezeShapeCoverRaster, publishShapeCoverPng } from "./shape-cover-freeze.js";
import { humanRegionBitmap, opaqueRegionCovered, projectHumanRectangle } from "./human-region-geometry.js";
import { reviewDigest } from "./cover-review-approval.js";
import { shapeCoverDigest } from "./shape-cover-render.js";

/** Bounded local geometry adapter. The review controller remains the only lifecycle owner. */
export function createHumanRegionCover(input: { draft: CoverReviewDraft; media: MediaItem[]; preset: ExportPreset;
  assets: StickerAssets; tools: FfmpegAdapter; directory: string; random: boolean }) {
  const draft = structuredClone(input.draft);
  const candidates = Object.keys(input.assets).filter(id => isCoverPoolStickerId(id) && input.assets[id]).sort();
  if (candidates.length > 256) throw Error("人工覆盖本地候选超过 256 款，请缩小贴纸库后重试。");
  const rounds = new Map<string, Promise<Map<string, StickerLayer[]>>>();
  const used = new Map<string, string[]>();
  const cache = new Map<string, StickerLayer | null>();
  const prepared = new Map<string, Promise<Awaited<ReturnType<typeof targets>>>>();
  const trials = new Map<string, number>();
  const targets = async (signal: AbortSignal, mediaId?: string) => {
    const result = [];
    for (const media of input.media) {
      if (mediaId && media.id !== mediaId) continue;
      const intent = draft.media.find(m => m.mediaId === media.id);
      if (!intent || intent.sourceFingerprint !== media.fingerprint || intent.disposition === "unresolved") throw Error("人工覆盖范围尚未确认。");
      if (intent.disposition === "no_cover") continue;
      if (!intent.segments.length || intent.segments.some(s => s.origin !== "human" || s.track.keyframes.length !== 1 || !intent.identities.some(i => i.id === s.identityId && i.origin === "human"))) throw Error("人工图案覆盖需要人工确认的固定框；移动目标请拆分时段。");
      const evidence = new SupervisorEvidence(input.tools, media);
      let source;
      try { source = await evidence.sourceIdentity(signal); } finally { await evidence.dispose(); }
      const projection = await measureShapeCoverOutput(media.sourcePath, source, input.preset, { ...input.tools, signal }, true);
      for (const segment of intent.segments) result.push({ media, source, projection, segment,
        target: projectHumanRectangle(segment.track.keyframes[0].rectangle, source, projection) });
    }
    await mkdir(input.directory, { recursive: true, mode: 0o700 });
    return result;
  };
  const match = async (target: Awaited<ReturnType<typeof targets>>[number], id: string, signal: AbortSignal): Promise<StickerLayer | null> => {
    const key = `${target.media.id}:${target.segment.id}:${id}`;
    if (cache.has(key)) return cache.get(key)!;
    const budgetKey = input.random ? target.media.id : "round";
    const attempts = (trials.get(budgetKey) ?? 0) + 1;
    trials.set(budgetKey, attempts);
    if (attempts > 512) throw Error(`人工覆盖匹配已达到${input.random ? "此素材" : "本批"} 512 次候选预算；请调整覆盖框或贴纸库。`);
    const tools = { ...input.tools, signal }, bitmap = humanRegionBitmap(target.target, target.projection);
    const selected = await searchHybridCornerShape([{ id, asset: input.assets[id]! }], bitmap, target.projection,
      { x: -target.projection.width, y: -target.projection.height, width: target.projection.width * 3, height: target.projection.height * 3 },
      Math.min(target.projection.scaledWidth / target.source.width, target.projection.scaledHeight / target.source.height), tools, "artwork");
    if (!selected) { cache.set(key, null); return null; }
    if (!opaqueRegionCovered(selected.raster.alpha, target.projection, target.target)) throw Error("人工覆盖不透明像素校验失败。");
    const frozen = await freezeShapeCoverRaster(selected.raster, bitmap, target.projection, 0, tools);
    const body = { kind: "human-region-v1" as const, projectId: draft.projectId, draftId: draft.id, revision: draft.revision,
      mediaId: target.media.id, segmentId: target.segment.id, identityId: target.segment.identityId, source: target.source,
      settings: { resolutionMode: input.preset.resolutionMode, frameRateMode: input.preset.frameRateMode, quality: input.preset.quality }, container: input.preset.container,
      rectangle: target.segment.track.keyframes[0].rectangle, target: target.target, projection: target.projection,
      placement: selected.placement, visualBounds: hybridMaskBounds(frozen.finalAlpha, target.projection),
      range: { startMs: target.segment.track.startMs, endMs: target.segment.track.endMs },
      artwork: { id, ...input.assets[id]! }, pngSha256: shapeCoverDigest(frozen.png), rgbaSha256: shapeCoverDigest(frozen.decoded) };
    const binding = HumanRegionBindingSchema.parse({ ...body, bindingDigest: reviewDigest(body) });
    const layer: StickerLayer = { id: randomUUID(), type: "sticker", visible: true, x: 0, y: 0, width: 1, opacity: 1, rotationDeg: 0, zIndex: 90,
      assetPath: await publishShapeCoverPng(input.directory, frozen.png), assetFingerprint: `sha256:${binding.pngSha256}`,
      cover: { stickerId: id, height: 1, regionId: target.segment.id, humanRegion: binding } };
    cache.set(key, layer); return layer;
  };
  const round = (version: number, signal: AbortSignal, mediaId?: string): Promise<Map<string, StickerLayer[]>> => {
    const scope = mediaId ?? "round", key = `${scope}:${version}`;
    let pending = rounds.get(key);
    if (!pending) {
      pending = (async () => {
        if (version > 1) await round(version - 1, signal, mediaId);
        const timeout = AbortSignal.timeout(600_000), bounded = AbortSignal.any([signal, timeout]);
        if (!prepared.has(scope)) prepared.set(scope, targets(bounded, mediaId));
        const all = await prepared.get(scope)!, result = new Map(input.media.map(m => [m.id, [] as StickerLayer[]]));
        const groups = new Map<string, typeof all>();
        for (const target of all) {
          const key = input.random ? `${target.media.id}:${target.segment.identityId}` : "round";
          groups.set(key, [...groups.get(key) ?? [], target]);
        }
        const assigned = new Map<string, Set<string>>(), entries = [...groups];
        const selections: { key: string; id: string; group: typeof all; layers: StickerLayer[] }[] = [];
        let assignments = 0;
        const solve = async (index: number): Promise<boolean> => {
          if (index === entries.length) return true;
          bounded.throwIfAborted();
          const [key, group] = entries[index], previous = used.get(key) ?? [];
          const perMedia = assigned.get(group[0].media.id) ?? new Set<string>();
          assigned.set(group[0].media.id, perMedia);
          const eligible = candidates.filter(id => !input.random || !perMedia.has(id));
          const ordered = [...eligible.filter(id => !previous.includes(id)), ...eligible.filter(id => previous.includes(id) && id !== previous.at(-1)), ...eligible.filter(id => id === previous.at(-1))];
          for (const id of ordered) {
            if (++assignments > 4096) throw Error("人工覆盖选材组合达到本轮预算，请减少目标或调整贴纸库。");
            bounded.throwIfAborted();
            const layers: StickerLayer[] = [];
            for (const target of group) { const layer = await match(target, id, bounded); if (!layer) break; layers.push(layer); }
            if (layers.length !== group.length) continue;
            perMedia.add(id); selections.push({ key, id, group, layers });
            if (await solve(index + 1)) return true;
            selections.pop(); perMedia.delete(id);
          }
          return false;
        };
        if (!await solve(0)) throw Error("没有贴纸能用自身不透明图案完整覆盖全部目标框。请调整框、时段或添加更合适的贴纸；不会添加白底。");
        for (const { key, id, group, layers } of selections) {
          used.set(key, [...used.get(key) ?? [], id]);
          layers.forEach((layer, index) => result.get(group[index].media.id)!.push(structuredClone(layer)));
        }
        return result;
      })();
      rounds.set(key, pending);
    }
    return pending;
  };
  return async (media: MediaItem, version: number, _runId: string, signal: AbortSignal) => (await round(version, signal, input.random ? media.id : undefined)).get(media.id)!;
}
