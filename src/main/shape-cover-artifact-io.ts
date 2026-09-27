import { createHash } from "node:crypto";
import { constants, lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

export const SHAPE_ARTIFACT_METADATA_BYTES = 1024 * 1024;
export const SHAPE_ARTIFACT_SAMPLE_BYTES = 1024 * 1024 * 1024;
export const SHAPE_ARTIFACT_TOTAL_BYTES = 2 * SHAPE_ARTIFACT_SAMPLE_BYTES;
export function artifactUnsafe(reason: string): never { throw new Error(`UNSAFE: shape artifact ${reason}`); }

export async function artifactDirectory(directory: string): Promise<void> {
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== path.resolve(directory)) artifactUnsafe("directory is not canonical");
}

/** Directory sync failure is a refusal, including on unsupported platforms. */
export async function syncArtifactDirectory(directory: string): Promise<void> {
  await artifactDirectory(directory);
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeArtifactJson(filePath: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > SHAPE_ARTIFACT_METADATA_BYTES) artifactUnsafe("metadata limit");
  await artifactDirectory(path.dirname(filePath));
  const handle = await open(filePath, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncArtifactDirectory(path.dirname(filePath));
}

/** Fixed-size streaming I/O: neither growth nor symlinks can bypass the byte budget. */
export async function inspectArtifactFile(source: string, maxBytes: number, signal?: AbortSignal, destination?: string, collect = false): Promise<{ fingerprint: string; bytes: number; content: Buffer }> {
  signal?.throwIfAborted();
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await input.stat();
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) artifactUnsafe("file size limit");
    if ((await lstat(source)).isSymbolicLink()) artifactUnsafe("symbolic link");
    if (destination) {
      await artifactDirectory(path.dirname(destination));
      output = await open(destination, "wx", 0o600);
    }
    const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(maxBytes + 1, 1024 * 1024));
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      signal?.throwIfAborted();
      const read = await input.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - bytes), null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > maxBytes) artifactUnsafe("file grew past limit");
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      if (collect) chunks.push(Buffer.from(chunk));
      if (output) for (let offset = 0; offset < chunk.length;) {
        const written = await output.write(chunk, offset, chunk.length - offset);
        if (!written.bytesWritten) artifactUnsafe("short write");
        offset += written.bytesWritten;
      }
    }
    const after = await input.stat();
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) artifactUnsafe("file changed during read");
    signal?.throwIfAborted();
    await output?.sync();
    return { fingerprint: `sha256:${hash.digest("hex")}`, bytes, content: collect ? Buffer.concat(chunks) : Buffer.alloc(0) };
  } finally { await input.close(); await output?.close(); }
}

export async function readArtifactJson(filePath: string): Promise<unknown> {
  return JSON.parse((await inspectArtifactFile(filePath, SHAPE_ARTIFACT_METADATA_BYTES, undefined, undefined, true)).content.toString("utf8"));
}
