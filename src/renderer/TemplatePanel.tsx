import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "../shared/export-settings";
import { ExportSettingsPanel } from "./ExportSettingsPanel";
import { RULE_TEMPLATES, getRule, MAX_AGENT_OUTPUTS, calculateProductionQuantity, type RuleId } from "../shared/agent";
import { Heading, Icon } from "./ui";
import type { ReactNode } from "react";
import type { MediaView } from "../main/media";
import { DecorationSchema, RequiredProductPriceSchema, requiresDisplayText, displayTextSettings, PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP, type DisplayTextSettings, type DecorationDisplayMode, type DecorationOptions, type Corner } from "../shared/decorations";
import { DisplayTextEditor } from "./DisplayTextEditor";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, type ExportFormat } from "../shared/export-format";
import { PriceStylePicker } from "./PriceStylePicker";
import { PRICE_STYLES, type PriceStyleId } from "../shared/price-styles";
import { CORNER_SAFE_POLICY } from "../shared/layout-policy";

export function TemplatePanel({ selected, onSelect, brief, onBrief, outputDirectory, automaticOutput = false, onAutomaticOutput, onOutput, onStart, count, disabled, startDisabled = false, decorations, coverPanel, uploadControls, coverDirty = false, decorationOptions, selectedMedia = [], onDisplayText, onSaveDisplayText, exportFormat, onExportFormat, exportSettings = DEFAULT_EXPORT_SETTINGS, onExportSettings, selectedCorner, onCornerSelect, onGenerateBrief, generatingBrief = false, usesModel = true, reviewRequired = false, onProductPrice, onPriceStyle, onDisplayMode, requestedCount = count, onRequestedCount }: {
  selectedMedia?: readonly MediaView[];
  onDisplayText?(value: DisplayTextSettings | undefined, mediaId?: string): void;
  onSaveDisplayText?(): void;
  startDisabled?: boolean;
  onDisplayMode?(mode: DecorationDisplayMode): void;
  requestedCount?: number; onRequestedCount?(value: number): void;
  onProductPrice?(price: string): void;
  onPriceStyle?(id: PriceStyleId): void;
  onGenerateBrief?(): void; generatingBrief?: boolean;
  usesModel?: boolean;
  reviewRequired?: boolean;
  selectedCorner?: Corner; onCornerSelect?(corner: Corner): void;
  decorations?: ReactNode;
  coverPanel?: ReactNode; coverDirty?: boolean;
  uploadControls?: ReactNode;
  decorationOptions?: DecorationOptions;
  exportSettings?: ExportSettings; onExportSettings?(value: ExportSettings): void;
  exportFormat: ExportFormat; onExportFormat(format: ExportFormat): void;
  selected: RuleId; onSelect(id: RuleId): void; brief: string; onBrief(text: string): void;
  outputDirectory: string; automaticOutput?: boolean; onAutomaticOutput?(): void; onOutput(): void; onStart(): void; count: number; disabled: boolean;
}) {
  const rule = getRule(selected);
  const automatic = decorationOptions?.mode === "agent";
  const random = decorationOptions?.mode === "random";
  const needsText = requiresDisplayText(decorationOptions, selectedMedia.map(item => item.id));
  const invalidPrice = needsText && !RequiredProductPriceSchema.safeParse(decorationOptions?.productPrice ?? "").success;
  const quantity = calculateProductionQuantity(count, requestedCount);
  const invalidQuantity = !quantity || quantity.total > MAX_AGENT_OUTPUTS;
  const total = quantity?.total ?? 0;
  return <>
    <Heading title="包装设置">{automatic ? "Agent 可按每条素材选择贴纸；本地只限制位置、尺寸与新增文字。" : random ? "普通包装的滤镜、四角贴纸与文字样式逐版本本地随机；组合自动形状匹配时，仅随机文字样式，边框按独立设置，保留原色和未确认角落。展示文字使用你填写的原文。" : "手动设置贴纸和展示文字；已保存的旧模板设置继续保留。"}</Heading>
    {!automatic && !random && <details className="card">
      <summary>旧模板兼容设置</summary>
      <label htmlFor="legacy-rule">手动滤镜与默认贴纸<select id="legacy-rule" value={selected} disabled={disabled} onChange={event => onSelect(event.target.value as RuleId)}>{RULE_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.name} · {template.filterLabel}</option>)}</select></label>
      <small>仅影响自己设置模式；本地随机不受此选择限制。</small>
    </details>}
    <DisplayTextEditor rule={rule} options={decorationOptions ?? DecorationSchema.parse({})} media={selectedMedia} exportSettings={exportSettings} selectedCorner={selectedCorner} onCornerSelect={onCornerSelect} disabled={disabled} onChange={onDisplayText} onSave={onSaveDisplayText}>
    <label><input type="checkbox" checked={displayTextSettings(decorationOptions).enabled} disabled={disabled || !onDisplayText} onChange={event => onDisplayText?.({ ...displayTextSettings(decorationOptions), enabled: event.target.checked })} />默认显示展示文字 / 价格</label><small>逐素材设置优先；关闭后，未单独设置的素材不添加文字。</small><p><strong>整批共用：价格内容只需填写一次，所有开启文字的素材使用相同内容；显示时段也统一应用于整批素材。下方逐素材设置仅调整开关和位置。</strong></p><label htmlFor="product-price">展示文字 / 价格 <span>{needsText ? "开启时必填 · 手动输入" : "可选 · 当前素材均已关闭"}</span></label><textarea id="product-price" rows={2} required={needsText} aria-invalid={invalidPrice} aria-describedby="product-price-help" inputMode="text" value={decorationOptions?.productPrice ?? ""} maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={disabled || !needsText} onChange={(event) => onProductPrice?.(event.target.value)} placeholder={"9.9元到手5卷\n19.9元拍一发三"} /><small id="product-price-help">按 Enter 换行，最多2行、每行12字。可填写任意文字，不要求包含金额；同一批视频使用相同内容，Agent 不能代填或改写。</small>{invalidPrice && <p role="alert">{PRODUCT_PRICE_HELP}</p>}{automatic ? <p>价格花字由 Agent 按每条素材从现有 {PRICE_STYLES.length} 款中选择，同批会参考已使用的样式减少重复，但不保证每版不同。手动价格保持不变；切回“自己设置”可继续使用之前选择的花字。</p> : random ? <p>价格花字从现有 {PRICE_STYLES.length} 款中本地随机选择，每条素材独立随机，不调用模型。手动价格保持不变。</p> : <PriceStylePicker value={decorationOptions?.priceStyle} price={decorationOptions?.productPrice} disabled={disabled || !needsText} onChange={onPriceStyle} />}
    <label id="display-time-settings" htmlFor="decoration-display-mode">价格 / 展示文字显示时段</label><select id="decoration-display-mode" value={decorationOptions?.displayMode === "first-3s" ? "first-5s" : decorationOptions?.displayMode ?? "full"} disabled={disabled || !onDisplayMode} onChange={(event) => onDisplayMode?.(event.target.value as DecorationDisplayMode)}><option value="full">全程显示（默认）</option><option value="first-5s">仅前 5 秒显示（渐隐）</option></select><small>仅控制后期添加的展示文字 / 价格；贴纸全程保留，覆盖与补角仍按各自有效时段显示，原视频内容不变。选项会告知 Agent；前 5 秒模式在最后 0.5 秒渐隐，短视频在结尾前渐隐。</small>
    </DisplayTextEditor>
    {decorations}
    <div className="rules-banner"><div className="icon-tile"><Icon name="shield" /></div><div><strong>{automatic ? "已锁定的创作边界" : random ? "本地随机包装边界" : `${rule.name} · 手动模板边界`}</strong><p>普通贴纸放四角且宽度 ≤ {(CORNER_SAFE_POLICY.maxStickerWidth * 100).toFixed(0)}% · 整圈边框独立选择 · 新增文字仅限手动展示文字 · 不裁剪、不拼接 · 保留原始音频</p></div><span className="small-tag">本地校验</span></div>
    {coverPanel}
    {uploadControls}
    <div className="brief-layout"><div className="card brief-card"><label htmlFor="creative-brief">还有想告诉 Agent 的？ <span>可选</span></label><button type="button" className="button secondary generate-brief" disabled={disabled || generatingBrief || invalidPrice || !onGenerateBrief} onClick={onGenerateBrief}>{generatingBrief ? "正在生成提示词…" : "自动生成提示词"}</button><textarea id="creative-brief" value={brief} maxLength={1000} rows={3} disabled={disabled} onChange={(event) => onBrief(event.target.value)} placeholder="例如：突出手作质感，语气温柔一点。价格请填写在上方价格栏。" /><small>{onGenerateBrief ? "点击调用当前模型，按已选贴纸生成提示词；没有手动选择时自由创作。生成后可继续编辑；中间只显示手动价格。" : "未连接模型时不能自动生成提示词；本地制作仍可继续。"}</small></div><div className="card export-card"><h3>成片保存到</h3><button className="directory-picker" disabled={disabled} onClick={onOutput}><Icon name="folder" /><span>{outputDirectory || (automaticOutput ? "自动创建 视频/M.D HH:MM" : "选择本地文件夹")}</span><Icon name="arrow" size={16} /></button>{automaticOutput ? <small>开始制作时根据素材位置自动创建；点上方可改为手动选择。</small> : <button type="button" className="text-button" disabled={disabled || !onAutomaticOutput} onClick={onAutomaticOutput}>改为自动创建目录</button>}<label className="export-format" htmlFor="export-format">导出格式<select id="export-format" value={exportFormat} disabled={disabled} onChange={(event) => onExportFormat(event.target.value as ExportFormat)}>{EXPORT_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}{format === DEFAULT_EXPORT_FORMAT ? "（默认）" : ""}</option>)}</select></label><ExportSettingsPanel value={exportSettings} onChange={(value) => onExportSettings?.(value)} disabled={disabled || !onExportSettings} /></div></div>
    <div className="card brief-card"><label htmlFor="production-count">想制作多少条视频？</label><input id="production-count" type="number" min={1} max={MAX_AGENT_OUTPUTS} step={1} value={Number.isFinite(requestedCount) ? requestedCount : ""} disabled={disabled} onChange={(event) => onRequestedCount?.(event.target.valueAsNumber)} /><div role="group" aria-label="快捷制作条数">{[5, 10, 20, 50].map((value) => <button key={value} type="button" className="button secondary compact" aria-pressed={requestedCount === value} disabled={disabled || (calculateProductionQuantity(count, value)?.total ?? Infinity) > MAX_AGENT_OUTPUTS} onClick={() => onRequestedCount?.(value)}>{value} 条</button>)}</div><p>期望 {Number.isFinite(requestedCount) ? requestedCount : "—"} 条，实际制作 <strong>{total} 条</strong>（{count} 条原素材 × {quantity?.multiplier ?? "—"} 版）</p><small>按原素材数量向上取整，实际条数可能多于填写数量。每个版本独立设计并导出，价格和手动装饰保持一致；{usesModel ? "模型调用次数按实际成片数量计算。" : "本地制作不调用模型。"}</small>{invalidQuantity && <p role="alert">请填写正整数，向上取整后最多制作 {MAX_AGENT_OUTPUTS} 条；当前素材数最多可制作 {count > 0 ? Math.floor(MAX_AGENT_OUTPUTS / count) * count : 0} 条。</p>}</div>
    <div className="step-footer"><div><strong>{count} 条素材，预计制作 {total} 条成片</strong><small>{coverDirty ? "覆盖贴纸有未保存的修改，请先保存覆盖设置后再制作。" : reviewRequired ? "在上方覆盖设置中框选区域，查看全部冻结预览后确认导出。" : usesModel ? "点击开始后发送抽帧并调用模型，完成包装后自动在本地导出。" : "点击开始后在本地生成包装并导出，不发送抽帧或调用模型。"}</small></div><button className="button primary" disabled={disabled || startDisabled || !count || (!automaticOutput && !outputDirectory) || invalidPrice || invalidQuantity || coverDirty} onClick={onStart}>{reviewRequired ? "前往覆盖预览与确认" : `${usesModel ? "交给 Agent" : "本地制作"}，制作 ${total} 条成片`}<Icon name="arrow" size={18} /></button></div>
  </>;
}
