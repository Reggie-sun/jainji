import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import "./material-collection.css";

export function MaterialCollection({ name, disabled, openingDisabled, onOpen, onName, onRename, onDelete, recentProjects, activeRecentId, compact = false }: {
  name: string;
  disabled: boolean;
  openingDisabled: boolean;
  onOpen(recentId: string): void;
  onName(name: string): void;
  onRename(recentId: string, name: string): Promise<boolean>;
  onDelete(recentId: string): Promise<boolean>;
  recentProjects: NonNullable<DesktopState["recentProjects"]>;
  activeRecentId?: string;
  compact?: boolean;
}) {
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selectedRecentId, setSelectedRecentId] = useState(activeRecentId ?? "");
  const picker = useRef<HTMLDetailsElement>(null);
  const selected = recentProjects.find((item) => item.id === selectedRecentId);
  const current = compact ? recentProjects.find((item) => item.id === activeRecentId) : selected;
  const listLabel = compact ? "已保存的素材模板" : "已保存的项目";
  const renameLabel = compact ? "新的模板名称" : "新的项目名称";
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
  useEffect(() => { if (openingDisabled) closePicker(); }, [openingDisabled]);
  return <section className={compact ? "material-collection material-collection-compact" : "card material-collection"} aria-label={compact ? "素材模板快捷选择" : "项目管理"}>
    {!compact && <label>项目名称<input aria-label="项目名称" value={name} maxLength={120} disabled={disabled} placeholder="例如：夏季新品展示" onChange={(event) => onName(event.target.value)} /></label>}
    <div className="saved-collections"><label>{compact ? "素材模板" : listLabel}</label><div className="saved-collection-row"><details className="saved-collection-picker" ref={picker}><summary aria-label={listLabel} aria-disabled={openingDisabled || managing || !recentProjects.length} onClick={(event) => {
      if (openingDisabled || managing || !recentProjects.length) event.preventDefault();
    }}><span>{current ? `${current.name} · ${current.mediaCount} 条素材${compact ? "" : ` · ${current.fileName}`}` : recentProjects.length ? compact ? "选择素材模板…" : "选择项目…" : "暂无记录，可先保存或从项目文件导入"}</span><span className="saved-collection-chevron" aria-hidden="true">⌄</span></summary><div className="saved-collection-menu" role="listbox" aria-label={compact ? "素材模板列表" : "项目列表"}>
      {recentProjects.map((item) => <div className="saved-collection-option-row" key={item.id}><button className="saved-collection-option" type="button" role="option" aria-selected={item.id === (compact ? activeRecentId : selectedRecentId)} disabled={openingDisabled || managing} data-recent-id={item.id} onClick={() => {
        setSelectedRecentId(item.id);
        setRenaming(false);
        closePicker();
        onOpen(item.id);
      }}><strong>{item.name}</strong><small>{item.mediaCount} 条素材 · {item.fileName}</small></button><button className="saved-collection-option-action saved-collection-option-rename" type="button" aria-label={`重命名${compact ? "模板" : "项目"} ${item.name}`} disabled={openingDisabled || managing} onClick={() => {
        setSelectedRecentId(item.id);
        setRenameName(item.name);
        setRenaming(true);
        closePicker();
      }}>重命名</button>{!compact && <button className="saved-collection-option-action saved-collection-option-delete" type="button" aria-label={`删除项目 ${item.name}`} title="删除项目" disabled={openingDisabled || managing} onClick={() => deleteRecent(item.id)}><Icon name="close" size={16} /></button>}</div>)}
    </div></details></div></div>
    {renaming && selected && <form className="saved-collection-rename" onSubmit={(event) => {
      event.preventDefault();
      if (!parsedRename.success || managing || openingDisabled) return;
      setManaging(true);
      void onRename(selected.id, parsedRename.data).then((renamed) => { if (renamed) setRenaming(false); }).finally(() => setManaging(false));
    }}><label>{renameLabel}<input aria-label={renameLabel} value={renameName} maxLength={120} autoFocus disabled={managing || openingDisabled} onChange={(event) => setRenameName(event.target.value)} /></label><button className="button primary compact" type="submit" disabled={managing || openingDisabled || !parsedRename.success}>确认重命名</button><button className="button secondary compact" type="button" disabled={managing} onClick={() => setRenaming(false)}>取消</button></form>}
    {!compact && <p>保存与打开项目文件在页面顶部进行；点击列表中的项目直接打开，也可重命名或删除。原视频仍在原位置，请勿移动或删除。</p>}
  </section>;
}
