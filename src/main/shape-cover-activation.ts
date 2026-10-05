import type { AgentStartInput } from "../shared/agent.js";
import type { CoverSticker } from "../shared/cover-sticker.js";
import { JianjiError } from "./errors.js";

const unsafe = (reason: string): never => { throw new JianjiError(`UNSAFE: ${reason}`, "input_invalid", "input", false); };
export const HYBRID_PRODUCT_ENABLED = true;

/** Legacy missing intent preserves its existing interpretation. Hybrid never issues strict M4 authority. */
export function assertShapeCoverProductEntry(input: AgentStartInput, cover: CoverSticker | undefined, assisted: boolean): void {
  if (input.coverStrategy === undefined) return;
  if (!cover?.enabled || cover.trackingMode !== "agent" || assisted) unsafe("形状匹配仅用于新的自动覆盖，不支持关闭覆盖、手动或半自动草稿。");
  if (input.sourceStickerRefresh) unsafe("形状匹配不能在同一请求中重新检查源事实，请先完成独立源检查。");
  if (input.exportFormat !== undefined && input.exportFormat !== "mp4") unsafe("形状匹配产品入口仅允许 MP4。");
  if (input.decorations?.mode === "random") unsafe("本地随机与形状匹配的组合尚未开放。");
  if (input.douyinUpload) unsafe("形状匹配与千川上传的组合尚未开放。");
  if (!HYBRID_PRODUCT_ENABLED) unsafe("形状匹配产品入口尚未启用 PRODUCT_DISABLED：Activation 最终验证尚未完成。");
}
