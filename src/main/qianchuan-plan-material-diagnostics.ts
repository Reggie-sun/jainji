import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { strictSyncDirectory } from "./douyin-upload-store.js";
import type { QianchuanPendingPlanDeletion } from "../shared/qianchuan-video-library.js";

const reasons = {
  TITLE_CONFIRMATION: "平台要求同步删除自选标题，已停止；删除结果未知，不会自动再次确认。",
  EXTRA_CONFIRMATION: "平台出现额外确认或异常弹窗，已停止；删除结果未知，不会自动再次确认。",
  RESULT_MISMATCH: "删除数量或素材身份无法核对，结果未知，已停止；不会自动再次确认。",
  RESULT_TIMEOUT: "等待删除结果超时，结果未知，已停止；不会自动再次确认。",
  PAGE_TIMEOUT: "等待千川页面超时，删除结果未知。",
  CANCELLED: "核对被取消，删除结果未知。",
  UNCLASSIFIED: "未取得完整结果证据，删除结果未知。",
} as const;
const reasonSchema = z.enum(["TITLE_CONFIRMATION", "EXTRA_CONFIRMATION", "RESULT_MISMATCH", "RESULT_TIMEOUT", "PAGE_TIMEOUT", "CANCELLED", "UNCLASSIFIED"]);
const stageSchema = z.enum(["准备清理", "连接账号浏览器", "打开计划素材", "筛选计划素材", "核对素材列表", "扫描下一页素材", "确认计划素材删除", "核对删除结果"]);
export type PlanMaterialStage = z.infer<typeof stageSchema>;
export class PlanMaterialDeletionError extends Error {
  constructor(readonly reason: z.infer<typeof reasonSchema>) { super(reasons[reason]); }
}
const schema = z.object({ version: z.literal(1), attempt: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  advertiserId: z.string(), adId: z.string(), stage: stageSchema, reason: reasonSchema, observedAt: z.string().datetime(),
}).strict();

/** Diagnostic sidecars never alter intent bytes or authorize recovery/deletion. */
export class QianchuanPlanMaterialDiagnostics {
  constructor(private readonly directory: string, private readonly target: FrozenQianchuanAccount) {}
  private file(pending: QianchuanPendingPlanDeletion): string { return path.join(this.directory, `${pending.attempt}.failure.json`); }
  async record(pending: QianchuanPendingPlanDeletion, stage: PlanMaterialStage, error: unknown): Promise<void> {
    if (pending.adId !== this.target.adId) throw new Error("diagnostic plan binding");
    const reason = error instanceof PlanMaterialDeletionError ? error.reason : error instanceof Error && error.name === "TimeoutError" ? "PAGE_TIMEOUT" :
      error instanceof Error && error.name === "AbortError" ? "CANCELLED" : "UNCLASSIFIED";
    const value = schema.parse({ version: 1, attempt: pending.attempt, digest: pending.digest, advertiserId: this.target.advertiserId,
      adId: pending.adId, stage, reason, observedAt: new Date().toISOString() });
    const handle = await open(this.file(pending), "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await strictSyncDirectory(this.directory);
  }
  async message(pending: QianchuanPendingPlanDeletion): Promise<string> {
    try {
      await lstat(this.file(pending));
      const { value } = await readPrivateJson(this.file(pending), input => schema.parse(input));
      if (value.attempt !== pending.attempt || value.digest !== pending.digest || value.advertiserId !== this.target.advertiserId || value.adId !== pending.adId || value.adId !== this.target.adId) throw new Error("binding");
      return `上次停止阶段：${value.stage}。${reasons[value.reason]}`;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "旧记录未保存失败原因，无法还原首次停止原因。" : "失败诊断缺失或无法核对，不能据此判断删除结果。";
    }
  }
}
