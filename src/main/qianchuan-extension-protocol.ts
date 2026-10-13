import { z } from "zod";
import { QianchuanCurrentAccountSchema } from "../shared/qianchuan-plan-selection.js";

export const QIANCHUAN_EXTENSION_ID = "piikkbehnnhbhaolgflpmnkpneejdncm";
export const QIANCHUAN_EXTENSION_ORIGIN = `chrome-extension://${QIANCHUAN_EXTENSION_ID}/`;
export const QIANCHUAN_NATIVE_HOST = "com.jianji.qianchuan";
export const EXTENSION_MESSAGE_BYTES = 1024 * 1024;
export const ExtensionSnapshotSchema = z.object({ tabId: z.number().int().nonnegative().safe(), documentId: z.string().uuid(),
  account: QianchuanCurrentAccountSchema.extend({ name: QianchuanCurrentAccountSchema.shape.name.unwrap() }),
  gfversion: z.string().max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict();
export const ExtensionProcessSchema = z.object({ pid: z.number().int().min(2).safe(), profile: z.string().min(1).max(4096),
  profileDirectory: z.string().min(1).max(100).refine(value => !/[\\/\u0000-\u001f]/.test(value) && ![".", ".."].includes(value)),
}).strict();
export const ExtensionHelloSchema = ExtensionProcessSchema.extend({ kind: z.literal("hello"), version: z.literal(1), token: z.string().regex(/^[A-Za-z0-9._~-]{32,256}$/) }).strict();
export type ExtensionSnapshot = z.infer<typeof ExtensionSnapshotSchema>;
export type ExtensionProcess = z.infer<typeof ExtensionProcessSchema>;
export type ExtensionOperation = { kind: "identity" } | { kind: "request"; snapshot: ExtensionSnapshot; path: "/ad/api/v1/account/user-list" | "/ad/api/v1/account/user/info"; params: Record<string, string | number>; headers: Record<string, string> } |
  { kind: "switch"; snapshot: ExtensionSnapshot; chosen: ExtensionSnapshot["account"] } | { kind: "plans"; snapshot: ExtensionSnapshot };
export type ExtensionCall = (operation: ExtensionOperation, signal?: AbortSignal) => Promise<unknown>;
export const extensionUnavailable = () => new Error("千川扩展尚未连接该账号 Chrome，请安装或启用简辑千川扩展，保持对应网页打开后刷新；VPS 还需 SSH 扩展通道就绪。");
export const extensionChanged = () => new Error("网页账户或扩展连接已变化，请刷新后重选；未自动重试切换。");
export function sameExtensionSnapshot(left: ExtensionSnapshot, right: ExtensionSnapshot): boolean {
  return left.tabId === right.tabId && left.documentId === right.documentId && left.account.advertiserId === right.account.advertiserId && left.account.name === right.account.name && left.gfversion === right.gfversion;
}
