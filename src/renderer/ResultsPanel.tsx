import { useState } from "react";
import type { DesktopState } from "../shared/desktop";
import type { PublicExportBatch } from "../main/application";
import { AppendProductionDialog } from "./AppendProductionDialog";
import { SourceStickerKnowledgeDetails } from "./SourceStickerKnowledgeDetails";
import { Heading, Icon } from "./ui";

const labels: Record<string, string> = { queued: "等待导出", validating: "检查素材", running: "正在渲染", verifying: "校验成片", cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
const sourceKnowledgeRiskWarning = {
  disputed: "此结果采用的原贴纸位置后来发现争议，画面可能受影响。重试仍使用原冻结方案；重新生成才使用当前知识。",
  unknown: "无法确认此结果的源贴纸历史状态；不影响按原冻结方案重试。",
} as const;
export function SupervisorPreviewDialog({ preview, onClose }: { preview: { url: string; name: string }; onClose(): void }) {
  return <div className="result-preview-backdrop" role="presentation" onClick={onClose}><section className="result-preview-dialog card" role="dialog" aria-modal="true" aria-label={`${preview.name} 主管样片`} onClick={(event) => event.stopPropagation()}><div className="card-header"><h2>{preview.name}</h2><button type="button" className="icon-button" aria-label="关闭样片" onClick={onClose}><Icon name="close" size={18} /></button></div><video src={preview.url} controls autoPlay preload="metadata" /></section></div>;
}
export function ResultsPanel({ state, busy, retryingIds, onCancel, onRetry, onOpen, onReveal, onNew }: {
  state: DesktopState; busy: boolean; retryingIds: string[]; onCancel(taskId: string): void; onRetry(taskId: string): void; onOpen(taskId: string): void; onReveal(taskId: string): void; onNew(): void;
}) {
  const [preview, setPreview] = useState<{ url: string; name: string }>();
  const [appendTarget, setAppendTarget] = useState<{ batch: PublicExportBatch; prefill: { productPrice: string; mediaCount: number } }>();
  const [appendError, setAppendError] = useState("");
  const batchById = new Map(state.queue.batches.map(({ batch }) => [batch.id, batch]));
  const openAppend = async (batchId: string) => {
    setAppendError("");
    try {
      const batch = batchById.get(batchId);
      if (!batch) throw new Error("找不到源批次。");
      const prefill = await window.jianji.appendProductionPrefill(batchId);
      setAppendTarget({ batch, prefill });
    } catch (cause) {
      setAppendError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "无法读取源批次信息。");
    }
  };
  const tasks = state.queue.batches.flatMap(({ batch }) => batch.tasks);
  const planned = state.agentRun?.items ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const unqueued = planned.filter((item) => !item.taskId || !tasks.some((task) => task.id === item.taskId));
  const completed = planned.filter((item) => item.taskId && taskById.get(item.taskId)?.status === "completed").length;
  const failed = planned.filter((item) => {
    const taskStatus = item.taskId ? taskById.get(item.taskId)?.status : undefined;
    return item.status === "failed" || item.status === "cancelled" || taskStatus === "failed" || taskStatus === "interrupted" || taskStatus === "cancelled";
  }).length;
  const processing = planned.length - completed - failed;
  return <>
    <Heading title="作品与导出">跟进分析与导出进度；完成后播放成片验收。</Heading>
    <div className="result-stats"><div><span>本轮制作</span><strong>{planned.length}<small>条</small></strong></div><div><span>正在处理</span><strong>{processing.toString().padStart(2, "0")}</strong></div><div><span>已完成</span><strong className="green-text">{completed.toString().padStart(2, "0")}</strong></div><div><span>需要处理</span><strong className={failed ? "red-text" : ""}>{failed.toString().padStart(2, "0")}</strong></div></div>
    <div className="card result-list"><div className="card-header"><h2>作品与任务</h2><span>原文件始终保留</span></div>
      {tasks.length + unqueued.length === 0 && <div className="empty-state"><Icon name="film" size={36} /><h3>第一条作品，从一份素材开始</h3><p>导入视频并选择模板后，Agent 会在这里开始工作。</p><button className="button secondary" onClick={onNew}>去导入素材<Icon name="arrow" size={16} /></button></div>}
      {unqueued.map((item) => <div className="result-row" key={item.id}><div className={`result-icon ${item.status === "analyzing" ? "pulse" : ""}`}><Icon name="spark" /></div><div className="result-info"><strong>{item.name}</strong><p>{item.error || (item.status === "cancelled" ? "已停止，可返回素材重新开始" : item.summary) || (item.status === "analyzing" ? "提取画面并设计包装方案…" : item.status === "waiting" ? "等待 Agent 分析" : item.status === "cancelled" ? "已停止，可返回素材重新开始" : "等待本地导出状态")}</p><SourceStickerKnowledgeDetails progress={item.sourceKnowledge} />{item.status === "failed" && <small>可返回模板页面重新生成，本次会再次调用模型。</small>}</div>{item.previewUrl && item.status === "prepared" ? <button type="button" className={`status-tag ${item.status} preview-status`} aria-label={`播放 ${item.name} 的主管样片`} onClick={() => setPreview({ url: item.previewUrl!, name: item.name })}>待导出</button> : <span className={`status-tag ${item.status}`}>{item.status === "failed" ? "分析失败" : item.status === "cancelled" ? "已停止" : item.status === "waiting" ? "等待中" : item.status === "prepared" ? "待导出" : "检查中"}</span>}</div>)}
      {[...tasks].reverse().map((task) => {
        const media = state.project.mediaItems.find((item) => item.id === task.mediaId);
        const plan = planned.find((item) => item.taskId === task.id);
        const riskWarning = state.sourceKnowledgeRisks?.[task.id];
        const name = plan?.name ?? media?.displayName ?? "视频素材";
        const playable = plan?.previewUrl && !terminal.has(task.status);
        const sourceBatch = batchById.get(task.batchId);
        const appendable = sourceBatch?.status === "completed" || sourceBatch?.status === "completed_with_errors";
        return <div className="result-row" key={task.id}><div className={`result-icon ${task.status === "completed" ? "complete" : ""}`}><Icon name={task.status === "completed" ? "check" : "film"} /></div><div className="result-info"><strong>{name}</strong><p>{task.errorMessage || "独立包装 · 成片"}</p><SourceStickerKnowledgeDetails progress={plan?.sourceKnowledge} />{riskWarning && <small>{sourceKnowledgeRiskWarning[riskWarning]}</small>}{!terminal.has(task.status) && <progress aria-label="导出进度" max={1} value={task.progress} />}</div>{playable ? <button type="button" className={`status-tag ${task.status} preview-status`} aria-label={`播放 ${name} 的主管样片`} onClick={() => setPreview({ url: plan.previewUrl!, name })}>{labels[task.status]}{task.status === "running" ? ` ${Math.round(task.progress * 100)}%` : ""}</button> : <span className={`status-tag ${task.status}`}>{labels[task.status]}{task.status === "running" ? ` ${Math.round(task.progress * 100)}%` : ""}</span>}<div className="row-actions">{task.status === "completed" ? <><button className="button secondary compact" onClick={() => onOpen(task.id)}><Icon name="play" size={15} />播放</button>{appendable && <button className="text-button" disabled={busy} onClick={() => void openAppend(task.batchId)}>追加制作</button>}<button className="icon-button" aria-label="打开成片文件夹" onClick={() => onReveal(task.id)}><Icon name="folder" size={18} /></button></> : task.status === "failed" || task.status === "interrupted" ? <button className="text-button" disabled={busy || state.agentRun?.status === "running" || retryingIds.includes(task.id)} onClick={() => onRetry(task.id)}>重试导出</button> : task.status === "cancelled" ? null : <button className="text-button muted" disabled={busy} onClick={() => onCancel(task.id)}>停止</button>}</div></div>;
      })}
    </div>
    {preview && <SupervisorPreviewDialog preview={preview} onClose={() => setPreview(undefined)} />}
    {appendError && <p className="notice error" role="alert">{appendError}</p>}
    {appendTarget && <AppendProductionDialog batch={appendTarget.batch} prefill={appendTarget.prefill} mediaLabel={appendTarget.batch.mediaIds.map((id) => state.project.mediaItems.find((item) => item.id === id)?.displayName ?? "历史素材").join("、")} onClose={() => setAppendTarget(undefined)} />}
    <div className="result-footnote"><Icon name="shield" size={16} /><span>重试导出会复用已生成的方案，不重新调用模型。分析中的任务退出后不会自动恢复。</span></div>
  </>;
}
