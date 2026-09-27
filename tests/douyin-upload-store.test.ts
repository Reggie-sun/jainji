import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { DouyinUploadStore, uploadTaskId, frozenInputDigest, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { DouyinUploadConfigSchema, type FinalArtifactInput } from "../src/shared/douyin-upload";

export function makeRecord(): UploadTaskRecord {
  const input: FinalArtifactInput = { project_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID(), video_path: "/tmp/a.mp4", artifact_sha256: "a".repeat(64), size_bytes: 1 };
  const id = uploadTaskId(input);
  return { input, inputDigest: frozenInputDigest(input), config: DouyinUploadConfigSchema.parse({}), snapshotPath: "/tmp/private.mp4", revisions: [], result: { project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, upload_task_id: id, artifact_sha256: input.artifact_sha256, file_name: "a.mp4", state: "PENDING", publish_outcome: "NOT_SUBMITTED", retryable: false, retry_count: 0, timestamp: new Date().toISOString() } };
}
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "douyin-store-")); const store = new DouyinUploadStore(root); await store.load(); return { root, store }; }

describe("durable Douyin fence", () => {
  it("exclusively syncs marker before granting permission, preserving it across restart", async () => {
    const { root, store } = await fixture(); const task = makeRecord(); await store.saveTask(task);
    await store.markSubmitting(task.result.upload_task_id);
    await expect(store.markSubmitting(task.result.upload_task_id)).rejects.toThrow();
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.task(task.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED", retryable: false });
    expect(JSON.parse(await readFile(path.join(root, "markers", `${task.result.upload_task_id}.json`), "utf8"))).toMatchObject({ artifact_sha256: task.input.artifact_sha256, input_digest: task.inputDigest });
  });
  it("does not use a stale backup to restore publication permission", async () => {
    const { root, store } = await fixture(); await store.saveTask(makeRecord());
    await writeFile(path.join(root, "state.json"), "broken");
    await expect(new DouyinUploadStore(root).load()).rejects.toThrow();
  });
  it("refuses side effects when directory sync fails and leaves an exclusive marker", async () => {
    const { root, store } = await fixture(); const task = makeRecord(); await store.saveTask(task);
    const failing = new DouyinUploadStore(root, { syncDirectory: async () => { throw new Error("directory fsync unsupported"); } });
    await failing.load();
    await expect(failing.markSubmitting(task.result.upload_task_id)).rejects.toThrow();
    expect(failing.hasMarker(task.result.upload_task_id)).toBe(true);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.task(task.result.upload_task_id)?.result.publish_outcome).toBe("MAY_HAVE_SUBMITTED");
  });
  it("rejects corrupt/orphan markers and unknown versions instead of clearing history", async () => {
    const { root, store } = await fixture(); const task = makeRecord(); await store.saveTask(task); await store.markSubmitting(task.result.upload_task_id);
    await writeFile(path.join(root, "markers", `${task.result.upload_task_id}.json`), "{}");
    await expect(new DouyinUploadStore(root).load()).rejects.toThrow();
    const second = await fixture(); await writeFile(path.join(second.root, "state.json"), JSON.stringify({ version: 2 }));
    await expect(new DouyinUploadStore(second.root).load()).rejects.toThrow();
  });
  it("binds identity to task and bytes, excluding path, caption and render attempt", () => {
    const task = makeRecord();
    expect(uploadTaskId({ ...task.input, video_path: "/tmp/renamed.mp4", caption: "new" })).toBe(task.result.upload_task_id);
    expect(uploadTaskId({ ...task.input, artifact_sha256: "b".repeat(64) })).not.toBe(task.result.upload_task_id);
  });
  it("recovers only as unknown after a separate process exits between file sync and result save", async () => {
    const { root, store } = await fixture(); const task = makeRecord(); await store.saveTask(task);
    const executable = path.join(root, "crash-fixture.cjs");
    buildSync({ stdin: { contents: `import { DouyinUploadStore } from ${JSON.stringify(path.resolve("src/main/douyin-upload-store.ts"))};
      const store = new DouyinUploadStore(${JSON.stringify(root)}, { syncDirectory: async () => process.exit(91) });
      store.load().then(() => store.markSubmitting(${JSON.stringify(task.result.upload_task_id)})).catch(() => process.exit(92));`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", outfile: executable, logLevel: "silent" });
    expect(spawnSync(process.execPath, [executable], { timeout: 10_000 }).status).toBe(91);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.task(task.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED" });
    await expect(reopened.markSubmitting(task.result.upload_task_id)).rejects.toThrow();
  });
});
