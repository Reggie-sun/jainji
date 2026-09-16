import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { useEffect, useRef, useState } from "react";
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
  const picker = useRef<HTMLDetailsElement>(null);
  const selected = recentProjects.find((item) => item.id === selectedRecentId);
  const parsedRename = MaterialNameSchema.safeParse(renameName);
  const closePicker = () => picker.current?.removeAttribute("open");
  const deleteRecent = (recentId: string) => {
    setManaging(true);
    void onDelete(recentId).then((removed) => {
      if (!removed) return;
      if (selectedRecentId === recentId) setSelectedRecentId("");
      setRenaming(false);
      closePicker();
    }).finally(() => setManaging(false));
  };
  useEffect(() => {
    setSelectedRecentId(activeRecentId ?? "");
    setRenaming(false);
    closePicker();
  }, [activeRecentId]);
  return <section className="card material-collection" aria-label="保存与打开素材集">
    <form onSubmit={(event) => { event.preventDefault(); if (parsed.success && !disabled) onSave(); }}>
      <label>素材集名称<input aria-label="素材集名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>
      <button className="button primary compact" disabled={disabled || !parsed.success} type="submit"><Icon name="download" size={15} />保存素材集</button>
      <button className="button secondary compact" disabled={openingDisabled} type="button" onClick={() => onOpen()}><Icon name="folder" size={15} />打开其他素材集</button>
    </form>
    <div className="saved-collections"><label>已保存的素材集</label><div className="saved-collection-row"><details className="saved-collection-picker" ref={picker}><summary aria-label="已保存的素材集" aria-disabled={openingDisabled || managing || !recentProjects.length} onClick={(event) => {
      if (openingDisabled || managing || !recentProjects.length) event.preventDefault();
    }}><span>{selected ? `${selected.name} · ${selected.mediaCount} 条素材 · ${selected.fileName}` : recentProjects.length ? "选择要管理的素材集…" : "暂无记录，可先保存或打开已有素材集"}</span><span className="saved-collection-chevron" aria-hidden="true">⌄</span></summary><div className="saved-collection-menu" role="listbox" aria-label="素材集列表">
      {recentProjects.map((item) => <div className="saved-collection-option-row" key={item.id}><button className="saved-collection-option" type="button" role="option" aria-selected={item.id === selectedRecentId} data-recent-id={item.id} onClick={() => {
        setSelectedRecentId(item.id);
        setRenaming(false);
        closePicker();
        onOpen(item.id);
      }}><strong>{item.name}</strong><small>{item.mediaCount} 条素材 · {item.fileName}</small></button><button className="saved-collection-option-action saved-collection-option-rename" type="button" aria-label={`重命名素材集 ${item.name}`} disabled={openingDisabled || managing} onClick={() => {
        setSelectedRecentId(item.id);
        setRenameName(item.name);
        setRenaming(true);
        closePicker();
      }}>重命名</button><button className="saved-collection-option-action saved-collection-option-delete" type="button" aria-label={`删除素材集 ${item.name}`} title="删除素材集" disabled={openingDisabled || managing} onClick={() => deleteRecent(item.id)}><Icon name="close" size={16} /></button></div>)}
    </div></details></div></div>
    {renaming && selected && <form className="saved-collection-rename" onSubmit={(event) => {
      event.preventDefault();
      if (!parsedRename.success || managing) return;
      setManaging(true);
      void onRename(selected.id, parsedRename.data).then((renamed) => { if (renamed) setRenaming(false); }).finally(() => setManaging(false));
    }}><label>新的素材集名称<input aria-label="新的素材集名称" value={renameName} maxLength={120} autoFocus disabled={managing} onChange={(event) => setRenameName(event.target.value)} /></label><button className="button primary compact" type="submit" disabled={managing || !parsedRename.success}>确认重命名</button><button className="button secondary compact" type="button" disabled={managing} onClick={() => setRenaming(false)}>取消</button></form>}
    <p><span>{dirty ? "尚有更改未保存" : "已保存"}</span>点击下拉列表中的素材集即可打开，也可以直接重命名或删除。原视频仍在原位置，请勿移动或删除。</p>
  </section>;
}
