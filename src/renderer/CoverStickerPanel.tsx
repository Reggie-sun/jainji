import { useEffect, useState } from "react";
import type { MediaView } from "../main/media";
import { DEFAULT_COVER_STICKER, MAX_MANUAL_COVERS, manualCoverRegions, type CoverRegion, type CoverSticker, type CoverTrack } from "../shared/cover-sticker";
import type { DecorationCatalog } from "../shared/decorations";
import { CoverTrackEditor } from "./CoverTrackEditor";
import { Heading, Icon } from "./ui";
import "./cover-sticker.css";

const cloneTrack = (track: CoverTrack) => ({ ...track, keyframes: track.keyframes.map((frame) => ({ ...frame, rectangle: { ...frame.rectangle } })) });
const cloneRegion = (region: CoverRegion): CoverRegion => ({ ...region, rectangle: { ...region.rectangle }, tracks: region.tracks && Object.fromEntries(Object.entries(region.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])) });
const cloneCoverSticker = (value: CoverSticker | undefined): CoverSticker => ({ ...(value ?? DEFAULT_COVER_STICKER), stickerIds: [...(value?.stickerIds ?? DEFAULT_COVER_STICKER.stickerIds)], rectangle: { ...(value?.rectangle ?? DEFAULT_COVER_STICKER.rectangle) }, tracks: value?.tracks && Object.fromEntries(Object.entries(value.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])), regions: value?.regions?.map(cloneRegion), mediaRegions: value?.mediaRegions && Object.fromEntries(Object.entries(value.mediaRegions).map(([mediaId, regions]) => [mediaId, regions.map(cloneRegion)])) });
const newRegion = (rectangle = { x: 0.35, y: 0.4, width: 0.3, height: 0.2 }): CoverRegion => ({ id: crypto.randomUUID(), rectangle });
// Unified (rotating) cover regions preview as a plain white board; the actual sticker is picked per round at production time.
const UNIFIED_PLACEHOLDER: DecorationCatalog["stickers"][number] = { id: "unified-placeholder", label: "统一款占位白板", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", animated: false, source: "builtin" };
const cornerRectangles = [
  { x: 0, y: 0, width: 0.2, height: 0.15 }, { x: 0.8, y: 0, width: 0.2, height: 0.15 },
  { x: 0, y: 0.85, width: 0.2, height: 0.15 }, { x: 0.8, y: 0.85, width: 0.2, height: 0.15 },
];

export function CoverStickerPanel({ projectId, value, selectedMedia, revision, disabled, onSave, onDirtyChange }: {
  projectId: string;
  value?: CoverSticker;
  selectedMedia: readonly MediaView[];
  revision: number;
  disabled: boolean;
  onSave(value: CoverSticker): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
}) {
  const [draft, setDraft] = useState(() => cloneCoverSticker(value));
  const [stickers, setStickers] = useState<DecorationCatalog["stickers"]>();
  const [previewId, setPreviewId] = useState<string>();
  const [activeRegionId, setActiveRegionId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const savedSignature = JSON.stringify(value ?? DEFAULT_COVER_STICKER);

  useEffect(() => {
    setDraft(cloneCoverSticker(value)); setActiveRegionId(undefined);
  }, [projectId, savedSignature]);
  useEffect(() => { setError(""); setMessage(""); }, [projectId]);
  useEffect(() => { onDirtyChange?.(JSON.stringify(draft) !== savedSignature); }, [draft, onDirtyChange, savedSignature]);
  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((catalog) => {
      if (active) setStickers(catalog.stickers.filter((sticker) => sticker.source === "uploaded"));
    }).catch(() => { if (active) setError("上传贴纸读取失败，请重新打开此页面。"); });
    return () => { active = false; };
  }, [revision]);

  const preview = selectedMedia.find((media) => media.id === previewId) ?? selectedMedia[0];
  const trackingMode = draft.trackingMode ?? "manual";
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
    if (draft.enabled && trackingMode === "manual" && !stickers) { setError("上传贴纸仍在读取中，请稍后再保存。"); return; }
    if (draft.enabled && trackingMode === "manual" && missingSticker) { setError("有已分配的贴纸不在当前上传素材库中，请重新选择后保存。"); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setMessage("覆盖设置已应用；保存素材集后可跨重启复用。");
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
      <div className="cover-sticker-heading"><div><h2>{draft.enabled ? "覆盖已开启" : "覆盖已关闭"}</h2><p>{draft.enabled ? "调整覆盖框与跟随方式；统一款将从全部已上传贴纸中逐轮换用。新覆盖层铺白色不透明底板并等比保留完整图案，保存后应用到下次制作。旧导出任务保留原效果。" : "关闭时保留原贴纸，不添加覆盖层。全部交给 Agent 时仍会识别原贴纸占位，只补空缺角落和时段。"}</p></div><label className="cover-sticker-toggle"><input type="checkbox" checked={draft.enabled} disabled={disabled || saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用覆盖</label></div>
      {draft.enabled && <>
        <div className="cover-tracking-tabs" role="group" aria-label="覆盖贴纸跟随方式"><button type="button" aria-pressed={trackingMode === "agent"} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "agent" }))}>Agent 看图自动覆盖</button><button type="button" aria-pressed={trackingMode === "manual"} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "manual" }))}>手动设置</button><button type="button" aria-pressed={trackingMode === "assisted"} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "assisted" }))}>半自动 · 人工审阅</button></div>
        {trackingMode === "assisted" ? <p>半自动覆盖由你编辑完整边界与时段，查看各版本动态预览后再确认导出。</p> : trackingMode === "agent" ? <p className="cover-agent-status">Agent 将从全部本地内置贴纸和可用上传贴纸中看图选款，无需逐张勾选；覆盖可原样使用贴纸自带的文字、价格或品牌图案，普通四角装饰规则不变。同轮素材统一用一款，下一轮换款；一次制作多轮也会轮换。</p> : <>
          {!stickers ? <p className="cover-sticker-loading">正在读取上传贴纸…</p> : stickers.length === 0 ? <p className="cover-sticker-empty">还没有可用的上传贴纸。请先到“上传贴纸”添加 PNG 或 JPG 图片。</p> : <p className="cover-sticker-note">统一款候选池 = 全部已上传贴纸（当前 {stickers.length} 张），新上传的贴纸自动进入轮换池，无需勾选。</p>}
          {missingSticker && <p className="cover-sticker-warning" role="alert">有已分配的贴纸不在当前上传素材库中，请重新选择。<button type="button" disabled={disabled || saving} onClick={clearMissingStickers}>清除失效贴纸</button></p>}
          <p className="cover-sticker-note">统一候选款供未单独指定的覆盖框共用：同轮素材使用一款，下一轮从候选中换用，不足时循环；每个框也可指定独立起始款。</p>
        </>}
        <div className="cover-sticker-editor"><div className="cover-sticker-preview-wrap">
          {selectedMedia.length > 0 && <label className="cover-sticker-media-select">当前素材<select aria-label="选择覆盖素材" value={preview?.id ?? ""} disabled={disabled || saving} onChange={(event) => { setPreviewId(event.target.value); setActiveRegionId(undefined); }}>{selectedMedia.map((media) => <option value={media.id} key={media.id}>{media.displayName}</option>)}</select></label>}
          {trackingMode === "assisted" ? <p>保存覆盖设置后，在下方建立审阅草稿。可以先人工建框，也可显式请求视觉模型提供候选。</p> : trackingMode === "agent" ? <div className="cover-agent-mode">{preview ? <div className="cover-agent-preview" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}><video key={preview.id} src={preview.previewUrl} controls preload="metadata" /></div> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再开始自动识别。</div>}<p>开始制作后，视觉模型查看最多 12 张全片联系帧，提出近似覆盖位置和时段；独立主管检查真实样片，按遮盖效果和主体可见性判断，允许合理位置误差。必要时补帧或放大；快速闪现、遮挡仍可能漏检，无法确认时停止，不套用旧手动框。</p><p>已选 {selectedMedia.length} 条素材。定框最多纠正 3 次无效方案，补检与初始联系帧共用 40 帧预算；每版最多检查 5 轮样片、修订 2 次，实际调用次数取决于补检与修订。每轮另有 2 次创作选款调用。同源位置可复用，但每版仍检查新样片；同轮统一款式、下一轮换款，单款时复用。定框使用视觉连接，样片使用复核连接，选款使用创作连接，均需支持图片。</p></div> : preview ? <>
            <div className="cover-region-toolbar"><strong>覆盖框 {regions.length}/{MAX_MANUAL_COVERS}</strong><div><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length >= MAX_MANUAL_COVERS} onClick={addFrame}>添加覆盖框</button><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length + 4 > MAX_MANUAL_COVERS} onClick={addCorners}>添加四角</button><button type="button" className="button secondary compact" disabled={disabled || saving || !regions.some((region) => region.stickerId)} onClick={() => updateRegions((current) => current.map((region) => ({ ...region, stickerId: undefined })))}>统一使用候选款</button><button type="button" className="button secondary compact" disabled={disabled || saving || !activeRegion} onClick={deleteActive}>删除当前框</button></div></div>
            <button type="button" className="button secondary compact" disabled={disabled || saving || (hasMediaOverride && regions.length === 0)} onClick={() => { updateRegions(() => []); setActiveRegionId(undefined); }}>此素材不覆盖</button>
            {activeRegion && <div className="cover-region-picker"><label>当前覆盖框 <select aria-label="选择当前覆盖框" value={activeRegion.id} disabled={disabled || saving} onChange={(event) => setActiveRegionId(event.target.value)}>{regions.map((region, index) => <option key={region.id} value={region.id}>覆盖框 {index + 1}{region.stickerId ? "（独立贴纸）" : "（统一款）"}</option>)}</select></label><label>独立起始款 <select aria-label="为当前覆盖框选择贴纸" value={activeRegion.stickerId ?? ""} disabled={disabled || saving || !stickers?.length} onChange={(event) => setActiveSticker(event.target.value || undefined)}><option value="">统一候选款</option>{stickers?.map((sticker) => <option key={sticker.id} value={sticker.id}>{sticker.label}</option>)}</select></label></div>}
            <p className="cover-sticker-note">{hasMediaOverride ? "当前素材使用独立覆盖设置；这里的编辑只影响当前素材。" : "当前素材沿用通用覆盖设置；首次编辑会创建只属于当前素材的设置。"} 预览中会同时显示所有当前时间可见的覆盖框；点击其他框可切换编辑。独立款与统一候选一起逐轮轮换，继续制作会接着上次款式换用；预览仅作款式示意。透明区域会铺白色不透明底板，图案等比完整放入。</p>
            <CoverTrackEditor media={preview} regions={previewRegions} activeRegionId={activeRegion?.id ?? ""} enabled={draft.enabled} disabled={disabled || saving} onActiveRegionChange={setActiveRegionId} onStaticRectangleChange={(regionId, rectangle) => updateRegions((current) => current.map((region) => region.id === regionId ? { ...region, rectangle } : region))} onTrackChange={(regionId, track) => updateRegionTrack(regionId, preview.id, track)} />
          </> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再调整覆盖位置。</div>}
        </div></div>
      </>}
      {error && <p className="cover-sticker-warning" role="alert">{error}</p>}
      {message && <p className="cover-sticker-success" role="status">{message}</p>}
      <div className="cover-sticker-actions"><small>保存覆盖设置后会应用到当前项目；保存素材集后可跨重启复用。已开始的任务会保留各自冻结的设置。</small><div><button type="button" className="button secondary compact" disabled={disabled || saving} onClick={() => { setDraft(cloneCoverSticker(value)); setActiveRegionId(undefined); setError(""); setMessage(""); }}>恢复已应用设置</button><button type="button" className="button primary" disabled={disabled || saving} onClick={() => void save()}><Icon name="download" size={16} />{saving ? "正在保存…" : "保存覆盖设置"}</button></div></div>
    </section>
  </>;
}
