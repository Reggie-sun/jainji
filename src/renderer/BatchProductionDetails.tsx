import { useEffect, useState } from "react";
import type { BatchProductionDetail, BatchProductionDetailRequest } from "../shared/batch-production";
import { SourceStickerKnowledgeDetails } from "./SourceStickerKnowledgeDetails";
import { Heading, Icon } from "./ui";
import { qianchuanUploadLabels } from "./qianchuan-upload-status";
import { QianchuanUploadHistory } from "./QianchuanUploadHistory";

const labels: Record<string, string> = { queued: "等待导出", validating: "检查素材", running: "正在渲染", verifying: "校验成片", cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function BatchProductionDetails({ request, name, onBack }: { request: BatchProductionDetailRequest; name: string; onBack(): void }) {
  const [detail, setDetail] = useState<BatchProductionDetail>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setDetail(undefined); setError("");
    const refresh = async () => {
      try {
        const next = await window.jianji.batchProductionDetails({ runId: request.runId, jobId: request.jobId });
        if (active) { setDetail(next); setError(""); }
      } catch (cause) { if (active) setError(message(cause)); }
      finally { if (active) timer = setTimeout(() => void refresh(), 1000); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [request.runId, request.jobId]);
  const artifact = async (id: string, reveal: boolean) => {
    try { if (reveal) await window.jianji.revealArtifact(id); else await window.jianji.openArtifact(id); }
    catch (cause) { setError(message(cause)); }
  };
  return <>
    <button type="button" className="text-button batch-details-back" onClick={onBack}>← 返回批量列表</button>
    <Heading title={`${name} · 作品与导出`}>查看该商品本批每条视频的制作与导出进度；完成后可播放成片。</Heading>
    {error && <p className="notice error" role="alert">{error}</p>}
    {detail ? <BatchProductionWorkList detail={detail} onArtifact={(id, reveal) => void artifact(id, reveal)} /> : !error && <p role="status">正在读取作品…</p>}
  </>;
}

export function BatchProductionWorkList({ detail, onArtifact }: { detail: BatchProductionDetail; onArtifact(id: string, reveal: boolean): void }) {
  const { job, tasks, items, usesModel } = detail;
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const unqueued = items.filter(item => !item.taskId || !taskById.has(item.taskId));
  const completed = tasks.filter(task => task.status === "completed").length;
  const failed = tasks.filter(task => ["failed", "cancelled", "interrupted"].includes(task.status)).length
    + unqueued.filter(item => item.status === "failed" || item.status === "cancelled").length;
  const total = job.actualCount || job.requestedCount;
  return <>
    <div className="result-stats"><div><span>本批制作</span><strong>{total}<small>条</small></strong></div><div><span>正在处理</span><strong>{Math.max(0, tasks.filter(task => !terminal.has(task.status)).length + unqueued.filter(item => !["failed", "cancelled"].includes(item.status)).length)}</strong></div><div><span>已完成</span><strong className="green-text">{completed}</strong></div><div><span>需要处理</span><strong className={failed ? "red-text" : ""}>{failed}</strong></div></div>
    {job.error && <p className="notice error">{job.error}</p>}
    {job.accountProduct && <section className="card brief-card" aria-label="本项千川上传">
      <div className="card-header"><h2>千川上传 · {job.accountProduct}</h2><span>导出与上传进度分别记录</span></div>
      <p>已上传 {detail.upload?.tasks.filter(task => task.upload_outcome === "READY").length ?? 0} / {total} 条 · 停在确定前</p>
      <small>上传记录会保存，同账号同计划下不重复上传。请保持任务 Chrome 页面打开，检查后自行确认。</small>
      {detail.upload?.message && <p>{detail.upload.message}</p>}
      {detail.upload?.tasks.map(task => <div className="result-row" key={task.upload_task_id}>
        <div className="result-info"><strong>{task.file_name}</strong><p>{qianchuanUploadLabels[task.state]} · 账户 {task.advertiserId} / 计划 {task.adId}</p>
          {task.failure && <small className="batch-error">{task.failure.message} {task.failure.next_action}</small>}
          {task.upload_outcome === "READY" && <small>上传记录已保存 · 待在 Chrome 确认</small>}
          {task.upload_outcome === "MAY_HAVE_UPLOADED" && <small>结果未知，禁止重新上传，请核查原页面。</small>}
        </div>
      </div>)}
      <QianchuanUploadHistory batches={detail.upload?.closedBatches} />
    </section>}
    <section className="card result-list" aria-label={`${job.name}作品与任务`}>
      <div className="card-header"><h2>作品与任务</h2><span>{completed} / {total} 条完成</span></div>
      {!tasks.length && !unqueued.length && <div className="empty-state"><Icon name="film" size={36} /><p>{job.status === "queued" ? "等待前面的商品制作完成，轮到该商品后会显示逐条进度。" : job.status === "preparing" || job.status === "producing" ? "正在准备制作，任务生成后会自动显示。" : "该项没有可用的作品记录。"}</p></div>}
      {unqueued.map(item => <div className="result-row" key={item.id}>
        <div className={`result-icon ${item.status === "analyzing" ? "pulse" : ""}`}><Icon name="spark" /></div>
        <div className="result-info"><strong>{item.name}</strong><p>{item.error || (item.taskId ? "导出记录不可用，无法确认成片状态。" : item.summary) || (item.status === "cancelled" ? "已停止" : item.status === "waiting" ? "等待制作" : usesModel === false ? "正在准备本地包装…" : "正在分析与设计包装…")}</p><SourceStickerKnowledgeDetails progress={item.sourceKnowledge} /></div>
        <span className={`status-tag ${item.status}`}>{item.status === "failed" ? "制作失败" : item.status === "cancelled" ? "已停止" : item.taskId ? "记录不可用" : item.status === "waiting" ? "等待中" : item.status === "prepared" ? "待导出" : "检查中"}</span>
      </div>)}
      {[...tasks].reverse().map((task, index) => {
        const item = items.find(item => item.taskId === task.id);
        const name = item?.name ?? `视频 ${tasks.length - index}`;
        return <div className="result-row" key={task.id}>
          <div className={`result-icon ${task.status === "completed" ? "complete" : ""}`}><Icon name={task.status === "completed" ? "check" : "film"} /></div>
          <div className="result-info"><strong>{name}</strong><p>{task.errorMessage || "独立包装 · 成片"}</p><SourceStickerKnowledgeDetails progress={item?.sourceKnowledge} />{!terminal.has(task.status) && <progress aria-label={`${name}导出进度`} max={1} value={task.progress} />}</div>
          <span className={`status-tag ${task.status}`}>{labels[task.status]}{task.status === "running" ? ` ${Math.round(task.progress * 100)}%` : ""}</span>
          {task.status === "completed" && <div className="row-actions"><button className="button secondary compact" onClick={() => onArtifact(task.id, false)}><Icon name="play" size={15} />播放</button><button className="icon-button" aria-label={`打开 ${name} 成片文件夹`} onClick={() => onArtifact(task.id, true)}><Icon name="folder" size={18} /></button></div>}
        </div>;
      })}
    </section>
  </>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "无法读取作品，请返回列表重试。"; }
