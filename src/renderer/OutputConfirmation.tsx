import { calculateProductionQuantity, MAX_AGENT_OUTPUTS } from "../shared/agent";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, type ExportFormat } from "../shared/export-format";
import { DEFAULT_EXPORT_SETTINGS } from "../shared/export-settings";
import { ExportSettingsPanel } from "./ExportSettingsPanel";
import type { TemplatePanelProps } from "./TemplatePanel";
import { Heading, Icon } from "./ui";

type Props = Pick<TemplatePanelProps, "outputDirectory" | "automaticOutput" | "onAutomaticOutput" | "onOutput" | "exportFormat" | "onExportFormat" | "exportSettings" | "onExportSettings" | "disabled" | "requestedCount" | "onRequestedCount" | "count" | "usesModel" | "uploadControls" | "startDisabled" | "onStart" | "reviewRequired" | "coverDirty" | "decorationOptions" | "startReasons" | "onFix" | "coverSummary">;
export function OutputConfirmation({ outputDirectory, automaticOutput, onAutomaticOutput, onOutput, exportFormat, onExportFormat, exportSettings = DEFAULT_EXPORT_SETTINGS, onExportSettings, disabled, count, requestedCount = count, onRequestedCount, usesModel, uploadControls, startDisabled, onStart, reviewRequired, coverDirty, decorationOptions, startReasons = [], onFix, coverSummary }: Props) {
  const quantity = calculateProductionQuantity(count, requestedCount);
  const invalidQuantity = !quantity || quantity.total > MAX_AGENT_OUTPUTS;
  const total = quantity?.total ?? 0;
  const fallbackReasons: NonNullable<TemplatePanelProps["startReasons"]> = [
    ...(!count ? [{message:"请先选择要制作的素材。", section:"materials" as const}] : []),
    ...(coverDirty ? [{message:"覆盖设置有未保存的修改。", section:"cover" as const}] : []),
    ...(invalidQuantity ? [{message:"请填写有效的制作条数。", section:"export" as const,selector:"#production-count"}] : []),
    ...(!automaticOutput && !outputDirectory ? [{message:"请选择成片保存目录。",section:"export" as const,selector:".directory-picker"}] : []),
  ];
  const reasons = [...startReasons, ...fallbackReasons];
  return <>
    <Heading title="输出确认">核对本轮设置，再开始制作。切页不会保存、批准或启动任务。</Heading>
    <div className="card production-summary"><h2>本轮制作</h2><p>{count} 条素材 · {decorationOptions?.mode === "agent" ? "全部交给 Agent" : decorationOptions?.mode === "manual" ? "自己设置" : "本地随机"} · {coverSummary ?? "沿用已保存覆盖设置"}</p><p>展示文字：{decorationOptions?.productPrice || "未填写；关闭文字的素材不添加文字"}</p><small>{usesModel ? "本轮包含模型分析；冻结后重试复用原方案。" : "本轮本地制作，不调用模型。"}</small></div>
    <div className="card export-card"><h3>成片保存到</h3><button className="directory-picker" disabled={disabled} onClick={onOutput}><Icon name="folder" /><span>{outputDirectory || (automaticOutput ? "自动创建 视频/M.D HH:MM" : "选择本地文件夹")}</span><Icon name="arrow" size={16} /></button>{automaticOutput ? <small>开始制作时根据素材位置自动创建；点上方可改为手动选择。</small> : <button type="button" className="text-button" disabled={disabled || !onAutomaticOutput} onClick={onAutomaticOutput}>改为自动创建目录</button>}<label className="export-format" htmlFor="export-format">导出格式<select id="export-format" value={exportFormat} disabled={disabled} onChange={(event) => onExportFormat(event.target.value as ExportFormat)}>{EXPORT_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}{format === DEFAULT_EXPORT_FORMAT ? "（默认）" : ""}</option>)}</select></label><ExportSettingsPanel value={exportSettings} onChange={(value) => onExportSettings?.(value)} disabled={disabled || !onExportSettings} /></div>
    <div className="card brief-card"><label htmlFor="production-count">想制作多少条视频？</label><input id="production-count" type="number" min={1} max={MAX_AGENT_OUTPUTS} step={1} value={Number.isFinite(requestedCount) ? requestedCount : ""} disabled={disabled} onChange={(event) => onRequestedCount?.(event.target.valueAsNumber)} /><div role="group" aria-label="快捷制作条数">{[5, 10, 20, 50].map((value) => <button key={value} type="button" className="button secondary compact" aria-pressed={requestedCount === value} disabled={disabled || (calculateProductionQuantity(count, value)?.total ?? Infinity) > MAX_AGENT_OUTPUTS} onClick={() => onRequestedCount?.(value)}>{value} 条</button>)}</div><p>期望 {Number.isFinite(requestedCount) ? requestedCount : "—"} 条，实际制作 <strong>{total} 条</strong>（{count} 条原素材 × {quantity?.multiplier ?? "—"} 版）</p><small>按原素材数量向上取整，实际条数可能多于填写数量。每个版本独立设计并导出，价格和手动装饰保持一致；{usesModel ? "模型调用次数按实际成片数量计算。" : "本地制作不调用模型。"}</small>{invalidQuantity && <p role="alert">请填写正整数，向上取整后最多制作 {MAX_AGENT_OUTPUTS} 条；当前素材数最多可制作 {count > 0 ? Math.floor(MAX_AGENT_OUTPUTS / count) * count : 0} 条。</p>}</div>
    {uploadControls}
    <div className="production-blockers" id="production-start-reasons" role="status" aria-live="polite">
      {reasons.length > 0 && <><strong>开始制作前需要处理</strong><ul>{reasons.map((reason, index) => <li key={index}>{reason.message}{(reason.section || reason.action) && <button type="button" className="text-button" onClick={() => onFix?.(reason)}>{reason.action === "accounts" ? "去配置账号与计划" : reason.action === "models" ? "去配置模型" : reason.section === "packaging" ? "去填写展示文字" : reason.section === "cover" ? "去保存覆盖设置" : reason.section === "materials" ? "去选择素材" : "去调整输出"}</button>}</li>)}</ul></>}
      {reviewRequired && <p>全部冻结预览和批准仍在覆盖页完成；输出参数变更后须重新核对预览。</p>}
    </div>
    <div className="step-footer"><div><strong>{count} 条素材，预计制作 {total} 条成片</strong><small>{reviewRequired ? "前往覆盖页查看全部冻结预览并明确确认。" : usesModel ? "开始后调用模型并沿原队列导出。" : "开始后在本地生成包装并导出。"}</small></div><button className="button primary" aria-describedby="production-start-reasons" disabled={disabled || startDisabled || !!reasons.length} onClick={onStart}>{reviewRequired ? "前往覆盖预览与确认" : `${usesModel ? "交给 Agent" : "本地制作"}，制作 ${total} 条成片`}<Icon name="arrow" size={18} /></button></div>
  </>;
}
