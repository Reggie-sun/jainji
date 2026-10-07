import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MediaView } from "../main/media";
import { DEFAULT_COVER_STICKER, MAX_MANUAL_COVERS, manualCoverRegions, type CoverRegion, type CoverSticker, type CoverTrack } from "../shared/cover-sticker";
import type { CoverReviewDraft } from "../shared/cover-review";
import { manualSettingsFromReview, manualReviewInput } from "../shared/manual-cover-review";
import type { DecorationCatalog } from "../shared/decorations";
import { CoverTrackEditor } from "./CoverTrackEditor";
import { MediaSelector } from "./MediaSelector";
import { Heading, Icon } from "./ui";
import "./cover-sticker.css";

const cloneTrack = (track: CoverTrack) => ({ ...track, keyframes: track.keyframes.map((frame) => ({ ...frame, rectangle: { ...frame.rectangle } })) });
const cloneRegion = (region: CoverRegion): CoverRegion => ({ ...region, rectangle: { ...region.rectangle }, tracks: region.tracks && Object.fromEntries(Object.entries(region.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])) });
const cloneCoverSticker = (value: CoverSticker | undefined): CoverSticker => ({ ...(value ?? DEFAULT_COVER_STICKER), stickerIds: [...(value?.stickerIds ?? DEFAULT_COVER_STICKER.stickerIds)], rectangle: { ...(value?.rectangle ?? DEFAULT_COVER_STICKER.rectangle) }, tracks: value?.tracks && Object.fromEntries(Object.entries(value.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])), regions: value?.regions?.map(cloneRegion), mediaRegions: value?.mediaRegions && Object.fromEntries(Object.entries(value.mediaRegions).map(([mediaId, regions]) => [mediaId, regions.map(cloneRegion)])) });
const newRegion = (rectangle = { x: 0.35, y: 0.4, width: 0.3, height: 0.2 }): CoverRegion => ({ id: crypto.randomUUID(), rectangle });
// Unified (rotating) cover regions preview as a plain white board; the actual sticker is picked per round at production time.
// The frame renders as CSS white (CoverTrackEditor skips the <img> for this id), so this url is only a fallback.
const UNIFIED_PLACEHOLDER: DecorationCatalog["stickers"][number] = { id: "unified-placeholder", label: "统一款占位白板", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", animated: false, source: "builtin" };
const cornerRectangles = [
  { x: 0, y: 0, width: 0.2, height: 0.15 }, { x: 0.8, y: 0, width: 0.2, height: 0.15 },
  { x: 0, y: 0.85, width: 0.2, height: 0.15 }, { x: 0.8, y: 0.85, width: 0.2, height: 0.15 },
];
const HUMAN_REGION_ARTWORK = "human-region-v1" as const;

export function CoverStickerPanel({ projectId, value, selectedMedia, revision, disabled, onSave, onDirtyChange, reviewPanel, reviewDrafts = [] }: {
  projectId: string;
  value?: CoverSticker;
  selectedMedia: readonly MediaView[];
  revision: number;
  disabled: boolean;
  onSave(value: CoverSticker): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
  reviewPanel?: ReactNode;
  reviewDrafts?: CoverReviewDraft[];
}) {
  const [draft, setDraft] = useState(() => manualSettingsFromReview(cloneCoverSticker(value), reviewDrafts));
  const [stickers, setStickers] = useState<DecorationCatalog["stickers"]>();
  const [previewId, setPreviewId] = useState<string>();
  const [activeRegionId, setActiveRegionId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const savedSignature = JSON.stringify(value ?? DEFAULT_COVER_STICKER);
  const settingsDirty = JSON.stringify(draft) !== savedSignature;
  const reviewEntry = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(manualSettingsFromReview(cloneCoverSticker(value), reviewDrafts)); setActiveRegionId(undefined);
  }, [projectId, savedSignature]);
  useEffect(() => { setError(""); setMessage(""); }, [projectId]);
  useEffect(() => { onDirtyChange?.(JSON.stringify(draft) !== savedSignature); }, [draft, onDirtyChange, savedSignature]);
  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((catalog) => {
      if (active) setStickers(catalog.stickers.filter((sticker) => sticker.source === "downloaded" || sticker.source === "uploaded"));
    }).catch(() => { if (active) setError("贴纸读取失败，请重新打开此页面。"); });
    return () => { active = false; };
  }, [revision]);

  const preview = selectedMedia.find((media) => media.id === previewId) ?? selectedMedia[0];
  const trackingMode = draft.trackingMode ?? "manual";
  const humanRegionMode = trackingMode === "assisted" && draft.assistedArtwork === HUMAN_REGION_ARTWORK;
  const manualMode = trackingMode === "manual" || humanRegionMode;
  const regions = preview ? manualCoverRegions(draft, preview.id) : manualCoverRegions(draft);
  const activeRegion = regions.find((region) => region.id === activeRegionId) ?? regions[0];
  const effectiveRegions = selectedMedia.flatMap((media) => manualCoverRegions(draft, media.id));
  const assignedStickerIds = effectiveRegions.flatMap((region) => region.stickerId ? [region.stickerId] : []);
  const missingSticker = stickers !== undefined && assignedStickerIds.some((id) => !stickers.some((sticker) => sticker.id === id));
  const updateRegions = (update: (current: CoverRegion[]) => CoverRegion[], mediaId = preview?.id) => {
    if (!mediaId) return;
    setDraft((current) => {
      const copied = manualCoverRegions(current, mediaId).map((region) => {
        const track = region.tracks?.[mediaId];
        return { ...region, rectangle: { ...region.rectangle }, tracks: track ? { [mediaId]: cloneTrack(track) } : undefined };
      });
      return { ...current, mediaRegions: { ...current.mediaRegions, [mediaId]: update(copied) } };
    });
  };
  const updateRegionTrack = (regionId: string, mediaId: string, track?: CoverTrack) => updateRegions((current) => current.map((region) => {
    if (region.id !== regionId) return region;
    const tracks = { ...region.tracks };
    if (track) tracks[mediaId] = track; else delete tracks[mediaId];
    return { ...region, tracks: Object.keys(tracks).length ? tracks : undefined };
  }), mediaId);
  const addFrame = () => {
    if (!preview) return;
    const region = newRegion();
    updateRegions((current) => current.length >= MAX_MANUAL_COVERS ? current : [...current, region]);
    setActiveRegionId(region.id);
  };
  const addCorners = () => {
    if (!preview || regions.length + cornerRectangles.length > MAX_MANUAL_COVERS) return;
    const additions = cornerRectangles.map((rectangle) => newRegion(rectangle));
    updateRegions((current) => [...current, ...additions]);
    setActiveRegionId(additions[0].id);
  };
  const deleteActive = () => {
    if (!activeRegion || !preview) return;
    const index = regions.findIndex((region) => region.id === activeRegion.id);
    const next = regions[index + 1] ?? regions[index - 1];
    updateRegions((current) => current.filter((region) => region.id !== activeRegion.id));
    setActiveRegionId(next?.id);
  };
  const setActiveSticker = (stickerId?: string) => {
    if (!activeRegion || !preview) return;
    updateRegions((current) => current.map((region) => region.id === activeRegion.id ? { ...region, ...(stickerId ? { stickerId } : { stickerId: undefined }) } : region));
  };
  const save = async () => {
    setError(""); setMessage("");
    if (draft.enabled && trackingMode === "manual" && !manualCoverRegions(draft).length && !Object.values(draft.mediaRegions ?? {}).some((list) => list.length)) { setError("请至少添加一个覆盖框，或关闭覆盖。"); return; }
    if (draft.enabled && trackingMode === "manual" && !stickers) { setError("贴纸仍在读取中，请稍后再保存。"); return; }
    if (draft.enabled && trackingMode === "manual" && missingSticker) { setError("有已分配的贴纸不在当前贴纸库中，请重新选择后保存。"); return; }
    if (draft.enabled && humanRegionMode) {
      try { manualReviewInput(draft, selectedMedia.map(media => ({ mediaId: media.id, durationMs: media.durationMs }))); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "请检查覆盖框。"); return; }
    }
    setSaving(true);
    try {
      await onSave(draft);
      setMessage("覆盖设置已应用；保存素材集后可跨重启复用。");
      if (draft.enabled && trackingMode === "assisted") requestAnimationFrame(() => requestAnimationFrame(() => reviewEntry.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "覆盖设置保存失败，请重试。");
    } finally { setSaving(false); }
  };

  const previewRegions = regions.map((region) => ({ ...region, track: region.tracks?.[preview?.id ?? ""], sticker: region.stickerId ? stickers?.find((sticker) => sticker.id === region.stickerId) : UNIFIED_PLACEHOLDER }));
  const hasMediaOverride = Boolean(preview && draft.mediaRegions && Object.prototype.hasOwnProperty.call(draft.mediaRegions, preview.id));
  const clearMissingStickers = () => setDraft((current) => {
    const keep = (region: CoverRegion) => !region.stickerId || stickers?.some((sticker) => sticker.id === region.stickerId) ? region : { ...region, stickerId: undefined };
    return { ...current, regions: current.regions?.map(keep), mediaRegions: current.mediaRegions && Object.fromEntries(Object.entries(current.mediaRegions).map(([mediaId, mediaRegions]) => [mediaId, mediaRegions.map(keep)])) };
  });
  return <>
    <Heading title="覆盖原贴纸">独立选择是否覆盖原视频中的贴纸，不随“全部交给 Agent”自动开启。</Heading>
    <section className="card cover-sticker-panel" aria-label="覆盖原贴纸设置">
      <div className="cover-sticker-heading"><div><h2>{draft.enabled ? "覆盖已开启" : "覆盖已关闭"}</h2><p>{draft.enabled ? humanRegionMode ? "你指定需要盖住的区域，本地贴纸库负责提供完整图案；目标框和贴纸实际占用范围会分开显示。保存后应用到下次制作，已开始的任务保留原效果。" : trackingMode === "agent" && draft.coverStrategy ? "按已检查的图案与位置处理确认的角落，其他角落保持原样。保存后应用到下次制作，已开始的任务保留原效果。" : "调整覆盖框与跟随方式；统一款将从本地贴纸库与已上传贴纸中逐轮换用。新覆盖层铺白色不透明底板并等比保留完整图案，保存后应用到下次制作。旧导出任务保留原效果。" : "关闭时保留原贴纸，不添加覆盖层。全部交给 Agent 时仍会识别原贴纸占位，只补空缺角落和时段。"}</p></div><label className="cover-sticker-toggle"><input type="checkbox" checked={draft.enabled} disabled={disabled || saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用覆盖</label></div>
      {draft.enabled && <>
        <div className="cover-tracking-tabs" role="group" aria-label="覆盖贴纸跟随方式"><button type="button" aria-pressed={trackingMode === "agent" && Boolean(draft.coverStrategy)} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "agent", coverStrategy: "shape-matched-static-v1", assistedArtwork: undefined, manualRegionInput: undefined }))}>自动形状匹配覆盖</button><button type="button" aria-pressed={trackingMode === "agent" && !draft.coverStrategy} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "agent", coverStrategy: undefined, assistedArtwork: undefined, manualRegionInput: undefined }))}>近似矩形覆盖</button><button type="button" aria-pressed={manualMode} disabled={disabled || saving} onClick={() => { if (!manualMode) setDraft((current) => ({ ...current, trackingMode: "manual", coverStrategy: undefined, assistedArtwork: undefined, manualRegionInput: undefined })); }}>手动设置</button><button type="button" aria-pressed={trackingMode === "assisted" && !humanRegionMode} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "assisted", coverStrategy: undefined, assistedArtwork: undefined, manualRegionInput: undefined }))}>半自动 · 人工审阅</button></div>
        {manualMode && <div className="cover-tracking-tabs" role="group" aria-label="手动覆盖方式"><button type="button" aria-pressed={!humanRegionMode} disabled={disabled || saving} onClick={() => setDraft(current => ({ ...current, trackingMode: "manual", assistedArtwork: undefined, manualRegionInput: undefined }))}>白底贴纸覆盖</button><button type="button" aria-pressed={humanRegionMode} disabled={disabled || saving} onClick={() => setDraft(current => ({ ...current, trackingMode: "assisted", assistedArtwork: HUMAN_REGION_ARTWORK, manualRegionInput: true, coverStrategy: undefined }))}>真实贴纸覆盖</button></div>}
        {trackingMode === "assisted" ? humanRegionMode ? <p>你先按素材框出必须完整盖住的区域（包含旧贴纸阴影），并设置出现时段；本地程序按原比例放入真实贴纸。覆盖框表示你的目标范围，不代表自动识别到的原贴纸轮廓，也不能证明框外没有其他旧贴纸。</p> : <p>半自动覆盖由你编辑完整边界与时段，查看各版本动态预览后再确认导出。</p> : trackingMode === "agent" && draft.coverStrategy ? <p className="cover-agent-status">仅处理四角内已确认的静态贴纸；样片检查通过后，按同一冻结图案与位置导出。未确认或跳过的角落保持原样，不能代表所有旧贴纸均已处理。保留原色和你填写的展示文字，不额外添加普通四角贴纸。</p> : trackingMode === "agent" ? <p className="cover-agent-status">Agent 将从全部本地内置贴纸和可用上传贴纸中看图选款，无需逐张勾选；覆盖可原样使用贴纸自带的文字、价格或品牌图案，普通四角装饰规则不变。同轮素材统一用一款，下一轮换款；一次制作多轮也会轮换。</p> : <>
          {!stickers ? <p className="cover-sticker-loading">正在读取贴纸…</p> : stickers.length === 0 ? <p className="cover-sticker-empty">还没有可用的贴纸。请重新安装完整软件包，或到“贴纸库”上传 PNG / JPG 图片。</p> : <p className="cover-sticker-note">统一款候选池 = 本地贴纸库 + 全部已上传贴纸（当前 {stickers.length} 张），新上传的贴纸自动进入轮换池，无需勾选。</p>}
          {missingSticker && <p className="cover-sticker-warning" role="alert">有已分配的贴纸不在当前贴纸库中，请重新选择。<button type="button" disabled={disabled || saving} onClick={clearMissingStickers}>清除失效贴纸</button></p>}
          <p className="cover-sticker-note">统一候选款供未单独指定的覆盖框共用：同轮素材使用一款，下一轮从候选中换用，不足时循环；每个框也可指定独立起始款。</p>
        </>}
        <div className="cover-sticker-editor"><div className="cover-sticker-preview-wrap">
          {(trackingMode !== "assisted" || humanRegionMode) && <div className="cover-sticker-media-select"><span>当前素材</span><MediaSelector label="覆盖素材" media={selectedMedia} value={preview?.id} disabled={disabled || saving} onChange={id => { setPreviewId(id); setActiveRegionId(undefined); }} />{regions.length > 0 ? <span className="cover-sticker-media-status" aria-label={`${preview?.displayName ?? "当前素材"}已配置覆盖框`}>已设置目标框</span> : null}</div>}
          {trackingMode === "assisted" && !humanRegionMode ? <p>保存覆盖设置后，在下方建立审阅草稿。可以先人工建框，也可显式请求视觉模型提供候选。</p> : trackingMode === "agent" && draft.coverStrategy ? <div className="cover-agent-mode"><p>已选 {selectedMedia.length} 条素材。先确认角落语义，再由本地算法检查静态运动、轮廓和完全不透明覆盖；冻结样片通过独立检查后进入原导出队列。导出和重试使用同一 PNG 与位置；源片或冻结资产变化会停止。每条结果列出实际处理的角落，移动、无法确认或没有安全形状的角落保持原样。</p></div> : trackingMode === "agent" ? <div className="cover-agent-mode">{preview ? <div className="cover-agent-preview" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}><video key={preview.id} src={preview.previewUrl} controls preload="metadata" /></div> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再开始自动识别。</div>}<p>开始制作后，视觉模型查看最多 12 张全片联系帧，提出近似覆盖位置和时段；独立主管检查真实样片，按遮盖效果和主体可见性判断，允许合理位置误差。必要时补帧或放大；快速闪现、遮挡仍可能漏检，无法确认时停止，不套用旧手动框。</p><p>已选 {selectedMedia.length} 条素材。定框最多纠正 3 次无效方案，补检与初始联系帧共用 40 帧预算；每版最多检查 5 轮样片、修订 2 次，实际调用次数取决于补检与修订。每轮另有 2 次创作选款调用。同源位置可复用，但每版仍检查新样片；同轮统一款式、下一轮换款，单款时复用。定框使用视觉连接，样片使用复核连接，选款使用创作连接，均需支持图片。</p></div> : preview ? <>
            <div className="cover-region-toolbar"><strong>覆盖框 {regions.length}/{MAX_MANUAL_COVERS}</strong><div><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length >= MAX_MANUAL_COVERS} onClick={addFrame}>添加覆盖框</button><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length + 4 > MAX_MANUAL_COVERS} onClick={addCorners}>添加四角</button>{!humanRegionMode && <button type="button" className="button secondary compact" disabled={disabled || saving || !regions.some((region) => region.stickerId)} onClick={() => updateRegions((current) => current.map((region) => ({ ...region, stickerId: undefined })))}>统一使用候选款</button>}<button type="button" className="button secondary compact" disabled={disabled || saving || !activeRegion} onClick={deleteActive}>删除当前框</button></div></div>
            <button type="button" className="button secondary compact" disabled={disabled || saving || (humanRegionMode ? regions.length === 0 : hasMediaOverride && regions.length === 0)} onClick={() => { updateRegions(() => []); setActiveRegionId(undefined); }}>{humanRegionMode ? "清空此素材覆盖框" : "此素材不覆盖"}</button>
            {humanRegionMode && <p>只覆盖已添加的框；没有框的素材正常制作，无需确认“不覆盖”。</p>}
            {activeRegion && <div className="cover-region-picker"><label>当前覆盖框 <select aria-label="选择当前覆盖框" value={activeRegion.id} disabled={disabled || saving} onChange={(event) => setActiveRegionId(event.target.value)}>{regions.map((region, index) => <option key={region.id} value={region.id}>覆盖框 {index + 1}{humanRegionMode ? "（目标区域）" : region.stickerId ? "（独立贴纸）" : "（统一款）"}</option>)}</select></label>{!humanRegionMode && <label>独立起始款 <select aria-label="为当前覆盖框选择贴纸" value={activeRegion.stickerId ?? ""} disabled={disabled || saving || !stickers?.length} onChange={(event) => setActiveSticker(event.target.value || undefined)}><option value="">统一候选款</option>{stickers?.map((sticker) => <option key={sticker.id} value={sticker.id}>{sticker.label}</option>)}</select></label>}</div>}
            <p className="cover-sticker-note">{hasMediaOverride ? "当前素材使用独立覆盖设置；这里的编辑只影响当前素材。" : "当前素材沿用通用覆盖设置；首次编辑会创建只属于当前素材的设置。"} 预览中会同时显示所有当前时间可见的覆盖框；点击其他框可切换编辑。{humanRegionMode ? "这里显示待覆盖区域；保存后点击开始制作，程序匹配真实贴纸并直接导出。图案可能大于目标框，不添加白底；请播放成片检查效果。" : "独立款与统一候选一起逐轮轮换，继续制作会接着上次款式换用；预览仅作款式示意。透明区域会铺白色不透明底板，图案等比完整放入。"}</p>
            <CoverTrackEditor targetOnly={humanRegionMode} media={preview} regions={previewRegions} activeRegionId={activeRegion?.id ?? ""} enabled={draft.enabled} disabled={disabled || saving} onActiveRegionChange={setActiveRegionId} onStaticRectangleChange={(regionId, rectangle) => updateRegions((current) => current.map((region) => region.id === regionId ? { ...region, rectangle } : region))} onTrackChange={(regionId, track) => updateRegionTrack(regionId, preview.id, track)} />
          </> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再调整覆盖位置。</div>}
        </div></div>
      </>}
      {error && <p className="cover-sticker-warning" role="alert">{error}</p>}
      {message && <p className="cover-sticker-success" role="status">{message}</p>}
      <div className="cover-sticker-actions"><small>保存覆盖设置后会应用到当前项目；保存素材集后可跨重启复用。已开始的任务会保留各自冻结的设置。</small><div><button type="button" className="button secondary compact" disabled={disabled || saving} onClick={() => { setDraft(manualSettingsFromReview(cloneCoverSticker(value), reviewDrafts)); setActiveRegionId(undefined); setError(""); setMessage(""); }}>恢复已应用设置</button><button type="button" className="button primary" disabled={disabled || saving} onClick={() => void save()}><Icon name="download" size={16} />{saving ? "正在保存…" : "保存覆盖设置"}</button></div></div>
      {draft.enabled && trackingMode === "assisted" && !humanRegionMode && <div className="cover-review-entry" ref={reviewEntry}>{settingsDirty ? <p role="status">请先保存上面的覆盖框和时段，再生成预览；已有审阅记录会保留。</p> : reviewPanel}</div>}
    </section>
  </>;
}
