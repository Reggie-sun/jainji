import { RULE_TEMPLATES, getRule, type RuleId } from "../shared/agent";
import { Heading, Icon } from "./ui";

export function TemplatePanel({ selected, onSelect, brief, onBrief, outputDirectory, onOutput, onStart, count, disabled }: {
  selected: RuleId; onSelect(id: RuleId): void; brief: string; onBrief(text: string): void;
  outputDirectory: string; onOutput(): void; onStart(): void; count: number; disabled: boolean;
}) {
  const rule = getRule(selected);
  return <>
    <Heading eyebrow="02 / CHOOSE YOUR DIRECTION" title="定下风格，放手让它创作">模板规定边界。文案、角标位置与色彩细节，由 Agent 根据每条素材决定。</Heading>
    <div className="template-grid" role="group" aria-label="规则模板">
      {RULE_TEMPLATES.map((template, index) => <button key={template.id} className={`template-card ${template.id} ${selected === template.id ? "selected" : ""}`} aria-pressed={selected === template.id} onClick={() => onSelect(template.id)} disabled={disabled}>
        <div className="template-art"><span className="template-number">0{index + 1}</span><span className="template-example">风格示意</span><div className="art-circle" /><div className="art-column" /><span className="art-label">{template.id === "black-gold" ? "精选 · 有质感" : template.id === "clean" ? "把日常过成喜欢" : "留住这一刻"}</span><div className="art-line" /></div>
        <div className="template-description"><div><span>{template.label}</span><h2>{template.name}</h2></div><span className="selection-ring">{selected === template.id && <Icon name="check" size={15} />}</span><p>{template.description}</p><div className="template-tags"><span>≤ {template.maxBadges} 个角标</span><span>{template.id === "mono" ? "黑白色调" : "轻度调色"}</span><span>保留原声</span></div></div>
      </button>)}
    </div>
    <div className="rules-banner"><div className="icon-tile"><Icon name="shield" /></div><div><strong>{rule.name} · 已锁定的创作边界</strong><p>角标仅放四角 · 单行 ≤ 12 字 · 字号 ≤ {(rule.maxFontSize * 100).toFixed(1)}% 画面宽 · 不裁剪、不拼接 · 保留原始音频</p></div><span className="small-tag">本地校验</span></div>
    <div className="brief-layout"><div className="card brief-card"><label htmlFor="creative-brief">还有想告诉 Agent 的？ <span>可选</span></label><textarea id="creative-brief" value={brief} maxLength={1000} rows={3} disabled={disabled} onChange={(event) => onBrief(event.target.value)} placeholder="例如：突出手作质感，语气温柔一点。需要价格或产品信息时，请提供真实内容。" /><small>留空也可以。Agent 会从画面出发，不自动添加未经提供的价格和优惠。</small></div><div className="card export-card"><span className="eyebrow">DELIVERY</span><h3>成片保存到</h3><button className="directory-picker" disabled={disabled} onClick={onOutput}><Icon name="folder" /><span>{outputDirectory || "选择本地文件夹"}</span><Icon name="arrow" size={16} /></button><p>每条素材生成一个独立 MP4，保留原分辨率与帧率。</p></div></div>
    <div className="step-footer"><div><strong>{count} 条素材，{count} 份独立创意</strong><small>点击开始后发送抽帧并调用模型，完成包装后自动在本地导出。</small></div><button className="button primary" disabled={disabled || !count || !outputDirectory} onClick={onStart}><Icon name="spark" size={18} />交给 Agent，开始出片<Icon name="arrow" size={18} /></button></div>
  </>;
}
