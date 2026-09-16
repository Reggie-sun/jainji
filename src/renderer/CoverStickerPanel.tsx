import { useEffect, useState } from "react";
import type { MediaView } from "../main/media";
import { DEFAULT_COVER_STICKER, MAX_MANUAL_COVERS, manualCoverRegions, type CoverRegion, type CoverSticker, type CoverTrack } from "../shared/cover-sticker";
import type { DecorationCatalog } from "../shared/decorations";
import { CoverTrackEditor } from "./CoverTrackEditor";
import { Heading, Icon } from "./ui";
import "./cover-sticker.css";

const cloneTrack = (track: CoverTrack) => ({ ...track, keyframes: track.keyframes.map((frame) => ({ ...frame, rectangle: { ...frame.rectangle } })) });
const cloneRegion = (region: CoverRegion): CoverRegion => ({ ...region, rectangle: { ...region.rectangle }, tracks: region.tracks && Object.fromEntries(Object.entries(region.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])) });
const cloneCoverSticker = (value: CoverSticker | undefined): CoverSticker => ({ ...(value ?? DEFAULT_COVER_STICKER), stickerIds: [...(value?.stickerIds ?? DEFAULT_COVER_STICKER.stickerIds)], rectangle: { ...(value?.rectangle ?? DEFAULT_COVER_STICKER.rectangle) }, tracks: value?.tracks && Object.fromEntries(Object.entries(value.tracks).map(([mediaId, track]) => [mediaId, cloneTrack(track)])), regions: value?.regions?.map(cloneRegion) });
const newRegion = (rectangle = { x: 0.35, y: 0.4, width: 0.3, height: 0.2 }): CoverRegion => ({ id: crypto.randomUUID(), rectangle });
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
  const [previewStickerId, setPreviewStickerId] = useState<string>();
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
  const regions = manualCoverRegions(draft);
  const activeRegion = regions.find((region) => region.id === activeRegionId) ?? regions[0];
  const sharedCandidates = draft.stickerIds.flatMap((id) => stickers?.find((sticker) => sticker.id === id) ?? []);
  const sharedSticker = sharedCandidates.find((sticker) => sticker.id === previewStickerId) ?? sharedCandidates[0];
  const assignedStickerIds = draft.regions?.flatMap((region) => region.stickerId ? [region.stickerId] : []) ?? [];
  const needsSharedSticker = !draft.regions || draft.regions.some((region) => !region.stickerId);
  const missingSticker = stickers !== undefined && [...(needsSharedSticker ? draft.stickerIds : []), ...assignedStickerIds].some((id) => !stickers.some((sticker) => sticker.id === id));
  const estimatedRequests = selectedMedia.reduce((total, media) => total + Math.max(1, Math.ceil((Math.max(1, Math.ceil(media.durationMs / 250)) - 1) / 7)), 0);
  const updateRegions = (update: (current: CoverRegion[]) => CoverRegion[]) => setDraft((current) => ({ ...current, regions: update(manualCoverRegions(current).map(cloneRegion)) }));
  const updateRegionTrack = (regionId: string, mediaId: string, track?: CoverTrack) => updateRegions((current) => current.map((region) => {
    if (region.id !== regionId) return region;
    const tracks = { ...region.tracks };
    if (track) tracks[mediaId] = track; else delete tracks[mediaId];
    return { ...region, tracks: Object.keys(tracks).length ? tracks : undefined };
  }));
  const toggleSticker = (id: string) => setDraft((current) => {
    const currentIds = current.stickerIds;
    return { ...current, stickerIds: currentIds.includes(id) ? currentIds.filter((entry) => entry !== id) : [...currentIds, id] };
  });
  const addFrame = () => {
    const region = newRegion();
    updateRegions((current) => current.length >= MAX_MANUAL_COVERS ? current : [...current, region]);
    setActiveRegionId(region.id);
  };
  const addCorners = () => {
    if (regions.length + cornerRectangles.length > MAX_MANUAL_COVERS) return;
    const additions = cornerRectangles.map((rectangle) => newRegion(rectangle));
    updateRegions((current) => [...current, ...additions]);
    setActiveRegionId(additions[0].id);
  };
  const deleteActive = () => {
    if (!activeRegion) return;
    const index = regions.findIndex((region) => region.id === activeRegion.id);
    const next = regions[index + 1] ?? regions[index - 1];
    updateRegions((current) => current.filter((region) => region.id !== activeRegion.id));
    setActiveRegionId(next?.id);
  };
  const setActiveSticker = (stickerId?: string) => {
    if (!activeRegion) return;
    updateRegions((current) => current.map((region) => region.id === activeRegion.id ? { ...region, ...(stickerId ? { stickerId } : { stickerId: undefined }) } : region));
  };
  const save = async () => {
    setError(""); setMessage("");
    if (draft.enabled && trackingMode !== "agent" && !stickers) { setError("上传贴纸仍在读取中，请稍后再保存。"); return; }
    if (draft.enabled && trackingMode !== "agent" && draft.regions?.length === 0) { setError("请至少添加一个覆盖框。"); return; }
    if (draft.enabled && trackingMode !== "agent" && needsSharedSticker && !draft.stickerIds.length) { setError("仍有覆盖框使用统一款，请至少选择一张自己的贴纸，或为每个覆盖框单独选择贴纸。"); return; }
    if (draft.enabled && trackingMode !== "agent" && missingSticker) { setError("有已选或已分配贴纸不在当前上传素材库中，请重新选择后保存。"); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setMessage("覆盖设置已应用；保存素材集后可跨重启复用。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "覆盖设置保存失败，请重试。");
    } finally { setSaving(false); }
  };

  const previewRegions = regions.map((region) => ({ ...region, track: region.tracks?.[preview?.id ?? ""], sticker: region.stickerId ? stickers?.find((sticker) => sticker.id === region.stickerId) : sharedSticker }));
  return <>
    <Heading eyebrow="COVER STICKER" title="覆盖原贴纸">独立选择是否覆盖原视频中的贴纸，不随“全部交给 Agent”自动开启。</Heading>
    <section className="card cover-sticker-panel" aria-label="覆盖原贴纸设置">
      <div className="cover-sticker-heading"><div><h2>{draft.enabled ? "覆盖已开启" : "覆盖已关闭"}</h2><p>{draft.enabled ? "选择覆盖贴纸与跟随方式；新覆盖层铺白色不透明底板并等比保留完整图案，保存后应用到下次制作。旧导出任务保留原效果。" : "关闭时保留原画面，不进行原贴纸识别，也不添加覆盖层。"}</p></div><label className="cover-sticker-toggle"><input type="checkbox" checked={draft.enabled} disabled={disabled || saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用覆盖</label></div>
      {draft.enabled && <>
        <div className="cover-tracking-tabs" role="group" aria-label="覆盖贴纸跟随方式"><button type="button" aria-pressed={trackingMode === "agent"} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "agent" }))}>Agent 自动识别全部原贴纸</button><button type="button" aria-pressed={trackingMode === "manual"} disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, trackingMode: "manual" }))}>手动设置</button></div>
        {trackingMode === "agent" ? <p className="cover-agent-status">Agent 将从全部可自动选用的内置贴纸和上传贴纸中看图选款，无需逐张勾选。同批统一使用一款，下批换款。</p> : <>
          {!stickers ? <p className="cover-sticker-loading">正在读取上传贴纸…</p> : stickers.length === 0 ? <p className="cover-sticker-empty">还没有可用的上传贴纸。请先到“上传贴纸”添加 PNG 或 JPG 图片。</p> : <div className="cover-sticker-choices" role="group" aria-label="选择统一覆盖贴纸候选">{stickers.map((sticker) => <label className={draft.stickerIds.includes(sticker.id) ? "cover-sticker-choice selected" : "cover-sticker-choice"} key={sticker.id}><input type="checkbox" checked={draft.stickerIds.includes(sticker.id)} disabled={disabled || saving} onChange={() => toggleSticker(sticker.id)} /><img src={sticker.url} alt="" /><span>{sticker.label}</span></label>)}</div>}
          {needsSharedSticker && draft.stickerIds.length === 0 && <p className="cover-sticker-warning" role="alert">仍有覆盖框使用统一款，请至少选择一张上传贴纸，或为每个框指定贴纸。</p>}
          {missingSticker && <p className="cover-sticker-warning" role="alert">有已选或已分配贴纸不在当前上传素材库中，请重新选择。<button type="button" disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, stickerIds: current.stickerIds.filter((id) => stickers?.some((sticker) => sticker.id === id)), regions: current.regions?.map((region) => stickers?.some((sticker) => sticker.id === region.stickerId) ? region : { ...region, stickerId: undefined }) }))}>清除失效贴纸</button></p>}
          <p className="cover-sticker-note">统一候选款供未单独指定的覆盖框共用：同一批使用一款，下批从候选中换用。每个框也可改用自己的贴纸。</p>
        </>}
        <div className="cover-sticker-editor"><div className="cover-sticker-preview-wrap">
          {trackingMode === "manual" && sharedCandidates.length > 0 && <label className="cover-sticker-media-select">统一款预览<select aria-label="预览统一覆盖贴纸" value={sharedSticker?.id ?? ""} disabled={disabled || saving} onChange={(event) => setPreviewStickerId(event.target.value)}>{sharedCandidates.map((sticker) => <option value={sticker.id} key={sticker.id}>{sticker.label}</option>)}</select></label>}
          {selectedMedia.length > 1 && <label className="cover-sticker-media-select">预览素材<select value={preview?.id ?? ""} disabled={disabled || saving} onChange={(event) => setPreviewId(event.target.value)}>{selectedMedia.map((media) => <option value={media.id} key={media.id}>{media.displayName}</option>)}</select></label>}
          {trackingMode === "agent" ? <div className="cover-agent-mode">{preview ? <div className="cover-agent-preview" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}><video key={preview.id} src={preview.previewUrl} controls preload="metadata" /></div> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再开始自动识别。</div>}<p>开始制作后，当前模型会逐段识别这条素材中的全部原贴纸，并自动生成多目标跟随轨迹；每秒检测 4 帧，再插值跟随。快速闪现或被遮挡的贴纸可能漏检，不确定或识别失败时不会套用手动框。</p><p>预计额外请求约 <strong>{estimatedRequests + 2}</strong> 次（含本批选款）（按已选 {selectedMedia.length} 条素材估算）。同一素材的多个版本只识别一次；Agent 为本批统一选定一款覆盖贴纸，下一批换款；可用款式仅一款时复用。此流程会增加模型调用，需要当前连接支持图片识别。</p></div> : preview ? <>
            <div className="cover-region-toolbar"><strong>覆盖框 {regions.length}/{MAX_MANUAL_COVERS}</strong><div><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length >= MAX_MANUAL_COVERS} onClick={addFrame}>添加覆盖框</button><button type="button" className="button secondary compact" disabled={disabled || saving || regions.length + 4 > MAX_MANUAL_COVERS} onClick={addCorners}>添加四角</button><button type="button" className="button secondary compact" disabled={disabled || saving || !regions.some((region) => region.stickerId)} onClick={() => updateRegions((current) => current.map((region) => ({ ...region, stickerId: undefined })))}>统一使用候选款</button><button type="button" className="button secondary compact" disabled={disabled || saving || !activeRegion} onClick={deleteActive}>删除当前框</button></div></div>
            {activeRegion && <div className="cover-region-picker"><label>当前覆盖框 <select aria-label="选择当前覆盖框" value={activeRegion.id} disabled={disabled || saving} onChange={(event) => setActiveRegionId(event.target.value)}>{regions.map((region, index) => <option key={region.id} value={region.id}>覆盖框 {index + 1}{region.stickerId ? "（独立贴纸）" : "（统一款）"}</option>)}</select></label><label>贴纸 <select aria-label="为当前覆盖框选择贴纸" value={activeRegion.stickerId ?? ""} disabled={disabled || saving || !stickers?.length} onChange={(event) => setActiveSticker(event.target.value || undefined)}><option value="">统一候选款</option>{stickers?.map((sticker) => <option key={sticker.id} value={sticker.id}>{sticker.label}</option>)}</select></label></div>}
            <p className="cover-sticker-note">预览中会同时显示所有当前时间可见的覆盖框；点击其他框可切换编辑。透明区域会铺白色不透明底板，图案等比完整放入。</p>
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
