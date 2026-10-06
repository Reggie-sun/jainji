import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { isUploadedStickerId } from "../shared/decorations.js";
import { isUploadedFrameId } from "../shared/frames.js";
import type { StickerAssets } from "./builtin-stickers.js";
import type { UploadedStickers } from "./uploaded-stickers.js";

/** Share the existing upload/delete boundary; separate namespaces keep selection pools distinct. */
export function registerDecorationAssetHandlers(input: {
  window: BrowserWindow; assertTrustedSender(event: IpcMainInvokeEvent): void; assertIdle(): void;
  assets: StickerAssets; stickers: UploadedStickers; frames: UploadedStickers;
}): void {
  let mutation = false;
  for (const kind of ["sticker", "frame"] as const) {
    const channel = kind === "sticker" ? "decorations" : "frames";
    const label = kind === "sticker" ? "贴纸" : "边框";
    const store = kind === "sticker" ? input.stickers : input.frames;
    ipcMain.handle(`${channel}.import`, async event => {
      input.assertTrustedSender(event); input.assertIdle();
      const result = await dialog.showOpenDialog(input.window, {
        title: `上传${label}`, properties: ["openFile"],
        filters: [{ name: kind === "sticker" ? "静态贴纸图片" : "透明边框 PNG", extensions: kind === "sticker" ? ["png", "jpg", "jpeg"] : ["png"] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      input.assertIdle();
      if (mutation) throw new Error("素材正在更新，请稍后重试。");
      mutation = true;
      try {
        const imported = await store.importFile(result.filePaths[0]);
        Object.assign(input.assets, { [imported.id]: imported.asset });
        return imported.id;
      } catch {
        throw new Error(kind === "sticker"
          ? "贴纸上传失败，请选择有效的 PNG/JPG 静态图片（10 MB 以内、宽高不超过 4096 像素），并检查磁盘空间。"
          : "边框上传失败，请选择中央半宽、半高区域完全透明且四周有图案的 PNG（10 MB 以内、宽高不超过 4096 像素），并检查磁盘空间。");
      } finally { mutation = false; }
    });
    ipcMain.handle(`${channel}.remove`, async (event, raw: unknown) => {
      input.assertTrustedSender(event); input.assertIdle();
      const id = z.string().refine(kind === "sticker" ? isUploadedStickerId : isUploadedFrameId, `只能删除上传的${label}。`).parse(raw);
      if (mutation) throw new Error("素材正在更新，请稍后重试。");
      const asset = input.assets[id];
      if (!asset) throw new Error(`上传${label}不存在或已删除。`);
      mutation = true;
      delete (input.assets as Record<string, unknown>)[id];
      try { await store.remove(id); }
      catch { Object.assign(input.assets, { [id]: asset }); throw new Error(`${label}删除失败，请检查本地素材目录权限后重试。`); }
      finally { mutation = false; }
    });
  }
}
