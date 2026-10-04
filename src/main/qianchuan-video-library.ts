import { createHash, randomUUID } from "node:crypto";
import { open, readdir, unlink } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectVideoLibrary } from "./qianchuan-video-library-browser.js";
import type { QianchuanVideoLibraryPage } from "./qianchuan-video-library-page.js";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";
import { readPrivateJson } from "./qianchuan-account-config.js";

type Connection = { page: Pick<QianchuanVideoLibraryPage, "open" | "read" | "deleteBatch" | "refresh" | "inventory">; close(): Promise<void>; };
const now = () => new Date().toISOString();
const unknown = "删除未获得完整核验，已保留删除屏障。请人工核查视频库，程序不会重新删除。";
const snapshotSchema = z.object({ total: z.number().int().min(0).max(20000), ids: z.array(z.string().regex(/^[1-9][0-9]{0,19}$/)).max(100) }).strict()
  .refine(value => value.ids.length <= value.total && new Set(value.ids).size === value.ids.length && (value.total === 0 || value.ids.length > 0));

/** Durable per-account deletion evidence; never changes the upload ledger or fences. */
export class QianchuanVideoLibrary {
  constructor(private readonly root: string, private readonly connect: (endpoint: string, id: string, signal: AbortSignal) => Promise<Connection> = connectVideoLibrary) {}
  private async write(file: string, value: unknown): Promise<void> {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > 64 * 1024) throw new Error("视频库删除记录超过限制。");
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await strictSyncDirectory(path.dirname(file));
  }
  async clear(target: FrozenQianchuanAccount, guard: () => Promise<void>, parentSignal?: AbortSignal): Promise<QianchuanLibraryResult> {
    const result: QianchuanLibraryResult = { product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: "视频库删除未开始。" };
    const directory = path.resolve(this.root, "video-library-deletions");
    let gateOwned = false, confirmed = false, verifiedEmpty = false, connection: Connection | undefined;
    const gate = path.join(directory, `${target.advertiserId}.pending.json`);
    let attempt: string = randomUUID(), phase = "开始", operation: Awaited<ReturnType<typeof open>> | undefined;
    const lock = path.join(directory, `${target.advertiserId}.operation.lock`), controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    try {
      await secureUploadDirectory(directory);
      await strictSyncDirectory(this.root);
      operation = await open(lock, "wx", 0o600);
      let recovery: { before: z.infer<typeof snapshotSchema>; initialCount: number; intentDigest: string; batch: number; deletedCount: number; removedIds: string[]; fresh(): Promise<void> } | undefined;
      try { await this.write(gate, { version: 1, attempt, product: target.product, advertiserId: target.advertiserId, startedAt: now() }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Reconcile only the last unresolved intent in a complete audit chain; never replay it.
        confirmed = true;
        const pending = await readPrivateJson(gate, input => z.object({ version: z.literal(1), attempt: z.string().uuid(), product: z.literal(target.product), advertiserId: z.literal(target.advertiserId), startedAt: z.string().datetime() }).strict().parse(input));
        attempt = pending.value.attempt;
        const oldAudit = path.join(directory, attempt);
        const names = (await readdir(oldAudit)).sort(), batches = names.filter(name => /^\d+\.intent\.json$/.test(name)).length;
        if (!batches || batches > 1000) throw new Error(unknown);
        const expected = ["start.json", ...Array.from({ length: batches }, (_, index) => `${index}.intent.json`), ...Array.from({ length: Math.max(0, batches - 1) }, (_, index) => `${index}.verified.json`)].sort();
        if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(unknown);
        const start = await readPrivateJson(path.join(oldAudit, "start.json"), input => z.object({ version: z.literal(1), advertiserId: z.literal(target.advertiserId), configDigest: z.literal(target.configDigest), initialCount: z.number().int().min(1).max(20000), startedAt: z.string().datetime() }).strict().parse(input));
        const records: [string, string][] = [[gate, pending.digest], [path.join(oldAudit, "start.json"), start.digest]], removedIds: string[] = [];
        let previous: z.infer<typeof snapshotSchema> | undefined;
        for (let index = 0; index < batches; index++) {
          signal.throwIfAborted();
          const file = path.join(oldAudit, `${index}.intent.json`);
          const intent = await readPrivateJson(file, input => z.object({ before: snapshotSchema.refine(value => value.ids.length > 0), advertiserId: z.literal(target.advertiserId), at: z.string().datetime() }).strict().parse(input));
          records.push([file, intent.digest]);
          if (intent.value.before.total !== start.value.initialCount - removedIds.length || intent.value.before.ids.some(id => removedIds.includes(id)) ||
            previous && JSON.stringify(previous) !== JSON.stringify(intent.value.before)) throw new Error(unknown);
          if (index === batches - 1) {
            recovery = { before: intent.value.before, initialCount: start.value.initialCount, intentDigest: intent.digest, batch: index, deletedCount: removedIds.length, removedIds: [...removedIds, ...intent.value.before.ids], fresh: async () => {
              if (JSON.stringify((await readdir(oldAudit)).sort()) !== JSON.stringify(names)) throw new Error(unknown);
              for (const [record, digest] of records) if ((await readPrivateJson(record, value => value)).digest !== digest) throw new Error(unknown);
            } };
          } else {
            const verifiedFile = path.join(oldAudit, `${index}.verified.json`);
            const verified = await readPrivateJson(verifiedFile, input => z.object({ after: snapshotSchema, removedIds: z.array(z.string().regex(/^[1-9][0-9]{0,19}$/)).min(1).max(100), at: z.string().datetime(), reconciled: z.literal(true).optional(), intentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), inventoryDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(input));
            records.push([verifiedFile, verified.digest]);
            if (JSON.stringify(verified.value.removedIds) !== JSON.stringify(intent.value.before.ids) || verified.value.after.total !== intent.value.before.total - intent.value.before.ids.length ||
              verified.value.after.ids.some(id => removedIds.includes(id) || intent.value.before.ids.includes(id)) ||
              (verified.value.reconciled ? verified.value.intentDigest !== intent.digest || !verified.value.inventoryDigest : !!verified.value.intentDigest || !!verified.value.inventoryDigest)) throw new Error(unknown);
            removedIds.push(...verified.value.removedIds); previous = verified.value.after;
          }
        }
      }
      gateOwned = true;
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit);
      await strictSyncDirectory(directory);
      await guard();
      signal.throwIfAborted();
      phase = "连接页面"; connection = await this.connect(target.cdpEndpoint, target.advertiserId, signal);
      await connection.page.open();
      let snapshot = await connection.page.read();
      const initialCount = recovery?.initialCount ?? snapshot.total;
      if (initialCount > 20000) throw new Error("视频库超过本次 20000 条删除上限，尚未删除。");
      let firstBatch = 0;
      if (recovery) {
        phase = "只读核对旧批次";
        const inventory = await connection.page.inventory();
        await guard(); signal.throwIfAborted();
        snapshot = await connection.page.refresh();
        if (inventory.total !== recovery.before.total - recovery.before.ids.length || inventory.ids.length !== inventory.total ||
          new Set(inventory.ids).size !== inventory.total || inventory.ids.some(id => recovery!.removedIds.includes(id)) || snapshot.total !== inventory.total) throw new Error(unknown);
        await guard(); await recovery.fresh(); signal.throwIfAborted();
        await this.write(path.join(audit, `${recovery.batch}.verified.json`), { after: snapshot, removedIds: recovery.before.ids, at: now(), reconciled: true, intentDigest: recovery.intentDigest,
          inventoryDigest: createHash("sha256").update(JSON.stringify(inventory)).digest("hex") });
        result.deletedCount = recovery.deletedCount + recovery.before.ids.length; firstBatch = recovery.batch + 1;
      } else await this.write(path.join(audit, "start.json"), { version: 1, advertiserId: target.advertiserId, configDigest: target.configDigest, initialCount, startedAt: now() });
      for (let batch = firstBatch; snapshot.total; batch++) {
        signal.throwIfAborted();
        if (batch >= 1000 || snapshot.total !== initialCount - result.deletedCount || !snapshot.ids.length) throw new Error(unknown);
        const before = snapshot;
        await guard();
        phase = `第 ${batch + 1} 批确认`; await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          await this.write(path.join(audit, `${batch}.intent.json`), { before, advertiserId: target.advertiserId, at: now() });
          signal.throwIfAborted();
          // Even a failed/ambiguous click after this durable intent cannot be replayed.
          confirmed = true;
        });
        phase = `第 ${batch + 1} 批刷新核验`;
        const deadline = Date.now() + 30000;
        const observationTimer = setTimeout(() => controller.abort(), 30000);
        try {
          do {
            await guard(); signal.throwIfAborted();
            snapshot = await connection.page.refresh();
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw new Error("本批次刷新核验超过 30 秒，已停止删除。");
            if (snapshot.total === before.total - before.ids.length && !snapshot.ids.some(id => before.ids.includes(id))) break;
            if (snapshot.total !== before.total && snapshot.total !== before.total - before.ids.length) throw new Error(`视频库数量不一致：删除前 ${before.total}，预期 ${before.total - before.ids.length}，当前 ${snapshot.total}。`);
            await new Promise(resolve => setTimeout(resolve, 500));
          } while (Date.now() < deadline);
          if (snapshot.total !== before.total - before.ids.length || snapshot.ids.some(id => before.ids.includes(id))) throw new Error(unknown);
        } finally { clearTimeout(observationTimer); }
        await this.write(path.join(audit, `${batch}.verified.json`), { after: snapshot, removedIds: before.ids, at: now() });
        result.deletedCount += before.ids.length;
      }
      await guard(); signal.throwIfAborted();
      const empty = await connection.page.refresh();
      if (empty.total || empty.ids.length || result.deletedCount !== initialCount) throw new Error(unknown);
      await this.write(path.join(audit, "completed.json"), { advertiserId: target.advertiserId, initialCount, deletedCount: result.deletedCount, empty, completedAt: now() });
      verifiedEmpty = true;
      await connection.close(); connection = undefined;
      await unlink(gate); await strictSyncDirectory(directory); gateOwned = false;
      return { ...result, state: "CLEARED", message: `已删除 ${result.deletedCount} 个视频，刷新核对视频库为空。` };
    } catch (error) {
      if (gateOwned && !confirmed) {
        try { await unlink(gate); await strictSyncDirectory(directory); gateOwned = false; }
        catch { return { ...result, message: unknown }; }
      }
      return { ...result, message: verifiedEmpty ? "视频库已核验清空，但连接或删除屏障释放失败；已保留完成记录，请人工核查。" : confirmed ? `${unknown} 阶段：${phase}；${error instanceof Error && error.message === unknown ? "核对结果不一致。" : error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "操作异常。"}` : (error as NodeJS.ErrnoException).code === "EEXIST" ? "该账号已有未结束的删除屏障，请人工核查；未再次删除。" : error instanceof Error ? error.message : "视频库删除不可用。" };
    } finally {
      clearTimeout(timer);
      await connection?.close().catch(() => undefined);
      if (operation) {
        try { await operation.close(); await unlink(lock); await strictSyncDirectory(directory); }
        catch { return { ...result, state: "BLOCKED", message: `删除操作锁释放失败；已核验删除 ${result.deletedCount} 个视频，请人工核查。` }; }
      }
    }
  }
}
