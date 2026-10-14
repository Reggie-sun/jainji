import { useEffect, useRef, useState } from "react";
import type { DesktopState } from "../shared/desktop";
import type { QianchuanUploadTaskStatus } from "../shared/douyin-upload";
import { QIANCHUAN_QUERY_METRICS } from "../shared/qianchuan-backend";
import { joinQianchuanEffects } from "../shared/qianchuan-effect";
import { qianchuanUploadLabels } from "./qianchuan-upload-status";
import { collectMaterialEffects, type QianchuanEffectSnapshot } from "./qianchuan-effect-read";
import "./qianchuan-backend.css";

const chinaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const key = (task: QianchuanUploadTaskStatus) => `${task.accountProduct}:${task.advertiserId}:${task.adId}`;
export function QianchuanEffectLoop({ state, active, onNavigate, onProduction }: { state: DesktopState; active: boolean;
  onNavigate(page: "uploads" | "reports" | "accounts"): void; onProduction(): void }) {
  const all = [...(state.douyinUpload?.tasks ?? []), ...(state.douyinUpload?.closedBatches?.flatMap(batch => batch.tasks) ?? [])];
  const tasks = [...new Map(all.map(task => [task.upload_task_id, task])).values()];
  const targets = [...new Map(tasks.map(task => [key(task), task])).values()];
  const [targetKey, setTargetKey] = useState(""), [startDate, setStartDate] = useState(chinaDate), [endDate, setEndDate] = useState(chinaDate);
  const [snapshot, setSnapshot] = useState<QianchuanEffectSnapshot>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selected = targets.find(task => key(task) === targetKey);
  const account = state.douyinUpload?.accounts.find(account => account.product === selected?.accountProduct);
  const available = !!selected && !!account?.available && account.advertiserId === selected.advertiserId;
  const identity = `${targetKey}:${account?.advertiserId ?? ""}:${account?.available ?? false}:${active}`;
  const current = useRef<{ controller: AbortController; requestId?: string }>();
  const cancel = () => {
    const work = current.current; current.current = undefined; work?.controller.abort();
    if (work?.requestId) void window.jianji.cancelQianchuanBackendQuery({ requestId: work.requestId }).catch(() => undefined);
  };
  useEffect(() => { cancel(); setBusy(false); setSnapshot(undefined); setError(""); return cancel; }, [identity]);
  const clear = () => { cancel(); setBusy(false); setSnapshot(undefined); setError(""); };
  async function collect() {
    if (!active || !available || !selected || current.current) return;
    const work = { controller: new AbortController(), requestId: undefined as string | undefined }; current.current = work;
    const timer = setTimeout(() => { if (current.current === work) { cancel(); setBusy(false); setError("采集超过180秒，已停止；没有自动重试。"); } }, 180000);
    setBusy(true); setError(""); setSnapshot(undefined);
    try {
      const next = await collectMaterialEffects({ product: selected.accountProduct, expectedAdvertiserId: selected.advertiserId, adId: selected.adId,
        startDate, endDate, asOf: new Date().toISOString() }, async query => {
        work.controller.signal.throwIfAborted(); work.requestId = query.requestId;
        const result = await window.jianji.queryQianchuanBackend(query); work.requestId = undefined;
        return result;
      }, work.controller.signal);
      // Validate the complete association before publishing any metrics.
      joinQianchuanEffects(tasks, next);
      if (current.current === work) setSnapshot(next);
    } catch {
      if (current.current === work) setError("效果采集未完成，请检查冻结账户、计划、日期和正常登录后重新采集。未保存部分数据或自动重试。");
    } finally { clearTimeout(timer); if (current.current === work) { current.current = undefined; setBusy(false); } }
  }
  const selectedTasks = tasks.filter(task => key(task) === targetKey);
  let joined: ReturnType<typeof joinQianchuanEffects> = [];
  if (snapshot) { try { joined = joinQianchuanEffects(selectedTasks, snapshot); } catch { /* Changed observations do not create authority. */ } }
  const evidence = selected ? joinQianchuanEffects(selectedTasks, { advertiserId: selected.advertiserId, adId: selected.adId, rows: [] }) : [];
  const accepted = evidence.filter(row => row.status === "not-observed").length;
  return <section className="qianchuan-backend-panel qianchuan-effect-loop" aria-label="制作与效果闭环">
    <h2>制作与效果</h2><p>沿原制作和上传流程，把平台接收的视频与真实素材效果关联。接受不代表审核通过或产生成交。</p>
    <div className="qianchuan-effect-steps"><span>① 成片验证</span><span>② 原计划上传</span><span>③ 平台接收回执</span><span>④ 素材效果采集</span></div>
    <div className="qianchuan-query-actions"><button type="button" className="button" onClick={onProduction}>制作并配置上传</button>
      <button type="button" className="button secondary" onClick={() => onNavigate("uploads")}>查看上传与接收</button>
      <button type="button" className="button secondary" onClick={() => onNavigate("reports")}>计划 · ROI · 预算查询</button></div>
    {!targets.length ? <p>尚无本地上传记录。请在制作页明确选择账户和计划并启用上传；已存在的记录会沿原账本出现在这里。</p> : <>
      <div className="qianchuan-query-fields"><label>冻结投放目标<select aria-label="效果采集目标" value={targetKey} disabled={busy} onChange={event => { clear(); setTargetKey(event.target.value); }}><option value="">请选择已有上传目标</option>
        {targets.map(task => <option key={key(task)} value={key(task)}>{task.accountProduct} · 账户 {task.advertiserId} · 计划 {task.adId}</option>)}</select></label>
        <label>开始日期<input aria-label="效果开始日期" type="date" value={startDate} disabled={busy} onChange={event => { clear(); setStartDate(event.target.value); }} /></label>
        <label>结束日期<input aria-label="效果结束日期" type="date" value={endDate} disabled={busy} onChange={event => { clear(); setEndDate(event.target.value); }} /></label></div>
      {selected && <p>冻结账户 {selected.advertiserId} / 计划 {selected.adId} · 本地记录 {selectedTasks.length} 条 · 平台接受 {accepted} 条</p>}
      {selected && !available && <p role="alert">保存的账户槽位已变化或不可用，不能用新账户读取旧目标。请在账号与计划中核对原目标。</p>}
      <div className="qianchuan-query-actions"><button type="button" className="button" disabled={busy || !active || !available} onClick={() => void collect()}>采集素材效果</button>
        {busy && <button type="button" className="button secondary" onClick={() => { clear(); setError("采集已取消，没有继续请求后续页面。"); }}>取消效果采集</button>}</div>
      <p>北京时间，最多31天；单次最多2000条、180秒。今日跨页使用同一截止时刻；只读，不修改预算、ROI或投放。</p>
      {busy && <p role="status">正在核对并采集全部素材页…</p>}{error && <p role="alert">{error}</p>}
      {snapshot && <p>采集到 {snapshot.total} 条计划素材 · {snapshot.startTime} 至 {snapshot.endTime} · 已关联 {joined.filter(row => row.status === "matched").length} 条本地记录。未匹配不代表未投放或上传失败。</p>}
      {selected && <div className="qianchuan-query-table"><table><thead><tr><th>成片 / 冻结身份</th><th>上传与效果状态</th><th>素材效果</th></tr></thead><tbody>{selectedTasks.map(task => {
        const effect = joined.find(row => row.task.upload_task_id === task.upload_task_id) ?? evidence.find(row => row.task.upload_task_id === task.upload_task_id);
        return <tr key={task.upload_task_id}><td>{task.file_name}<br /><small>项目 {task.project_id}<br />批次 {task.batch_id}<br />导出任务 {task.export_task_id}</small></td>
          <td>{qianchuanUploadLabels[task.state]} · {task.upload_outcome}{task.acceptedEvidence && <><br /><small>视频 {task.acceptedEvidence.platformVideoId}</small></>}
            <br />{effect?.status === "matched" ? "已精确关联视频" : effect?.status === "invalid-evidence" ? "接收证据无法核对" : task.state !== "ACCEPTED" ? "等待原上传流程明确结果" : snapshot ? "本次范围未关联到素材" : "等待效果采集"}</td>
          <td>{effect?.materials.map(material => <div key={material.materialId}><strong>素材 {material.materialId}</strong><dl className="qianchuan-query-metrics">{QIANCHUAN_QUERY_METRICS.map((metric, i) => <div key={metric}><dt>{["消耗", "成交订单", "含券成交额", "支付ROI"][i]}</dt><dd>{material.metrics[metric].display}</dd></div>)}</dl></div>) ?? "—"}</td></tr>;
      })}</tbody></table></div>}
    </>}
  </section>;
}
