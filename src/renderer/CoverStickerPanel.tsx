import { useEffect, useState } from "react";
import type { MediaView } from "../main/media";
import { DEFAULT_COVER_STICKER, type CoverSticker, type CoverTrack } from "../shared/cover-sticker";
import type { DecorationCatalog } from "../shared/decorations";
import { CoverTrackEditor } from "./CoverTrackEditor";
import { Heading, Icon } from "./ui";
import "./cover-sticker.css";

const cloneCoverSticker = (value: CoverSticker | undefined): CoverSticker => ({ ...(value ?? DEFAULT_COVER_STICKER), stickerIds: [...(value?.stickerIds ?? DEFAULT_COVER_STICKER.stickerIds)], rectangle: { ...(value?.rectangle ?? DEFAULT_COVER_STICKER.rectangle) }, tracks: value?.tracks && Object.fromEntries(Object.entries(value.tracks).map(([mediaId, track]) => [mediaId, { ...track, keyframes: track.keyframes.map((frame) => ({ ...frame, rectangle: { ...frame.rectangle } })) }])) });

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const savedSignature = JSON.stringify(value ?? DEFAULT_COVER_STICKER);

  useEffect(() => {
    setDraft(cloneCoverSticker(value));
  }, [projectId, savedSignature]);

  useEffect(() => {
    setError(""); setMessage("");
  }, [projectId]);

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(draft) !== savedSignature);
  }, [draft, onDirtyChange, savedSignature]);

  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((catalog) => {
      if (active) setStickers(catalog.stickers.filter((sticker) => sticker.source === "uploaded"));
    }).catch(() => { if (active) setError("上传贴纸读取失败，请重新打开此页面。"); });
    return () => { active = false; };
  }, [revision]);

  const preview = selectedMedia.find((media) => media.id === previewId) ?? selectedMedia[0];
  const previewCandidates = draft.stickerIds.flatMap((id) => stickers?.find((sticker) => sticker.id === id) ?? []);
  const previewSticker = previewCandidates.find((sticker) => sticker.id === previewStickerId) ?? previewCandidates[0];
  const missingSticker = stickers !== undefined && draft.stickerIds.some((id) => !stickers.some((sticker) => sticker.id === id));
  const updateTrack = (mediaId: string, track?: CoverTrack) => setDraft((current) => {
    const tracks = { ...current.tracks };
    if (track) tracks[mediaId] = track; else delete tracks[mediaId];
    return { ...current, tracks: Object.keys(tracks).length ? tracks : undefined };
  });
  const toggleSticker = (id: string) => setDraft((current) => ({ ...current, stickerIds: current.stickerIds.includes(id) ? current.stickerIds.filter((entry) => entry !== id) : [...current.stickerIds, id] }));
  const save = async () => {
    setError(""); setMessage("");
    if (!stickers) { setError("上传贴纸仍在读取中，请稍后再保存。"); return; }
    if (draft.enabled && !draft.stickerIds.length) { setError("启用覆盖贴纸前，请至少选择一张自己上传的贴纸。"); return; }
    if (draft.enabled && missingSticker) { setError("已选贴纸已不在上传素材库中，请重新选择后保存。"); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setMessage("覆盖设置已应用；保存素材集后可跨重启复用。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "覆盖设置保存失败，请重试。");
    } finally { setSaving(false); }
  };

  return <>
    <Heading eyebrow="COVER STICKER" title="覆盖原贴纸">选择自己的贴纸固定覆盖，或为每条素材设置移动轨迹。当前批次统一使用一张候选，下一批换款；轨迹随素材集复用。</Heading>
    <section className="card cover-sticker-panel" aria-label="固定覆盖贴纸设置">
      <div className="cover-sticker-heading"><div><h2>覆盖设置</h2><p>固定框可自由调整宽高；轨迹在关键帧之间平滑移动、等比缩放。图片裁切填满框，透明区域仍可看到原视频。</p></div><label className="cover-sticker-toggle"><input type="checkbox" checked={draft.enabled} disabled={disabled || saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用覆盖</label></div>
      {!stickers ? <p className="cover-sticker-loading">正在读取上传贴纸…</p> : stickers.length === 0 ? <p className="cover-sticker-empty">还没有可用的上传贴纸。请先到“上传贴纸”添加 PNG 或 JPG 图片。</p> : <div className="cover-sticker-choices" role="group" aria-label="选择覆盖贴纸候选">{stickers.map((sticker) => <label className={draft.stickerIds.includes(sticker.id) ? "cover-sticker-choice selected" : "cover-sticker-choice"} key={sticker.id}><input type="checkbox" checked={draft.stickerIds.includes(sticker.id)} disabled={disabled || saving} onChange={() => toggleSticker(sticker.id)} /><img src={sticker.url} alt="" /><span>{sticker.label}</span></label>)}</div>}
      {draft.enabled && draft.stickerIds.length === 0 && <p className="cover-sticker-warning" role="alert">请至少选择一张上传贴纸。</p>}
      {missingSticker && <p className="cover-sticker-warning" role="alert">有已选贴纸不在当前上传素材库中，请重新选择。<button type="button" disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, stickerIds: current.stickerIds.filter((id) => stickers?.some((sticker) => sticker.id === id)) }))}>清除失效候选</button></p>}
      <p className="cover-sticker-note">{draft.stickerIds.length < 2 ? "只选一张时不会轮换；添加两张或更多候选后，下一批会换用其他候选。" : `已选 ${draft.stickerIds.length} 张候选：同一批的全部选中素材使用同一张，下一批从候选中换用。`}</p>
      <div className="cover-sticker-editor"><div className="cover-sticker-preview-wrap">
        {previewCandidates.length > 0 && <label className="cover-sticker-media-select">候选示意<select aria-label="预览覆盖候选" value={previewSticker?.id ?? ""} disabled={disabled || saving} onChange={(event) => setPreviewStickerId(event.target.value)}>{previewCandidates.map((sticker) => <option value={sticker.id} key={sticker.id}>{sticker.label}</option>)}</select></label>}
        {previewCandidates.length > 1 && <p className="cover-sticker-note">这里可逐款检查覆盖效果，不代表下一批选款；制作时按候选顺序轮换。请确认每款的透明区域与裁切都能盖住原贴纸。</p>}
        {selectedMedia.length > 1 && <label className="cover-sticker-media-select">预览素材<select value={preview?.id ?? ""} disabled={disabled || saving} onChange={(event) => setPreviewId(event.target.value)}>{selectedMedia.map((media) => <option value={media.id} key={media.id}>{media.displayName}</option>)}</select></label>}
        {preview ? <CoverTrackEditor key={preview.id} media={preview} sticker={previewSticker} enabled={draft.enabled} staticRectangle={draft.rectangle} track={draft.tracks?.[preview.id]} disabled={disabled || saving} onStaticRectangleChange={(rectangle) => setDraft((current) => ({ ...current, rectangle }))} onTrackChange={(track) => updateTrack(preview.id, track)} /> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再调整覆盖位置。</div>}
      </div></div>
      {error && <p className="cover-sticker-warning" role="alert">{error}</p>}
      {message && <p className="cover-sticker-success" role="status">{message}</p>}
      <div className="cover-sticker-actions"><small>保存覆盖设置后会应用到当前项目；保存素材集后可跨重启复用。已开始的任务会保留各自冻结的设置。</small><div><button type="button" className="button secondary compact" disabled={disabled || saving} onClick={() => { setDraft(cloneCoverSticker(value)); setError(""); setMessage(""); }}>恢复已应用设置</button><button type="button" className="button primary" disabled={disabled || saving} onClick={() => void save()}><Icon name="download" size={16} />{saving ? "正在保存…" : "保存覆盖设置"}</button></div></div>
    </section>
  </>;
}
