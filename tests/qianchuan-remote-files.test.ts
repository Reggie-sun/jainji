import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteFileStore, type RemoteFileSpec } from "../src/main/qianchuan-remote-files.js";

const roots: string[] = [];
const payload = Buffer.from("remote staging keeps these exact bytes");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(bytes = payload) {
  const parent = await mkdtemp(path.join(tmpdir(), "jianji-remote-files-"));
  roots.push(parent);
  const root = path.join(parent, "private", "incoming");
  const store = new RemoteFileStore(root);
  const spec: RemoteFileSpec = { advertiserId: "123456789", sha256: sha256(bytes), size: bytes.length, fileName: "视频 文件.mp4" };
  return { parent, root, store, spec, bytes };
}

describe.skipIf(process.platform === "win32")("remote Qianchuan file staging", () => {
  it("resumes exact chunks and publishes only the original filename after SHA256 verification", async () => {
    const { root, store, spec, bytes } = await fixture();
    const first = await store.append(spec, 0, bytes.subarray(0, 8));
    expect(first).toMatchObject({ offset: 8, complete: false });
    expect(path.basename(first.path)).not.toBe(spec.fileName);
    expect((await store.status(spec)).offset).toBe(8);

    const done = await store.append(spec, 8, bytes.subarray(8));
    expect(done).toMatchObject({ offset: bytes.length, complete: true, path: path.join(root, spec.advertiserId, spec.sha256, spec.fileName) });
    expect(await readFile(done.path)).toEqual(bytes);
    expect((await lstat(done.path)).mode & 0o777).toBe(0o400);
    expect(await readdir(path.dirname(done.path))).toEqual([spec.fileName]);
    expect(await store.status(spec)).toEqual(done);
  });

  it("keeps a full digest-mismatched partial as diagnostic state and never publishes it", async () => {
    const { root, store, spec, bytes } = await fixture();
    const initial = await store.status(spec);
    const wrong = Buffer.from(bytes); wrong[0] ^= 1;
    await expect(store.append(spec, 0, wrong)).rejects.toMatchObject({ code: "REMOTE_FILE_HASH_MISMATCH" });
    expect(await readFile(initial.path)).toEqual(wrong);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_HASH_MISMATCH" });
    await expect(lstat(path.join(root, spec.advertiserId, spec.sha256, spec.fileName))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes a verified full staging file left read-only at the publication boundary", async () => {
    const { store, spec, bytes } = await fixture();
    const partial = await store.status(spec);
    await mkdir(path.dirname(partial.path), { recursive: true, mode: 0o700 });
    await writeFile(partial.path, bytes, { mode: 0o600 });
    await chmod(partial.path, 0o400);
    const done = await store.status(spec);
    expect(done).toMatchObject({ offset: bytes.length, complete: true });
    expect(await readFile(done.path)).toEqual(bytes);
    expect((await lstat(done.path)).mode & 0o777).toBe(0o400);
  });

  it("isolates the same content by advertiser and rejects stale offsets without changing staged bytes", async () => {
    const { store, spec, bytes } = await fixture();
    const other = { ...spec, advertiserId: "987654321" };
    await store.append(spec, 0, bytes.subarray(0, 5));
    await expect(store.append(spec, 0, bytes.subarray(5, 10))).rejects.toMatchObject({ code: "REMOTE_FILE_OFFSET_MISMATCH" });
    await store.append(other, 0, bytes.subarray(0, 5));
    expect((await store.status(spec)).path).not.toBe((await store.status(other)).path);
    expect((await store.status(spec)).offset).toBe(5);
    expect((await store.status(other)).offset).toBe(5);
  });

  it("allows only one concurrent append at a given offset", async () => {
    const bytes = Buffer.alloc(64, 0x4a);
    const { store, spec } = await fixture(bytes);
    const results = await Promise.allSettled([
      store.append(spec, 0, bytes.subarray(0, 16)),
      store.append(spec, 0, bytes.subarray(16, 32)),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await store.status(spec)).offset).toBe(16);
  });

  it("rejects unsafe identities, filenames, sizes, hashes, and oversized chunks", async () => {
    const { store, spec, bytes } = await fixture();
    const invalid: RemoteFileSpec[] = [
      { ...spec, advertiserId: "../123" },
      { ...spec, advertiserId: "0" },
      { ...spec, advertiserId: "0123" },
      { ...spec, advertiserId: "1".repeat(21) },
      { ...spec, fileName: "../video.mp4" },
      { ...spec, fileName: "video\\escape.mp4" },
      { ...spec, fileName: "bad\nname.mp4" },
      { ...spec, fileName: ".." },
      { ...spec, sha256: "z".repeat(64) },
      { ...spec, sha256: spec.sha256.toUpperCase() },
      { ...spec, size: 0 },
      { ...spec, size: 1.5 },
      { ...spec, size: 20 * 1024 ** 3 + 1 },
    ];
    for (const value of invalid) await expect(store.status(value)).rejects.toMatchObject({ code: "REMOTE_FILE_SPEC_INVALID" });
    await expect(store.append(spec, 0, Buffer.alloc(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "REMOTE_FILE_CHUNK_INVALID" });
    await expect(store.append(spec, 0, Buffer.alloc(0))).rejects.toMatchObject({ code: "REMOTE_FILE_CHUNK_INVALID" });
    expect((await store.status(spec)).offset).toBe(0);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("rejects a symlinked root and refuses an existing published file with changed bytes", async () => {
    const { parent, root, spec, store, bytes } = await fixture();
    const realRoot = path.join(parent, "real-root");
    await store.append(spec, 0, bytes);
    await rm(root, { recursive: true, force: true });
    await mkdir(realRoot, { recursive: true, mode: 0o700 });
    const link = path.join(parent, "linked-root");
    await symlink(realRoot, link);
    await expect(new RemoteFileStore(link).status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PATH_UNSAFE" });

    await store.status(spec);
    const published = path.join(root, spec.advertiserId, spec.sha256, spec.fileName);
    await mkdir(path.dirname(published), { recursive: true, mode: 0o700 });
    await writeFile(published, Buffer.from("tampered"), { mode: 0o600 });
    await chmod(path.dirname(published), 0o700);
    await chmod(published, 0o400);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PUBLISHED_INVALID" });
  });

  it("rejects unsafe root permissions instead of silently repairing them", async () => {
    const { root, store, spec } = await fixture();
    await store.status(spec);
    await chmod(root, 0o755);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PATH_UNSAFE" });
  });

  it("rejects symlinked account, partial, and published paths", async () => {
    const { parent, root, store, spec } = await fixture();
    await store.status(spec);
    const outside = path.join(parent, "outside");
    await mkdir(outside, { mode: 0o700 });

    const accountDirectory = path.join(root, spec.advertiserId);
    await rm(accountDirectory, { recursive: true, force: true });
    await symlink(outside, accountDirectory);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PATH_UNSAFE" });
    await rm(accountDirectory);
    await mkdir(accountDirectory, { mode: 0o700 });
    await store.status(spec);

    const partial = (await store.status(spec)).path;
    await mkdir(path.dirname(partial), { recursive: true, mode: 0o700 });
    await symlink(path.join(outside, "payload"), partial);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PATH_UNSAFE" });
    await rm(partial);
    await rm(path.dirname(partial), { recursive: true, force: true });

    const published = path.join(root, spec.advertiserId, spec.sha256, spec.fileName);
    await symlink(path.join(outside, "payload"), published);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PUBLISHED_INVALID" });
  });

  it("rejects a staged regular file with non-private permissions", async () => {
    const { store, spec } = await fixture();
    const partial = (await store.status(spec)).path;
    await mkdir(path.dirname(partial), { recursive: true, mode: 0o700 });
    await writeFile(partial, Buffer.from("partial"), { mode: 0o600 });
    await chmod(partial, 0o644);
    await expect(store.status(spec)).rejects.toMatchObject({ code: "REMOTE_FILE_PATH_UNSAFE" });
  });

  it("rejects relative roots at construction", async () => {
    expect(() => new RemoteFileStore("relative/storage")).toThrowError(expect.objectContaining({ code: "REMOTE_FILE_SPEC_INVALID" }));
  });
});
