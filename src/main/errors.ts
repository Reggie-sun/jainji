import type { ErrorCode } from "./domain.js";
import type { KnowledgeProductionStage } from "../shared/source-sticker-knowledge-audit.js";

export class JianjiError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly stage: "input" | "resource" | "environment" | "process" | "verify" | "publish" | "recovery",
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "JianjiError";
  }
}

export function classifyError(error: unknown, fallback: ErrorCode = "ffmpeg_failed"): JianjiError {
  if (error instanceof JianjiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EPERM" || code === "EACCES" || /\b(?:eperm|eacces)\b/.test(lower) || lower.includes("operation not permitted") || lower.includes("permission")) {
    return new JianjiError("文件读写被系统拒绝。请检查素材和输出目录权限，或关闭占用文件的程序后重试。", "permission_denied", "environment", true);
  }
  if (code === "ENOSPC" || lower.includes("no space") || lower.includes("disk full") || lower.includes("enospc")) return new JianjiError("磁盘空间不足。释放空间后重试。", "disk_space", "environment", true);
  if (lower.includes("font_missing")) return new JianjiError(message.replace("font_missing:", "缺少字体："), "font_missing", "resource", false);
  if (lower.includes("sticker") && lower.includes("missing")) return new JianjiError(message, "sticker_missing", "resource", false);
  return new JianjiError(message.slice(0, 2_000), fallback, "process", true);
}

export function preparationFailureMessage(error: unknown, stage: KnowledgeProductionStage): string {
  const failure = classifyError(error);
  // Only local descriptions reach the renderer; raw OS/model details may contain paths or keys.
  switch (failure.code) {
    case "permission_denied": return "文件读写权限不足或文件被占用。请检查素材和输出目录权限，或关闭占用文件的程序后重新生成。";
    case "disk_space": return "磁盘空间不足。请释放临时目录和输出目录所在磁盘的空间后重新生成。";
    case "font_missing": return "所需字体不可用。请安装或恢复字体后重新生成。";
    case "sticker_missing": return "贴纸资源不可用。请恢复贴纸或重新选择后生成。";
    case "resource_missing": return "模板资源不可用。请检查字体和贴纸后重新生成。";
  }
  const stages: Record<KnowledgeProductionStage, string> = {
    waiting: "制作准备", knowledge: "原贴纸知识检查", frames: "原始素材抽帧", "cover-selection": "覆盖贴纸选材",
    creative: "包装方案生成", prepare: "本地模板准备", preview: "导出样片准备", reconcile: "源贴纸结果核对", enqueue: "导出提交",
  };
  return `${stages[stage]}失败。请检查素材、模板资源和输出目录后重新生成。`;
}

export function recoveryAdvice(code: ErrorCode): string {
  switch (code) {
    case "resource_missing": return "恢复列出的字体或贴纸资源，然后重新验证模板。";
    case "font_missing": return "安装或恢复该系统字体，然后重新验证模板。";
    case "sticker_missing": return "恢复贴纸文件，或从模板中移除该图层。";
    case "permission_denied": return "检查素材和输出目录的读写权限，关闭占用文件的程序；必要时选择其他输出目录。";
    case "disk_space": return "释放磁盘空间后仅重试失败项。";
    case "artifact_missing": return "检查成片是否被外部程序移动，再重新导出。";
    case "interrupted": return "应用上次退出时任务未完成，可安全重试。";
    case "cancelled": return "如需继续，可重新加入队列。";
    case "encoder_missing": return "安装包含 libx264 和 AAC 的 system FFmpeg。";
    case "future_schema": return "使用支持该版本的简辑打开文件，当前版本不会降级解析。";
    default: return "检查输入与 FFmpeg 能力后，仅重试该项。";
  }
}
