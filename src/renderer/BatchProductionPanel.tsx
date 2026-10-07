import { useEffect, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import { BatchProductionStartSchema, batchRequiresDisplayText, batchLocalCoverError, type BatchProjectOption } from "../shared/batch-production";
import { calculateExactProductionQuantity, MAX_AGENT_OUTPUTS } from "../shared/agent";
import { PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP, RequiredProductPriceSchema } from "../shared/decorations";
import { Heading, Icon } from "./ui";
import { BatchProductionDetails } from "./BatchProductionDetails";
import { resolveBatchUploadAccount } from "../shared/batch-upload";
import type { QianchuanProduct } from "../shared/qianchuan-account";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection";
import { QianchuanPlanSelect } from "./QianchuanPlanSelect";
import "./batch-production.css";

type Row = BatchProjectOption & { selected: boolean; outputDirectory?: string; uploadEnabled: boolean; uploadPlan?: QianchuanPlanOption };
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
        return { ...project, selected: draft?.selected ?? false, uploadEnabled: draft?.uploadEnabled ?? true, ...(draft ? { requestedCount: draft.requestedCount,
          productPrice: draft.productPrice, coverEnabled: draft.coverEnabled, coverMethod: draft.coverMethod, displayMode: draft.displayMode, mode: draft.mode, outputDirectory: draft.outputDirectory, uploadPlan: draft.uploadPlan,
          } : {}) };
      }));
    }).catch(value => { if (active) setError(message(value)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectKey, revision, visible]);
  const update = (id: string, next: Partial<Row>) => setRows(current => current.map(row => row.recentProjectId === id ? { ...row, ...next } : row));
  const selected = rows.filter(row => row.selected);
  const bindingReady = typeof window.jianji.saveBatchUploadAccount === "function";
  const accountFor = (row: Row) => row.uploadBindingError
    ? { error: row.uploadBindingError, accountProduct: undefined }
    : resolveBatchUploadAccount(row.name, state.douyinUpload?.accounts ?? [], row.uploadBinding);
  const uploadSelection = (row: Row) => {
    if (!row.uploadEnabled || !state.douyinUpload?.config.enabled) return undefined;
    const account = accountFor(row);
    return account.accountProduct ? { enabled: true as const, accountProduct: account.accountProduct, ...(row.uploadPlan ? { plan: row.uploadPlan } : {}) } : undefined;
  };
  const entries = selected.map(row => ({ recentProjectId: row.recentProjectId, requestedCount: row.requestedCount,
    productPrice: batchRequiresDisplayText(row) ? row.productPrice : "", coverEnabled: row.coverEnabled, coverMethod: row.coverMethod, displayMode: row.displayMode, mode: row.mode,
    ...(uploadSelection(row) ? { douyinUpload: uploadSelection(row) } : {}),
    ...(row.outputDirectory ? { outputDirectory: row.outputDirectory } : {}) }));
  const entryValidation = BatchProductionStartSchema.safeParse({ entries });
  const rowErrors = selected.flatMap(row => {
    const quantity = calculateExactProductionQuantity(row.sourceCount, row.requestedCount);
    const account = accountFor(row);
    const uploadAccount = (state.douyinUpload?.accounts ?? []).find(value => value.product === account.accountProduct);
    const errors = [row.error, batchLocalCoverError(row)];
    if (!quantity || quantity.total > MAX_AGENT_OUTPUTS) errors.push(`请填写有效条数，最多 ${MAX_AGENT_OUTPUTS} 条。`);
    if (batchRequiresDisplayText(row) && !RequiredProductPriceSchema.safeParse(row.productPrice).success) errors.push(PRODUCT_PRICE_HELP);
    if (row.uploadEnabled && state.douyinUpload?.config.enabled) {
      if (account.error) errors.push(account.error);
      else if (!row.uploadPlan) errors.push("尚未选择上传计划，请点击下拉框选择计划，或关闭本项千川上传。");
      else if (row.uploadPlan.advertiserId !== uploadAccount?.advertiserId) errors.push("上传计划不属于当前账号，请重新选择计划。");
    }
    return errors.filter((value): value is string => Boolean(value)).map(message => ({ name: row.name, message }));
  });
  const valid = entryValidation.success && rowErrors.length === 0;
  const run = state.batchProduction;
  const running = run?.status === "running" || run?.status === "cancelling";
  const exporting = state.queue.batches.some(({ batch }) => batch.tasks.some(task => !["completed", "failed", "cancelled", "interrupted"].includes(task.status)));
  const startReasons = [
    ...(busy ? ["正在准备，请稍候。"] : []),
    ...(loading ? ["正在读取模板，请稍候。"] : []),
    ...(running ? ["当前批量制作尚未结束，请等待完成或停止整批。"] : []),
    ...(exporting ? ["仍有视频等待导出或正在导出，请等待完成。"] : []),
    ...(state.agentRun?.status === "running" ? ["当前 Agent 制作尚未结束，请等待完成。"] : []),
    ...(!state.capabilities.ready ? ["本地制作环境尚未就绪，请检查页面顶部的环境提示。"] : []),
    ...(state.batchProductionWarning ? [state.batchProductionWarning] : []),
    ...(!selected.length ? ["请先选择要制作的模板。"] : rowErrors.map(({ name, message }) => `${name}：${message}`)),
    ...(!entryValidation.success && selected.length && !rowErrors.length ? ["制作参数无效，请检查所选模板的设置。"] : []),
  ];
  const firstRowError = rowErrors[0];
  const startHint = firstRowError && startReasons[0] === `${firstRowError.name}：${firstRowError.message}`
    ? `${rowErrors.filter(error => error.message === firstRowError.message).length} 个模板：${firstRowError.message}`
    : startReasons[0];
  const start = async () => {
    if (!valid || busy || running) return;
    setBusy(true); setError("");
    try {
      onState(await window.jianji.startBatchProduction(BatchProductionStartSchema.parse({ entries })));
    }
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
  const selectAccount = async (row: Row, product: QianchuanProduct) => {
    const account = state.douyinUpload?.accounts?.find(account => account.product === product && account.available);
    if (!account || !row.projectId || busy) return;
    setBusy(true); setError("");
    try {
      const uploadBinding = await window.jianji.saveBatchUploadAccount({ recentProjectId: row.recentProjectId, expectedProjectId: row.projectId,
        accountProduct: product, expectedAdvertiserId: account.advertiserId });
      update(row.recentProjectId, { uploadBinding, uploadBindingError: undefined, uploadPlan: undefined });
    } catch (value) { setError(message(value)); }
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
    <div className="batch-production-heading"><Heading title="批量制作">选择不同商品的已保存模板，按列表顺序逐项制作。上一项全部导出并校验后才开始下一项；失败会记录原因并继续。</Heading><button className="button secondary compact" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><Icon name="folder" size={16} />刷新模板</button></div>
    <p>每个模板选择上传账号后会自动保存；多个模板可以使用同一个账号。{state.douyinUpload?.config.enabled ? "每组最多 9 条，成功后继续，停在确定前。" : "全局千川上传已关闭；仍可先保存模板与账号的关联。"}</p>
    {!bindingReady && <p role="status">账号关联功能等待当前制作结束后加载，请保留正在进行的任务。</p>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {state.batchProductionWarning && <div className="notice error" role="alert">{state.batchProductionWarning}</div>}
    {loading && <p role="status">正在读取已保存模板…</p>}
    {!loading && !rows.length && <div className="card empty-material"><Icon name="folder" /><p>还没有已保存的素材模板</p><small>先在“制作”页面导入商品素材，设置价格与包装并保存项目，再回来批量选择。</small></div>}
    <div className="batch-production-list" aria-label="批量模板设置">
      {rows.map((row, index) => {
        const quantity = calculateExactProductionQuantity(row.sourceCount, row.requestedCount);
        const invalidQuantity = !quantity || quantity.total > MAX_AGENT_OUTPUTS;
        const needsText = batchRequiresDisplayText(row);
        const invalidText = needsText && !RequiredProductPriceSchema.safeParse(row.productPrice).success;
        const coverError = batchLocalCoverError(row);
        const prefix = `batch-${row.recentProjectId}`;
        const uploadAccount = accountFor(row);
        const uploadError = row.uploadEnabled && state.douyinUpload?.config.enabled ? uploadAccount.error : undefined;
        const planAccount = state.douyinUpload?.accounts?.find(account => account.product === uploadAccount.accountProduct);
        return <section className={`card batch-template-row${row.selected ? " selected" : ""}`} key={row.recentProjectId} aria-label={`${row.name}制作设置`}>
          <div className="batch-template-title"><label><input type="checkbox" aria-label={`选择模板 ${row.name}`} checked={row.selected} disabled={busy || Boolean(row.error)} onChange={event => update(row.recentProjectId, { selected: event.target.checked })} /><span className="batch-order">{index + 1}</span><span className="batch-template-name"><strong title={row.name}>{row.name}</strong><span className="small-tag">{row.sourceCount} 条素材</span></span></label></div>
          {row.error ? <p className="batch-error">{row.error}</p> : <>
            <div className="batch-mode-select" role="group" aria-label={`${row.name}制作模式`}>
              {(["agent", "manual", "random"] as const).map(mode => <button type="button" className={`button secondary${row.mode === mode ? " active" : ""}`} aria-pressed={row.mode === mode} disabled={busy} key={mode} onClick={() => update(row.recentProjectId, { mode })}>{modeLabels[mode]}</button>)}
            </div>
            <div className="batch-template-controls">
              <label htmlFor={`${prefix}-count`}>条数<input id={`${prefix}-count`} aria-label="想制作的视频条数" type="number" min={1} max={MAX_AGENT_OUTPUTS} step={1} placeholder="例如 100" value={Number.isFinite(row.requestedCount) ? row.requestedCount : ""} disabled={busy} onChange={event => update(row.recentProjectId, { requestedCount: event.target.valueAsNumber })} />{invalidQuantity && <small className="batch-error" role="alert">请填写有效条数，最多 {MAX_AGENT_OUTPUTS} 条</small>}</label>
              <label htmlFor={`${prefix}-price`}>展示文字 / 价格<textarea id={`${prefix}-price`} rows={2} value={row.productPrice} maxLength={PRODUCT_PRICE_MAX_LENGTH} required={needsText} aria-invalid={row.selected && invalidText} disabled={busy || !needsText} onChange={event => update(row.recentProjectId, { productPrice: event.target.value })} placeholder={needsText ? "手动填写，最多 2 行、每行 12 字" : "模板已关闭展示文字"} />{!needsText && <small>沿用模板：本轮素材不显示文字</small>}{row.selected && invalidText && <small className="batch-error" role="alert">{PRODUCT_PRICE_HELP}</small>}</label>
              <label htmlFor={`${prefix}-timing`}>价格显示时段<select id={`${prefix}-timing`} value={row.displayMode} disabled={busy} onChange={event => update(row.recentProjectId, { displayMode: event.target.value as Row["displayMode"] })}><option value="full">全程显示</option><option value="first-5s">仅前 5 秒（渐隐）</option></select></label>
              <div className="batch-cover-settings"><label className="batch-cover-toggle"><span>覆盖原贴纸</span><span><input type="checkbox" aria-label={`${row.name}开启覆盖`} checked={row.coverEnabled} disabled={busy} onChange={event => update(row.recentProjectId, { coverEnabled: event.target.checked })} />开启</span></label>
              <label><span>覆盖方式</span><select aria-label={`${row.name}覆盖方式`} value={row.coverMethod ?? "saved"} disabled={busy || !row.coverEnabled} onChange={event => update(row.recentProjectId, { coverMethod: event.target.value as Row["coverMethod"] })}><option value="saved">沿用模板设置</option><option value="real-artwork">手动框 · 真实贴纸覆盖</option></select></label>
              {row.coverEnabled && row.coverMethod === "real-artwork" && <small>使用已保存覆盖框直接制作；无框不覆盖。调整框请在制作页打开并保存素材集。</small>}</div>
              <div className="batch-upload-account">
                <label className="batch-upload-toggle"><span>千川上传</span><span><input type="checkbox" aria-label={`${row.name}开启千川上传`} checked={row.uploadEnabled} disabled={busy || !state.douyinUpload?.config.enabled} onChange={event => update(row.recentProjectId, { uploadEnabled: event.target.checked })} /><span>{!state.douyinUpload?.config.enabled ? "全局已关闭" : row.uploadEnabled ? "自动上传" : "不上传"}</span></span></label>
                <select aria-label={`${row.name}上传账号`} value={uploadAccount.error ? "" : uploadAccount.accountProduct ?? ""} disabled={busy || !bindingReady} onChange={event => void selectAccount(row, event.target.value as QianchuanProduct)}>
                  <option value="" disabled>请选择上传账号</option>
                  {(state.douyinUpload?.accounts ?? []).map(account => <option key={account.product} value={account.product} disabled={!account.available}>{account.productName ?? account.product} · {account.advertiserId || "未配置"}{!account.available && "（不可用）"}</option>)}
                </select>
                {row.uploadEnabled && state.douyinUpload?.config.enabled && <QianchuanPlanSelect key={`${planAccount?.product}:${planAccount?.advertiserId}`} compact account={planAccount} value={row.uploadPlan} disabled={busy || running} idPrefix={prefix} onChange={uploadPlan => update(row.recentProjectId, { uploadPlan })} />}
                {!uploadAccount.error && <small>{row.uploadBinding ? "已保存关联" : "同名匹配，可改选账号"}</small>}
              </div>
            </div>
            {coverError && <p className="batch-error" role="alert">{coverError}</p>}
            {uploadError && <p className="batch-error" role="alert">{uploadError}</p>}
            <div className="batch-output"><button type="button" className="icon-button" aria-label="选择目录" title={row.outputDirectory || "选择目录"} disabled={busy} onClick={() => void selectOutput(row)}><Icon name="folder" size={16} /></button>{row.outputDirectory && <button type="button" className="text-button" aria-label="改为自动保存" title="改为自动保存" disabled={busy} onClick={() => update(row.recentProjectId, { outputDirectory: undefined })}>自动</button>}</div>
          </>}
        </section>;
      })}
    </div>
    <div className="step-footer"><div style={{ minWidth: 0 }}><strong>已选择 {selected.length} 个模板，共制作 {total} 条视频</strong><small>开始后仍可编辑下一批参数；当前任务保留开始时的设置。失败项不会自动重试。</small></div><div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>{startHint && <small id="batch-start-reasons" role="status" aria-live="polite" title={startReasons.join("\n")} style={{ color: "#b14444", marginTop: 0, maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{startHint}</small>}<button className="button primary" style={{ flexShrink: 0 }} aria-describedby={startHint ? "batch-start-reasons" : undefined} disabled={busy || loading || running || exporting || state.agentRun?.status === "running" || !state.capabilities.ready || Boolean(state.batchProductionWarning) || !valid} onClick={() => void start()}><Icon name="play" size={18} />{busy ? "正在准备…" : running ? "批量制作中" : "开始批量制作"}</button></div></div>
    {run && <section className="card batch-production-results" aria-label="批量制作进度"><div className="card-header"><h2>{running ? "批量制作进行中" : run.status === "interrupted" ? "上次批量制作已中断" : run.status === "cancelled" ? "批量制作已停止" : "批量制作结果"}</h2>{running && <button className="button secondary compact" disabled={stopping || run.status === "cancelling"} onClick={() => void stop()}>{stopping || run.status === "cancelling" ? "正在停止…" : "停止整批"}</button>}</div>{run.error && <p className="batch-error">{run.error}</p>}
      {run.jobs.map((job, index) => <div className="batch-result-row" key={job.id}><span className="batch-order">{index + 1}</span><div className="batch-result-info"><button type="button" className="text-button batch-result-name" aria-label={`查看 ${job.name} 作品`} onClick={() => setDetail({ runId: run.id, jobId: job.id, name: job.name })}>{job.name}</button><p>{job.completedCount} / {job.actualCount || job.requestedCount} 条完成{job.mode && ` · ${modeLabels[job.mode]}`} · 覆盖{job.coverEnabled ? "开启" : "关闭"} · 价格{job.displayMode === "full" ? "全程" : "前 5 秒"}</p>{job.error && <small className="batch-error">{job.error}</small>}{job.outputDirectory && <small>{job.outputDirectory}</small>}</div><span className={`status-tag ${job.status}`}>{labels[job.status]}</span>{running && ["queued", "preparing", "producing", "exporting"].includes(job.status) && <button type="button" className="text-button" aria-label={`取消 ${job.name} 制作`} disabled={stopping || run.status === "cancelling" || cancellingJobs.includes(job.id)} onClick={() => void cancelJob(run.id, job.id)}>{cancellingJobs.includes(job.id) ? "正在取消…" : "取消该项"}</button>}<button type="button" className="text-button" onClick={() => setDetail({ runId: run.id, jobId: job.id, name: job.name })}>查看作品</button>{job.completedTaskIds?.[0] && <div className="row-actions"><button className="text-button" onClick={() => void artifact(job.completedTaskIds![0], false)}>播放首条</button><button className="icon-button" aria-label={`打开 ${job.name} 成片文件夹`} onClick={() => void artifact(job.completedTaskIds![0], true)}><Icon name="folder" size={18} /></button></div>}</div>)}
    </section>}
  </>;
}

function message(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "操作未完成，请重试。"; }
