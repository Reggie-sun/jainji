import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import { isCoverPoolStickerId, isHumanRegionStickerId } from "../shared/cover-sticker.js";
import { HumanRegionBindingSchema } from "../shared/human-region-cover.js";
import type { MediaItem, ExportPreset, StickerLayer } from "./domain.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { measureShapeCoverOutput } from "./shape-cover-alpha.js";
import { searchHybridCornerShape, hybridMaskBounds, type HybridArtworkCache } from "./shape-cover-hybrid-shape.js";
import { freezeShapeCoverRaster, publishShapeCoverPng } from "./shape-cover-freeze.js";
import { humanRegionArtworkScope, humanRegionBitmap, opaqueRegionCovered, projectHumanRectangle } from "./human-region-geometry.js";
import { reviewDigest } from "./cover-review-approval.js";
import { shapeCoverDigest } from "./shape-cover-render.js";
import { ProviderError } from "./agent-provider.js";

export type HumanRegionIntent = Pick<CoverReviewDraft, "id" | "projectId" | "revision" | "assistedArtwork"> & {
  admission?: "manual-production-v1";
  media: Pick<CoverReviewDraft["media"][number], "mediaId" | "sourceFingerprint" | "disposition" | "identities" | "segments">[];
};
type MatchedArtwork = { excess: number; clipped: number; publish: () => Promise<StickerLayer> };

