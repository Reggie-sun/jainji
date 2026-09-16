import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults";
import { useEffect, useRef, useState } from "react";
import type { RuleTemplate } from "../shared/agent";
import { LIBRARY_STICKERS } from "../shared/asset-library";
import { CORNERS, CORNER_LABELS, formatProductPrice, ProductPriceSchema, type Corner, type DecorationOptions } from "../shared/decorations";
import { constrainedStickerPreviewGeometry, CORNER_SAFE_POLICY } from "../shared/layout-policy";
import { getPriceStyle, PRICE_LINE_HEIGHT, priceFontSizeRatio } from "../shared/price-styles";
import "./template-preview.css";

export function TemplatePreview({ rule, options, selectedCorner, onCornerSelect, disabled }: { rule: RuleTemplate; options: DecorationOptions; selectedCorner?: Corner; onCornerSelect?(corner: Corner): void; disabled?: boolean }) {
  const automatic = options.mode === "agent";
  const previewPriceStyle = getPriceStyle(automatic ? undefined : options.priceStyle);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Record<string, HTMLImageElement>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const stickerId = options.sticker === "template" ? rule.sticker : options.sticker;
  const autoCorner = rule.stickerCorners.find((corner) => !options.corners?.[corner]);
  const stickerSlots = (automatic ? [] : CORNERS).flatMap((corner) => {
    const slot = options.corners?.[corner];
    if (slot?.type === "sticker") return [{ corner, id: slot.sticker }];
    return !slot && corner === autoCorner && stickerId !== "none" ? [{ corner, id: stickerId }] : [];
  });
  const assetKey = JSON.stringify([...new Set(stickerSlots.map(({ id }) => id))].sort());
  useEffect(() => {
    let active = true;
    setFailed([]);
    const ids: string[] = JSON.parse(assetKey);
    void (async () => {
      const catalog = ids.length ? await window.jianji.decorationCatalog() : undefined;
      await Promise.all(ids.map(async (id) => {
        try {
          let url = catalog?.stickers.find((entry) => entry.id === id)?.url;
          if (!url && LIBRARY_STICKERS.some((entry) => entry.id === id)) url = (await window.jianji.libraryAsset(id)).url;
          if (!url) throw new Error("missing sticker");
          const image = new Image(); image.src = url; await image.decode();
          if (active) setAssets((current) => ({ ...current, [id]: image }));
        } catch { if (active) setFailed((current) => [...current, id]); }
      }));
    })().catch(() => { if (active) setFailed(ids); });
    return () => { active = false; };
  }, [assetKey]);

  useEffect(() => {
    const draw = () => {
      const context = canvas.current?.getContext("2d");
      if (!context) return;
      const width = 900, height = 1600;
      const background = context.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#ece9e2"); background.addColorStop(1, "#bfc9bf");
      context.fillStyle = background; context.fillRect(0, 0, width, height);
      context.fillStyle = "#ffffff45";
      context.beginPath(); context.ellipse(450, 730, 340, 460, -0.3, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#748572";
      context.beginPath(); context.roundRect(335, 600, 230, 420, 36); context.fill();
      context.fillStyle = "#526550"; context.fillRect(370, 545, 160, 65);
      context.fillStyle = "#eeeede"; context.fillRect(360, 710, 180, 155);
      context.fillStyle = "#526550"; context.textBaseline = "top";
      context.font = '24px sans-serif'; context.fillText("DAILY", 411, 765);

      if (options.productPrice?.trim() && ProductPriceSchema.safeParse(options.productPrice).success) {
        const style = previewPriceStyle;
        const cssColor = (color: typeof style.color) => `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
        const lines = formatProductPrice(options.productPrice).split("\n");
        const fontSize = height * priceFontSizeRatio(width, height, lines.join("\n"));
        const border = Math.round(style.strokeWidthRatio * height);
        for (const [index, text] of lines.entries()) {
          const x = width / 2, y = height * 0.13 + index * fontSize * PRICE_LINE_HEIGHT;
          context.save();
          context.textAlign = "center";
          context.font = `${fontSize}px "${DEFAULT_TEXT_FONT_FAMILY}", sans-serif`;
          // Position the visible glyph top as drawtext does, rather than the font em box.
          context.textBaseline = "alphabetic";
          const glyph = context.measureText(text);
          const baseline = y + glyph.actualBoundingBoxAscent;
          if (style.backgroundColor) {
            const padding = Math.round((style.backgroundPaddingRatio ?? 0.006) * height);
            context.fillStyle = cssColor(style.backgroundColor);
            context.fillRect(x - glyph.width / 2 - padding, y - padding, glyph.width + 2 * padding, glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent + 2 * padding);
          }
          context.lineWidth = border * 2;
          context.lineJoin = "round";
          if (style.shadow) {
            context.fillStyle = cssColor(style.shadow.color);
            context.strokeStyle = cssColor(style.shadow.color);
            const sx = x + Math.round(style.shadow.xRatio * height), sy = baseline + Math.round(style.shadow.yRatio * height);
            if (border) context.strokeText(text, sx, sy);
            context.fillText(text, sx, sy);
          }
          context.strokeStyle = cssColor(style.strokeColor);
          if (border) context.strokeText(text, x, baseline);
          context.fillStyle = cssColor(style.color);
          context.fillText(text, x, baseline);
          context.restore();
        }
      }

      for (const { corner, id } of stickerSlots) {
        const asset = assets[id];
        if (!asset || failed.includes(id)) continue;
        const angle = rule.stickerRotation * Math.PI / 180;
        const geometry = constrainedStickerPreviewGeometry({
          layer: { x: corner.endsWith("right") ? 1 - CORNER_SAFE_POLICY.cornerMargin - rule.stickerWidth : CORNER_SAFE_POLICY.cornerMargin, y: corner.startsWith("bottom") ? CORNER_SAFE_POLICY.bottomCornerStart : CORNER_SAFE_POLICY.cornerMargin, width: rule.stickerWidth, rotationDeg: rule.stickerRotation },
          frameWidth: width, frameHeight: height, sourceWidth: asset.naturalWidth, sourceHeight: asset.naturalHeight,
        });
        const imageWidth = geometry.imageWidth * width, imageHeight = geometry.imageHeight * height;
        context.save(); context.translate((geometry.x + geometry.width / 2) * width, (geometry.y + geometry.height / 2) * height);
        context.rotate(angle); context.globalAlpha = 0.94;
        context.drawImage(asset, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
        context.restore();
      }
    };
    draw();
  }, [rule, options, previewPriceStyle, assetKey, assets, failed]);

  return <section className="template-preview card" aria-label="整体模板预览">
    <div className="template-preview-picture"><canvas ref={canvas} width={900} height={1600} role="img" aria-label={automatic ? "Agent 贴纸安排示例：上方居中显示手动价格" : `${rule.name}排版示例：上方居中显示手动价格，四角可独立选择贴纸`} />
      {!automatic && onCornerSelect && CORNERS.map((corner) => <button type="button" key={corner} className={`corner-slot ${corner}`} aria-label={`编辑${CORNER_LABELS[corner]}`} aria-pressed={selectedCorner === corner} disabled={disabled} onClick={() => { onCornerSelect(corner); document.getElementById("corner-decoration-editor")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}><span>{CORNER_LABELS[corner]} · {options.corners?.[corner]?.type === "sticker" ? "贴纸" : options.corners?.[corner]?.type === "none" ? "留空" : "选择内容"}</span></button>)}
    </div>
    <div className="template-preview-info"><span className="eyebrow">{automatic ? "AGENT CAPABILITY" : "TEMPLATE PREVIEW"}</span><h2>{automatic ? "Agent 自主安排" : `${rule.name} · 整体预览`}</h2>{automatic ? <p>开始出片后，Agent 为四个角落各选贴纸。开启覆盖时，已有原贴纸的角落优先覆盖，没有覆盖层的时段补齐；具体选款和时段将在生成后确定。</p> : <><p>先看一眼贴纸放在一起的效果，再开始制作。</p><dl><div><dt>贴纸</dt><dd>{stickerId === "none" ? "不加贴纸" : `宽度为画面的 ${(rule.stickerWidth * 100).toFixed(0)}%`}</dd></div></dl></>}
      <p>{automatic ? "价格花字由 Agent 自主选择；当前仅以经典红白示例展示。" : `价格花字 · ${getPriceStyle(options.priceStyle).name}。此处为排版与花字示例；成片颜色会随所选滤镜变化。`}</p>
      {failed.length > 0 ? <p role="alert">贴纸预览加载失败，请重新选择贴纸。</p> : stickerSlots.some(({ id }) => !assets[id]) && <p role="status">正在加载贴纸预览…</p>}
      <small>{automatic ? "此处仅展示示意背景和默认花字，不代表 Agent 已作出选择。Agent 从现有 8 款中按画面选择，同批会参考使用记录减少重复，但不保证每版不同。中间仅显示手动填写的价格，开始制作前必须填写。" : "点击四角分别选择贴纸，所选内容会用于成片。中间仅显示手动填写的价格，开始制作前必须填写。未设置的角落按默认贴纸与模板规则安排；此处为 9:16 静态示例。"}</small>
    </div>
  </section>;
}
