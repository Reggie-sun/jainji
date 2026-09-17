import { MaterialNameSchema } from "../shared/material-names";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, dirty, disabled, openingDisabled, onSave, onBrowse, onName }: {
  name: string;
  dirty: boolean;
  disabled: boolean;
  openingDisabled: boolean;
  onSave(): void;
  onBrowse(): void;
  onName(name: string): void;
}) {
  const parsed = MaterialNameSchema.safeParse(name);
  return <section className="card material-collection" aria-label="保存项目">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>项目名称<input aria-label="项目名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存项目</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={onBrowse}><Icon name="folder" size={15} />从项目文件导入</button>
    </form>
    <p><span>{dirty ? "项目有更改尚未保存" : "项目已保存"}</span>保存会记录当前素材、制作设置与所在步骤，下次可从右上角项目列表继续。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
