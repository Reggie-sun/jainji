import { z } from "zod";

export const FEEDBACK_REPOSITORY = "Reggie-sun/jainji";
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
export const FeedbackScreenshotSchema = z.object({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(4).max(Math.ceil(MAX_FEEDBACK_IMAGE_BYTES / 3) * 4),
}).strict();
export const BugFeedbackSchema = z.object({
  feedbackId: z.string().uuid(),
  description: z.string().trim().min(5, "请至少填写 5 个字的问题描述。").max(8000),
  page: z.enum(["connection", "import", "templates", "results"]),
  screenshot: FeedbackScreenshotSchema.optional(),
}).strict();
export type FeedbackScreenshot = z.infer<typeof FeedbackScreenshotSchema>;
export type BugFeedback = z.infer<typeof BugFeedbackSchema>;
export type FeedbackStatus = { configured: boolean; repository: string; credentialSource: "environment" | "local" | "none" };
export const FeedbackReceiptSchema = z.object({
  feedbackId: z.string().uuid(),
  issueNumber: z.number().int().positive().safe(),
  issueUrl: z.string(),
  hasScreenshot: z.boolean(),
}).strict().refine((value) => value.issueUrl === `https://github.com/${FEEDBACK_REPOSITORY}/issues/${value.issueNumber}`);
export type FeedbackReceipt = z.infer<typeof FeedbackReceiptSchema>;
export type FeedbackHistoryEntry = { feedbackId: string; createdAt: string; description: string; receipt?: FeedbackReceipt };

/** Redact common pasted credentials and paths; arbitrary prose still needs user review. */
export function redactFeedback(text: string): string {
  return text
    .replace(/<!--[^]*?-->/g, "[REDACTED]")
    .replace(/(?:authorization|cookie)\s*["']?\s*[:=][^\r\n]*/gi, "[REDACTED]")
    .replace(/([\w-]*(?:token|password|secret|api[_-]?key|session)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(?:https?:\/\/|file:\/\/)[^\s<>"']+/gi, "[REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"']+|\/(?:home|Users|tmp|var|mnt|media)\/[^\s<>"']+/g, "[REDACTED]")
    .slice(0, 8000);
}
