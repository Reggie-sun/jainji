import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "../shared/export-settings";
import { ExportSettingsPanel } from "./ExportSettingsPanel";
import { RULE_TEMPLATES, getRule, MAX_AGENT_OUTPUTS, calculateProductionQuantity, type RuleId } from "../shared/agent";
import { Heading, Icon } from "./ui";
import type { ReactNode } from "react";
import { DecorationSchema, RequiredProductPriceSchema, PRODUCT_PRICE_MAX_LENGTH, PRODUCT_PRICE_HELP, type DecorationOptions, type Corner } from "../shared/decorations";
import { TemplatePreview } from "./TemplatePreview";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, type ExportFormat } from "../shared/export-format";
import { PriceStylePicker } from "./PriceStylePicker";
import type { PriceStyleId } from "../shared/price-styles";
import { CORNER_SAFE_POLICY } from "../shared/layout-policy";

const STICKER_GLYPHS = { sparkle: "✦", arrow: "↗", heart: "♥", burst: "✹" } as const;

export function TemplatePanel({ selected, onSelect, brief, onBrief, outputDirectory, onOutput, onStart, count, disabled, decorations, decorationOptions, exportFormat, onExportFormat, exportSettings = DEFAULT_EXPORT_SETTINGS, onExportSettings, selectedCorner, onCornerSelect, onGenerateBrief, generatingBrief = false, onProductPrice, onPriceStyle, requestedCount = count, onRequestedCount }: {
  requestedCount?: number; onRequestedCount?(value: number): void;
  onProductPrice?(price: string): void;
  onPriceStyle?(id: PriceStyleId): void;
  onGenerateBrief?(): void; generatingBrief?: boolean;
  selectedCorner?: Corner; onCornerSelect?(corner: Corner): void;
  decorations?: ReactNode;
  decorationOptions?: DecorationOptions;
  exportSettings?: ExportSettings; onExportSettings?(value: ExportSettings): void;
  exportFormat: ExportFormat; onExportFormat(format: ExportFormat): void;
  selected: RuleId; onSelect(id: RuleId): void; brief: string; onBrief(text: string): void;
  outputDirectory: string; onOutput(): void; onStart(): void; count: number; disabled: boolean;
}) {
  const rule = getRule(selected);
  const automatic = decorationOptions?.mode === "agent";
  const invalidPrice = !RequiredProductPriceSchema.safeParse(decorationOptions?.productPrice ?? "").success;
  const quantity = calculateProductionQuantity(count, requestedCount);
  const invalidQuantity = !quantity || quantity.total > MAX_AGENT_OUTPUTS;
  const total = quantity?.total ?? 0;
  return <>
    <Heading eyebrow="02 / CHOOSE YOUR DIRECTION" title={automatic ? "告诉 Agent 可以做什么" : "选择模板，自己设置"}>{automatic ? "Agent 可按每条素材选择贴纸；本地只限制位置、尺寸与新增文字。" : "选择一个模板作为手动贴纸与滤镜的默认安排。"}</Heading>
    {!automatic && <div className="template-grid" role="group" aria-label="规则模板">
      {RULE_TEMPLATES.map((template, index) => <button key={template.id} className={`template-card ${template.id} ${selected === template.id ? "selected" : ""}`} aria-pressed={selected === template.id} onClick={() => onSelect(template.id)} disabled={disabled}>
        <div className="template-art"><span className="template-number">{String(index + 1).padStart(2, "0")}</span><span className="filter-pill">滤镜 · {template.filterLabel}</span><div className="art-circle" /><div className="art-column" /><span className={`template-sticker sticker-${template.sticker}`} aria-hidden="true">{STICKER_GLYPHS[template.sticker]}</span><div className="art-line" /></div>
        <div className="template-description"><div><span>{template.label}</span><h2>{template.name}</h2></div><span className="selection-ring">{selected === template.id && <Icon name="check" size={15} />}</span><p>{template.description}</p><div className="template-tags"><span>贴纸 · {template.stickerLabel}</span><span>滤镜 · {template.filterLabel}</span><span>四角贴纸</span></div></div>
      </button>)}
    </div>}
    <TemplatePreview selectedCorner={selectedCorner} onCornerSelect={onCornerSelect} disabled={disabled} rule={rule} options={decorationOptions ?? DecorationSchema.parse({})} />
    <div className="card brief-card price-input-card"><label htmlFor="product-price">产品价格 / 数量 <span>必填 · 手动输入</span></label><input id="product-price" required aria-invalid={invalidPrice} aria-describedby="product-price-help" inputMode="text" value={decorationOptions?.productPrice ?? ""} maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={disabled} onChange={(event) => onProductPrice?.(event.target.value)} placeholder="例如：19.90 或 19.9元30贴" /><small id="product-price-help">请手动填写金额，可附数量单位（如19.9元30贴），填写后才能开始制作。不能填写产品名，Agent 不能代填或改写价格。同一批视频使用此价格。</small>{invalidPrice && <p role="alert">{PRODUCT_PRICE_HELP}</p>}{!automatic && <PriceStylePicker value={decorationOptions?.priceStyle} price={decorationOptions?.productPrice} disabled={disabled} onChange={onPriceStyle} />}</div>
    {decorations}
    <div className="rules-banner"><div className="icon-tile"><Icon name="shield" /></div><div><strong>{automatic ? "已锁定的创作边界" : `${rule.name} · 手动模板边界`}</strong><p>贴纸仅放四角且宽度 ≤ {(CORNER_SAFE_POLICY.maxStickerWidth * 100).toFixed(0)}% · 新增文字仅限手动价格 · 不裁剪、不拼接 · 保留原始音频</p></div><span className="small-tag">本地校验</span></div>
    <div className="brief-layout"><div className="card brief-card"><label htmlFor="creative-brief">还有想告诉 Agent 的？ <span>可选</span></label><button type="button" className="button secondary generate-brief" disabled={disabled || generatingBrief || invalidPrice || !onGenerateBrief} onClick={onGenerateBrief}><Icon name="spark" size={16} />{generatingBrief ? "正在生成提示词…" : "自动生成提示词"}</button><textarea id="creative-brief" value={brief} maxLength={1000} rows={3} disabled={disabled} onChange={(event) => onBrief(event.target.value)} placeholder="例如：突出手作质感，语气温柔一点。价格请填写在上方价格栏。" /><small>点击调用当前模型，按已选贴纸生成提示词；没有手动选择时自由创作。生成后可继续编辑；中间只显示手动价格。</small></div><div className="card export-card"><span className="eyebrow">DELIVERY</span><h3>成片保存到</h3><button className="directory-picker" disabled={disabled} onClick={onOutput}><Icon name="folder" /><span>{outputDirectory || "选择本地文件夹"}</span><Icon name="arrow" size={16} /></button><label className="export-format" htmlFor="export-format">导出格式<select id="export-format" value={exportFormat} disabled={disabled} onChange={(event) => onExportFormat(event.target.value as ExportFormat)}>{EXPORT_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}{format === DEFAULT_EXPORT_FORMAT ? "（默认）" : ""}</option>)}</select></label><ExportSettingsPanel value={exportSettings} onChange={(value) => onExportSettings?.(value)} disabled={disabled || !onExportSettings} /></div></div>
    <div className="card brief-card"><label htmlFor="production-count">想制作多少条视频？</label><input id="production-count" type="number" min={1} max={MAX_AGENT_OUTPUTS} step={1} value={Number.isFinite(requestedCount) ? requestedCount : ""} disabled={disabled} onChange={(event) => onRequestedCount?.(event.target.valueAsNumber)} /><div role="group" aria-label="快捷制作条数">{[5, 10, 20, 50].map((value) => <button key={value} type="button" className="button secondary compact" aria-pressed={requestedCount === value} disabled={disabled || (calculateProductionQuantity(count, value)?.total ?? Infinity) > MAX_AGENT_OUTPUTS} onClick={() => onRequestedCount?.(value)}>{value} 条</button>)}</div><p>期望 {Number.isFinite(requestedCount) ? requestedCount : "—"} 条，实际制作 <strong>{total} 条</strong>（{count} 条原素材 × {quantity?.multiplier ?? "—"} 版）</p><small>按原素材数量向上取整，实际条数可能多于填写数量。每个版本独立设计并导出，价格和手动装饰保持一致；模型调用次数按实际成片数量计算。</small>{invalidQuantity && <p role="alert">请填写正整数，向上取整后最多制作 {MAX_AGENT_OUTPUTS} 条；当前素材数最多可制作 {count > 0 ? Math.floor(MAX_AGENT_OUTPUTS / count) * count : 0} 条。</p>}</div>
    <div className="step-footer"><div><strong>{count} 条素材，预计制作 {total} 条成片</strong><small>点击开始后发送抽帧并调用模型，完成包装后自动在本地导出。</small></div><button className="button primary" disabled={disabled || !count || !outputDirectory || invalidPrice || invalidQuantity} onClick={onStart}><Icon name="spark" size={18} />交给 Agent，制作 {total} 条成片<Icon name="arrow" size={18} /></button></div>
  </>;
}
