import { Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import { encodeRgbaPng } from "./builtin-stickers.js";

/** Keep one recoverable desktop window while explicitly enabled schedules run. */
export class AutomationBackground {
  private tray?: Tray;
  constructor(private readonly window: () => BrowserWindow | undefined, private readonly quit: () => void) {}
  hide(): boolean {
    try {
      if (!this.tray) {
        const pixels = new Uint8Array(24 * 24 * 4);
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
          const white = (x >= 11 && x <= 12 && y >= 5 && y <= 12) || (y >= 11 && y <= 12 && x >= 11 && x <= 18);
          pixels.set(white ? [255, 255, 255, 255] : [13, 125, 107, 255], (y * 24 + x) * 4);
        }
        this.tray = new Tray(nativeImage.createFromBuffer(encodeRgbaPng(pixels, 24, 24)));
        this.tray.setToolTip("简辑 · 定时任务在后台运行");
        this.tray.setContextMenu(Menu.buildFromTemplate([
          { label: "打开简辑", click: () => this.show() },
          { label: "退出简辑并停止定时任务", click: this.quit },
        ]));
        this.tray.on("click", () => this.show());
      }
      this.window()?.hide(); return true;
    } catch { this.show(); return false; }
  }
  show(): void {
    const window = this.window();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  dispose(): void { this.tray?.destroy(); this.tray = undefined; }
}
