import { useState } from "react";
import type { MediaView } from "../main/media";
import type { RuleTemplate } from "../shared/agent";
import { displayTextSettings, type Corner, type DecorationOptions, type DisplayTextSettings } from "../shared/decorations";
import { outputDimensions, type ExportSettings } from "../shared/export-settings";
import { TemplatePreview } from "./TemplatePreview";
import { MediaSelector } from "./MediaSelector";

export function DisplayTextEditor({ rule, options, media, exportSettings, selectedCorner, onCornerSelect, disabled, onChange, onSave }: {
  rule: RuleTemplate; options: DecorationOptions; media: readonly MediaView[]; exportSettings: ExportSettings;
  selectedCorner?: Corner; onCornerSelect?(corner: Corner): void; disabled?: boolean;
  onChange?(settings: DisplayTextSettings | undefined, mediaId?: string): void; onSave?(): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = media.find(item => item.id === selectedId) ?? media[0];
  const settings = displayTextSettings(options, selected?.id);
  const dimensions = selected ? outputDimensions(selected, exportSettings) : { width: 900, height: 1600 };
  const update = (patch: Partial<DisplayTextSettings>) => onChange?.({ ...settings, ...patch }, selected?.id);
  return <>
    <div className="card brief-card display-text-settings">
      <label htmlFor="display-text-media">展示文字位置 · 逐素材设置</label>
      <MediaSelector id="display-text-media" label="展示文字素材" media={media} value={selected?.id} disabled={disabled} onChange={setSelectedId} />
      <label><input type="checkbox" checked={settings.enabled} disabled={disabled || !onChange} onChange={event => update({ enabled: event.target.checked })} />{selected ? "此素材显示展示文字 / 价格" : "显示展示文字 / 价格"}</label>
      <div className="display-text-coordinates">
        {(["x", "y"] as const).map(axis => <label key={axis}>{axis === "x" ? "横向位置（%）" : "纵向位置（%）"}<input type="number" aria-label={axis === "x" ? "文字横向位置" : "文字纵向位置"} min={0} max={100} step={1} value={Math.round(settings[axis] * 100)} disabled={disabled || !settings.enabled || !onChange} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) update({ [axis]: Math.max(0, Math.min(1, value / 100)) }); }} /></label>)}
      </div>
      <button type="button" className="button secondary compact" disabled={disabled || !onChange} onClick={() => onChange?.(undefined, selected?.id)}>恢复默认位置和开关</button>
      <button type="button" className="button secondary compact" disabled={disabled || !onSave} onClick={onSave}>保存文字位置与开关</button>
      <small>可拖动预览中的文字，也可用方向键微调。每条素材独立保存位置和开关，文字内容仍整批共用；文字会限制在画面内。设置随项目模板保存，同一素材的所有新版本使用相同设置。</small>
    </div>
    <TemplatePreview rule={rule} options={{ ...options, displayText: settings }} media={selected} dimensions={dimensions} selectedCorner={selectedCorner} onCornerSelect={onCornerSelect} disabled={disabled} onDisplayTextChange={value => onChange?.(value, selected?.id)} />
  </>;
}
