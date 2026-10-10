import { z } from "zod";
import { QianchuanEgressSchema } from "./qianchuan-egress.js";

export const REMOTE_CHUNK_BYTES = 4 * 1024 * 1024;
export const RemoteDisplayNameSchema = z.string().min(1).max(100).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)).transform(value => value.trim());
export const RemoteFileSchema = z.object({
  advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(20 * 1024 ** 3),
  fileName: z.string().min(1).max(240).refine(value => value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(value)),
}).strict();
export const RemoteRequestSchema = z.object({
  version: z.literal(1),
  route: QianchuanEgressSchema.refine(value => value.mode === "remote-browser"),
  action: z.enum(["open", "existing", "assert-closed", "close", "probe", "file-status", "file-append", "desktop-sync"]),
  advertiserId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  file: RemoteFileSchema.optional(), offset: z.number().int().nonnegative().optional(),
  displayName: RemoteDisplayNameSchema.optional(),
  bodyBytes: z.number().int().min(0).max(REMOTE_CHUNK_BYTES),
}).strict().superRefine((value, ctx) => {
  if (value.action === "desktop-sync" ? value.displayName === undefined : value.displayName !== undefined) ctx.addIssue({ code: "custom", message: "Invalid desktop metadata" });
  if (value.action.startsWith("file-") ? !value.file || value.file.advertiserId !== value.advertiserId || (value.action === "file-append" ? value.offset === undefined || !value.bodyBytes : value.bodyBytes !== 0) : !!value.file || value.bodyBytes !== 0 || value.offset !== undefined) ctx.addIssue({ code: "custom", message: "Invalid remote request" });
});
export type RemoteRequest = z.infer<typeof RemoteRequestSchema>;
export const RemoteBrowserSchema = z.object({ port: z.number().int().min(1).max(65535), browserPath: z.string().regex(/^\/devtools\/browser\/[a-zA-Z0-9-]+$/) }).strict();
export const RemoteFileStatusSchema = z.object({ offset: z.number().int().nonnegative(), complete: z.boolean(), path: z.string().startsWith("/").max(4096) }).strict();
