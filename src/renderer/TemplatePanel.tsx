import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "../shared/export-settings";
import { OutputConfirmation } from "./OutputConfirmation";
import { WorkspacePage } from "./WorkspacePage";
import { RULE_TEMPLATES, getRule, type RuleId } from "../shared/agent";
import { Heading, Icon } from "./ui";
import type { ReactNode } from "react";
import type { MediaView } from "../main/media";
import { DecorationSchema, RequiredProductPriceSchema, requiresDisplayText, displayTextSettings, PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP, type DisplayTextSettings, type DecorationDisplayMode, type DecorationOptions, type Corner } from "../shared/decorations";
import { DisplayTextEditor } from "./DisplayTextEditor";
import { type ExportFormat } from "../shared/export-format";
import { PriceStylePicker } from "./PriceStylePicker";
import { PRICE_STYLES, type PriceStyleId } from "../shared/price-styles";
import { CORNER_SAFE_POLICY } from "../shared/layout-policy";

export type TemplatePanelProps = {
  section?: "packaging" | "cover" | "export";
  onNavigate?(section: "packaging" | "cover" | "export", selector?: string): void;
  startReasons?: { message: string; section?: "materials" | "packaging" | "cover" | "export"; selector?: string; action?: "models" | "accounts" }[];
  onFix?(reason: NonNullable<TemplatePanelProps["startReasons"]>[number]): void;
  coverSummary?: string;
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
  modePicker?: ReactNode;
  coverPanel?: ReactNode; coverDirty?: boolean;
  uploadControls?: ReactNode;
  decorationOptions?: DecorationOptions;
  exportSettings?: ExportSettings; onExportSettings?(value: ExportSettings): void;
  exportFormat: ExportFormat; onExportFormat(format: ExportFormat): void;
  selected: RuleId; onSelect(id: RuleId): void; brief: string; onBrief(text: string): void;
  outputDirectory: string; automaticOutput?: boolean; onAutomaticOutput?(): void; onOutput(): void; onStart(): void; count: number; disabled: boolean;
};

export function TemplatePanel({ section = "packaging", onNavigate, startReasons = [], onFix, coverSummary, modePicker, selected, onSelect, brief, onBrief, outputDirectory, automaticOutput = false, onAutomaticOutput, onOutput, onStart, count, disabled, startDisabled = false, decorations, coverPanel, uploadControls, coverDirty = false, decorationOptions, selectedMedia = [], onDisplayText, onSaveDisplayText, exportFormat, onExportFormat, exportSettings = DEFAULT_EXPORT_SETTINGS, onExportSettings, selectedCorner, onCornerSelect, onGenerateBrief, generatingBrief = false, usesModel = true, reviewRequired = false, onProductPrice, onPriceStyle, onDisplayMode, requestedCount = count, onRequestedCount }: TemplatePanelProps) {
  const rule = getRule(selected);
  const automatic = decorationOptions?.mode === "agent";
  const random = decorationOptions?.mode === "random";
  const needsText = requiresDisplayText(decorationOptions, selectedMedia.map(item => item.id));
  const invalidPrice = needsText && !RequiredProductPriceSchema.safeParse(decorationOptions?.productPrice ?? "").success;
  return <>
    <WorkspacePage active={section === "packaging"} label="包装">
    <Heading title="包装设置">{automatic ? "Agent 可按每条素材选择贴纸；本地只限制位置、尺寸与新增文字。" : random ? "普通包装的滤镜、四角贴纸与文字样式逐版本本地随机；组合自动形状匹配时，仅随机文字样式，边框按独立设置，保留原色和未确认角落。展示文字使用你填写的原文。" : "手动设置贴纸和展示文字；已保存的旧模板设置继续保留。"}</Heading>
    {modePicker}
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
    {automatic && <div className="brief-layout"><div className="card brief-card"><label htmlFor="creative-brief">还有想告诉 Agent 的？ <span>可选</span></label><button type="button" className="button secondary generate-brief" disabled={disabled || generatingBrief || invalidPrice || !onGenerateBrief} onClick={onGenerateBrief}>{generatingBrief ? "正在生成提示词…" : "自动生成提示词"}</button><textarea id="creative-brief" value={brief} maxLength={1000} rows={3} disabled={disabled} onChange={(event) => onBrief(event.target.value)} placeholder="例如：突出手作质感，语气温柔一点。价格请填写在上方价格栏。" /><small>{onGenerateBrief ? "点击调用当前模型，按已选贴纸生成提示词；没有手动选择时自由创作。生成后可继续编辑；中间只显示手动价格。" : "未连接模型时不能自动生成提示词；本地制作仍可继续。"}</small></div></div>}

    <div className="step-footer"><button type="button" className="text-button" onClick={() => onNavigate?.("packaging", "#product-price")}>展示文字设置</button><button type="button" className="button primary" onClick={() => onNavigate?.("cover")}>下一步，覆盖<Icon name="arrow" size={18} /></button></div>
    </WorkspacePage>
    <WorkspacePage active={section === "cover"} label="覆盖">
      {coverPanel}
      <div className="step-footer"><span>{coverDirty ? "覆盖有未保存的修改；制作前请先保存。" : "覆盖设置沿用当前项目；切页不会批准或启动制作。"}</span><button type="button" className="button primary" onClick={() => onNavigate?.("export")}>下一步，输出确认<Icon name="arrow" size={18} /></button></div>
    </WorkspacePage>
    <WorkspacePage active={section === "export"} label="输出确认">
      <OutputConfirmation {...{ outputDirectory, automaticOutput, onAutomaticOutput, onOutput, exportFormat, onExportFormat, exportSettings, onExportSettings, disabled, requestedCount, onRequestedCount, count, usesModel, uploadControls, startDisabled, onStart, reviewRequired, coverDirty, decorationOptions, startReasons, onFix, coverSummary }} />
    </WorkspacePage>
  </>;
}
