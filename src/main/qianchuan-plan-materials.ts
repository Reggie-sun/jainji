import { randomUUID } from "node:crypto";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectPlanMaterials } from "./qianchuan-video-library-browser.js";
import type { QianchuanPlanMaterialPage } from "./qianchuan-plan-material-page.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { createZeroImpressionsWindow, type ZeroImpressionsWindow } from "./qianchuan-zero-impressions.js";

type Connection = { page: Pick<QianchuanPlanMaterialPage, "open" | "filter" | "read" | "deleteBatch"> & Partial<Pick<QianchuanPlanMaterialPage, "movePage">>; close(): Promise<void> };
const pendingSchema = z.object({ version: z.literal(1), attempt: z.string().uuid(), advertiserId: z.string(), adId: z.string(), ids: z.array(z.string()).min(1).max(100),
  zeroWindow: z.object({ startTime: z.string(), endTime: z.string(), createdBefore: z.string().optional() }).strict().optional(),
}).strict();

/** Same production service owns scheduling; this owner only records plan-delete intent and current UI progress. */
export class QianchuanPlanMaterials {
  constructor(private readonly root: string, private readonly connect: (target: FrozenQianchuanAccount, signal: AbortSignal, zeroWindow?: ZeroImpressionsWindow) => Promise<Connection> = connectPlanMaterials, private readonly startedAt = Date.now()) {}
  private async write(file: string, value: unknown): Promise<void> {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await strictSyncDirectory(path.dirname(file));
  }
  async clear(target: FrozenQianchuanAccount, guard: () => Promise<void>, parentSignal?: AbortSignal, rule?: QianchuanLibraryClear["planMaterialRule"]): Promise<QianchuanLibraryResult> {
    if (rule === "AUDIT_AND_ZERO_IMPRESSIONS_15D") {
      const timeout = AbortSignal.timeout(30 * 60 * 1000);
      const signal = parentSignal ? AbortSignal.any([timeout, parentSignal]) : timeout;
      const audit = await this.clear(target, guard, signal);
      if (audit.state === "BLOCKED") return audit;
      const zero = await this.clear(target, guard, signal, "ZERO_IMPRESSIONS_15D");
      return { ...zero, deletedCount: audit.deletedCount + zero.deletedCount, message: `${audit.message} ${zero.message}` };
    }
    const zeroWindow = rule === "ZERO_IMPRESSIONS_15D" ? createZeroImpressionsWindow(this.startedAt) : undefined;
    const result: QianchuanLibraryResult = { product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: "计划素材清理未开始。" };
    const directory = path.resolve(this.root, "plan-material-deletions"), attempt = randomUUID();
    const gate = path.join(directory, `${target.advertiserId}-${target.adId}.pending.json`), lock = path.join(directory, `${target.advertiserId}.operation.lock`);
    const controller = new AbortController(), signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    let operation: Awaited<ReturnType<typeof open>> | undefined, connection: Connection | undefined;
    let intentWritten = false;
    let stage = "准备清理";
    try {
      await secureUploadDirectory(directory); await strictSyncDirectory(this.root);
      operation = await open(lock, "wx", 0o600);
      await guard(); signal.throwIfAborted();
      // Existing unresolved intent forbids a new automated confirmation, including after restart.
      let hasPending = true;
      try { await lstat(gate); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") hasPending = false; else throw error; }
      if (hasPending) { await readPrivateJson(gate, input => pendingSchema.parse(input)); throw new Error("该计划上次删除结果未知，请先人工核查；不会自动重试。"); }
      stage = "连接账号浏览器"; connection = await this.connect(target, signal, zeroWindow);
      stage = "打开计划素材"; await connection.page.open();
      stage = "筛选计划素材";
      const { skippedEcological } = await connection.page.filter();
      stage = "核对素材列表";
      let snapshot = await connection.page.read();
      if (zeroWindow && (!snapshot.zeroImpressions || !connection.page.movePage)) throw new Error("缺少零展示分页证据，未删除素材。");
      const initialCount = snapshot.total;
      const visited = new Set<string>();
      for (let batch = 0; snapshot.total; batch++) {
        signal.throwIfAborted(); await guard();
        if (snapshot.total > 20000 || batch >= 1000 || !zeroWindow && !snapshot.ids.length) throw new Error("超过计划素材清理上限，已停止。");
        if (zeroWindow) {
          if (!snapshot.zeroImpressions || !connection.page.movePage) throw new Error("缺少零展示分页证据，未删除素材。");
          for (const row of snapshot.zeroImpressions.rows) {
            if (visited.has(row.id)) throw new Error("素材分页重复或发生变化，已停止删除。");
            visited.add(row.id);
          }
          if (!snapshot.ids.length) {
            stage = "扫描下一页素材";
            if (!await connection.page.movePage()) break;
            snapshot = await connection.page.read(); continue;
          }
        }
        const before = snapshot;
        stage = "确认计划素材删除";
        await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          await this.write(gate, { version: 1, attempt, advertiserId: target.advertiserId, adId: target.adId, ids: before.ids, ...(zeroWindow ? { zeroWindow } : {}) });
          intentWritten = true; signal.throwIfAborted();
        });
        stage = "核对删除结果";
        snapshot = await connection.page.read();
        if (snapshot.total >= before.total || (snapshot.zeroImpressions?.rows.map(row => row.id) ?? snapshot.ids).some(id => before.ids.includes(id)) ||
          zeroWindow && before.total - snapshot.total !== before.ids.length) throw new Error("删除结果未知或列表无进展，已停止。");
        await guard(); signal.throwIfAborted();
        const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
        await this.write(path.join(audit, `${batch}.json`), { advertiserId: target.advertiserId, adId: target.adId, before, after: snapshot, ...(zeroWindow ? { zeroWindow } : {}), observedAt: new Date().toISOString() });
        await unlink(gate); await strictSyncDirectory(directory); intentWritten = false;
        result.deletedCount += before.total - snapshot.total;
        if (zeroWindow && snapshot.total) {
          visited.clear(); await connection.page.movePage!(true); snapshot = await connection.page.read();
        }
      }
      await guard(); signal.throwIfAborted();
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
      await this.write(path.join(audit, "completed.json"), { advertiserId: target.advertiserId, adId: target.adId, initialCount, deletedCount: result.deletedCount, observationMode: zeroWindow ? "zero_impressions_all_pages" : "filtered_current_ui", ...(zeroWindow ? { zeroWindow } : {}), completedAt: new Date().toISOString() });
      await connection.close(); connection = undefined;
      return { ...result, state: "CLEARED", message: zeroWindow ? `计划 ${target.adId} 已逐页清理 ${zeroWindow.startTime.slice(0, 10)} 至 ${zeroWindow.endTime.slice(0, 10)} 零展示素材，删除 ${result.deletedCount} 条。` : `计划 ${target.adId} 三类素材已清理，列表净减少 ${result.deletedCount} 条${skippedEcological ? "；无生态审核不通过选项，已跳过" : ""}。` };
    } catch (error) {
      const detail = error instanceof Error && error.name === "TimeoutError" ? `${stage}时等待千川页面超时。` :
        error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "操作异常。";
      return { ...result, message: `计划 ${target.adId} 清理已停止。${detail}${intentWritten ? " 删除意图保留，结果未知，不自动重试。" : ""}` };
    } finally {
      clearTimeout(timer); await connection?.close().catch(() => undefined);
      if (operation) {
        try { await operation.close(); await unlink(lock); await strictSyncDirectory(directory); }
        catch { return { ...result, message: "计划素材清理操作释放失败，已停止。" }; }
      }
    }
  }
}
