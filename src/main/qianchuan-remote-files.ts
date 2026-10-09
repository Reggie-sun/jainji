import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PUBLISHED_FILE_MODE = 0o400;
const NOFOLLOW = constants.O_NOFOLLOW;

export interface RemoteFileSpec {
  advertiserId: string;
  sha256: string;
  size: number;
  fileName: string;
}

export interface RemoteFileStatus {
  offset: number;
  complete: boolean;
  path: string;
}

export class RemoteFileStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RemoteFileStoreError";
  }
}

interface Paths {
  accountDirectory: string;
  contentDirectory: string;
  stagingDirectory: string;
  fileStagingDirectory: string;
  partialPath: string;
  lockPath: string;
  publishedPath: string;
}

function fail(code: string, message: string): never {
  throw new RemoteFileStoreError(code, message);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function validateSpec(spec: RemoteFileSpec): RemoteFileSpec {
  if (!spec || typeof spec !== "object"
    || typeof spec.advertiserId !== "string" || !/^[1-9][0-9]{0,19}$/.test(spec.advertiserId)
    || typeof spec.sha256 !== "string" || !/^[a-f\d]{64}$/.test(spec.sha256)
    || !Number.isSafeInteger(spec.size) || spec.size <= 0 || spec.size > MAX_FILE_BYTES
    || typeof spec.fileName !== "string" || spec.fileName.length === 0
    || spec.fileName === "." || spec.fileName === ".." || spec.fileName.includes("..")
    || spec.fileName.includes("/") || spec.fileName.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(spec.fileName)
    || path.basename(spec.fileName) !== spec.fileName
    || Buffer.byteLength(spec.fileName, "utf8") > 255) {
    fail("REMOTE_FILE_SPEC_INVALID", "Remote file specification is invalid.");
  }
  return { ...spec };
}

function safePathError(): RemoteFileStoreError {
  return new RemoteFileStoreError("REMOTE_FILE_PATH_UNSAFE", "Remote file storage path is unsafe.");
}

function assertOwned(stats: Awaited<ReturnType<typeof lstat>>): void {
  const getuid = process.getuid;
  if (typeof getuid === "function" && stats.uid !== getuid()) throw safePathError();
}

async function assertNoSymlinkAncestors(target: string): Promise<void> {
  const parsed = path.parse(target);
  const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    let stats;
    try { stats = await lstat(current); }
    catch (error) { if (isErrno(error, "ENOENT")) return; throw error; }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw safePathError();
  }
}

async function assertPrivateDirectory(directory: string): Promise<void> {
  let stats;
  try { stats = await lstat(directory); }
  catch (error) { if (isErrno(error, "ENOENT")) throw safePathError(); throw error; }
  if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o7777) !== PRIVATE_DIRECTORY_MODE) throw safePathError();
  assertOwned(stats);
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
  }
  await assertPrivateDirectory(directory);
}

async function statRegularFile(handle: FileHandle, filePath: string, expectedModes: number | readonly number[]): Promise<Awaited<ReturnType<FileHandle["stat"]>>> {
  const stats = await handle.stat();
  const modes = typeof expectedModes === "number" ? [expectedModes] : expectedModes;
  let pathStats;
  try { pathStats = await lstat(filePath); }
  catch { fail("REMOTE_FILE_PATH_UNSAFE", "Remote file path changed during access."); }
  if (!stats.isFile() || stats.isSymbolicLink() || !modes.includes(stats.mode & 0o7777)
    || pathStats.isSymbolicLink() || !pathStats.isFile() || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
    throw safePathError();
  }
  assertOwned(stats);
  assertOwned(pathStats);
  return stats;
}

async function hashHandle(handle: FileHandle, initialSize: number): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(HASH_BUFFER_BYTES);
  let position = 0;
  while (position < initialSize) {
    const wanted = Math.min(buffer.length, initialSize - position);
    const { bytesRead } = await handle.read(buffer, 0, wanted, position);
    if (bytesRead <= 0) fail("REMOTE_FILE_CHANGED", "Remote file changed while being verified.");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const finalStats = await handle.stat();
  if (!finalStats.isFile() || Number(finalStats.size) !== initialSize) fail("REMOTE_FILE_CHANGED", "Remote file changed while being verified.");
  return hash.digest("hex");
}

