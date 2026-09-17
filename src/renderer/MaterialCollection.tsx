import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { useState } from "react";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, dirty, disabled, openingDisabled, onSave, onBrowse, onOpen, onName, onRename, onDelete, recentProjects, activeRecentId }: {
  name: string;
  dirty: boolean;
  disabled: boolean;
  openingDisabled: boolean;
  onSave(): void;
  onBrowse(): void;
  onOpen(recentId: string): void;
  onName(name: string): void;
  onRename(recentId: string, name: string): Promise<boolean>;
  onDelete(recentId: string): Promise<boolean>;
  recentProjects: NonNullable<DesktopState["recentProjects"]>;
  activeRecentId?: string;
}) {
  const parsed = MaterialNameSchema.safeParse(name);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const selected = recentProjects.find((item) => item.id === activeRecentId);
  const parsedRename = MaterialNameSchema.safeParse(renameName);
  return <section className="card material-collection" aria-label="保存项目">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>项目名称<input aria-label="项目名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存项目</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={onBrowse}><Icon name="folder" size={15} />从项目文件导入</button>
    </form>
    <div className="saved-collections"><label htmlFor="saved-project-select">已保存的项目</label><div className="saved-collection-row"><select id="saved-project-select" aria-label="已保存的项目" value={activeRecentId ?? ""} disabled={openingDisabled || !recentProjects.length} onChange={(event) => {
      const id = event.target.value;
      setRenaming(false);
      if (id) onOpen(id);
    }}>
      <option value="">{recentProjects.length ? "选择项目，直接打开…" : "暂无记录，可先保存或从项目文件导入"}</option>
      {recentProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mediaCount} 条素材 · {item.fileName}</option>)}
    </select><button className="button secondary compact" type="button" disabled={openingDisabled || managing || !selected} onClick={() => { setRenameName(selected?.name ?? ""); setRenaming(true); }}>重命名</button><button className="button secondary compact saved-collection-delete" type="button" disabled={openingDisabled || managing || !selected} onClick={() => {
      if (!selected) return;
      setManaging(true);
      void onDelete(selected.id).then((removed) => { if (removed) setRenaming(false); }).finally(() => setManaging(false));
    }}>删除</button></div></div>
    {renaming && selected && <form className="saved-collection-rename" onSubmit={(event) => {
      event.preventDefault();
      if (!parsedRename.success || managing) return;
      setManaging(true);
      void onRename(selected.id, parsedRename.data).then((renamed) => { if (renamed) setRenaming(false); }).finally(() => setManaging(false));
    }}><label>新的项目名称<input aria-label="新的项目名称" value={renameName} maxLength={120} autoFocus disabled={managing} onChange={(event) => setRenameName(event.target.value)} /></label><button className="button primary compact" type="submit" disabled={managing || !parsedRename.success}>确认重命名</button><button className="button secondary compact" type="button" disabled={managing} onClick={() => setRenaming(false)}>取消</button></form>}
    <p><span>{dirty ? "项目有更改尚未保存" : "项目已保存"}</span>保存会记录当前素材、制作设置与所在步骤，下次可从已保存项目列表继续。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
