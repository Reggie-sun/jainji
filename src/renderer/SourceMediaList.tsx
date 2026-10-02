import { useEffect, useRef, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { Icon, duration, sizeLabel } from "./ui";

type Media = DesktopState["project"]["mediaItems"][number];

function SourcePreviewDialog({ media, index, count, disabled, onMove, onRemove, onClose }: {
  media: Media; index: number; count: number; disabled: boolean;
  onMove(direction: number): void; onRemove(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setFailed(false); }, [media.id]);
  return <dialog ref={dialog} className="source-preview-dialog card" aria-label="素材预览" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="card-header"><h2>{media.displayName}</h2><button type="button" className="icon-button" aria-label="关闭素材预览" autoFocus onClick={onClose}><Icon name="close" size={18} /></button></div>
    <video key={media.id} src={media.previewUrl} controls autoPlay preload="metadata" aria-label={`播放 ${media.displayName}`} onError={() => setFailed(true)} />
    {failed && <p role="alert">无法播放此视频，请检查原文件是否存在及其编码格式。</p>}
    <div className="source-preview-actions"><button type="button" className="button secondary compact" disabled={disabled || index === 0} onClick={() => onMove(-1)}>上一条</button><span>{index + 1} / {count}</span><button type="button" className="button secondary compact" disabled={disabled || index === count - 1} onClick={() => onMove(1)}>下一条</button><button type="button" className="text-button" disabled={disabled} onClick={onRemove}>移出清单</button></div>
    <p className="source-media-help">移出清单后点击“保存素材清单”；磁盘上的原视频会保留。</p>
  </dialog>;
}

export function SourceMediaList({ items, selected, previewId, disabled, saveDisabled, onSelected, onPreview, onRemove, onSave }: {
  items: Media[]; selected: string[]; previewId?: string; disabled: boolean; saveDisabled: boolean;
  onSelected(ids: string[]): void; onPreview(id: string): void;
  onRemove(id: string): Promise<boolean>; onSave(): void;
}) {
  const [openId, setOpenId] = useState<string>();
  const ready = items.filter(item => item.probeStatus === "ready");
  const activeIndex = ready.findIndex(item => item.id === openId);
  const active = ready[activeIndex];
  const open = (id: string) => { onPreview(id); setOpenId(id); };
  const remove = async (id: string) => {
    const index = ready.findIndex(item => item.id === id);
    const next = ready[index + 1] ?? ready[index - 1];
    if (await onRemove(id) && openId === id) {
      setOpenId(current => current === id ? next?.id : current);
      if (next) onPreview(next.id);
    }
  };
  return <div className="card media-list">
    <div className="card-header"><h2>素材清单 <span>{items.length}</span></h2><div className="source-media-toolbar"><button type="button" className="text-button" disabled={disabled || !ready.length} onClick={() => onSelected(selected.length === ready.length ? [] : ready.map(item => item.id))}>{selected.length === ready.length && ready.length ? "取消全选" : "选择全部"}</button><button type="button" className="button secondary compact" disabled={saveDisabled} onClick={onSave}>保存素材清单</button></div></div>
    {items.length === 0 ? <div className="empty-material"><Icon name="film" size={26} /><p>你的素材即将在这里就位</p><small>导入后自动检查格式、时长与画面尺寸</small></div> : items.map(item => <div className={"media-row" + (previewId === item.id ? " previewing" : "")} key={item.id}>
      <input type="checkbox" aria-label={"选择 " + item.displayName} checked={selected.includes(item.id)} disabled={disabled || item.probeStatus !== "ready"} onChange={() => onSelected(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id])} />
      <button type="button" className="media-thumb" aria-label={"打开预览 " + item.displayName} disabled={item.probeStatus !== "ready"} onClick={() => open(item.id)}><Icon name="play" /></button>
      <div className="media-info"><strong>{item.displayName}</strong><small>{item.probeStatus === "ready" ? item.width + " × " + item.height + " · " + duration(item.durationMs) + " · " + sizeLabel(item.sizeBytes) : item.errorMessage || "素材不可读取"}</small></div>
      <span className={item.probeStatus === "ready" ? "status-tag completed" : "status-tag failed"}>{item.probeStatus === "ready" ? "就绪" : "需处理"}</span>
      <div className="source-media-row-actions"><button type="button" className="text-button" aria-label={"预览 " + item.displayName} disabled={item.probeStatus !== "ready"} onClick={() => open(item.id)}>预览</button><button type="button" className="text-button muted" aria-label={"移除 " + item.displayName} title="移出清单，保留原视频" disabled={disabled} onClick={() => void remove(item.id)}>移除</button></div>
    </div>)}
    {!!items.length && <p className="source-media-help">移除仅移出当前清单；保存后，下次打开仍保留筛选结果。</p>}
    {active && <SourcePreviewDialog media={active} index={activeIndex} count={ready.length} disabled={disabled} onMove={direction => open(ready[activeIndex + direction].id)} onRemove={() => void remove(active.id)} onClose={() => setOpenId(undefined)} />}
  </div>;
}
