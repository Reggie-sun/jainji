export const LEGACY_CORNER_SAFE_POLICY = {
  id: "corner-safe-v1" as const,
  cornerInset: 0.08,
  cornerMargin: 0.04,
  bottomCornerStart: 0.8,
  maxStickerWidth: 0.2,
  maxStickerHeight: 0.16,
  maxStickerRotation: 15,
  maxTotalStickerAreaProxy: 0.08,
};

export const CORNER_SAFE_POLICY = {
  id: "corner-safe-v2" as const,
  cornerInset: 0.03,
  cornerMargin: 0.015,
  bottomCornerStart: 0.88,
  maxStickerWidth: 0.1,
  maxStickerHeight: 0.1,
  maxStickerRotation: 15,
  maxTotalStickerAreaProxy: 0.03,
};

export type CornerSafePolicy = typeof LEGACY_CORNER_SAFE_POLICY | typeof CORNER_SAFE_POLICY;
export type CornerSafePolicyId = CornerSafePolicy["id"];

export function getCornerSafePolicy(id: CornerSafePolicyId | undefined): CornerSafePolicy | undefined {
  if (id === LEGACY_CORNER_SAFE_POLICY.id) return LEGACY_CORNER_SAFE_POLICY;
  if (id === CORNER_SAFE_POLICY.id) return CORNER_SAFE_POLICY;
  return undefined;
}

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

export function isCornerAnchored(layer: CornerSafeSticker, policy: CornerSafePolicy = CORNER_SAFE_POLICY): boolean {
  const left = layer.x <= policy.cornerInset;
  const right = layer.x + layer.width >= 1 - policy.cornerInset;
  const top = layer.y <= policy.cornerInset;
  const bottom = layer.y >= policy.bottomCornerStart;
  return (left || right) && (top || bottom);
}

export function cornerSafeStickerIssues(layer: CornerSafeSticker, policy: CornerSafePolicy = CORNER_SAFE_POLICY): string[] {
  if (!layer.visible) return [];
  const issues: string[] = [];
  if (layer.width > policy.maxStickerWidth) issues.push(`贴纸宽度不得超过画面的 ${policy.maxStickerWidth * 100}%`);
  if (!isCornerAnchored(layer, policy)) issues.push("贴纸必须贴近画面四角之一");
  if (Math.abs(layer.rotationDeg) > policy.maxStickerRotation) issues.push(`贴纸旋转不得超过 ${policy.maxStickerRotation}°`);
  return issues;
}

export function snapStickerToCorner<T extends CornerSafeSticker>(layer: T, policy: CornerSafePolicy = CORNER_SAFE_POLICY): T {
  const width = Math.min(layer.width, policy.maxStickerWidth);
  const corner = nearestStickerCorner(layer);
  return {
    ...layer,
    width,
    x: corner.horizontal === "right" ? Number((1 - policy.cornerMargin - width).toFixed(6)) : policy.cornerMargin,
    y: corner.vertical === "bottom" ? policy.bottomCornerStart : policy.cornerMargin,
    rotationDeg: Math.max(-policy.maxStickerRotation, Math.min(policy.maxStickerRotation, layer.rotationDeg)),
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
  policy?: CornerSafePolicy;
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
  const policy = input.policy ?? CORNER_SAFE_POLICY;
  const angle = Math.abs(input.layer.rotationDeg) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const rotatedWidth = input.sourceWidth * cosine + input.sourceHeight * sine;
  const rotatedHeight = input.sourceHeight * cosine + input.sourceWidth * sine;
  const maxWidth = input.frameWidth * Math.min(input.layer.width, policy.maxStickerWidth);
  const maxHeight = input.frameHeight * policy.maxStickerHeight;
  const scale = Math.min(maxWidth / rotatedWidth, maxHeight / rotatedHeight);
  const width = rotatedWidth * scale / input.frameWidth;
  const height = rotatedHeight * scale / input.frameHeight;
  const corner = nearestStickerCorner(input.layer);
  return {
    x: corner.horizontal === "right" ? 1 - policy.cornerMargin - width : policy.cornerMargin,
    y: corner.vertical === "bottom" ? 1 - policy.cornerMargin - height : policy.cornerMargin,
    width,
    height,
    imageWidth: input.sourceWidth * scale / input.frameWidth,
    imageHeight: input.sourceHeight * scale / input.frameHeight,
  };
}
