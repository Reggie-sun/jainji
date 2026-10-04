import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { readPrivateJson } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectVideoLibrary } from "./qianchuan-video-library-browser.js";
import type { QianchuanVideoLibraryPage } from "./qianchuan-video-library-page.js";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";

type Connection = { page: Pick<QianchuanVideoLibraryPage, "open" | "read" | "deleteBatch" | "refresh">; close(): Promise<void>; };
const now = () => new Date().toISOString();

/** Explicit clear continues from the current account list; never backs up videos or changes upload fences. */
export class QianchuanVideoLibrary {
  constructor(private readonly root: string, private readonly connect: (endpoint: string, id: string, signal: AbortSignal) => Promise<Connection> = connectVideoLibrary) {}
  private async write(file: string, value: unknown): Promise<void> {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await strictSyncDirectory(path.dirname(file));
  }
  async clear(target: FrozenQianchuanAccount, guard: () => Promise<void>, parentSignal?: AbortSignal): Promise<QianchuanLibraryResult> {
    const result: QianchuanLibraryResult = { product: target.product, advertiserId: target.advertiserId, state: "BLOCKED", deletedCount: 0, message: "视频库删除未开始。" };
    const directory = path.resolve(this.root, "video-library-deletions");
    const attempt = randomUUID(), gate = path.join(directory, `${target.advertiserId}.pending.json`);
    const lock = path.join(directory, `${target.advertiserId}.operation.lock`), controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    let operation: Awaited<ReturnType<typeof open>> | undefined, connection: Connection | undefined;
    let pending = false, remaining: number | undefined;
    try {
      await secureUploadDirectory(directory); await strictSyncDirectory(this.root);
      operation = await open(lock, "wx", 0o600);
      await guard(); signal.throwIfAborted();
      connection = await this.connect(target.cdpEndpoint, target.advertiserId, signal);
      await connection.page.open();
      let snapshot = await connection.page.read();
      const initialCount = snapshot.total;
      remaining = snapshot.total;
      for (let batch = 0; snapshot.total; batch++) {
        signal.throwIfAborted();
        if (snapshot.total > 20000 || batch >= 1000 || !snapshot.ids.length) throw new Error("超过本轮清空范围或处理上限，已暂停。");
        const before = snapshot;
        await guard();
        await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          if (!pending) {
            try { await this.write(gate, { version: 1, attempt, product: target.product, advertiserId: target.advertiserId, startedAt: now() }); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
              // A new explicit clear acts only on the freshly read list; old unknown confirmations are never replayed.
              await readPrivateJson(gate, input => z.object({ version: z.literal(1), attempt: z.string().uuid(), product: z.literal(target.product), advertiserId: z.literal(target.advertiserId), startedAt: z.string().datetime() }).strict().parse(input));
            }
            pending = true;
          }
          signal.throwIfAborted();
        });
        snapshot = await connection.page.refresh();
        signal.throwIfAborted(); remaining = snapshot.total;
        if (snapshot.total === before.total && JSON.stringify(snapshot.ids) === JSON.stringify(before.ids)) throw new Error("平台未移除这一批视频，已暂停。");
        result.deletedCount += Math.max(0, before.total - snapshot.total);
      }
      await guard(); signal.throwIfAborted();
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit); await strictSyncDirectory(directory);
      await this.write(path.join(audit, "completed.json"), { advertiserId: target.advertiserId, initialCount, deletedCount: result.deletedCount, empty: snapshot, observationMode: "current_ui", completedAt: now() });
      await connection.close(); connection = undefined;
      // Preserve all old audit files; remove only this account's pending marker after actual empty UI.
      try { await unlink(gate); await strictSyncDirectory(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return { ...result, state: "CLEARED", message: "视频库已清空。" };
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "操作异常。";
      return { ...result, message: `清空已暂停${remaining === undefined ? "" : `，上次列表剩余 ${remaining} 条`}。${detail} 可重新清空当前剩余视频。` };
    } finally {
      clearTimeout(timer);
      await connection?.close().catch(() => undefined);
      if (operation) {
        try { await operation.close(); await unlink(lock); await strictSyncDirectory(directory); }
        catch { return { ...result, state: "BLOCKED", message: "清空操作释放失败，已暂停。" }; }
      }
    }
  }
}
