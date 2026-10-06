import { randomUUID } from "node:crypto";
import type { StickerAssets } from "./builtin-stickers.js";
import type { StickerLayer } from "./domain.js";
import { fingerprintFile } from "./paths.js";

export async function assertDecorationFrameAsset(frameId: string | undefined, assets: StickerAssets): Promise<void> {
  if (!frameId) return;
  const asset = assets[frameId];
  try {
    if (asset && await fingerprintFile(asset.assetPath) === asset.assetFingerprint) return;
  } catch { /* Missing frame bytes fail admission. */ }
  throw new Error("所选边框缺失或已变化，请重新上传或选择。");
}

/** Electron's decoded bitmap uses four channels with alpha last on both platforms. */
export function assertFrameBitmap(width: number, height: number, pixels: Buffer): void {
  if (width < 4 || height < 4 || width > 4096 || height > 4096 || pixels.length !== width * height * 4) throw new Error("边框图片尺寸无效。");
  let visible = false;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha) visible = true;
    if (x >= Math.floor(width / 4) && x < Math.ceil(width * 3 / 4) && y >= Math.floor(height / 4) && y < Math.ceil(height * 3 / 4) && alpha !== 0) {
      throw new Error("边框中央半宽、半高区域必须完全透明，请上传透明 PNG 边框。");
    }
  }
  if (!visible) throw new Error("边框不能是完全空白的图片。");
}

export function decorationFrameLayers(frameId: string | undefined, assets: StickerAssets): StickerLayer[] {
  if (!frameId) return [];
  const asset = assets[frameId];
  if (!asset) throw new Error("所选边框不存在或已删除，请重新选择。");
  return [{ id: randomUUID(), type: "sticker", ...asset, frame: { id: frameId },
    x: 0, y: 0, width: 1, rotationDeg: 0, opacity: 1, zIndex: -1000, visible: true }];
}
