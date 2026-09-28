import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { BatchProductionStartSchema, type BatchProductionEntry, type BatchProjectOption } from "../shared/batch-production";
import { calculateExactProductionQuantity, MAX_AGENT_OUTPUTS } from "../shared/agent";
import { PRODUCT_PRICE_MAX_LENGTH } from "../shared/decorations";
import { Heading, Icon } from "./ui";
import { BatchProductionDetails } from "./BatchProductionDetails";
import "./batch-production.css";

type Row = BatchProjectOption & { selected: boolean; outputDirectory?: string };
const labels = { queued: "等待制作", preparing: "检查模板", producing: "正在制作", exporting: "正在导出", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
const modeLabels = { manual: "自己设置", agent: "全部交给 Agent", random: "本地随机" };

export function BatchProductionPanel({ state, visible, onState }: { state: DesktopState; visible: boolean; onState(state: DesktopState): void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancellingJobs, setCancellingJobs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<{ runId: string; jobId: string; name: string }>();
  useEffect(() => { setDetail(undefined); }, [state.batchProduction?.id]);
  const projectKey = (state.recentProjects ?? []).map(item => `${item.id}:${item.name}:${item.mediaCount}`).join("|");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    void window.jianji.batchProductionProjects().then(projects => {
      if (active) setRows(current => projects.map(project => {
        const draft = current.find(row => row.recentProjectId === project.recentProjectId);
        return { ...project, selected: draft?.selected ?? false, ...(draft ? { requestedCount: draft.requestedCount,
          productPrice: draft.productPrice, coverEnabled: draft.coverEnabled, displayMode: draft.displayMode, mode: draft.mode, outputDirectory: draft.outputDirectory } : {}) };
      }));
    }).catch(value => { if (active) setError(message(value)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectKey, revision, visible]);
  const update = (id: string, next: Partial<Row>) => setRows(current => current.map(row => row.recentProjectId === id ? { ...row, ...next } : row));
  const selected = rows.filter(row => row.selected);
  const entries: BatchProductionEntry[] = selected.map(row => ({ recentProjectId: row.recentProjectId, requestedCount: row.requestedCount,
    productPrice: row.productPrice, coverEnabled: row.coverEnabled, displayMode: row.displayMode, mode: row.mode,
    ...(row.outputDirectory ? { outputDirectory: row.outputDirectory } : {}) }));
  const valid = BatchProductionStartSchema.safeParse({ entries }).success && selected.every(row => {
    const quantity = calculateExactProductionQuantity(row.sourceCount, row.requestedCount);
    return !row.error && quantity && quantity.total <= MAX_AGENT_OUTPUTS;
  });
  const run = state.batchProduction;
  const running = run?.status === "running" || run?.status === "cancelling";
  const exporting = state.queue.batches.some(({ batch }) => batch.tasks.some(task => !["completed", "failed", "cancelled", "interrupted"].includes(task.status)));
  const start = async () => {
    if (!valid || busy || running) return;
    setBusy(true); setError("");
    try { onState(await window.jianji.startBatchProduction({ entries })); }
    catch (value) { setError(message(value)); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setStopping(true); setError("");
    try { onState(await window.jianji.cancelBatchProduction()); }
    catch (value) { setError(message(value)); }
    finally { setStopping(false); }
  };
  const cancelJob = async (runId: string, jobId: string) => {
    setCancellingJobs(current => [...current, jobId]); setError("");
    try { onState(await window.jianji.cancelBatchProductionJob({ runId, jobId })); }
    catch (value) { setError(message(value)); }
    finally { setCancellingJobs(current => current.filter(id => id !== jobId)); }
  };
  const selectOutput = async (row: Row) => {
    setBusy(true); setError("");
    try { const directory = await window.jianji.selectOutputDirectory(); if (directory) update(row.recentProjectId, { outputDirectory: directory }); }
    catch (value) { setError(message(value)); }
    finally { setBusy(false); }
  };
  const artifact = async (id: string, reveal: boolean) => {
    try { if (reveal) await window.jianji.revealArtifact(id); else await window.jianji.openArtifact(id); }
    catch (value) { setError(message(value)); }
  };
  const total = selected.reduce((sum, row) => sum + (calculateExactProductionQuantity(row.sourceCount, row.requestedCount)?.total ?? 0), 0);
  if (!visible) return null;
  if (detail) return <BatchProductionDetails request={detail} name={detail.name} onBack={() => setDetail(undefined)} />;
  return <>
    <Heading title="批量制作">选择不同商品的已保存模板，按列表顺序逐项制作。上一项全部导出并校验后才开始下一项；失败会记录原因并继续。</Heading>
    <div className="card batch-production-intro"><div><strong>每个商品单独设置，统一开始</strong><p>逐项选择制作模式；覆盖方式、位置和导出画质沿用模板。价格显示时段只控制后期展示文字，贴纸保留原有时序。</p><small>使用已保存内容，当前项目未保存的修改不参与本批。{running ? "现在编辑下方设置只影响下一批。" : "自动保存到各商品的“视频”目录，也可以逐项选择文件夹。"}</small></div><button className="button secondary compact" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><Icon name="folder" size={16} />刷新模板</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {state.batchProductionWarning && <div className="notice error" role="alert">{state.batchProductionWarning}</div>}
    {loading && <p role="status">正在读取已保存模板…</p>}
    {!loading && !rows.length && <div className="card empty-material"><Icon name="folder" /><p>还没有已保存的素材模板</p><small>先在“制作”页面导入商品素材，设置价格与包装并保存项目，再回来批量选择。</small></div>}
    <div className="batch-production-list" aria-label="批量模板设置">
      {rows.map((row, index) => {
        const quantity = calculateExactProductionQuantity(row.sourceCount, row.requestedCount);
        const invalidQuantity = !quantity || quantity.total > MAX_AGENT_OUTPUTS;
        const prefix = `batch-${row.recentProjectId}`;
        return <section className={`card batch-template-row${row.selected ? " selected" : ""}`} key={row.recentProjectId} aria-label={`${row.name}制作设置`}>
          <div className="batch-template-title"><label><input type="checkbox" aria-label={`选择模板 ${row.name}`} checked={row.selected} disabled={busy || Boolean(row.error)} onChange={event => update(row.recentProjectId, { selected: event.target.checked })} /><span className="batch-order">{index + 1}</span><strong>{row.name}</strong></label><span className="small-tag">{modeLabels[row.mode]} · {row.sourceCount} 条素材</span></div>
          {row.error ? <p className="batch-error">{row.error}</p> : <>
            <div className="batch-mode-select" role="group" aria-label={`${row.name}制作模式`}>
              {(["agent", "manual", "random"] as const).map(mode => <button type="button" className={`button secondary${row.mode === mode ? " active" : ""}`} aria-pressed={row.mode === mode} disabled={busy} key={mode} onClick={() => update(row.recentProjectId, { mode })}>{modeLabels[mode]}</button>)}
              <small>{row.coverEnabled && row.coverMode === "agent" ? "模板使用 Agent 自动覆盖，仍需模型识别与复核。切换为手动覆盖请先在制作页面设置并保存模板。" : row.mode === "agent" ? "由模型分析画面并设计包装。" : row.mode === "random" ? "本地随机分配贴纸与价格样式，不调用模型。" : "使用模板保存的手动外观设置。"}</small>
            </div>
            <div className="batch-template-controls">
              <label htmlFor={`${prefix}-count`}>想制作的视频条数<input id={`${prefix}-count`} aria-label="想制作的视频条数" type="number" min={1} max={MAX_AGENT_OUTPUTS} step={1} placeholder="例如 100，可大于素材数量" value={Number.isFinite(row.requestedCount) ? row.requestedCount : ""} disabled={busy} onChange={event => update(row.recentProjectId, { requestedCount: event.target.valueAsNumber })} /><small>严格按填写数量制作，最后一轮仅制作所需条数</small><small>{invalidQuantity ? `请填写有效条数，最多 ${MAX_AGENT_OUTPUTS} 条` : `实际制作 ${quantity.total} 条（使用 ${Math.min(row.sourceCount, quantity.total)} 条素材）`}</small></label>
              <label htmlFor={`${prefix}-price`}>展示文字 / 价格<textarea id={`${prefix}-price`} rows={2} value={row.productPrice} maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={busy} onChange={event => update(row.recentProjectId, { productPrice: event.target.value })} placeholder="手动填写，最多 2 行、每行 12 字" /></label>
              <label htmlFor={`${prefix}-timing`}>价格显示时段<select id={`${prefix}-timing`} value={row.displayMode} disabled={busy} onChange={event => update(row.recentProjectId, { displayMode: event.target.value as Row["displayMode"] })}><option value="full">全程显示</option><option value="first-5s">仅前 5 秒（渐隐）</option></select></label>
              <label className="batch-cover-toggle"><span>覆盖原贴纸</span><span><input type="checkbox" aria-label={`${row.name}开启覆盖`} checked={row.coverEnabled} disabled={busy} onChange={event => update(row.recentProjectId, { coverEnabled: event.target.checked })} />开启覆盖</span><small>沿用模板保存的覆盖方式和位置；缺少配置会明确失败。</small></label>
            </div>
            <div className="batch-output"><span><Icon name="folder" size={16} />{row.outputDirectory || "自动保存到该商品的 视频/M.D HH:MM"}</span><button type="button" className="text-button" disabled={busy} onClick={() => void selectOutput(row)}>选择目录</button>{row.outputDirectory && <button type="button" className="text-button" disabled={busy} onClick={() => update(row.recentProjectId, { outputDirectory: undefined })}>改为自动保存</button>}</div>
          </>}
        </section>;
      })}
    </div>
    <div className="step-footer"><div><strong>已选择 {selected.length} 个模板，共制作 {total} 条视频</strong><small>开始后仍可编辑下一批参数；当前任务保留开始时的设置。失败项不会自动重试。</small></div><button className="button primary" disabled={busy || loading || running || exporting || state.agentRun?.status === "running" || !state.capabilities.ready || Boolean(state.batchProductionWarning) || !valid} onClick={() => void start()}><Icon name="play" size={18} />{busy ? "正在准备…" : running ? "批量制作中" : "开始批量制作"}</button></div>
    {run && <section className="card batch-production-results" aria-label="批量制作进度"><div className="card-header"><h2>{running ? "批量制作进行中" : run.status === "interrupted" ? "上次批量制作已中断" : run.status === "cancelled" ? "批量制作已停止" : "批量制作结果"}</h2>{running && <button className="button secondary compact" disabled={stopping || run.status === "cancelling"} onClick={() => void stop()}>{stopping || run.status === "cancelling" ? "正在停止…" : "停止整批"}</button>}</div>{run.error && <p className="batch-error">{run.error}</p>}
      {run.jobs.map((job, index) => <div className="batch-result-row" key={job.id}><span className="batch-order">{index + 1}</span><div className="batch-result-info"><button type="button" className="text-button batch-result-name" aria-label={`查看 ${job.name} 作品`} onClick={() => setDetail({ runId: run.id, jobId: job.id, name: job.name })}>{job.name}</button><p>{job.completedCount} / {job.actualCount || job.requestedCount} 条完成{job.mode && ` · ${modeLabels[job.mode]}`} · 覆盖{job.coverEnabled ? "开启" : "关闭"} · 价格{job.displayMode === "full" ? "全程" : "前 5 秒"}</p>{job.error && <small className="batch-error">{job.error}</small>}{job.outputDirectory && <small>{job.outputDirectory}</small>}</div><span className={`status-tag ${job.status}`}>{labels[job.status]}</span>{running && ["queued", "preparing", "producing", "exporting"].includes(job.status) && <button type="button" className="text-button" aria-label={`取消 ${job.name} 制作`} disabled={stopping || run.status === "cancelling" || cancellingJobs.includes(job.id)} onClick={() => void cancelJob(run.id, job.id)}>{cancellingJobs.includes(job.id) ? "正在取消…" : "取消该项"}</button>}<button type="button" className="text-button" onClick={() => setDetail({ runId: run.id, jobId: job.id, name: job.name })}>查看作品</button>{job.completedTaskIds?.[0] && <div className="row-actions"><button className="text-button" onClick={() => void artifact(job.completedTaskIds![0], false)}>播放首条</button><button className="icon-button" aria-label={`打开 ${job.name} 成片文件夹`} onClick={() => void artifact(job.completedTaskIds![0], true)}><Icon name="folder" size={18} /></button></div>}</div>)}
    </section>}
  </>;
}

function message(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "操作未完成，请重试。"; }