/** Bounded geometry shared by normal production and the existing review lifecycle. */
export function createHumanRegionCover(input: { draft: HumanRegionIntent; media: MediaItem[]; preset: ExportPreset;
  assets: StickerAssets; tools: FfmpegAdapter; directory: string; random: boolean }) {
  const draft = structuredClone(input.draft);
  const independent = input.random || draft.admission === "manual-production-v1";
  const artworkCache: HybridArtworkCache = new Map();
  const eligibleSticker = draft.admission === "manual-production-v1" ? isHumanRegionStickerId : isCoverPoolStickerId;
  const candidates = draft.media.every(item => item.disposition === "no_cover") ? []
    : Object.keys(input.assets).filter(id => eligibleSticker(id) && input.assets[id]).sort();
  if (candidates.length > 256) throw Error("人工覆盖本地候选超过 256 款，请缩小贴纸库后重试。");
  const rounds = new Map<string, Promise<Map<string, StickerLayer[]>>>();
  const progress = new Map<string, (stage: string) => void>();
  const used = new Map<string, string[]>();
  const cache = new Map<string, MatchedArtwork | null>();
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
  const match = async (target: Awaited<ReturnType<typeof targets>>[number], id: string, signal: AbortSignal): Promise<MatchedArtwork | null> => {
    const key = `${target.media.id}:${target.segment.id}:${id}`;
    if (cache.has(key)) return cache.get(key)!;
    const budgetKey = independent ? target.media.id : "round";
    const attempts = (trials.get(budgetKey) ?? 0) + 1;
    trials.set(budgetKey, attempts);
    const maximum = draft.admission === "manual-production-v1"
      ? Math.max(512, candidates.length * draft.media.find(item => item.mediaId === target.media.id)!.segments.length) : 512;
    if (attempts > maximum) throw new ProviderError(`人工覆盖匹配已达到${independent ? "此素材" : "本批"} ${maximum} 次候选预算；请调整覆盖框或贴纸库。`);
    const tools = { ...input.tools, signal }, bitmap = humanRegionBitmap(target.target, target.projection);
    const selected = await searchHybridCornerShape([{ id, asset: input.assets[id]! }], bitmap, target.projection,
      draft.admission === "manual-production-v1" ? humanRegionArtworkScope(target.target)
        : { x: -target.projection.width, y: -target.projection.height, width: target.projection.width * 3, height: target.projection.height * 3 },
      Math.min(target.projection.scaledWidth / target.source.width, target.projection.scaledHeight / target.source.height), tools,
      draft.admission === "manual-production-v1" ? "compact-artwork" : "artwork", artworkCache);
    if (!selected) { cache.set(key, null); return null; }
    if (!opaqueRegionCovered(selected.raster.alpha, target.projection, target.target)) throw Error("人工覆盖不透明像素校验失败。");
    const frozen = await freezeShapeCoverRaster(selected.raster, bitmap, target.projection, 0, tools);
    const body = { kind: "human-region-v1" as const, projectId: draft.projectId, draftId: draft.id, revision: draft.revision,
      ...(draft.admission ? { admission: draft.admission } : {}),
      mediaId: target.media.id, segmentId: target.segment.id, identityId: target.segment.identityId, source: target.source,
      settings: { resolutionMode: input.preset.resolutionMode, frameRateMode: input.preset.frameRateMode, quality: input.preset.quality }, container: input.preset.container,
      rectangle: target.segment.track.keyframes[0].rectangle, target: target.target, projection: target.projection,
      placement: selected.placement, visualBounds: hybridMaskBounds(frozen.finalAlpha, target.projection),
      range: { startMs: target.segment.track.startMs, endMs: target.segment.track.endMs },
      artwork: { id, ...input.assets[id]! }, pngSha256: shapeCoverDigest(frozen.png), rgbaSha256: shapeCoverDigest(frozen.decoded) };
    const binding = HumanRegionBindingSchema.parse({ ...body, bindingDigest: reviewDigest(body) });
    const png = frozen.png, area = target.target.width * target.target.height;
    const excess = selected.raster.alpha.reduce((n, alpha) => n + Number(alpha > 0), 0) / area - 1;
    const p = selected.placement;
    const visibleWidth = Math.min(target.projection.width, p.x + p.width) - Math.max(0, p.x);
    const visibleHeight = Math.min(target.projection.height, p.y + p.height) - Math.max(0, p.y);
    const clipped = draft.admission === "manual-production-v1" ? 1 - visibleWidth * visibleHeight / (p.width * p.height) : 0;
    let published: StickerLayer | undefined;
    const matched: MatchedArtwork = { excess, clipped, publish: async () => published ??= {
      id: randomUUID(), type: "sticker", visible: true, x: 0, y: 0, width: 1, opacity: 1, rotationDeg: 0, zIndex: 90,
      assetPath: await publishShapeCoverPng(input.directory, png), assetFingerprint: `sha256:${binding.pngSha256}`,
      cover: { stickerId: id, height: 1, regionId: target.segment.id, humanRegion: binding } } };
    cache.set(key, matched); return matched;
  };
  const noFit = () => new ProviderError(draft.admission === "manual-production-v1"
    ? "没有贴纸能在当前可用范围内用自身不透明图案完整覆盖全部目标框。请调整框、时段或添加更合适的贴纸；不会拉伸贴纸或添加白底。"
    : "没有贴纸能用自身不透明图案完整覆盖全部目标框。请调整框、时段或添加更合适的贴纸；不会添加白底。");
  const round = (version: number, signal: AbortSignal, mediaId?: string, runId = ""): Promise<Map<string, StickerLayer[]>> => {
    const scope = mediaId ?? "round", key = `${scope}:${version}`;
    let pending = rounds.get(key);
    if (!pending) {
      let timeout: AbortSignal | undefined;
      pending = (async () => {
        if (version > 1) await round(version - 1, signal, mediaId, runId);
        timeout = AbortSignal.timeout(600_000);
        const bounded = AbortSignal.any([signal, timeout]), started = Date.now();
        let lastProgress = 0;
        const report = (stage: string, force = false) => {
          if (force || Date.now() - lastProgress >= 300) {
            lastProgress = Date.now(); progress.get(key)?.(`${stage} · 已用时 ${Math.floor((Date.now() - started) / 1000)} 秒`);
          }
        };
        report("正在核对源文件与人工覆盖框", true);
        if (!prepared.has(scope)) prepared.set(scope, targets(bounded, mediaId));
        const all = await prepared.get(scope)!, result = new Map(input.media.map(m => [m.id, [] as StickerLayer[]]));
        const groups = new Map<string, typeof all>();
        for (const target of all) {
          const key = independent ? `${target.media.id}:${target.segment.identityId}` : "round";
          groups.set(key, [...groups.get(key) ?? [], target]);
        }
        const assigned = new Map<string, Set<string>>(), entries = [...groups];
        const selections: { key: string; id: string; group: typeof all; matches: MatchedArtwork[] }[] = [];
        let assignments = 0;
        const solve = async (index: number): Promise<boolean> => {
          if (index === entries.length) return true;
          bounded.throwIfAborted();
          const [key, group] = entries[index], previous = used.get(key) ?? [];
          const perMedia = assigned.get(group[0].media.id) ?? new Set<string>();
          assigned.set(group[0].media.id, perMedia);
          const eligible = candidates.filter(id => !input.random || !perMedia.has(id));
          // A stable random order per run/target prevents the first IDs from
          // winning on every source while preserving backtracking and version rotation.
          const ranks = new Map(input.random ? eligible.map(id => [id, createHash("sha256").update(`${runId}:${key}:${id}`).digest("hex")]) : []);
          if (input.random) eligible.sort((a, b) => ranks.get(a)!.localeCompare(ranks.get(b)!));
          const tiers = [eligible.filter(id => !previous.includes(id)), eligible.filter(id => previous.includes(id) && id !== previous.at(-1)), eligible.filter(id => id === previous.at(-1))];
          let hasMatch = false;
          // New manual production tries the first safe fit immediately. Later conflicts
          // can still backtrack; historical assisted selection keeps its comparison window.
          const windowSize = draft.admission === "manual-production-v1" ? 1 : 8;
          for (const tier of tiers) for (let start = 0; start < tier.length; start += windowSize) {
            const options: { id: string; matches: MatchedArtwork[]; excess: number; clipped: number }[] = [];
            for (const id of tier.slice(start, start + windowSize)) {
              if (++assignments > 4096) throw new ProviderError("人工覆盖选材组合达到本轮预算，请减少目标或调整贴纸库。");
              bounded.throwIfAborted();
              report(`正在匹配覆盖框 ${index + 1}/${entries.length} · 贴纸 ${candidates.indexOf(id) + 1}/${candidates.length}`);
              const matches: MatchedArtwork[] = [];
              for (const target of group) { const matched = await match(target, id, bounded); if (!matched) break; matches.push(matched); }
              if (matches.length === group.length) options.push({ id, matches, excess: matches.reduce((sum, matched) => sum + matched.excess, 0),
                clipped: matches.reduce((sum, matched) => sum + matched.clipped, 0) });
            }
            options.sort((a, b) => a.clipped - b.clipped || a.excess - b.excess
              || (input.random ? ranks.get(a.id)!.localeCompare(ranks.get(b.id)!) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            hasMatch ||= options.length > 0;
            for (const { id, matches } of options) {
              perMedia.add(id); selections.push({ key, id, group, matches });
              if (await solve(index + 1)) return true;
              selections.pop(); perMedia.delete(id);
              // Creator/manual choices are independent; another earlier choice cannot repair a later no-fit target.
              if (!input.random) return false;
            }
          }
          // An impossible target cannot be repaired by permuting earlier assignments.
          // Check excluded artwork too: it may fit after an earlier choice is reassigned.
          if (input.random && !hasMatch) {
            let excludedFits = false;
            for (const id of perMedia) {
              if (++assignments > 4096) throw new ProviderError("人工覆盖选材组合达到本轮预算，请减少目标或调整贴纸库。");
              bounded.throwIfAborted();
              let fits = true;
              for (const target of group) if (!await match(target, id, bounded)) { fits = false; break; }
              if (fits) { excludedFits = true; break; }
            }
            if (!excludedFits) throw noFit();
          }
          return false;
        };
        if (!await solve(0)) throw noFit();
        bounded.throwIfAborted();
        report("正在冻结已匹配贴纸并验证覆盖像素", true);
        for (const { key, id, group, matches } of selections) {
          used.set(key, [...used.get(key) ?? [], id]);
          const layers = await Promise.all(matches.map(matched => matched.publish()));
          layers.forEach((layer, index) => result.get(group[index].media.id)!.push(structuredClone(layer)));
        }
        return result;
      })().catch(error => {
        if (!signal.aborted && timeout?.aborted) throw new ProviderError("人工覆盖匹配超过本素材本版 10 分钟上限，已停止本版；请调整覆盖框或贴纸库后重新制作。");
        if (!signal.aborted && error instanceof Error && error.message === "HYBRID_SEARCH_LIMIT") throw new ProviderError("人工覆盖贴纸尺寸匹配达到搜索上限，已停止本版；请调整覆盖框或贴纸库。");
        throw error;
      });
      rounds.set(key, pending);
    }
    return pending;
  };
  return async (media: MediaItem, version: number, runId: string, signal: AbortSignal, onStage?: (stage: string) => void) => {
    const scope = independent ? media.id : "round", key = `${scope}:${version}`;
    if (onStage) progress.set(key, onStage);
    onStage?.(version > 1 ? "等待本素材上一版本完成覆盖匹配…" : "正在准备人工框真实贴纸覆盖…");
    try { return (await round(version, signal, independent ? media.id : undefined, runId)).get(media.id)!; }
    finally { progress.delete(key); }
  };
}
