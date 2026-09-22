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
  const random = value.mode === "random";
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
      <button type="button" disabled={disabled} aria-pressed={!automatic && value.mode !== "random"} onClick={() => onChange({ ...value, mode: "manual" })}>自己设置</button>
      <button type="button" disabled={disabled} aria-pressed={value.mode === "random"} onClick={() => { onChange({ ...value, mode: "random" }); onSelect(undefined); }}>本地随机</button>
    </div>
    {automatic ? <div className="card corner-settings"><h2>Agent 四角贴纸安排</h2><p>根据每条视频选择价格花字与贴纸，保留已有角落贴纸，只补齐空缺。</p><p>开启下方“覆盖原贴纸”后，已有贴纸的角落由覆盖层优先占位，其余角落和没有覆盖层的时段自动补齐。关闭覆盖时，通过独立视觉模型识别原贴纸，已有贴纸的角落和时段不再加一张；四角都有时不新增装饰贴纸。贴纸从内置素材和用户上传素材中选用；切回“自己设置”保留原有手动选择。</p></div> : random ? <div className="card corner-settings"><h2>四角贴纸 · 本地随机</h2><p>每个素材版本从本地贴纸库中随机选 4 款不同的贴纸，分别放在四角；价格花字也按素材独立随机。无需手动选择，零模型调用。</p></div> : <>
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
