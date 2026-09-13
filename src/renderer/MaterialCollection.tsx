import { MaterialNameSchema } from "../shared/material-names";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, dirty, disabled, openingDisabled, onSave, onOpen, onName }: {
  name: string; dirty: boolean; disabled: boolean; openingDisabled: boolean;
  onSave: () => void; onOpen: () => void; onName: (name: string) => void;
}) {
  const parsed = MaterialNameSchema.safeParse(name);
  return <section className="card material-collection" aria-label="保存与打开素材集">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>素材集名称<input aria-label="素材集名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存素材集</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={onOpen}><Icon name="folder" size={15} />打开素材集</button>
    </form>
    <p><span>{dirty ? "尚有更改未保存" : "已保存"}</span>保存全部素材及名称，下次通过“打开素材集”继续使用。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
