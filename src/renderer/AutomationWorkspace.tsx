import { useState } from "react";
import type { DesktopState } from "../shared/desktop";
import type { BatchProductionStart } from "../shared/batch-production";
import type { QianchuanLibraryClear } from "../shared/qianchuan-video-library";
import type { AutomationTask } from "../shared/automation";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { AutomationComposer, AutomationPanel } from "./AutomationPanel";
import { AutomationTaskDetails } from "./AutomationTaskDetails";
import { WorkspacePage } from "./WorkspacePage";
import { Heading } from "./ui";

export type AutomationDraft = { production?: BatchProductionStart; cleanup?: QianchuanLibraryClear };
export type AutomationPage = "tasks" | "create" | "edit";
export function AutomationWorkspace({ state, page, onPage, draft, revision, onSource }: {
  state: DesktopState; page: AutomationPage; onPage(page: AutomationPage): void;
  draft?: AutomationDraft; revision: number; onSource(source: "batch" | "cleanup"): void;
}) {
  const [editing, setEditing] = useState<AutomationTask>();
  const [editingTasks, setEditingTasks] = useState<AutomationTask[]>([]);
  const [editRevision, setEditRevision] = useState(0);
  const accounts = state.douyinUpload?.accounts ?? [];
  return <>
    <Heading title="自动化">管理每日固定任务；保存或启用需要明确的范围与授权。</Heading>
    <nav className="task-page-tabs" aria-label="自动化页面">
      <button type="button" aria-current={page === "tasks" ? "page" : undefined} onClick={() => onPage("tasks")}>任务管理</button>
      <button type="button" aria-current={page === "create" ? "page" : undefined} onClick={() => onPage("create")}>创建任务</button>
    </nav>
    <WorkspacePage active={page === "tasks"} label="任务管理"><AutomationPanel accounts={accounts} onEdit={(task, tasks) => { setEditing(task); setEditingTasks(tasks); setEditRevision(value => value + 1); onPage("edit"); }} /></WorkspacePage>
    <WorkspacePage active={page === "create"} label="创建自动化">
      <div className="task-source-actions"><button type="button" className="text-button" onClick={() => onSource("batch")}>从批量制作选择模板</button><button type="button" className="text-button" onClick={() => onSource("cleanup")}>从素材管理选择清理范围</button></div>
      <AutomationComposer key={revision} production={draft?.production} cleanup={draft?.cleanup} onCreated={() => onPage("tasks")} />
    </WorkspacePage>
    <WorkspacePage active={page === "edit"} label="编辑自动化">{editing && <AutomationTaskEditor key={`${editing.id}:${editRevision}`} task={editing} accounts={accounts} tasks={editingTasks} onSaved={() => onPage("tasks")} />}</WorkspacePage>
  </>;
}

function AutomationTaskEditor({ task, accounts, tasks, onSaved }: { task: AutomationTask; accounts: QianchuanAccountSummary[]; tasks: AutomationTask[]; onSaved(): void }) {
  const [time, setTime] = useState(task.request.time);
  const [enabled, setEnabled] = useState(task.request.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await window.jianji.configureAutomation({ id: task.id, time, enabled }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "定时设置未保存。"); }
    finally { setBusy(false); }
  };
  return <section className="card automation-composer" aria-label="编辑定时任务">
    <h2>{task.request.name}</h2><AutomationTaskDetails task={task} accounts={accounts} tasks={tasks} />
    <p>固定素材、账号、计划和授权范围保持原绑定；需要更换范围时，从来源页面创建新任务。</p>
    <label>每天执行时间<input type="time" value={time} disabled={busy} onChange={event => setTime(event.target.value)} /></label>
    <label><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />启用此每日任务</label>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button primary" disabled={busy || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)} onClick={() => void save()}>保存定时设置</button>
  </section>;
}
