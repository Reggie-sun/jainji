import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, dirty, disabled, openingDisabled, onSave, onOpen, onName, recentProjects }: {
  name: string; dirty: boolean; disabled: boolean; openingDisabled: boolean;
  onSave: () => void; onOpen: (recentId?: string) => void; onName: (name: string) => void;
  recentProjects: NonNullable<DesktopState["recentProjects"]>;
}) {
  const parsed = MaterialNameSchema.safeParse(name);
  return <section className="card material-collection" aria-label="保存与打开素材集">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>素材集名称<input aria-label="素材集名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存素材集</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={() => onOpen()}><Icon name="folder" size={15} />打开其他素材集</button>
    </form>
    <label className="saved-collections">已保存的素材集<select aria-label="已保存的素材集" value="" disabled={openingDisabled || !recentProjects.length} onChange={(event) => { if (event.target.value) onOpen(event.target.value); }}>
      <option value="">{recentProjects.length ? "选择素材集，直接打开…" : "暂无记录，可先保存或打开已有素材集"}</option>
      {recentProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mediaCount} 条素材 · {item.fileName}</option>)}
    </select></label>
    <p><span>{dirty ? "尚有更改未保存" : "已保存"}</span>保存全部素材及名称，下次从下拉列表选择即可使用。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
