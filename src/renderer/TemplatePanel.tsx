import { RULE_TEMPLATES, getRule, type RuleId } from "../shared/agent";
import { Heading, Icon } from "./ui";
import type { ReactNode } from "react";
import { DecorationSchema, ProductPriceSchema, type DecorationOptions, type Corner } from "../shared/decorations";
import { TemplatePreview } from "./TemplatePreview";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, type ExportFormat } from "../shared/export-format";

const STICKER_GLYPHS = { sparkle: "✦", arrow: "↗", heart: "♥", burst: "✹" } as const;

export function TemplatePanel({ selected, onSelect, brief, onBrief, outputDirectory, onOutput, onStart, count, disabled, decorations, decorationOptions, exportFormat, onExportFormat, selectedCorner, onCornerSelect, onGenerateBrief, generatingBrief = false, onProductPrice }: {
  onProductPrice?(price: string): void;
  onGenerateBrief?(): void; generatingBrief?: boolean;
  selectedCorner?: Corner; onCornerSelect?(corner: Corner): void;
  decorations?: ReactNode;
  decorationOptions?: DecorationOptions;
  exportFormat: ExportFormat; onExportFormat(format: ExportFormat): void;
  selected: RuleId; onSelect(id: RuleId): void; brief: string; onBrief(text: string): void;
  outputDirectory: string; onOutput(): void; onStart(): void; count: number; disabled: boolean;
}) {
  const rule = getRule(selected);
  const invalidCornerText = decorationOptions?.mode !== "agent" && Object.values(decorationOptions?.corners ?? {}).some((slot) => slot?.type === "text" && (!slot.text.trim() || /[\u0000-\u001f\u007f]/.test(slot.text)));
  const invalidPrice = !ProductPriceSchema.safeParse(decorationOptions?.productPrice ?? "").success;
  return <>
    <Heading eyebrow="02 / CHOOSE YOUR DIRECTION" title="定下风格，放手让它创作">模板规定边界。文案、角标位置与色彩细节，由 Agent 根据每条素材决定。</Heading>
    <div className="template-grid" role="group" aria-label="规则模板">
      {RULE_TEMPLATES.map((template, index) => <button key={template.id} className={`template-card ${template.id} ${selected === template.id ? "selected" : ""}`} aria-pressed={selected === template.id} onClick={() => onSelect(template.id)} disabled={disabled}>
        <div className="template-art"><span className="template-number">{String(index + 1).padStart(2, "0")}</span><span className="filter-pill">滤镜 · {template.filterLabel}</span><div className="art-circle" /><div className="art-column" /><span className={`template-sticker sticker-${template.sticker}`} aria-hidden="true">{STICKER_GLYPHS[template.sticker]}</span><span className="art-label">{template.previewCaption}</span><div className="art-line" /></div>
        <div className="template-description"><div><span>{template.label}</span><h2>{template.name}</h2></div><span className="selection-ring">{selected === template.id && <Icon name="check" size={15} />}</span><p>{template.description}</p><div className="template-tags"><span>贴纸 · {template.stickerLabel}</span><span>滤镜 · {template.filterLabel}</span><span>≤ {template.maxBadges} 个角标</span></div></div>
      </button>)}
    </div>
    <TemplatePreview selectedCorner={selectedCorner} onCornerSelect={onCornerSelect} disabled={disabled} rule={rule} options={decorationOptions ?? DecorationSchema.parse({})} />
    <div className="card brief-card"><label htmlFor="product-price">产品价格（元） <span>可选</span></label><input id="product-price" inputMode="decimal" value={decorationOptions?.productPrice ?? ""} maxLength={9} disabled={disabled} onChange={(event) => onProductPrice?.(event.target.value)} placeholder="例如：19.90" /><small>中间只显示此价格；未填不显示。不能填写产品名，Agent 不会改写价格。同一批视频使用此价格。</small>{invalidPrice && <p role="alert">请填写金额，最多两位小数，不要包含产品名或其他文字。</p>}</div>
    {decorations}
    <div className="rules-banner"><div className="icon-tile"><Icon name="shield" /></div><div><strong>{rule.name} · 已锁定的创作边界</strong><p>贴纸仅放四角且宽度 ≤ {(rule.stickerWidth * 100).toFixed(0)}% · 角落文字单行 ≤ 12 字 · 角落字号 ≤ {(rule.maxFontSize * 100).toFixed(1)}% 画面宽 · 不裁剪、不拼接 · 保留原始音频</p></div><span className="small-tag">本地校验</span></div>
    <div className="brief-layout"><div className="card brief-card"><label htmlFor="creative-brief">还有想告诉 Agent 的？ <span>可选</span></label><button type="button" className="button secondary generate-brief" disabled={disabled || generatingBrief || invalidCornerText || invalidPrice || !onGenerateBrief} onClick={onGenerateBrief}><Icon name="spark" size={16} />{generatingBrief ? "正在生成提示词…" : "自动生成提示词"}</button><textarea id="creative-brief" value={brief} maxLength={1000} rows={3} disabled={disabled} onChange={(event) => onBrief(event.target.value)} placeholder="例如：突出手作质感，语气温柔一点。价格请填写在上方价格栏，文案禁止加入产品名。" /><small>点击调用当前模型，按已选贴纸和文字生成提示词；没有手动选择时自由创作。生成后可继续编辑，Agent 角落文案仅选通用短句，禁止加入产品名；中间只显示手动价格。</small></div><div className="card export-card"><span className="eyebrow">DELIVERY</span><h3>成片保存到</h3><button className="directory-picker" disabled={disabled} onClick={onOutput}><Icon name="folder" /><span>{outputDirectory || "选择本地文件夹"}</span><Icon name="arrow" size={16} /></button><label className="export-format" htmlFor="export-format">导出格式<select id="export-format" value={exportFormat} disabled={disabled} onChange={(event) => onExportFormat(event.target.value as ExportFormat)}>{EXPORT_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}{format === DEFAULT_EXPORT_FORMAT ? "（默认）" : ""}</option>)}</select></label><p>每条素材生成一个独立 {exportFormat.toUpperCase()}，保留原分辨率与帧率。</p></div></div>
    {invalidCornerText && <p role="alert">请填写角落文字（1–12 字，不能包含换行或控制字符）。</p>}
    <div className="step-footer"><div><strong>{count} 条素材，{count} 份独立创意</strong><small>点击开始后发送抽帧并调用模型，完成包装后自动在本地导出。</small></div><button className="button primary" disabled={disabled || !count || !outputDirectory || invalidCornerText || invalidPrice} onClick={onStart}><Icon name="spark" size={18} />交给 Agent，开始出片<Icon name="arrow" size={18} /></button></div>
  </>;
}
