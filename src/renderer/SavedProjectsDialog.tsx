import { useEffect, useRef, useState } from "react";
import { MaterialNameSchema } from "../shared/material-names";
import type { DesktopState } from "../shared/desktop";
import { Icon } from "./ui";
import "./saved-projects-dialog.css";

type SavedProject = NonNullable<DesktopState["recentProjects"]>[number];

export function SavedProjectsDialog({ open, projects, activeId, disabled, onClose, onOpen, onRename, onDelete }: {
  open: boolean;
  projects: SavedProject[];
  activeId?: string;
  disabled: boolean;
  onClose(): void;
  onOpen(id: string): Promise<boolean>;
  onRename(id: string, name: string): Promise<boolean>;
  onDelete(id: string): Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement>();
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string>();
  const [renameName, setRenameName] = useState("");
  const parsedName = MaterialNameSchema.safeParse(renameName);

  useEffect(() => {
    if (!open) {
      previousFocus.current?.focus();
      previousFocus.current = undefined;
      setRenamingId(undefined);
      return;
    }
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.showModal();
  }, [open]);

  const openProject = async (id: string) => {
    if (busy || disabled) return;
    setBusy(true);
    try { if (await onOpen(id)) onClose(); }
    finally { setBusy(false); }
  };
  const renameProject = async () => {
    if (!renamingId || !parsedName.success || busy || disabled) return;
    setBusy(true);
    try { if (await onRename(renamingId, parsedName.data)) setRenamingId(undefined); }
    finally { setBusy(false); }
  };
  const deleteProject = async (id: string) => {
    if (busy || disabled) return;
    setBusy(true);
    try { if (await onDelete(id) && renamingId === id) setRenamingId(undefined); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return <dialog ref={dialog} className="saved-projects-dialog" aria-labelledby="saved-projects-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="saved-projects-heading"><div><span className="eyebrow">CONTINUE YOUR WORK</span><h2 id="saved-projects-title">打开项目</h2><p>选择之前保存的项目，继续上次做到一半的创作。</p></div><button className="icon-button" aria-label="关闭项目列表" disabled={busy} onClick={onClose}><Icon name="close" size={20} /></button></div>
    {projects.length ? <div className="saved-projects-list" role="list" aria-label="已保存项目">
      {projects.map((project) => <div className="saved-projects-row" role="listitem" key={project.id}>
        <button className="saved-projects-open" type="button" aria-current={project.id === activeId ? "true" : undefined} data-recent-id={project.id} disabled={busy || disabled} onClick={() => void openProject(project.id)}><strong>{project.name}</strong><small>{project.mediaCount} 条素材 · {project.fileName}</small></button>
        <button className="saved-projects-action" type="button" aria-label={`重命名项目 ${project.name}`} disabled={busy || disabled} onClick={() => { setRenamingId(project.id); setRenameName(project.name); }}>重命名</button>
        <button className="saved-projects-action delete" type="button" aria-label={`删除项目 ${project.name}`} disabled={busy || disabled} onClick={() => void deleteProject(project.id)}><Icon name="close" size={16} /></button>
      </div>)}
    </div> : <div className="saved-projects-empty"><Icon name="folder" size={28} /><strong>还没有保存的项目</strong><p>做到一半时点击右上角“保存项目”，下次就能从这里继续。</p></div>}
    {renamingId && <form className="saved-projects-rename" onSubmit={(event) => { event.preventDefault(); void renameProject(); }}><label>新的项目名称<input aria-label="新的项目名称" value={renameName} maxLength={120} autoFocus disabled={busy} onChange={(event) => setRenameName(event.target.value)} /></label><button className="button primary compact" type="submit" disabled={busy || !parsedName.success}>确认重命名</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setRenamingId(undefined)}>取消</button></form>}
  </dialog>;
}
