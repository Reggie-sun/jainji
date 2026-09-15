import type { CSSProperties } from "react";
import { formatProductPrice, RequiredProductPriceSchema } from "../shared/decorations";
import { getPriceStyle, PRICE_STYLES, type PriceStyle, type PriceStyleId } from "../shared/price-styles";
import "./price-styles.css";

const cssColor = (color: PriceStyle["color"]) => `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;

export function PriceStylePicker({ value, price, disabled, onChange }: { value?: PriceStyleId; price?: string; disabled: boolean; onChange?(id: PriceStyleId): void }) {
  const validPrice = RequiredProductPriceSchema.safeParse(price);
  const sample = validPrice.success ? formatProductPrice(validPrice.data) : "价格";
  const sampleUnits = Math.max(...sample.split("\n").map((line) => [...line].reduce((total, character) => total + (/[\u0000-\u00ff]/.test(character) ? 0.6 : 1), 0)));
  const selected = getPriceStyle(value);
  return <section className="price-style-picker" aria-label="价格花字样式">
    <div className="price-style-heading"><div><h3>价格花字</h3><p>描边、投影、底牌自由搭配手动模板。</p></div><span className="small-tag">{PRICE_STYLES.length} 款 · 已选{selected.name}</span></div>
    <div className="price-style-grid" role="group" aria-label="选择价格花字">
      {PRICE_STYLES.map((entry) => {
        const style: PriceStyle = entry;
        const fontSize = Math.min(26, 120 / sampleUnits);
        const scale = fontSize / 0.045;
        const appearance: CSSProperties = {
          fontSize, color: cssColor(style.color), WebkitTextStroke: `${style.strokeWidthRatio * scale * 2}px ${cssColor(style.strokeColor)}`,
          paintOrder: "stroke fill",
          textShadow: style.shadow ? `${style.shadow.xRatio * scale}px ${style.shadow.yRatio * scale}px 0 ${cssColor(style.shadow.color)}` : undefined,
          background: style.backgroundColor ? cssColor(style.backgroundColor) : undefined,
        };
        return <button key={style.id} type="button" className="price-style-option" data-price-style={style.id} disabled={disabled} aria-pressed={selected.id === style.id} aria-label={`价格花字：${style.name}`} onClick={() => onChange?.(style.id as PriceStyleId)}>
          <span className="price-style-swatch" aria-hidden="true"><span style={appearance}>{sample}</span></span>
          <strong>{style.name}</strong><small>{style.description}</small>
        </button>;
      })}
    </div>
    <small>仅改变手动价格的外观，切换装饰模式会保留选择。未填价格时只展示字样示例。</small>
  </section>;
}
