import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";
import { connectVideoLibrary } from "./qianchuan-video-library-browser.js";
import type { QianchuanVideoLibraryPage } from "./qianchuan-video-library-page.js";
import type { QianchuanLibraryResult } from "../shared/qianchuan-video-library.js";

type Connection = { page: Pick<QianchuanVideoLibraryPage, "open" | "read" | "deleteBatch" | "refresh">; close(): Promise<void>; };
const now = () => new Date().toISOString();
const unknown = "删除未获得完整核验，已保留删除屏障。请人工核查视频库，程序不会重新删除。";

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
    const attempt = randomUUID(), controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    try {
      await secureUploadDirectory(directory);
      await strictSyncDirectory(this.root);
      await this.write(gate, { version: 1, attempt, product: target.product, advertiserId: target.advertiserId, startedAt: now() });
      gateOwned = true;
      const audit = path.join(directory, attempt); await secureUploadDirectory(audit);
      await strictSyncDirectory(directory);
      await guard();
      signal.throwIfAborted();
      connection = await this.connect(target.cdpEndpoint, target.advertiserId, signal);
      await connection.page.open();
      let snapshot = await connection.page.read();
      const initialCount = snapshot.total;
      if (initialCount > 20000) throw new Error("视频库超过本次 20000 条删除上限，尚未删除。");
      await this.write(path.join(audit, "start.json"), { version: 1, advertiserId: target.advertiserId, configDigest: target.configDigest, initialCount, startedAt: now() });
      for (let batch = 0; snapshot.total; batch++) {
        signal.throwIfAborted();
        if (batch >= 1000 || snapshot.total !== initialCount - result.deletedCount || !snapshot.ids.length) throw new Error(unknown);
        const before = snapshot;
        await guard();
        await connection.page.deleteBatch(before, async () => {
          await guard(); signal.throwIfAborted();
          await this.write(path.join(audit, `${batch}.intent.json`), { before, advertiserId: target.advertiserId, at: now() });
          signal.throwIfAborted();
          // Even a failed/ambiguous click after this durable intent cannot be replayed.
          confirmed = true;
        });
        snapshot = await connection.page.refresh();
        if (snapshot.total !== before.total - before.ids.length || snapshot.ids.some(id => before.ids.includes(id))) throw new Error(unknown);
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
      return { ...result, message: verifiedEmpty ? "视频库已核验清空，但连接或删除屏障释放失败；已保留完成记录，请人工核查。" : confirmed ? unknown : (error as NodeJS.ErrnoException).code === "EEXIST" ? "该账号已有未结束的删除屏障，请人工核查；未再次删除。" : error instanceof Error ? error.message : "视频库删除不可用。" };
    } finally {
      clearTimeout(timer);
      await connection?.close().catch(() => undefined);
    }
  }
}
