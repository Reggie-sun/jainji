export const CORNER_SAFE_POLICY = {
  id: "corner-safe-v1" as const,
  cornerInset: 0.08,
  cornerMargin: 0.04,
  bottomCornerStart: 0.8,
  maxStickerWidth: 0.2,
  maxStickerHeight: 0.16,
  maxStickerRotation: 15,
  maxTotalStickerAreaProxy: 0.08,
};

export interface CornerSafeSticker {
  x: number;
  y: number;
  width: number;
  rotationDeg: number;
  visible: boolean;
}

export function nearestStickerCorner(layer: Pick<CornerSafeSticker, "x" | "y" | "width">): { horizontal: "left" | "right"; vertical: "top" | "bottom" } {
  return {
    horizontal: layer.x + layer.width / 2 >= 0.5 ? "right" : "left",
    vertical: layer.y >= 0.5 ? "bottom" : "top",
  };
}

export function isCornerAnchored(layer: CornerSafeSticker): boolean {
  const left = layer.x <= CORNER_SAFE_POLICY.cornerInset;
  const right = layer.x + layer.width >= 1 - CORNER_SAFE_POLICY.cornerInset;
  const top = layer.y <= CORNER_SAFE_POLICY.cornerInset;
  const bottom = layer.y >= CORNER_SAFE_POLICY.bottomCornerStart;
  return (left || right) && (top || bottom);
}

export function cornerSafeStickerIssues(layer: CornerSafeSticker): string[] {
  if (!layer.visible) return [];
  const issues: string[] = [];
  if (layer.width > CORNER_SAFE_POLICY.maxStickerWidth) issues.push("贴纸宽度不得超过画面的 20%");
  if (!isCornerAnchored(layer)) issues.push("贴纸必须放在画面四角之一");
  if (Math.abs(layer.rotationDeg) > CORNER_SAFE_POLICY.maxStickerRotation) issues.push("贴纸旋转不得超过 15°");
  return issues;
}

export function snapStickerToCorner<T extends CornerSafeSticker>(layer: T): T {
  const width = Math.min(layer.width, CORNER_SAFE_POLICY.maxStickerWidth);
  const corner = nearestStickerCorner(layer);
  return {
    ...layer,
    width,
    x: corner.horizontal === "right" ? Number((1 - CORNER_SAFE_POLICY.cornerMargin - width).toFixed(6)) : CORNER_SAFE_POLICY.cornerMargin,
    y: corner.vertical === "bottom" ? CORNER_SAFE_POLICY.bottomCornerStart : CORNER_SAFE_POLICY.cornerMargin,
    rotationDeg: Math.max(-CORNER_SAFE_POLICY.maxStickerRotation, Math.min(CORNER_SAFE_POLICY.maxStickerRotation, layer.rotationDeg)),
  };
}

interface CumulativeDragInput {
  layerX: number;
  layerY: number;
  layerWidth: number;
  pointerStartX: number;
  pointerStartY: number;
  pointerX: number;
  pointerY: number;
  stageWidth: number;
  stageHeight: number;
}

export type LayerDragSession = Pick<CumulativeDragInput, "layerX" | "layerY" | "layerWidth" | "pointerStartX" | "pointerStartY">;

export function beginLayerDrag(layer: Pick<CornerSafeSticker, "x" | "y" | "width">, pointerX: number, pointerY: number): LayerDragSession {
  return { layerX: layer.x, layerY: layer.y, layerWidth: layer.width, pointerStartX: pointerX, pointerStartY: pointerY };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function cumulativeDragPosition(input: CumulativeDragInput): { x: number; y: number } {
  const x = clamp(input.layerX + (input.pointerX - input.pointerStartX) / input.stageWidth, 0, 1 - input.layerWidth);
  const y = clamp(input.layerY + (input.pointerY - input.pointerStartY) / input.stageHeight, 0, 1);
  return { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) };
}

interface StickerPreviewGeometryInput {
  layer: Pick<CornerSafeSticker, "x" | "y" | "width" | "rotationDeg">;
  frameWidth: number;
  frameHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface StickerPreviewGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export function constrainedStickerPreviewGeometry(input: StickerPreviewGeometryInput): StickerPreviewGeometry {
  const angle = Math.abs(input.layer.rotationDeg) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const rotatedWidth = input.sourceWidth * cosine + input.sourceHeight * sine;
  const rotatedHeight = input.sourceHeight * cosine + input.sourceWidth * sine;
  const maxWidth = input.frameWidth * Math.min(input.layer.width, CORNER_SAFE_POLICY.maxStickerWidth);
  const maxHeight = input.frameHeight * CORNER_SAFE_POLICY.maxStickerHeight;
  const scale = Math.min(maxWidth / rotatedWidth, maxHeight / rotatedHeight);
  const width = rotatedWidth * scale / input.frameWidth;
  const height = rotatedHeight * scale / input.frameHeight;
  const corner = nearestStickerCorner(input.layer);
  return {
    x: corner.horizontal === "right" ? 1 - CORNER_SAFE_POLICY.cornerMargin - width : CORNER_SAFE_POLICY.cornerMargin,
    y: corner.vertical === "bottom" ? 1 - CORNER_SAFE_POLICY.cornerMargin - height : CORNER_SAFE_POLICY.cornerMargin,
    width,
    height,
    imageWidth: input.sourceWidth * scale / input.frameWidth,
    imageHeight: input.sourceHeight * scale / input.frameHeight,
  };
}
