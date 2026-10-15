import { constants } from "node:fs";
import { link, lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { QianchuanReportList, QianchuanReportSnapshot } from "../shared/qianchuan-report.js";
import { QianchuanReportListSchema, QianchuanReportSnapshotSchema } from "../shared/qianchuan-report.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";

const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const snapshotName = /^[0-9a-f-]{36}\.json$/i;
const corrupt = () => new Error("千川报表快照目录包含无效、部分或重复记录，已拒绝读取。");

async function privateSnapshotBytes(file: string): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES || info.mode & 0o7177 ||
    (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.()) throw corrupt();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.mode !== info.mode || before.uid !== info.uid || before.size !== info.size) throw corrupt();
    const bytes = await handle.readFile();
    const after = await handle.stat(), current = await lstat(file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || current.dev !== after.dev || current.ino !== after.ino ||
      current.isSymbolicLink() || bytes.length !== before.size) throw corrupt();
    return bytes;
  } finally { await handle.close(); }
}

/** Sole durable owner for normalized, complete Qianchuan report snapshots. */
export class QianchuanReportStore {
  private readonly directory: string;
  private initialized = false;

  constructor(directory: string, private readonly syncDirectory: (directory: string) => Promise<void> = strictSyncDirectory) { this.directory = path.resolve(directory); }

  private async ensureDirectory(): Promise<void> {
    if (process.platform === "win32" || !process.getuid) throw new Error("千川报表快照私有权限和目录持久化尚未核验 Windows 环境。");
    const parent = path.dirname(this.directory);
    if (!(await lstat(parent)).isDirectory()) throw corrupt();
    await secureUploadDirectory(this.directory);
    await this.syncDirectory(parent);
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid() || await realpath(this.directory) !== this.directory) throw corrupt();
  }

  private async readAll(): Promise<QianchuanReportSnapshot[]> {
    await this.ensureDirectory();
    const names = (await readdir(this.directory)).sort();
    if (names.length > 10_000 || names.some(name => !snapshotName.test(name))) throw corrupt();
    const ids = new Set<string>(), snapshots: QianchuanReportSnapshot[] = [];
    for (const name of names) {
      const file = path.join(this.directory, name);
      let parsed: QianchuanReportSnapshot;
      try { parsed = QianchuanReportSnapshotSchema.parse(JSON.parse((await privateSnapshotBytes(file)).toString("utf8"))); }
      catch { throw corrupt(); }
      if (name !== `${parsed.id}.json` || ids.has(parsed.id)) throw corrupt();
      ids.add(parsed.id);
      snapshots.push(parsed);
    }
    return snapshots;
  }

  async initialize(): Promise<void> {
    await this.ensureDirectory();
    await this.readAll();
    this.initialized = true;
  }

  private async ready(): Promise<void> {
    if (!this.initialized) await this.initialize();
    else await this.ensureDirectory();
  }

  async save(input: QianchuanReportSnapshot, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const snapshot = QianchuanReportSnapshotSchema.parse(input);
    await this.ready();
    const existing = await this.readAll();
    if (existing.some(item => item.id === snapshot.id)) throw new Error("千川报表快照 ID 已存在，拒绝覆盖。");

    const finalPath = path.join(this.directory, `${snapshot.id}.json`);
    const temporary = path.join(this.directory, `.${snapshot.id}.${process.pid}.${Date.now()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(snapshot)}\n`); await handle.sync(); } finally { await handle.close(); }
      await this.ensureDirectory();
      signal?.throwIfAborted();
      // Hard-link publication makes the complete fsynced bytes visible atomically and cannot replace an existing ID.
      await link(temporary, finalPath);
      await this.syncDirectory(this.directory);
      await unlink(temporary);
      await this.syncDirectory(this.directory);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("千川报表快照 ID 已存在，拒绝覆盖。");
      throw error;
    }
  }

  async list(product: string, expectedAdvertiserId: string): Promise<QianchuanReportSnapshot[]> {
    const binding: QianchuanReportList = QianchuanReportListSchema.parse({ product, expectedAdvertiserId });
    await this.ready();
    return (await this.readAll()).filter(snapshot => snapshot.product === binding.product && snapshot.advertiserId === binding.expectedAdvertiserId);
  }
}
