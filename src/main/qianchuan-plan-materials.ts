import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { QianchuanPlanMaterialRecovery } from "./qianchuan-plan-material-recovery.js";
import { QianchuanPlanMaterialDiagnostics, type PlanMaterialStage } from "./qianchuan-plan-material-diagnostics.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectPlanMaterials } from "./qianchuan-video-library-browser.js";
import type { QianchuanPlanMaterialPage } from "./qianchuan-plan-material-page.js";
import type { QianchuanLibraryClear, QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { createZeroImpressionsWindow, type ZeroImpressionsWindow } from "./qianchuan-zero-impressions.js";

type Connection = { page: Pick<QianchuanPlanMaterialPage, "open" | "filter" | "read" | "deleteBatch"> & Partial<Pick<QianchuanPlanMaterialPage, "movePage" | "excludeMaterialIds">>; close(): Promise<void> };

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
      return { ...zero, state: zero.state === "CLEARED" && audit.state === "PARTIAL" ? "PARTIAL" : zero.state, pendingPlanDeletion: zero.pendingPlanDeletion ?? audit.pendingPlanDeletion, deletedCount: audit.deletedCount + zero.deletedCount, message: `${audit.message} ${zero.message}` };
    }
    const zeroWindow = rule === "ZERO_IMPRESSIONS_15D" ? createZeroImpressionsWindow(this.startedAt) : undefined;
    const result: QianchuanLibraryResult = { product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: "计划素材清理未开始。" };
    const directory = path.resolve(this.root, "plan-material-deletions"), attempt = randomUUID();
    let gate = path.join(directory, `${target.advertiserId}-${target.adId}.pending.json`), lock = path.join(directory, `${target.advertiserId}.operation.lock`);
    const controller = new AbortController(), signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    let operation: Awaited<ReturnType<typeof open>> | undefined, connection: Connection | undefined;
    let intentWritten = false;
    let stage: PlanMaterialStage = "准备清理";
    const recovery = new QianchuanPlanMaterialRecovery(directory, target);
    const diagnostics = new QianchuanPlanMaterialDiagnostics(directory, target);
    try {
      await secureUploadDirectory(directory); await strictSyncDirectory(this.root);
      operation = await open(lock, "wx", 0o600);
      await guard(); signal.throwIfAborted();
      const pending = await recovery.pendingRecords();
      result.pendingPlanDeletion = pending[0];
      const protectedIds = await recovery.protectedIds();
      // Keep every old intent byte intact; new confirmations use an independent exclusive gate.
      if (pending.length) gate = recovery.attemptGate(attempt);
      const paginated = !!zeroWindow || protectedIds.size > 0;
      stage = "连接账号浏览器"; connection = await this.connect(target, signal, zeroWindow);
      if (protectedIds.size) {
        if (!connection.page.excludeMaterialIds || !connection.page.movePage) throw new Error("缺少历史素材隔离分页能力，未删除素材。");
        connection.page.excludeMaterialIds(protectedIds);
      }
      stage = "打开计划素材"; await connection.page.open();
      stage = "筛选计划素材";
      const { skippedEcological } = await connection.page.filter();
      stage = "核对素材列表";
      let snapshot = await connection.page.read();
      if (paginated && (!(snapshot.zeroImpressions || snapshot.auditPage) || !connection.page.movePage)) throw new Error("缺少素材分页证据，未删除素材。");
      if (paginated && snapshot.total) {
        await connection.page.movePage!(true); snapshot = await connection.page.read();
        if ((snapshot.zeroImpressions ?? snapshot.auditPage)?.offset !== 0) throw new Error("素材分页未回到首页，未删除素材。");
      }
      const initialCount = snapshot.total;
      const visited = new Set<string>();
      for (let batch = 0; snapshot.total; batch++) {
        signal.throwIfAborted(); await guard();
        if (snapshot.total > 20000 || batch >= 1000 || !paginated && !snapshot.ids.length) throw new Error("超过计划素材清理上限，已停止。");
        if (paginated) {
          if (!(snapshot.zeroImpressions || snapshot.auditPage) || !connection.page.movePage) throw new Error("缺少素材分页证据，未删除素材。");
          for (const row of snapshot.zeroImpressions?.rows ?? snapshot.auditPage!.ids.map(id => ({ id }))) {
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
        if (before.ids.some(id => protectedIds.has(id))) throw new Error("当前列表含历史未知删除的素材，须在千川人工处理；不会自动重复删除。");
        stage = "确认计划素材删除";
        await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          await this.write(gate, { version: 1, attempt, advertiserId: target.advertiserId, adId: target.adId, ids: before.ids, ...(zeroWindow ? { zeroWindow } : {}) });
          intentWritten = true; signal.throwIfAborted();
        });
        stage = "核对删除结果";
        snapshot = await connection.page.read();
        if (snapshot.total >= before.total || (snapshot.zeroImpressions?.rows.map(row => row.id) ?? snapshot.auditPage?.ids ?? snapshot.ids).some(id => before.ids.includes(id)) ||
          paginated && before.total - snapshot.total !== before.ids.length) throw new Error("删除结果未知或列表无进展，已停止。");
        await guard(); signal.throwIfAborted();
        const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
        await this.write(path.join(audit, `${batch}.json`), { advertiserId: target.advertiserId, adId: target.adId, before, after: snapshot, ...(zeroWindow ? { zeroWindow } : {}), observedAt: new Date().toISOString() });
        await unlink(gate); await strictSyncDirectory(directory); intentWritten = false;
        result.deletedCount += before.total - snapshot.total;
        if (paginated && snapshot.total) {
          visited.clear(); await connection.page.movePage!(true); snapshot = await connection.page.read();
        }
      }
      await guard(); signal.throwIfAborted();
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
      await this.write(path.join(audit, "completed.json"), { advertiserId: target.advertiserId, adId: target.adId, initialCount, deletedCount: result.deletedCount, observationMode: zeroWindow ? "zero_impressions_all_pages" : "filtered_current_ui", ...(zeroWindow ? { zeroWindow } : {}), completedAt: new Date().toISOString() });
      await connection.close(); connection = undefined;
      return { ...result, state: protectedIds.size ? "PARTIAL" : "CLEARED", message: (zeroWindow ? `计划 ${target.adId} 已逐页清理 ${zeroWindow.startTime.slice(0, 10)} 至 ${zeroWindow.endTime.slice(0, 10)} 零展示素材，删除 ${result.deletedCount} 条。` : `计划 ${target.adId} 三类素材已清理，列表净减少 ${result.deletedCount} 条${skippedEcological ? "；无生态审核不通过选项，已跳过" : ""}。`) + (protectedIds.size ? ` 历史未知结果的 ${protectedIds.size} 个素材ID已隔离，其他候选已处理；保留 ${pending.length} 批待核查记录，不自动重删。` : "") };
    } catch (error) {
      let diagnosticWarning = "";
      if (intentWritten) {
        try {
          const pending = await recovery.pending(attempt);
          if (!pending || pending.attempt !== attempt) throw new Error("intent binding");
          result.pendingPlanDeletion = pending;
          await diagnostics.record(pending, stage, error);
        } catch { diagnosticWarning = " 失败诊断未能完整保存；删除意图仍须人工核查。"; }
      }
      const detail = error instanceof Error && error.name === "TimeoutError" ? `${stage}时等待千川页面超时。` :
        error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "操作异常。";
      return { ...result, message: `计划 ${target.adId} 清理已停止。${detail}${intentWritten ? " 删除意图保留，结果未知，不自动重试。" : ""}${diagnosticWarning}` };
    } finally {
      clearTimeout(timer); await connection?.close().catch(() => undefined);
      if (operation) {
        try { await operation.close(); await unlink(lock); await strictSyncDirectory(directory); }
        catch { return { ...result, message: "计划素材清理操作释放失败，已停止。" }; }
      }
    }
  }
}
