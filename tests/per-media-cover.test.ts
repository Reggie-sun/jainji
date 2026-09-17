import { describe, expect, it, vi } from "vitest";
import { CoverStickerSchema, manualCoverRegions, type CoverSticker } from "../src/shared/cover-sticker";
import { resolveCoverSticker, manualCoverLayers, previousCoverStickerId, unusedCoverStickerIds } from "../src/main/cover-sticker";
import * as limits from "../src/main/execution-limits";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { AgentRunner } from "../src/main/agent-runner";
import { knowledgeFixture } from "./helpers/knowledge-session";
import { DecorationSchema } from "../src/shared/decorations";
import { createDefaultTemplate, type MediaItem, type ExportBatch } from "../src/main/domain";

const a = `uploaded-${"a".repeat(64)}`, b = `uploaded-${"b".repeat(64)}`;
const asset = { assetPath: "/tmp/a.png", assetFingerprint: "a" };
const assets = { sparkle: asset, arrow: asset, heart: asset, burst: asset, [a]: asset, [b]: { assetPath: "/tmp/b.png", assetFingerprint: "b" } };
const rectangle = { x: 0, y: 0, width: 0.2, height: 0.1 };
const media: MediaItem[] = Array.from({ length: 3 }, (_, i) => ({ id: crypto.randomUUID(), sourcePath: `/tmp/source-${i}.mp4`, displayName: `source-${i}`, fingerprint: "fixture", sizeBytes: 1, durationMs: 1000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }));
const region = (x: number) => ({ id: crypto.randomUUID(), rectangle: { ...rectangle, x } });
const settings = (): CoverSticker => ({ enabled: true, trackingMode: "manual", stickerIds: [a,b], rectangle, regions: [region(0)], mediaRegions: { [media[0].id]: [region(0),region(0.4)], [media[1].id]: [region(0.6)], [media[2].id]: [] } });

