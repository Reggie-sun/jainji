import type { BatchProductionDetail, BatchProductionDetailRequest } from "../shared/batch-production";
import { SourceStickerKnowledgeDetails } from "./SourceStickerKnowledgeDetails";
import { Heading, Icon } from "./ui";
import { batchDetailError, useBatchProductionDetails } from "./useBatchProductionDetails";
import { qianchuanUploaded } from "./qianchuan-upload-status";

const labels: Record<string, string> = { queued: "等待导出", validating: "检查素材", running: "正在渲染", verifying: "校验成片", cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function BatchProductionDetails({ request, name, active, onBack, onUploads }: { request: BatchProductionDetailRequest; name: string; active: boolean; onBack(): void; onUploads?(): void }) {
  const { detail, error, setError } = useBatchProductionDetails(request, active);
  const artifact = async (id: string, reveal: boolean) => {
    try { if (reveal) await window.jianji.revealArtifact(id); else await window.jianji.openArtifact(id); }
    catch (cause) { setError(batchDetailError(cause)); }
  };
  return <>
    <button type="button" className="text-button batch-details-back" onClick={onBack}>← 返回批量列表</button>
    <Heading title={`${name} · 作品与导出`}>查看该商品本批每条视频的制作与导出进度；完成后可播放成片。</Heading>
    {error && <p className="notice error" role="alert">{error}</p>}
    {detail ? <BatchProductionWorkList detail={detail} onArtifact={(id, reveal) => void artifact(id, reveal)} onUploads={onUploads} /> : !error && <p role="status">正在读取作品…</p>}
  </>;
}

export function BatchProductionWorkList({ detail, onArtifact, onUploads }: { detail: BatchProductionDetail; onArtifact(id: string, reveal: boolean): void; onUploads?(): void }) {
  const { job, tasks, items, usesModel } = detail;
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const unqueued = items.filter(item => !item.taskId || !taskById.has(item.taskId));
  const completed = tasks.filter(task => task.status === "completed").length;
  const failed = tasks.filter(task => ["failed", "cancelled", "interrupted"].includes(task.status)).length
    + unqueued.filter(item => item.status === "failed" || item.status === "cancelled").length;
  const total = job.actualCount || job.requestedCount;
  const uploads = detail.upload?.tasks ?? [];
  const processing = uploads.filter(task => !qianchuanUploaded(task) && ["CONNECTING_BROWSER", "OPENING_UPLOAD_PAGE", "UPLOADING", "WAITING_UPLOAD_COMPLETE"].includes(task.state));
  const uploaded = uploads.filter(qianchuanUploaded).length;
  const pending = uploads.filter(task => task.state === "PENDING").length;
  const unknown = uploads.filter(task => task.upload_outcome === "MAY_HAVE_UPLOADED" && !qianchuanUploaded(task) && !processing.includes(task)).length;
  return <>
    <div className="result-stats"><div><span>本批制作</span><strong>{total}<small>条</small></strong></div><div><span>正在处理</span><strong>{Math.max(0, tasks.filter(task => !terminal.has(task.status)).length + unqueued.filter(item => !["failed", "cancelled"].includes(item.status)).length)}</strong></div><div><span>已完成</span><strong className="green-text">{completed}</strong></div><div><span>需要处理</span><strong className={failed ? "red-text" : ""}>{failed}</strong></div></div>
    {job.error && <p className="notice error">{job.error}</p>}
    {job.accountProduct && <div className="batch-upload-summary" aria-label="本批上传摘要">
      <p>千川上传：已上传 {uploaded} / {total} 条 · 待上传 {pending} 条 · 处理中 {processing.length} 条 · 结果未知 {unknown} 条</p>
      {onUploads && <button type="button" className="button secondary compact" onClick={onUploads}>查看本批上传任务</button>}
      {detail.upload?.message && <small>{detail.upload.message}</small>}
    </div>}
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
          <div className="result-info"><strong>{name}</strong><p>{task.errorMessage || task.coverSummary || "独立包装 · 成片"}</p><SourceStickerKnowledgeDetails progress={item?.sourceKnowledge} />{!terminal.has(task.status) && <progress aria-label={`${name}导出进度`} max={1} value={task.progress} />}</div>
          <span className={`status-tag ${task.status}`}>{task.status === "completed" && task.coverSummary ? "导出完成" : labels[task.status]}{task.status === "running" ? ` ${Math.round(task.progress * 100)}%` : ""}</span>
          {task.status === "completed" && <div className="row-actions"><button className="button secondary compact" onClick={() => onArtifact(task.id, false)}><Icon name="play" size={15} />播放</button><button className="icon-button" aria-label={`打开 ${name} 成片文件夹`} onClick={() => onArtifact(task.id, true)}><Icon name="folder" size={18} /></button></div>}
        </div>;
      })}
    </section>
  </>;
}
