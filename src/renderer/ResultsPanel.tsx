import type { DesktopState } from "../shared/desktop";
import { Heading, Icon } from "./ui";

const labels: Record<string, string> = { queued: "等待导出", validating: "检查素材", running: "正在渲染", verifying: "校验成片", cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
export function ResultsPanel({ state, busy, retryingIds, onCancel, onRetry, onOpen, onReveal, onNew }: {
  state: DesktopState; busy: boolean; retryingIds: string[]; onCancel(taskId: string): void; onRetry(taskId: string): void; onOpen(taskId: string): void; onReveal(taskId: string): void; onNew(): void;
}) {
  const tasks = state.queue.batches.flatMap(({ batch }) => batch.tasks);
  const planned = state.agentRun?.items ?? [];
  const unqueued = planned.filter((item) => !item.taskId || !tasks.some((task) => task.id === item.taskId));
  const completed = tasks.filter((task) => task.status === "completed").length;
  const processing = tasks.filter((task) => !terminal.has(task.status)).length + unqueued.filter((item) => item.status === "waiting" || item.status === "analyzing").length;
  const failed = tasks.filter((task) => task.status === "failed" || task.status === "interrupted").length + unqueued.filter((item) => item.status === "failed").length;
  return <>
    <Heading eyebrow="03 / YOUR CREATIONS" title={processing ? "灵感正在成为作品" : "每条素材，都有了新表达"}>在这里跟进分析与导出。完成后播放成片，确认你喜欢最终效果。</Heading>
    <div className="result-stats"><div><span>本项目任务</span><strong>{tasks.length + unqueued.length}<small>条</small></strong></div><div><span>正在处理</span><strong>{processing.toString().padStart(2, "0")}</strong></div><div><span>已完成</span><strong className="green-text">{completed.toString().padStart(2, "0")}</strong></div><div><span>需要处理</span><strong className={failed ? "red-text" : ""}>{failed.toString().padStart(2, "0")}</strong></div></div>
    <div className="card result-list"><div className="card-header"><h2>作品与任务</h2><span>原文件始终保留</span></div>
      {tasks.length + unqueued.length === 0 && <div className="empty-state"><Icon name="film" size={36} /><h3>第一条作品，从一份素材开始</h3><p>导入视频并选择模板后，Agent 会在这里开始工作。</p><button className="button secondary" onClick={onNew}>去导入素材<Icon name="arrow" size={16} /></button></div>}
      {unqueued.map((item) => <div className="result-row" key={item.mediaId}><div className={`result-icon ${item.status === "analyzing" ? "pulse" : ""}`}><Icon name="spark" /></div><div className="result-info"><strong>{item.name}</strong><p>{item.error || (item.status === "analyzing" ? "提取画面并设计包装方案…" : item.status === "waiting" ? "等待 Agent 分析" : item.status === "cancelled" ? "已停止，可返回素材重新开始" : "等待本地导出状态")}</p>{item.status === "failed" && <small>可返回模板页面重新生成，本次会再次调用模型。</small>}</div><span className={`status-tag ${item.status}`}>{item.status === "failed" ? "分析失败" : item.status === "cancelled" ? "已停止" : item.status === "waiting" ? "等待中" : "分析中"}</span></div>)}
      {[...tasks].reverse().map((task) => {
        const media = state.project.mediaItems.find((item) => item.id === task.mediaId);
        const plan = planned.find((item) => item.taskId === task.id);
        return <div className="result-row" key={task.id}><div className={`result-icon ${task.status === "completed" ? "complete" : ""}`}><Icon name={task.status === "completed" ? "check" : "film"} /></div><div className="result-info"><strong>{media?.displayName ?? plan?.name ?? "视频素材"}</strong><p>{task.errorMessage || plan?.summary || "独立包装 · 成片"}</p>{!terminal.has(task.status) && <progress aria-label="导出进度" max={1} value={task.progress} />}</div><span className={`status-tag ${task.status}`}>{labels[task.status]}{task.status === "running" ? ` ${Math.round(task.progress * 100)}%` : ""}</span><div className="row-actions">{task.status === "completed" ? <><button className="button secondary compact" onClick={() => onOpen(task.id)}><Icon name="play" size={15} />播放</button><button className="icon-button" aria-label="打开成片文件夹" onClick={() => onReveal(task.id)}><Icon name="folder" size={18} /></button></> : task.status === "failed" || task.status === "interrupted" ? <button className="text-button" disabled={busy || retryingIds.includes(task.id)} onClick={() => onRetry(task.id)}>重试导出</button> : task.status === "cancelled" ? null : <button className="text-button muted" disabled={busy} onClick={() => onCancel(task.id)}>停止</button>}</div></div>;
      })}
    </div>
    <div className="result-footnote"><Icon name="shield" size={16} /><span>重试导出会复用已生成的方案，不重新调用模型。分析中的任务退出后不会自动恢复。</span></div>
  </>;
}