async function openExistingRegularFile(filePath: string, expectedModes: number | readonly number[]): Promise<{ handle: FileHandle; size: number; mode: number }> {
  let handle: FileHandle;
  try { handle = await open(filePath, constants.O_RDONLY | NOFOLLOW | (constants.O_NONBLOCK ?? 0)); }
  catch (error) {
    if (isErrno(error, "ENOENT")) throw error;
    if (isErrno(error, "ELOOP")) throw safePathError();
    throw error;
  }
  try {
    const stats = await statRegularFile(handle, filePath, expectedModes);
    const size = Number(stats.size);
    if (!Number.isSafeInteger(size) || size < 0) fail("REMOTE_FILE_PATH_UNSAFE", "Remote file size is unsafe.");
    return { handle, size, mode: Number(stats.mode) & 0o7777 };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export class RemoteFileStore {
  private readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || !path.isAbsolute(root) || NOFOLLOW === undefined) {
      fail("REMOTE_FILE_SPEC_INVALID", "Remote file storage root must be an absolute path on a qualified filesystem.");
    }
    this.root = path.resolve(root);
  }

  async status(input: RemoteFileSpec): Promise<RemoteFileStatus> {
    const spec = validateSpec(input);
    return this.withLock(spec, async paths => {
      const published = await this.inspectPublished(paths.publishedPath, spec);
      if (published) return { offset: spec.size, complete: true, path: paths.publishedPath };

      const partial = await this.inspectPartial(paths.partialPath, spec);
      if (partial.offset === spec.size) {
        if (!partial.digestMatches) fail("REMOTE_FILE_HASH_MISMATCH", "Remote file digest does not match the frozen source.");
        await this.publishPartial(paths, spec);
        return { offset: spec.size, complete: true, path: paths.publishedPath };
      }
      return { offset: partial.offset, complete: false, path: paths.partialPath };
    });
  }

  async append(input: RemoteFileSpec, offset: number, data: Buffer): Promise<RemoteFileStatus> {
    const spec = validateSpec(input);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Buffer.isBuffer(data)
      || data.length === 0 || data.length > MAX_CHUNK_BYTES || offset + data.length > spec.size) {
      fail("REMOTE_FILE_CHUNK_INVALID", "Remote file chunk is invalid.");
    }
    const chunk = Buffer.from(data);
    return this.withLock(spec, async paths => {
      const published = await this.inspectPublished(paths.publishedPath, spec);
      if (published) fail("REMOTE_FILE_ALREADY_COMPLETE", "Remote file has already been published.");

      const handle = await this.openPartialForAppend(paths.partialPath, offset);
      try {
        const stats = await statRegularFile(handle, paths.partialPath, PRIVATE_FILE_MODE);
        if (stats.size !== offset) fail("REMOTE_FILE_OFFSET_MISMATCH", "Remote file chunk offset does not match staged bytes.");
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, offset + written);
          if (result.bytesWritten <= 0) fail("REMOTE_FILE_WRITE_FAILED", "Remote file chunk could not be written.");
          written += result.bytesWritten;
        }
        await handle.sync();
        const after = await handle.stat();
        const nextOffset = offset + chunk.length;
        if (!after.isFile() || Number(after.size) !== nextOffset) fail("REMOTE_FILE_WRITE_FAILED", "Remote file chunk length changed during write.");
      } finally {
        await handle.close();
      }

      const nextOffset = offset + chunk.length;
      if (nextOffset !== spec.size) return { offset: nextOffset, complete: false, path: paths.partialPath };

      const partial = await this.inspectPartial(paths.partialPath, spec);
      if (!partial.digestMatches) fail("REMOTE_FILE_HASH_MISMATCH", "Remote file digest does not match the frozen source.");
      await this.publishPartial(paths, spec);
      return { offset: spec.size, complete: true, path: paths.publishedPath };
    });
  }

  private paths(spec: RemoteFileSpec): Paths {
    const accountDirectory = path.join(this.root, spec.advertiserId);
    const contentDirectory = path.join(accountDirectory, spec.sha256);
    const stagingDirectory = path.join(contentDirectory, ".staging");
    const fileKey = createHash("sha256").update(spec.fileName, "utf8").digest("hex");
    const fileStagingDirectory = path.join(stagingDirectory, fileKey);
    return {
      accountDirectory,
      contentDirectory,
      stagingDirectory,
      fileStagingDirectory,
      partialPath: path.join(fileStagingDirectory, "payload.part"),
      lockPath: path.join(fileStagingDirectory, "write.lock"),
      publishedPath: path.join(contentDirectory, spec.fileName),
    };
  }

  private async withLock<T>(spec: RemoteFileSpec, work: (paths: Paths) => Promise<T>): Promise<T> {
    const paths = this.paths(spec);
    await this.ensureRoot();
    await ensurePrivateDirectory(paths.accountDirectory);
    await ensurePrivateDirectory(paths.contentDirectory);
    await ensurePrivateDirectory(paths.stagingDirectory);
    await ensurePrivateDirectory(paths.fileStagingDirectory);

    let lock: FileHandle;
    try {
      lock = await open(paths.lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, PRIVATE_FILE_MODE);
    } catch (error) {
      if (isErrno(error, "EEXIST") || isErrno(error, "ELOOP")) fail("REMOTE_FILE_BUSY", "Remote file staging is already locked.");
      throw error;
    }
    let lockStats: Awaited<ReturnType<FileHandle["stat"]>> | undefined;
    try {
      lockStats = await lock.stat();
      if (!lockStats.isFile() || (lockStats.mode & 0o7777) !== PRIVATE_FILE_MODE) throw safePathError();
      assertOwned(lockStats);
      await lock.writeFile(randomBytes(16));
      await lock.sync();
      return await work(paths);
    } finally {
      await lock.close().catch(() => undefined);
      try {
        const current = await lstat(paths.lockPath);
        if (lockStats && !current.isSymbolicLink() && current.isFile() && current.dev === lockStats.dev && current.ino === lockStats.ino) await unlink(paths.lockPath);
      } catch { /* Keep failures fail-closed; a remaining lock requires explicit recovery. */ }
      await rmdir(paths.fileStagingDirectory).catch(() => undefined);
      await rmdir(paths.stagingDirectory).catch(() => undefined);
    }
  }

  private async ensureRoot(): Promise<void> {
    await assertNoSymlinkAncestors(this.root);
    try { await lstat(this.root); }
    catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      await mkdir(this.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    }
    await assertNoSymlinkAncestors(this.root);
    await assertPrivateDirectory(this.root);
  }

  private async openPartialForAppend(partialPath: string, offset: number): Promise<FileHandle> {
    if (offset === 0) {
      try {
        return await open(partialPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, PRIVATE_FILE_MODE);
      } catch (error) {
        if (!isErrno(error, "EEXIST")) {
          if (isErrno(error, "ELOOP")) throw safePathError();
          throw error;
        }
      }
    }
    try { return await open(partialPath, constants.O_RDWR | NOFOLLOW | (constants.O_NONBLOCK ?? 0)); }
    catch (error) {
      if (isErrno(error, "ENOENT")) fail("REMOTE_FILE_OFFSET_MISMATCH", "Remote file chunk offset does not match staged bytes.");
      if (isErrno(error, "ELOOP")) throw safePathError();
      throw error;
    }
  }

  private async inspectPublished(filePath: string, spec: RemoteFileSpec): Promise<boolean> {
    let opened: { handle: FileHandle; size: number; mode: number };
    try { opened = await openExistingRegularFile(filePath, PUBLISHED_FILE_MODE); }
    catch (error) {
      if (isErrno(error, "ENOENT")) return false;
      if (error instanceof RemoteFileStoreError) fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file is unsafe.");
      throw error;
    }
    try {
      if (opened.size !== spec.size || await hashHandle(opened.handle, opened.size) !== spec.sha256) {
        fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file does not match the frozen source.");
      }
      return true;
    } catch (error) {
      if (error instanceof RemoteFileStoreError && error.code !== "REMOTE_FILE_PUBLISHED_INVALID") {
        fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file could not be verified.");
      }
      throw error;
    } finally {
      await opened.handle.close();
    }
  }

  private async inspectPartial(partialPath: string, spec: RemoteFileSpec): Promise<{ offset: number; digestMatches: boolean }> {
    let opened: { handle: FileHandle; size: number; mode: number };
    try { opened = await openExistingRegularFile(partialPath, [PRIVATE_FILE_MODE, PUBLISHED_FILE_MODE]); }
    catch (error) {
      if (isErrno(error, "ENOENT")) return { offset: 0, digestMatches: false };
      throw error;
    }
    try {
      if (opened.size > spec.size || (opened.size < spec.size && opened.mode !== PRIVATE_FILE_MODE)) fail("REMOTE_FILE_PARTIAL_INVALID", "Staged remote file has an invalid size or mode.");
      const digestMatches = opened.size === spec.size && await hashHandle(opened.handle, opened.size) === spec.sha256;
      return { offset: opened.size, digestMatches };
    } finally {
      await opened.handle.close();
    }
  }

  private async publishPartial(paths: Paths, spec: RemoteFileSpec): Promise<void> {
    const partial = await openExistingRegularFile(paths.partialPath, [PRIVATE_FILE_MODE, PUBLISHED_FILE_MODE]);
    try {
      if (partial.mode === PRIVATE_FILE_MODE) await partial.handle.chmod(PUBLISHED_FILE_MODE);
      await partial.handle.sync();
      await statRegularFile(partial.handle, paths.partialPath, PUBLISHED_FILE_MODE);
    } finally {
      await partial.handle.close();
    }
    try {
      await link(paths.partialPath, paths.publishedPath);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        if (isErrno(error, "ELOOP")) fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file path is unsafe.");
        throw error;
      }
      if (!await this.inspectPublished(paths.publishedPath, spec)) fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file could not be verified.");
      await unlink(paths.partialPath).catch(() => undefined);
      return;
    }

    const partialStats = await lstat(paths.partialPath);
    const publishedStats = await lstat(paths.publishedPath);
    if (partialStats.isSymbolicLink() || !partialStats.isFile() || publishedStats.isSymbolicLink() || !publishedStats.isFile()
      || partialStats.dev !== publishedStats.dev || partialStats.ino !== publishedStats.ino
      || (publishedStats.mode & 0o7777) !== PUBLISHED_FILE_MODE) fail("REMOTE_FILE_PUBLISHED_INVALID", "Published remote file could not be verified.");
    assertOwned(publishedStats);
    await unlink(paths.partialPath);
    const directory = await open(paths.contentDirectory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NOFOLLOW);
    try { await directory.sync(); }
    finally { await directory.close(); }
  }
}