describe("per-material manual coverage", () => {
  it("continues independently assigned artwork across separate productions using the owning material's history", () => {
    const options = settings();
    const sharedRegionId = crypto.randomUUID();
    options.mediaRegions![media[0].id] = [{ id: sharedRegionId, rectangle, stickerId: a }];
    options.mediaRegions![media[1].id] = [{ id: sharedRegionId, rectangle, stickerId: b }];
    const ids = media.slice(0, 2).map(source => source.id);
    const frozen = resolveCoverSticker(options, assets, [], ids)!;
    const history = media.slice(0, 2).map((source, index) => ({ createdAt: new Date(index * 1000).toISOString(), mediaIds: [source.id], templateSnapshot: { ...createDefaultTemplate(), layers: manualCoverLayers(frozen, source, source) } })) as ExportBatch[];
    const next = resolveCoverSticker(options, assets, history, ids)!;
    expect(manualCoverLayers(next, media[0], media[0])[0].cover?.stickerId).toBe(b);
    expect(manualCoverLayers(next, media[1], media[1])[0].cover?.stickerId).toBe(a);
  });
  it("freezes only the owning material's legacy track instead of duplicating all tracks", () => {
    const options = settings(); delete options.mediaRegions;
    options.regions![0].tracks = Object.fromEntries(media.map(source => [source.id, { startMs: 0, endMs: 900, keyframes: [{ timeMs: 0, rectangle }] }]));
    const frozen = resolveCoverSticker(options, assets, [], media.map(source => source.id))!;
    for (const source of media) expect(Object.keys(frozen.mediaRegions![source.id][0].tracks!)).toEqual([source.id]);
  });
  it("uses the last logical round even if an earlier round finishes planning later", async () => {
    const execution = vi.spyOn(limits, "executionLimits").mockReturnValue({ analysis: 2, exports: 1, threads: 2 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let plans = 0;
    const history: ExportBatch[] = [];
    const options = settings();
    const runner = new AgentRunner({ frames: async () => [], plan: async () => { if (++plans === 1) await gate; return { summary: "包装", captions: [], filter: "cool", intensity: 0.3 }; },
      enqueue: async (template) => { history.push({ createdAt: new Date(history.length * 1000).toISOString(), templateSnapshot: template } as ExportBatch); release(); return crypto.randomUUID(); },
      stickerAssets: assets, decorations: DecorationSchema.parse({ productPrice: "手动文字", sticker: "none" }), coverSticker: resolveCoverSticker(options, assets, [], [media[0].id]), onChange: () => {} });
    try {
      runner.start("project", "clean", "", [media[0]], 2); await runner.settled();
      expect(history.map(batch => batch.templateSnapshot.layers.find(layer => layer.type === "sticker")?.cover?.selection?.round)).toEqual([2,1]);
      expect(previousCoverStickerId(history)).toBe(b);
      const next = resolveCoverSticker(options, assets, history, [media[0].id])!;
      expect(manualCoverLayers(next, media[0], media[0])[0].cover?.stickerId).toBe(a);
    } finally { release(); execution.mockRestore(); }
  });
  it("starts a fresh automatic selection cycle after exhausting candidates without adjacent repeats", () => {
    const chosen: string[] = [];
    for (let round = 0; round < 9; round++) chosen.push(unusedCoverStickerIds(["a","b","c"], chosen, "c")[0]);
    for (let offset = 0; offset < 9; offset += 3) expect(new Set(chosen.slice(offset, offset + 3)).size).toBe(3);
    expect(chosen.every((id, i) => i === 0 || id !== chosen[i - 1])).toBe(true);
    expect(unusedCoverStickerIds(["a"], ["a"], "a")).toEqual(["a"]);
  });
  it("freezes independent counts and rectangles, including explicit no coverage, with a batch-wide shared style", () => {
    const options = settings(), ids = media.map(item=>item.id);
    const frozen = resolveCoverSticker(options, assets, [], ids)!;
    options.mediaRegions![ids[0]][0].rectangle.x = 0.3;
    expect(media.map(source=>manualCoverLayers(frozen, source, source).length)).toEqual([2,1,0]);
    expect(manualCoverLayers(frozen,media[0],media[0])[0].x).toBe(0);
    expect(manualCoverLayers(frozen,media[1],media[1])[0].x).toBe(0.6);
    const history = [{ createdAt: new Date().toISOString(), templateSnapshot: { ...createDefaultTemplate(), layers: manualCoverLayers(frozen,media[0],media[0]) } }] as ExportBatch[];
    const next = resolveCoverSticker(settings(), assets, history, ids)!;
    expect(media.flatMap(source=>manualCoverLayers(next,source,source)).every(layer=>layer.cover?.stickerId === b)).toBe(true);
  });
  it("uses legacy common settings only for materials without an override and ignores unused missing assets", () => {
    const options = settings();
    delete options.mediaRegions![media[1].id];
    expect(manualCoverRegions(options,media[1].id)).toEqual(options.regions);
    expect(manualCoverRegions(options,media[2].id)).toEqual([]);
    options.mediaRegions![media[0].id][0].stickerId = `uploaded-${"c".repeat(64)}`;
    expect(() => resolveCoverSticker(options, assets, [], [media[0].id])).toThrow("覆盖贴纸已删除");
    expect(() => resolveCoverSticker(options, assets, [], [media[1].id])).not.toThrow();
    expect(resolveCoverSticker(options, {}, [], [media[2].id])).toBeUndefined();
  });
  it("rejects bad media identity, cross-material tracks and overlong tracks; removes only the deleted material configuration", () => {
    const service = new ApplicationService(new FfmpegAdapter("unused","unused"), {resolve:async()=>null});
    service.currentProject.mediaItems.push(...media);
    const options = settings();
    expect(() => service.setCoverSticker({...options,mediaRegions:{[crypto.randomUUID()]:[]}})).toThrow("素材不存在");
    const first = options.mediaRegions![media[0].id][0];
    first.tracks = {[media[1].id]:{ startMs:0,endMs:900,keyframes:[{timeMs:0,rectangle}] }};
    expect(() => service.setCoverSticker(options)).toThrow("素材不存在");
    first.tracks = {[media[0].id]:{ startMs:0,endMs:1100,keyframes:[{timeMs:0,rectangle}] }};
    expect(() => service.setCoverSticker(options)).toThrow("时长");
    first.tracks[media[0].id].endMs=900;
    service.setCoverSticker(options);service.removeMedia(media[0].id);
    expect(service.currentProject.coverSticker?.mediaRegions).toEqual({[media[1].id]:options.mediaRegions![media[1].id],[media[2].id]:[]});
    expect(CoverStickerSchema.safeParse({...options,mediaRegions:{[media[1].id]:Array(65).fill(region(0))}}).success).toBe(false);
  });
  it("exports each selected source's own layout on every version, without triggering recognition", async () => {
    const queued: {sourceId:string;count:number;stickers:string[]}[]=[];
    const detectCoverTracks=vi.fn();
    const runner=new AgentRunner({frames:async()=>[],plan:async()=>({summary:"包装",captions:[],filter:"cool",intensity:0.3}), enqueue:async(template, source)=>{queued.push({sourceId:source.id,count:template.layers.filter(l=>l.type==="sticker"&&l.cover).length,stickers:template.layers.flatMap(l=>l.type==="sticker"&&l.cover?[l.cover.stickerId]:[])});return crypto.randomUUID();},stickerAssets:assets,decorations:DecorationSchema.parse({productPrice:"手动文字",sticker:"none"}),coverSticker:resolveCoverSticker(settings(),assets,[],media.map(s=>s.id)),detectCoverTracks,onChange:()=>{}});
    runner.start("project","clean","",media,2);await runner.settled();
    expect(queued, JSON.stringify(runner.snapshot())).toHaveLength(6);
    for(const [index,source] of media.entries()) expect(queued.filter(item=>item.sourceId===source.id).map(item=>item.count)).toEqual([[2,2],[1,1],[0,0]][index]);
    for(const source of media.slice(0,2)) expect(queued.filter(item=>item.sourceId===source.id).map(item=>[...new Set(item.stickers)])).toEqual([[a],[b]]);
    expect(detectCoverTracks).not.toHaveBeenCalled();
  });
  it("shares one automatic choice per round across materials while recognizing each material only once", async () => {
    const selections: string[][] = [];
    const selectCoverSticker = vi.fn(async (_frames: string[], _signal: AbortSignal, previous: readonly string[]) => {
      selections.push([...previous]);
      const stickerId = previous.length % 2 ? b : a;
      return { stickerId, ...assets[stickerId], rectangle, automatic: true };
    });
    const detectCoverTracks = vi.fn(async () => [{ targetId: "original", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle }] } }]);
    const output: { id: string; sticker: string }[] = [];
    const runner = new AgentRunner({ frames: async () => [], plan: async () => ({ summary: "包装", captions: [], filter: "cool", intensity: 0.3 }),
      enqueue: async (template, source) => { const cover = template.layers.find(layer => layer.type === "sticker" && layer.cover); if (cover?.type === "sticker") output.push({ id: source.id, sticker: cover.cover!.stickerId }); return crypto.randomUUID(); },
      stickerAssets: assets, decorations: DecorationSchema.parse({ productPrice: "手动文字", sticker: "none" }), selectCoverSticker, knowledge: knowledgeFixture(detectCoverTracks), onChange: () => {} });
    runner.start("project", "clean", "", media.slice(0, 2), 3); await runner.settled();
    expect(selections).toEqual([[], [a], [a,b]]);
    expect(selectCoverSticker).toHaveBeenCalledTimes(3);
    expect(detectCoverTracks).toHaveBeenCalledTimes(2);
    for (const source of media.slice(0, 2)) expect(output.filter(item => item.id === source.id).map(item => item.sticker)).toEqual([a,b,a]);
  });
});
