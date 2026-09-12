import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults";
import { useEffect, useRef, useState } from "react";
import type { RuleTemplate } from "../shared/agent";
import { LIBRARY_STICKERS } from "../shared/asset-library";
import { CORNERS, CORNER_LABELS, formatProductPrice, ProductPriceSchema, type Corner, type DecorationOptions } from "../shared/decorations";
import { constrainedStickerPreviewGeometry, CORNER_SAFE_POLICY } from "../shared/layout-policy";
import "./template-preview.css";

export function TemplatePreview({ rule, options, selectedCorner, onCornerSelect, disabled }: { rule: RuleTemplate; options: DecorationOptions; selectedCorner?: Corner; onCornerSelect?(corner: Corner): void; disabled?: boolean }) {
  const automatic = options.mode === "agent";
  const canvas = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Record<string, HTMLImageElement>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const stickerId = options.sticker === "template" ? rule.sticker : options.sticker;
  const autoCorner = rule.stickerCorners.find((corner) => corner !== "top-left" && !options.corners?.[corner]);
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

      const drawText = (corner: Corner, text: string, family: string) => {
        const fontSize = rule.maxFontSize * width;
        context.font = `${fontSize}px "${family}", sans-serif`;
        context.textBaseline = "top";
        const x = width * (corner.endsWith("right") ? 0.54 : 0.04);
        const y = height * (corner.startsWith("bottom") ? 0.9 : 0.04);
        const padding = 0.006 * height;
        context.fillStyle = `rgba(${rule.backgroundColor.join(",")})`;
        context.fillRect(x - padding, y - padding, Math.min(context.measureText(text).width, width * 0.42) + padding * 2, fontSize + padding * 2);
        context.fillStyle = `rgb(${rule.textColor.join(",")})`;
        context.fillText(text, x, y, width * 0.42);
      };
      if (!automatic && !options.corners?.["top-left"]) drawText("top-left", rule.previewCaption, options.fontFamily);
      for (const corner of automatic ? [] : CORNERS) {
        const slot = options.corners?.[corner];
        if (slot?.type === "text") drawText(corner, slot.text, slot.fontFamily);
      }

      if (options.productPrice?.trim() && ProductPriceSchema.safeParse(options.productPrice).success) {
        context.save();
        context.textAlign = "center";
        context.font = `72px "${DEFAULT_TEXT_FONT_FAMILY}", sans-serif`;
        context.lineWidth = 8;
        context.lineJoin = "round";
        context.strokeStyle = "#fff8ed";
        context.strokeText(formatProductPrice(options.productPrice), width / 2, height * 0.13);
        context.fillStyle = "#df303e";
        context.fillText(formatProductPrice(options.productPrice), width / 2, height * 0.13);
        context.restore();
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
    document.fonts.addEventListener("loadingdone", draw);
    return () => document.fonts.removeEventListener("loadingdone", draw);
  }, [rule, options, assetKey, assets, failed]);

  return <section className="template-preview card" aria-label="整体模板预览">
    <div className="template-preview-picture"><canvas ref={canvas} width={900} height={1600} role="img" aria-label={`${rule.name}排版示例：上方居中显示手动价格，四角可独立选择贴纸或文字`} />
      {!automatic && onCornerSelect && CORNERS.map((corner) => <button type="button" key={corner} className={`corner-slot ${corner}`} aria-label={`编辑${CORNER_LABELS[corner]}`} aria-pressed={selectedCorner === corner} disabled={disabled} onClick={() => { onCornerSelect(corner); document.getElementById("corner-decoration-editor")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}><span>{CORNER_LABELS[corner]} · {options.corners?.[corner]?.type === "text" ? "文字" : options.corners?.[corner]?.type === "sticker" ? "贴纸" : options.corners?.[corner]?.type === "none" ? "留空" : "选择内容"}</span></button>)}
    </div>
    <div className="template-preview-info"><span className="eyebrow">TEMPLATE PREVIEW</span><h2>{rule.name} · {automatic ? "Agent 自动安排" : "整体预览"}</h2>{automatic ? <p>开始出片后，Agent 根据每条素材决定使用哪些角落，也可以全部留空。具体贴纸与文字将在生成后确定。</p> : <><p>先看一眼贴纸与文字放在一起的效果，再开始制作。</p><dl><div><dt>文字</dt><dd>{options.fontFamily} · 字号为画面宽度的 {(rule.maxFontSize * 100).toFixed(1)}%</dd></div><div><dt>颜色</dt><dd><span className="preview-color" style={{ backgroundColor: `rgb(${rule.textColor.join(",")})` }} />#{rule.textColor.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}</dd></div><div><dt>贴纸</dt><dd>{stickerId === "none" ? "不加贴纸" : `宽度为画面的 ${(rule.stickerWidth * 100).toFixed(0)}%`}</dd></div></dl></>}
      {failed.length > 0 ? <p role="alert">贴纸预览加载失败，请重新选择贴纸。</p> : stickerSlots.some(({ id }) => !assets[id]) && <p role="status">正在加载贴纸预览…</p>}
      <small>{automatic ? "此处仅展示示意背景，不代表 Agent 已作出选择。中间仅显示手动填写的价格，开始制作前必须填写。" : "点击四角分别选择贴纸、文字与字体，所选内容会用于成片。中间仅显示手动填写的价格，开始制作前必须填写。未设置的角落由 Agent 根据素材安排；此处为 9:16 静态示例。"}</small>
    </div>
  </section>;
}
