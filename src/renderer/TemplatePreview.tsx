import { useEffect, useRef, useState } from "react";
import type { RuleTemplate } from "../shared/agent";
import { LIBRARY_STICKERS } from "../shared/asset-library";
import type { DecorationOptions } from "../shared/decorations";
import { constrainedStickerPreviewGeometry, CORNER_SAFE_POLICY } from "../shared/layout-policy";
import "./template-preview.css";

export function TemplatePreview({ rule, options }: { rule: RuleTemplate; options: DecorationOptions }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [asset, setAsset] = useState<{ id: string; image: HTMLImageElement }>();
  const [failed, setFailed] = useState("");
  const stickerId = options.sticker === "template" ? rule.sticker : options.sticker;

  useEffect(() => {
    if (stickerId === "none") return;
    let active = true;
    setFailed("");
    void (async () => {
      const catalog = await window.jianji.decorationCatalog();
      let url = catalog.stickers.find((entry) => entry.id === stickerId)?.url;
      if (!url && LIBRARY_STICKERS.some((entry) => entry.id === stickerId)) url = (await window.jianji.libraryAsset(stickerId)).url;
      if (!url) throw new Error("missing sticker");
      const image = new Image();
      image.src = url;
      await image.decode();
      if (active) setAsset({ id: stickerId, image });
    })().catch(() => { if (active) setFailed(stickerId); });
    return () => { active = false; };
  }, [stickerId]);

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

      // A single sample caption leaves the other corners available for the sticker.
      const fontSize = rule.maxFontSize * width;
      context.font = `${fontSize}px "${options.fontFamily}", sans-serif`;
      const padding = 0.006 * height;
      context.fillStyle = `rgba(${rule.backgroundColor.join(",")})`;
      context.fillRect(width * 0.04 - padding, height * 0.04 - padding, context.measureText(rule.previewCaption).width + padding * 2, fontSize + padding * 2);
      context.fillStyle = `rgb(${rule.textColor.join(",")})`;
      context.fillText(rule.previewCaption, width * 0.04, height * 0.04);

      context.save();
      context.textAlign = "center";
      context.font = `900 72px "${options.fontFamily}", sans-serif`;
      context.lineWidth = 8;
      context.lineJoin = "round";
      context.strokeStyle = "#fff8ed";
      context.strokeText("¥ XX.XX", width / 2, height * 0.13);
      context.fillStyle = "#df303e";
      context.fillText("¥ XX.XX", width / 2, height * 0.13);
      context.font = `24px "${options.fontFamily}", sans-serif`;
      context.fillStyle = "#775653";
      context.fillText("价格占位", width / 2, height * 0.19);

      const slotSize = width * 0.2;
      const slotMargin = width * CORNER_SAFE_POLICY.cornerMargin;
      const slotY = height - slotMargin - slotSize;
      for (const [x, label] of [[slotMargin, "左下贴纸"], [width - slotMargin - slotSize, "右下贴纸"]] as const) {
        context.fillStyle = "#ffffff99";
        context.strokeStyle = "#748572";
        context.lineWidth = 2;
        context.setLineDash([10, 8]);
        context.beginPath();
        context.roundRect(x, slotY, slotSize, slotSize, 16);
        context.fill();
        context.stroke();
        context.fillStyle = "#526550";
        context.textBaseline = "middle";
        context.fillText(label, x + slotSize / 2, slotY + slotSize / 2);
      }
      context.restore();

      if (stickerId !== "none" && asset?.id === stickerId) {
        const corner = rule.stickerCorners.find((entry) => entry !== "top-left")!;
        const angle = rule.stickerRotation * Math.PI / 180;
        const geometry = constrainedStickerPreviewGeometry({
          layer: { x: corner.endsWith("right") ? 1 - CORNER_SAFE_POLICY.cornerMargin - rule.stickerWidth : CORNER_SAFE_POLICY.cornerMargin, y: corner.startsWith("bottom") ? CORNER_SAFE_POLICY.bottomCornerStart : CORNER_SAFE_POLICY.cornerMargin, width: rule.stickerWidth, rotationDeg: rule.stickerRotation },
          frameWidth: width, frameHeight: height, sourceWidth: asset.image.naturalWidth, sourceHeight: asset.image.naturalHeight,
        });
        const imageWidth = geometry.imageWidth * width, imageHeight = geometry.imageHeight * height;
        context.save(); context.translate((geometry.x + geometry.width / 2) * width, (geometry.y + geometry.height / 2) * height);
        context.rotate(angle); context.globalAlpha = 0.94;
        context.drawImage(asset.image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
        context.restore();
      }
    };
    draw();
    document.fonts.addEventListener("loadingdone", draw);
    return () => document.fonts.removeEventListener("loadingdone", draw);
  }, [rule, options.fontFamily, stickerId, asset]);

  return <section className="template-preview card" aria-label="整体模板预览">
    <div className="template-preview-picture"><canvas ref={canvas} width={900} height={1600} role="img" aria-label={`${rule.name}排版示例：左上角文字“${rule.previewCaption}”，上方居中价格占位，左下和右下贴纸占位，${stickerId === "none" ? "不加贴纸" : "角落贴纸"}`} /></div>
    <div className="template-preview-info"><span className="eyebrow">TEMPLATE PREVIEW</span><h2>{rule.name} · 整体预览</h2><p>先看一眼贴纸与文字放在一起的效果，再开始制作。</p><dl><div><dt>文字</dt><dd>{options.fontFamily} · 字号为画面宽度的 {(rule.maxFontSize * 100).toFixed(1)}%</dd></div><div><dt>颜色</dt><dd><span className="preview-color" style={{ backgroundColor: `rgb(${rule.textColor.join(",")})` }} />#{rule.textColor.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}</dd></div><div><dt>贴纸</dt><dd>{stickerId === "none" ? "不加贴纸" : `宽度为画面的 ${(rule.stickerWidth * 100).toFixed(0)}%`}</dd></div></dl>
      {stickerId !== "none" && (failed === stickerId ? <p role="alert">贴纸预览加载失败，请重新选择贴纸。</p> : asset?.id !== stickerId && <p role="status">正在加载贴纸预览…</p>)}
      <small>9:16 静态排版示例。上方价格与下方两个虚线框仅为占位示意，不会写入成片；真实价格需自行提供。切换模板、贴纸或字体即可预览；实际文案、字号与位置由 Agent 根据素材调整。</small>
    </div>
  </section>;
}
