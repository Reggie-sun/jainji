import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MediaView } from "../main/media";
import { DEFAULT_COVER_STICKER, type CoverRectangle, type CoverSticker } from "../shared/cover-sticker";
import type { DecorationCatalog } from "../shared/decorations";
import { Heading, Icon } from "./ui";
import "./cover-sticker.css";

const minimumSize = 0.01;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
const cloneCoverSticker = (value: CoverSticker | undefined): CoverSticker => ({ ...(value ?? DEFAULT_COVER_STICKER), stickerIds: [...(value?.stickerIds ?? DEFAULT_COVER_STICKER.stickerIds)], rectangle: { ...(value?.rectangle ?? DEFAULT_COVER_STICKER.rectangle) } });

type Interaction = { kind: "drag" | "resize"; x: number; y: number; rectangle: CoverRectangle };

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
  const stage = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>();
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
  const setRectangle = (next: CoverRectangle) => setDraft((current) => ({ ...current, rectangle: next }));
  const updateRectangle = (field: keyof CoverRectangle, percent: number) => {
    if (!Number.isFinite(percent)) return;
    const value = clamp(percent / 100, 0, 1);
    const rectangle = draft.rectangle;
    if (field === "x") setRectangle({ ...rectangle, x: clamp(value, 0, 1 - rectangle.width) });
    else if (field === "y") setRectangle({ ...rectangle, y: clamp(value, 0, 1 - rectangle.height) });
    else if (field === "width") setRectangle({ ...rectangle, width: clamp(value, minimumSize, 1 - rectangle.x) });
    else setRectangle({ ...rectangle, height: clamp(value, minimumSize, 1 - rectangle.y) });
  };
  const startInteraction = (event: PointerEvent<HTMLDivElement>, kind: Interaction["kind"]) => {
    if (disabled || saving || !draft.enabled) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { kind, x: event.clientX, y: event.clientY, rectangle: { ...draft.rectangle } };
  };
  const moveInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || saving) return;
    const current = interaction.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (!current || !bounds) return;
    const deltaX = (event.clientX - current.x) / bounds.width;
    const deltaY = (event.clientY - current.y) / bounds.height;
    if (current.kind === "drag") setRectangle({ ...current.rectangle, x: clamp(current.rectangle.x + deltaX, 0, 1 - current.rectangle.width), y: clamp(current.rectangle.y + deltaY, 0, 1 - current.rectangle.height) });
    else setRectangle({ ...current.rectangle, width: clamp(current.rectangle.width + deltaX, minimumSize, 1 - current.rectangle.x), height: clamp(current.rectangle.height + deltaY, minimumSize, 1 - current.rectangle.y) });
  };
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
    <Heading eyebrow="FIXED COVER STICKER" title="固定覆盖贴纸">选一张或多张自己上传的贴纸，固定覆盖在选中素材的同一位置。当前批次统一使用一张候选；下一批可从候选中换一张。</Heading>
    <section className="card cover-sticker-panel" aria-label="固定覆盖贴纸设置">
      <div className="cover-sticker-heading"><div><h2>覆盖设置</h2><p>贴纸可放在画面任意位置并自由调整宽高；图片会裁切填满覆盖框，透明区域仍可看到原视频。</p></div><label className="cover-sticker-toggle"><input type="checkbox" checked={draft.enabled} disabled={disabled || saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用固定覆盖</label></div>
      {!stickers ? <p className="cover-sticker-loading">正在读取上传贴纸…</p> : stickers.length === 0 ? <p className="cover-sticker-empty">还没有可用的上传贴纸。请先到“上传贴纸”添加 PNG 或 JPG 图片。</p> : <div className="cover-sticker-choices" role="group" aria-label="选择覆盖贴纸候选">{stickers.map((sticker) => <label className={draft.stickerIds.includes(sticker.id) ? "cover-sticker-choice selected" : "cover-sticker-choice"} key={sticker.id}><input type="checkbox" checked={draft.stickerIds.includes(sticker.id)} disabled={disabled || saving} onChange={() => toggleSticker(sticker.id)} /><img src={sticker.url} alt="" /><span>{sticker.label}</span></label>)}</div>}
      {draft.enabled && draft.stickerIds.length === 0 && <p className="cover-sticker-warning" role="alert">请至少选择一张上传贴纸。</p>}
      {missingSticker && <p className="cover-sticker-warning" role="alert">有已选贴纸不在当前上传素材库中，请重新选择。<button type="button" disabled={disabled || saving} onClick={() => setDraft((current) => ({ ...current, stickerIds: current.stickerIds.filter((id) => stickers?.some((sticker) => sticker.id === id)) }))}>清除失效候选</button></p>}
      <p className="cover-sticker-note">{draft.stickerIds.length < 2 ? "只选一张时不会轮换；添加两张或更多候选后，下一批会换用其他候选。" : `已选 ${draft.stickerIds.length} 张候选：同一批的全部选中素材使用同一张，下一批从候选中换用。`}</p>
      <div className="cover-sticker-editor">
        <div className="cover-sticker-preview-wrap">
          {previewCandidates.length > 0 && <label className="cover-sticker-media-select">候选示意<select aria-label="预览覆盖候选" value={previewSticker?.id ?? ""} disabled={disabled || saving} onChange={(event) => setPreviewStickerId(event.target.value)}>{previewCandidates.map((sticker) => <option value={sticker.id} key={sticker.id}>{sticker.label}</option>)}</select></label>}
          {previewCandidates.length > 1 && <p className="cover-sticker-note">这里可逐款检查覆盖效果，不代表下一批选款；制作时按候选顺序轮换。请确认每款的透明区域与裁切都能盖住原贴纸。</p>}
          {selectedMedia.length > 1 && <label className="cover-sticker-media-select">预览素材<select value={preview?.id ?? ""} disabled={disabled} onChange={(event) => setPreviewId(event.target.value)}>{selectedMedia.map((media) => <option value={media.id} key={media.id}>{media.displayName}</option>)}</select></label>}
          {preview ? <div className="cover-sticker-preview" ref={stage} style={{ aspectRatio: `${preview.width} / ${preview.height}` }} onPointerMove={moveInteraction} onPointerUp={() => { interaction.current = undefined; }} onPointerCancel={() => { interaction.current = undefined; }}><video src={preview.previewUrl} controls preload="metadata" />{draft.enabled && previewSticker && <div className="cover-sticker-frame" style={{ left: `${draft.rectangle.x * 100}%`, top: `${draft.rectangle.y * 100}%`, width: `${draft.rectangle.width * 100}%`, height: `${draft.rectangle.height * 100}%` }} onPointerDown={(event) => startInteraction(event, "drag")} aria-label="拖动覆盖贴纸"><img src={previewSticker.url} alt="覆盖贴纸预览" /><div className="cover-sticker-handle" aria-label="调整覆盖贴纸尺寸" onPointerDown={(event) => startInteraction(event, "resize")} /></div>}</div> : <div className="cover-sticker-preview-empty">先在素材工作台勾选至少一条可用素材，再调整覆盖位置。</div>}
          <small>可用视频自带播放与进度控制查看不同画面；拖动贴纸移动，拖右下角手柄调整尺寸。</small>
        </div>
        <div className="cover-sticker-controls"><h3>覆盖位置与尺寸</h3><p>以下数值按画面宽高的百分比保存，所有当前选中素材共用同一个框。</p><div className="cover-sticker-numbers">{(["x", "y", "width", "height"] as const).map((field) => <label key={field}>{({ x: "左边", y: "上边", width: "宽度", height: "高度" } as const)[field]}<span><input type="number" min={field === "width" || field === "height" ? 1 : 0} max={100} step={1} value={Math.round(draft.rectangle[field] * 100)} disabled={disabled || saving || !draft.enabled} onChange={(event) => updateRectangle(field, event.target.valueAsNumber)} />%</span></label>)}</div><p className="cover-sticker-coverage">当前框：左 {Math.round(draft.rectangle.x * 100)}% · 上 {Math.round(draft.rectangle.y * 100)}% · 宽 {Math.round(draft.rectangle.width * 100)}% · 高 {Math.round(draft.rectangle.height * 100)}%</p></div>
      </div>
      {error && <p className="cover-sticker-warning" role="alert">{error}</p>}
      {message && <p className="cover-sticker-success" role="status">{message}</p>}
      <div className="cover-sticker-actions"><small>保存覆盖设置后会应用到当前项目；保存素材集后可跨重启复用。已开始的任务会保留各自冻结的设置。</small><div><button type="button" className="button secondary compact" disabled={disabled || saving} onClick={() => { setDraft(cloneCoverSticker(value)); setError(""); setMessage(""); }}>恢复已应用设置</button><button type="button" className="button primary" disabled={disabled || saving} onClick={() => void save()}><Icon name="download" size={16} />{saving ? "正在保存…" : "保存覆盖设置"}</button></div></div>
    </section>
  </>;
}
