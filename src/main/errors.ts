import type { ErrorCode } from "./domain.js";

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
  if (lower.includes("font_missing")) return new JianjiError(message.replace("font_missing:", "缺少字体："), "font_missing", "resource", false);
  if (lower.includes("sticker") && lower.includes("missing")) return new JianjiError(message, "sticker_missing", "resource", false);
  if (lower.includes("permission") || lower.includes("eacces")) return new JianjiError("输出目录没有写入权限。请选择可写目录后重试。", "permission_denied", "environment", true);
  if (lower.includes("no space") || lower.includes("disk full") || lower.includes("enospc")) return new JianjiError("磁盘空间不足。释放空间后重试。", "disk_space", "environment", true);
  return new JianjiError(message.slice(0, 2_000), fallback, "process", true);
}

export function recoveryAdvice(code: ErrorCode): string {
  switch (code) {
    case "resource_missing": return "恢复列出的字体或贴纸资源，然后重新验证模板。";
    case "font_missing": return "安装或恢复该系统字体，然后重新验证模板。";
    case "sticker_missing": return "恢复贴纸文件，或从模板中移除该图层。";
    case "permission_denied": return "选择有写权限的输出目录。";
    case "disk_space": return "释放磁盘空间后仅重试失败项。";
    case "artifact_missing": return "检查成片是否被外部程序移动，再重新导出。";
    case "interrupted": return "应用上次退出时任务未完成，可安全重试。";
    case "cancelled": return "如需继续，可重新加入队列。";
    case "encoder_missing": return "安装包含 libx264 和 AAC 的 system FFmpeg。";
    case "future_schema": return "使用支持该版本的简辑打开文件，当前版本不会降级解析。";
    default: return "检查输入与 FFmpeg 能力后，仅重试该项。";
  }
}
