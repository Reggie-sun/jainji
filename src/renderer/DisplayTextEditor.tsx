import { useState, type ReactNode } from "react";
import type { MediaView } from "../main/media";
import type { RuleTemplate } from "../shared/agent";
import { displayTextSettings, type Corner, type DecorationOptions, type DisplayTextSettings } from "../shared/decorations";
import { outputDimensions, type ExportSettings } from "../shared/export-settings";
import { TemplatePreview } from "./TemplatePreview";
import { MediaSelector } from "./MediaSelector";
import { frameSettings } from "../shared/frames";

export function DisplayTextEditor({ rule, options, media, exportSettings, selectedCorner, onCornerSelect, disabled, onChange, onSave, children }: {
  rule: RuleTemplate; options: DecorationOptions; media: readonly MediaView[]; exportSettings: ExportSettings;
  selectedCorner?: Corner; onCornerSelect?(corner: Corner): void; disabled?: boolean;
  onChange?(settings: DisplayTextSettings | undefined, mediaId?: string): void; onSave?(): void;
  children?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = media.find(item => item.id === selectedId) ?? media[0];
  const settings = displayTextSettings(options, selected?.id);
  const frame = frameSettings(options, selected?.id);
  const dimensions = selected ? outputDimensions(selected, exportSettings) : { width: 900, height: 1600 };
  const update = (patch: Partial<DisplayTextSettings>) => onChange?.({ ...settings, ...patch }, selected?.id);
  return <div className="card brief-card price-input-card display-text-settings">
      {children}
      <label className="display-text-media-label" htmlFor="display-text-media">逐素材开关与位置</label>
      <MediaSelector id="display-text-media" label="展示文字素材" media={media} value={selected?.id} disabled={disabled} onChange={setSelectedId} />
      <label><input type="checkbox" checked={settings.enabled} disabled={disabled || !onChange} onChange={event => update({ enabled: event.target.checked })} />{selected ? "此素材显示展示文字 / 价格" : "显示展示文字 / 价格"}</label>
      <button type="button" className="button secondary compact" disabled={disabled || !onChange} onClick={() => onChange?.(undefined, selected?.id)}>恢复默认位置和开关</button>
      <button type="button" className="button secondary compact" disabled={disabled || !onSave} onClick={onSave}>保存到当前项目</button>
      <small>选择素材后可播放预览、拖动文字，也可用方向键微调。每条素材的位置和开关独立，文字内容与显示时段整批共用。保存会更新当前项目模板，同一素材的所有新版本使用相同设置；首次保存新素材项目才需选择文件位置。</small>
    <TemplatePreview rule={rule} options={{ ...options, frame, frameId: frame.mode === "manual" ? frame.frameId : frame.mode === "random" ? "frame-stars" : undefined, framesByMedia: undefined, displayText: settings }} media={selected} dimensions={dimensions} selectedCorner={selectedCorner} onCornerSelect={onCornerSelect} disabled={disabled} onDisplayTextChange={value => onChange?.(value, selected?.id)} />
  </div>;
}
