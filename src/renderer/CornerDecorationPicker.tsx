import { CORNERS, CORNER_LABELS, type Corner, type CornerDecoration, type DecorationOptions } from "../shared/decorations";
import { DecorationPicker } from "./DecorationPicker";
import { useRef } from "react";

export function CornerDecorationPicker({ value, onChange, disabled, selected, onSelect }: {
  value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean;
  selected?: Corner; onSelect(corner?: Corner): void;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const slot = selected ? value.corners?.[selected] : undefined;
  const update = (next?: CornerDecoration) => {
    if (!selected || disabled) return;
    const corners = { ...valueRef.current.corners };
    if (next) corners[selected] = next; else delete corners[selected];
    onChange({ ...valueRef.current, corners });
  };
  const pickerValue = selected ? { sticker: slot?.type === "sticker" ? slot.sticker : "none", fontFamily: slot?.type === "text" ? slot.fontFamily : value.fontFamily } : value;
  return <section id="corner-decoration-editor" aria-label="四角内容设置">
    <div className="corner-tabs" role="group" aria-label="选择编辑角落">
      <button type="button" disabled={disabled} aria-pressed={!selected} onClick={() => onSelect(undefined)}>默认样式</button>
      {CORNERS.map((corner) => <button type="button" key={corner} disabled={disabled} aria-pressed={selected === corner} onClick={() => onSelect(corner)}>{CORNER_LABELS[corner]}</button>)}
    </div>
    {selected && <div className="card corner-settings"><h2>{CORNER_LABELS[selected]}内容</h2>
      <label>内容类型<select aria-label="角落内容类型" disabled={disabled} value={slot?.type ?? "auto"} onChange={(event) => {
        const type = event.target.value;
        update(type === "auto" ? undefined : type === "none" ? { type: "none" } : type === "sticker" ? { type: "sticker", sticker: "heart" } : { type: "text", text: "好物推荐", fontFamily: value.fontFamily });
      }}><option value="auto">跟随模板</option><option value="none">留空</option><option value="sticker">贴纸</option><option value="text">文字与字体</option></select></label>
      {slot?.type === "text" && <label>角落文字<input aria-label="角落文字" maxLength={12} value={slot.text} disabled={disabled} onChange={(event) => update({ ...slot, text: event.target.value })} /><small>请输入 1–12 字；此文字会直接用于本轮每条成片。</small></label>}
      <p>此处选择仅应用于{CORNER_LABELS[selected]}，其他角落保持各自设置。</p>
    </div>}
    {(!selected || slot?.type === "sticker" || slot?.type === "text") && <DecorationPicker key={`${selected ?? "default"}-${slot?.type ?? "auto"}`} mode={selected ? slot?.type === "text" ? "font" : "sticker" : "both"} value={pickerValue} disabled={disabled} onChange={(next) => {
      if (!selected) onChange(next);
      else if (slot?.type === "text") {
        const current = valueRef.current.corners?.[selected];
        if (current?.type === "text") update({ ...current, fontFamily: next.fontFamily });
      }
      else update(next.sticker === "none" ? { type: "none" } : next.sticker === "template" ? undefined : { type: "sticker", sticker: next.sticker });
    }} />}
  </section>;
}
