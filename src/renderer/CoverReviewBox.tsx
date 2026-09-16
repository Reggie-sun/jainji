import { useRef, useState, type PointerEvent } from "react";
import type { CoverRectangle } from "../shared/cover-sticker";
import { dragCoverRectangle } from "./cover-review-geometry";

export function CoverReviewBox({ rectangle, selected, disabled, keepRatio, label, onSelect, onPause, onSave }: {
  rectangle: CoverRectangle; selected: boolean; disabled: boolean; keepRatio: boolean; label: string;
  onSelect(): void; onPause(): void; onSave(rectangle: CoverRectangle): Promise<unknown>;
}) {
  const [preview, setPreview] = useState<CoverRectangle>();
  const [saving, setSaving] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; width: number; height: number; resize: boolean; original: CoverRectangle; latest: CoverRectangle }>();
  const shown = preview ?? rectangle;
  const start = (event: PointerEvent<HTMLButtonElement>, resize: boolean) => {
    if (disabled || saving || event.button !== 0 || gesture.current) return;
    const bounds = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault(); onPause(); onSelect();
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, resize, original: rectangle, latest: rectangle };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    current.latest = dragCoverRectangle(current.original, (event.clientX - current.x) / current.width, (event.clientY - current.y) / current.height, current.resize, keepRatio);
    setPreview(current.latest);
  };
  const finish = async (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || JSON.stringify(current.original) === JSON.stringify(current.latest)) { setPreview(undefined); return; }
    setSaving(true);
    try { await onSave(current.latest); } finally { setSaving(false); setPreview(undefined); }
  };
  const handlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void finish(event), onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void finish(event, true), onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void finish(event, true) };
  return <div className={`review-box${selected ? " selected" : ""}`} style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}>
    <button type="button" className="review-box-move" aria-label={`移动${label}`} disabled={disabled || saving} onClick={onSelect} onPointerDown={(event) => start(event, false)} {...handlers}>{label}</button>
    {selected && <button type="button" className="review-box-resize" aria-label={`缩放${label}`} disabled={disabled || saving} onPointerDown={(event) => start(event, true)} {...handlers} />}
  </div>;
}
