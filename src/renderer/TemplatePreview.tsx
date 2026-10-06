import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MediaView } from "../main/media";
import type { RuleTemplate } from "../shared/agent";
import { LIBRARY_STICKERS } from "../shared/asset-library";
import { CORNERS, CORNER_LABELS, decorationDisplaySeconds, decorationTimingContext, displayTextSettings, formatProductPrice, ProductPriceSchema, type Corner, type DecorationOptions, type DisplayTextSettings } from "../shared/decorations";
import { constrainedStickerPreviewGeometry, CORNER_SAFE_POLICY } from "../shared/layout-policy";
import { getPriceStyle, PRICE_LINE_HEIGHT, priceFontSizeRatio, priceTextGeometry } from "../shared/price-styles";
import "./template-preview.css";

export function TemplatePreview({ rule, options, selectedCorner, onCornerSelect, disabled, media, dimensions = { width: 900, height: 1600 }, onDisplayTextChange }: { rule: RuleTemplate; options: DecorationOptions; selectedCorner?: Corner; onCornerSelect?(corner: Corner): void; disabled?: boolean; media?: MediaView; dimensions?: { width: number; height: number }; onDisplayTextChange?(value: DisplayTextSettings): void }) {
  const automatic = options.mode === "agent";
  const previewPriceStyle = getPriceStyle(automatic ? undefined : options.priceStyle);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; settings: DisplayTextSettings }>();
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  useEffect(() => { setTimeSeconds(0); setPlaybackFailed(false); }, [media?.id]);
  const placement = displayTextSettings(options);
  const displaySeconds = decorationDisplaySeconds(options.displayMode === "first-3s" ? "first-5s" : options.displayMode);
  const fadeEnd = media && displaySeconds ? Math.min(displaySeconds, media.durationMs / 1000) : undefined;
  const textOpacity = fadeEnd === undefined ? 1 : Math.max(0, Math.min(1, (fadeEnd - timeSeconds) / Math.max(.001, Math.min(.5, fadeEnd))));
  const validText = Boolean(options.productPrice?.trim() && ProductPriceSchema.safeParse(options.productPrice).success);
  const geometry = priceTextGeometry(dimensions.width, dimensions.height, validText ? formatProductPrice(options.productPrice!) : "", placement);
  const move = (x: number, y: number) => {
    const next = priceTextGeometry(dimensions.width, dimensions.height, formatProductPrice(options.productPrice!), { x, y });
    onDisplayTextChange?.({ enabled: placement.enabled, x: next.x, y: next.y });
  };
  const movePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current, bounds = stage.current?.getBoundingClientRect();
    if (!current || current.pointerId !== event.pointerId || !bounds || disabled) return;
    move(current.settings.x + (event.clientX - current.x) / bounds.width, current.settings.y + (event.clientY - current.y) / bounds.height);
  };
  useEffect(() => { drag.current = undefined; }, [media?.id, disabled, placement.enabled]);
  const [assets, setAssets] = useState<Record<string, HTMLImageElement>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const stickerId = options.sticker === "template" ? rule.sticker : options.sticker;
  const autoCorner = rule.stickerCorners.find((corner) => !options.corners?.[corner]);
  const previewStickerWidth = Math.min(rule.stickerWidth, CORNER_SAFE_POLICY.maxStickerWidth);
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
      const { width, height } = dimensions;
      context.clearRect(0, 0, width, height);
      if (!media) {
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
      }

      if (placement.enabled && options.productPrice?.trim() && ProductPriceSchema.safeParse(options.productPrice).success) {
        const style = previewPriceStyle;
        const cssColor = (color: typeof style.color) => `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
        const lines = formatProductPrice(options.productPrice).split("\n");
        const fontSize = height * priceFontSizeRatio(width, height, lines.join("\n"));
        const border = Math.round(style.strokeWidthRatio * height);
        for (const [index, text] of lines.entries()) {
          const x = width * geometry.x, y = height * geometry.y + index * fontSize * PRICE_LINE_HEIGHT;
          context.save();
          context.globalAlpha = textOpacity;
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
          layer: { x: corner.endsWith("right") ? 1 - CORNER_SAFE_POLICY.cornerMargin - previewStickerWidth : CORNER_SAFE_POLICY.cornerMargin, y: corner.startsWith("bottom") ? CORNER_SAFE_POLICY.bottomCornerStart : CORNER_SAFE_POLICY.cornerMargin, width: previewStickerWidth, rotationDeg: rule.stickerRotation },
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
  }, [rule, options, previewPriceStyle, assetKey, assets, failed, dimensions.width, dimensions.height, media?.id, textOpacity]);

  return <section className="template-preview card" aria-label="整体模板预览">
    <div className="template-preview-picture" ref={stage}>
      {media && <video key={media.id} src={media.previewUrl} controls playsInline controlsList="nofullscreen" disablePictureInPicture muted preload="metadata" aria-label={`播放 ${media.displayName}`} onTimeUpdate={event => setTimeSeconds(event.currentTarget.currentTime)} onError={() => setPlaybackFailed(true)} />}
      <canvas ref={canvas} width={dimensions.width} height={dimensions.height} role="img" aria-label={`${media?.displayName ?? rule.name} · 展示文字位置与贴纸预览`} />
      {placement.enabled && validText && textOpacity > 0 && onDisplayTextChange && <button type="button" className="display-text-drag" aria-label="拖动展示文字位置" disabled={disabled} style={{ left: `${(geometry.x - geometry.width / 2) * 100}%`, top: `${(geometry.y - 0.01) * 100}%`, width: `${geometry.width * 100}%`, height: `${geometry.height * 100}%` }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, settings: { ...placement, x: geometry.x, y: geometry.y } }; }}
        onPointerMove={movePointer} onPointerUp={event => { movePointer(event); drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
        onKeyDown={event => { const step = event.shiftKey ? 0.05 : 0.01; if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); move(geometry.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), geometry.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)); }}><span>拖动文字</span></button>}
      {!automatic && onCornerSelect && CORNERS.map((corner) => <button type="button" key={corner} className={`corner-slot ${corner}`} aria-label={`编辑${CORNER_LABELS[corner]}`} aria-pressed={selectedCorner === corner} disabled={disabled} onClick={() => { onCornerSelect(corner); document.getElementById("corner-decoration-editor")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}><span>{CORNER_LABELS[corner]} · {options.corners?.[corner]?.type === "sticker" ? "贴纸" : options.corners?.[corner]?.type === "none" ? "留空" : "选择内容"}</span></button>)}
    </div>
    <div className="template-preview-info"><h2>{media ? `${media.displayName} · 素材预览` : automatic ? "Agent 自主安排" : `${rule.name} · 整体预览`}</h2>{automatic ? <p>开始出片后，Agent 为四角准备候补贴纸。关闭覆盖时保留原贴纸，只补空缺角落和时段；开启覆盖时优先显示覆盖层，其余时段补齐。具体选款和时段将在识别后确定。</p> : <><p>先看一眼贴纸放在一起的效果，再开始制作。</p><dl><div><dt>贴纸</dt><dd>{stickerId === "none" ? "不加贴纸" : `宽度不超过画面的 ${(previewStickerWidth * 100).toFixed(0)}%`}</dd></div></dl></>}
      <p>{automatic ? "价格花字由 Agent 自主选择；当前仅以经典红白示例展示。" : `价格花字 · ${getPriceStyle(options.priceStyle).name}。此处为排版与花字示例；成片颜色会随所选滤镜变化。`}</p>
      <p>{decorationTimingContext(options.displayMode)}{media ? "可播放、暂停或拖动视频进度，检查文字的位置与显示时段。" : "此处为显示期间的静态示例。"}</p>
      {playbackFailed && <p role="alert">无法播放此视频，请检查原文件是否存在及其编码格式。</p>}
      {failed.length > 0 ? <p role="alert">贴纸预览加载失败，请重新选择贴纸。</p> : stickerSlots.some(({ id }) => !assets[id]) && <p role="status">正在加载贴纸预览…</p>}
      <small>{media ? "以当前素材和导出画布预览文字位置；未应用导出滤镜。" : "此处使用示意背景预览排版。"}开启展示文字的素材只使用手动输入内容；关闭时不添加文字。{automatic ? "Agent 花字与贴纸仅为示意，具体选择以冻结模板为准。" : "点击四角可分别选择贴纸。"}预览不代表最终成片已验收。</small>
    </div>
  </section>;
}
