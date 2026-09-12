import { useEffect, useState } from "react";
import type { DecorationCatalog, DecorationOptions } from "../shared/decorations";
import { FONT_LABELS } from "../shared/decorations";
import "./decorations.css";

export function DecorationPicker({ value, onChange, disabled }: { value: DecorationOptions; onChange(value: DecorationOptions): void; disabled: boolean }) {
  const [catalog, setCatalog] = useState<DecorationCatalog>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void window.jianji.decorationCatalog().then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setError("贴纸与字体加载失败，请重新打开此页面。"); });
    return () => { active = false; };
  }, []);
  return <section className="decoration-picker card" aria-label="贴纸与字体">
    <h2>贴纸与字体</h2><p>选择后应用到本轮每条视频；贴纸自动避开文字，保持在角落。</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={disabled || !catalog}><legend>贴纸库</legend><div className="sticker-choices">
      {(["template", "none"] as const).map((id) => <button type="button" key={id} aria-pressed={value.sticker === id} onClick={() => onChange({ ...value, sticker: id })}>{id === "template" ? "跟随模板" : "不加贴纸"}</button>)}
      {catalog?.stickers.map((sticker) => <button type="button" key={sticker.id} aria-pressed={value.sticker === sticker.id} onClick={() => onChange({ ...value, sticker: sticker.id })}><img src={sticker.url} alt="" /><span>{sticker.label}</span></button>)}
    </div></fieldset>
    <label htmlFor="caption-font">文字字体</label><select id="caption-font" value={value.fontFamily} disabled={disabled || !catalog?.fonts.length} onChange={(event) => onChange({ ...value, fontFamily: event.target.value as DecorationOptions["fontFamily"] })}>
      {!catalog?.fonts.includes(value.fontFamily) && <option value={value.fontFamily} disabled>{value.fontFamily}（未就绪）</option>}
      {catalog?.fonts.map((font) => <option key={font} value={font}>{FONT_LABELS[font as DecorationOptions["fontFamily"]] ?? font}</option>)}
    </select>
    <div className="font-example" style={{ fontFamily: `"${value.fontFamily}", "Microsoft YaHei", sans-serif` }}>今日好物推荐 · 19.9元</div>
    <small>仅列出本机可用字体；示例展示字形，成片字号与颜色随模板调整。</small>
  </section>;
}
