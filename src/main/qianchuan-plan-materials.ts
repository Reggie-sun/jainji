import { randomUUID } from "node:crypto";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPrivateJson, type FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectPlanMaterials } from "./qianchuan-video-library-browser.js";
import type { QianchuanPlanMaterialPage } from "./qianchuan-plan-material-page.js";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";

type Connection = { page: Pick<QianchuanPlanMaterialPage, "open" | "filter" | "read" | "deleteBatch">; close(): Promise<void> };
const pendingSchema = z.object({ version: z.literal(1), attempt: z.string().uuid(), advertiserId: z.string(), adId: z.string(), ids: z.array(z.string()).min(1).max(100) }).strict();

/** Same production service owns scheduling; this owner only records plan-delete intent and current UI progress. */
export class QianchuanPlanMaterials {
  constructor(private readonly root: string, private readonly connect: (target: FrozenQianchuanAccount, signal: AbortSignal) => Promise<Connection> = connectPlanMaterials) {}
  private async write(file: string, value: unknown): Promise<void> {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await strictSyncDirectory(path.dirname(file));
  }
  async clear(target: FrozenQianchuanAccount, guard: () => Promise<void>, parentSignal?: AbortSignal): Promise<QianchuanLibraryResult> {
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
      stage = "连接账号浏览器"; connection = await this.connect(target, signal);
      stage = "打开计划素材"; await connection.page.open();
      stage = "筛选计划素材";
      const { skippedEcological } = await connection.page.filter();
      stage = "核对素材列表";
      let snapshot = await connection.page.read();
      const initialCount = snapshot.total;
      for (let batch = 0; snapshot.total; batch++) {
        signal.throwIfAborted(); await guard();
        if (snapshot.total > 20000 || batch >= 1000 || !snapshot.ids.length) throw new Error("超过计划素材清理上限，已停止。");
        const before = snapshot;
        stage = "确认计划素材删除";
        await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          await this.write(gate, { version: 1, attempt, advertiserId: target.advertiserId, adId: target.adId, ids: before.ids });
          intentWritten = true; signal.throwIfAborted();
        });
        stage = "核对删除结果";
        snapshot = await connection.page.read();
        if (snapshot.total >= before.total || snapshot.ids.some(id => before.ids.includes(id))) throw new Error("删除结果未知或列表无进展，已停止。");
        await guard(); signal.throwIfAborted();
        const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
        await this.write(path.join(audit, `${batch}.json`), { advertiserId: target.advertiserId, adId: target.adId, before, after: snapshot, observedAt: new Date().toISOString() });
        await unlink(gate); await strictSyncDirectory(directory); intentWritten = false;
        result.deletedCount += before.total - snapshot.total;
      }
      await guard(); signal.throwIfAborted();
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
      await this.write(path.join(audit, "completed.json"), { advertiserId: target.advertiserId, adId: target.adId, initialCount, deletedCount: result.deletedCount, observationMode: "filtered_current_ui", completedAt: new Date().toISOString() });
      await connection.close(); connection = undefined;
      return { ...result, state: "CLEARED", message: `计划 ${target.adId} 三类素材已清理，列表净减少 ${result.deletedCount} 条${skippedEcological ? "；无生态审核不通过选项，已跳过" : ""}。` };
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
