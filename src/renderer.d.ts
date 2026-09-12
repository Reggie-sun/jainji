import type { DesktopApi } from "./main/preload";

declare global {
  interface Window { jianji: DesktopApi; }
}
export {};
