import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { useEffect, useState } from "react";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, dirty, disabled, openingDisabled, onSave, onOpen, onName, onRename, onDelete, recentProjects, activeRecentId }: {
  name: string; dirty: boolean; disabled: boolean; openingDisabled: boolean;
  onSave: () => void; onOpen: (recentId?: string) => void; onName: (name: string) => void;
  onRename: (recentId: string, name: string) => Promise<boolean>; onDelete: (recentId: string) => Promise<boolean>;
  recentProjects: NonNullable<DesktopState["recentProjects"]>; activeRecentId?: string;
}) {
  const parsed = MaterialNameSchema.safeParse(name);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selectedRecentId, setSelectedRecentId] = useState(activeRecentId ?? "");
  const selected = recentProjects.find((item) => item.id === selectedRecentId);
  const parsedRename = MaterialNameSchema.safeParse(renameName);
  useEffect(() => {
    setSelectedRecentId(activeRecentId ?? "");
    setRenaming(false);
  }, [activeRecentId]);
  return <section className="card material-collection" aria-label="保存与打开素材集">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>素材集名称<input aria-label="素材集名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存素材集</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={() => onOpen()}><Icon name="folder" size={15} />打开其他素材集</button>
    </form>
    <div className="saved-collections"><label htmlFor="saved-collection-select">已保存的素材集</label><div className="saved-collection-row"><select id="saved-collection-select" aria-label="已保存的素材集" value={selected?.id ?? ""} disabled={openingDisabled || !recentProjects.length} onChange={(event) => {
      setSelectedRecentId(event.target.value);
      setRenaming(false);
    }}>
      <option value="">{recentProjects.length ? "选择要管理的素材集…" : "暂无记录，可先保存或打开已有素材集"}</option>
      {recentProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mediaCount} 条素材 · {item.fileName}</option>)}
    </select><button className="button secondary compact" type="button" disabled={openingDisabled || managing || !selected} onClick={() => { if (selected) onOpen(selected.id); }}>打开</button><button className="button secondary compact" type="button" disabled={openingDisabled || managing || !selected} onClick={() => { setRenameName(selected?.name ?? ""); setRenaming(true); }}>重命名</button><button className="button secondary compact saved-collection-delete" type="button" disabled={openingDisabled || managing || !selected} onClick={() => {
      if (!selected) return;
      setManaging(true);
      void onDelete(selected.id).then((removed) => { if (removed) { setRenaming(false); setSelectedRecentId(""); } }).finally(() => setManaging(false));
    }}>删除</button></div></div>
    {renaming && selected && <form className="saved-collection-rename" onSubmit={(event) => {
      event.preventDefault();
      if (!parsedRename.success || managing) return;
      setManaging(true);
      void onRename(selected.id, parsedRename.data).then((renamed) => { if (renamed) setRenaming(false); }).finally(() => setManaging(false));
    }}><label>新的素材集名称<input aria-label="新的素材集名称" value={renameName} maxLength={120} autoFocus disabled={managing} onChange={(event) => setRenameName(event.target.value)} /></label><button className="button primary compact" type="submit" disabled={managing || !parsedRename.success}>确认重命名</button><button className="button secondary compact" type="button" disabled={managing} onClick={() => setRenaming(false)}>取消</button></form>}
    <p><span>{dirty ? "尚有更改未保存" : "已保存"}</span>保存全部素材及名称；从下拉列表选中后，可以打开、重命名或删除。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
