import { CORNERS, CORNER_LABELS, type Corner, type CornerDecoration, type DecorationOptions } from "../shared/decorations";
import { DecorationPicker } from "./DecorationPicker";
import { useRef } from "react";

export function CornerDecorationPicker({ value, onChange, disabled, selected, onSelect }: {
  value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean;
  selected?: Corner; onSelect(corner?: Corner): void;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const automatic = value.mode === "agent";
  const slot = selected ? value.corners?.[selected] : undefined;
  const update = (next?: CornerDecoration) => {
    if (!selected || disabled) return;
    const corners = { ...valueRef.current.corners };
    if (next) corners[selected] = next; else delete corners[selected];
    onChange({ ...valueRef.current, corners });
  };
  const pickerValue = selected ? { ...value, sticker: slot?.type === "sticker" ? slot.sticker : "none" } : value;
  return <section id="corner-decoration-editor" aria-label="四角内容设置">
    <div className="corner-tabs" role="group" aria-label="装饰选择方式">
      <button type="button" disabled={disabled} aria-pressed={automatic} onClick={() => { onChange({ ...value, mode: "agent" }); onSelect(undefined); }}>全部交给 Agent</button>
      <button type="button" disabled={disabled} aria-pressed={!automatic} onClick={() => onChange({ ...value, mode: "manual" })}>自己设置</button>
    </div>
    {automatic ? <div className="card corner-settings"><h2>Agent 按画面选择装饰与价格花字</h2><p>根据每条视频选择贴纸、位置和价格花字。四个角落不必加满，也可以全部留空。</p><p>价格金额保持手动输入；花字只从现有 8 款中选择，并参考同批已使用的样式减少重复，但不保证每版不同。贴纸只从内置装饰中选择，遵守所选模板的尺寸与数量限制。切回“自己设置”可继续使用之前的选择。</p></div> : <>
    <div className="corner-tabs" role="group" aria-label="选择编辑角落">
      <button type="button" disabled={disabled} aria-pressed={!selected} onClick={() => onSelect(undefined)}>默认样式</button>
      {CORNERS.map((corner) => <button type="button" key={corner} disabled={disabled} aria-pressed={selected === corner} onClick={() => onSelect(corner)}>{CORNER_LABELS[corner]}</button>)}
    </div>
    {selected && <div className="card corner-settings"><h2>{CORNER_LABELS[selected]}内容</h2>
      <label>内容类型<select aria-label="角落内容类型" disabled={disabled} value={slot?.type ?? "auto"} onChange={(event) => {
        const type = event.target.value;
        update(type === "auto" ? undefined : type === "none" ? { type: "none" } : { type: "sticker", sticker: "heart" });
      }}><option value="auto">跟随模板</option><option value="none">留空</option><option value="sticker">贴纸</option></select></label>
      <p>此处选择仅应用于{CORNER_LABELS[selected]}，其他角落保持各自设置。</p>
    </div>}
    {(!selected || slot?.type === "sticker") && <DecorationPicker key={`${selected ?? "default"}-${slot?.type ?? "auto"}`} value={pickerValue} disabled={disabled} onChange={(next) => {
      if (!selected) onChange(next);
      else update(next.sticker === "none" ? { type: "none" } : next.sticker === "template" ? undefined : { type: "sticker", sticker: next.sticker });
    }} />}
    </>}
  </section>;
}
