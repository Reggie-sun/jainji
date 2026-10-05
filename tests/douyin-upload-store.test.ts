import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { DouyinUploadStore, uploadTaskId, frozenInputDigest, sameTargetBytes, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { legacyTaskId, legacyInputDigest } from "../src/main/douyin-upload-legacy";
import { DouyinUploadConfigSchema, QianchuanUploadConfigSchema, QianchuanUploadResultSchema, UploadAuthorizationSchema, type PageOwnership } from "../src/shared/douyin-upload";

const roots: string[] = [];
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
export function makeRecord(): UploadTaskRecord {
  const input = { project_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID(), video_path: "/tmp/a.mp4", artifact_sha256: "a".repeat(64), size_bytes: 1 };
  const authorization = { target: { product: "眼贴" as const, cdpEndpoint: "http://127.0.0.1:9225", advertiserId: "9007199254740993", adId: "123", configDigest: "b".repeat(64) }, pageBatchId: crypto.randomUUID(), expectedCount: 2 };
  return { input, inputDigest: frozenInputDigest(input, authorization), authorization, config: QianchuanUploadConfigSchema.parse({}), snapshotPath: "/tmp/private.mp4",
    result: { project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, upload_task_id: uploadTaskId(input, authorization.target), artifact_sha256: input.artifact_sha256, file_name: "a.mp4", accountProduct: "眼贴", advertiserId: authorization.target.advertiserId, adId: authorization.target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: new Date().toISOString() } };
}
export async function saveRecord(store: DouyinUploadStore, task: UploadTaskRecord): Promise<void> {
  await store.saveIntents([{ project_id: task.input.project_id, batch_id: task.input.batch_id, export_task_id: task.input.export_task_id, selection: { enabled: true, accountProduct: task.authorization.target.product }, authorization: task.authorization, config: task.config }]);
  await store.saveTask(task);
}
const ownership = (task: UploadTaskRecord): PageOwnership => ({ targetId: "fixture-target", pageBatchId: task.authorization.pageBatchId, modalSessionId: crypto.randomUUID() });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "qianchuan-store-")); roots.push(root); const store = new DouyinUploadStore(root); await store.load(); return { root, store }; }

describe("v2 target-bound selection fences", () => {
  it.each(["project", "authorization", "capacity"] as const)("rejects batch %s drift even when other batches intervene", async drift => {
    const { store } = await fixture(), first = makeRecord(), unrelated = makeRecord(), extra = makeRecord();
    if (drift === "capacity") first.authorization.expectedCount = 1;
    await store.saveIntents([first, unrelated].map(task => ({ project_id: task.input.project_id, batch_id: task.input.batch_id, export_task_id: task.input.export_task_id,
      selection: { enabled: true as const, accountProduct: task.authorization.target.product }, authorization: task.authorization, config: task.config })));
    const intent = { project_id: first.input.project_id, batch_id: extra.input.batch_id, export_task_id: extra.input.export_task_id,
      selection: { enabled: true as const, accountProduct: first.authorization.target.product }, authorization: structuredClone(first.authorization), config: first.config };
    if (drift === "project") intent.project_id = extra.input.project_id;
    if (drift === "authorization") intent.authorization.target.adId = "456";
    await expect(store.saveIntents([intent])).rejects.toThrow();
    expect(store.unavailable).toBe(true);
  });

  it("does not count another batch's fences as READY evidence for this batch", async () => {
    const { root, store } = await fixture(), first = makeRecord(), other = makeRecord();
    other.input.artifact_sha256 = "c".repeat(64); other.result.artifact_sha256 = other.input.artifact_sha256;
    other.inputDigest = frozenInputDigest(other.input, other.authorization); other.result.upload_task_id = uploadTaskId(other.input, other.authorization.target);
    await saveRecord(store, first); await saveRecord(store, other);
    const page = ownership(first); await store.markSelecting(first.result.upload_task_id, page, 1);
    await store.markSelecting(other.result.upload_task_id, ownership(other), 1);
    const state = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
    state.tasks[0].result = { ...state.tasks[0].result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY",
      readyEvidence: { advertiserId: first.result.advertiserId, adId: first.result.adId, fileName: first.result.file_name, selectedCount: 2, pageOwnership: page, observedAt: new Date().toISOString() } };
    expect(QianchuanUploadResultSchema.safeParse(state.tasks[0].result).success).toBe(true);
    await writeFile(path.join(root, "state.json"), JSON.stringify(state));
    await expect(new DouyinUploadStore(root).load()).rejects.toThrow();
  });

  it("restores named and legacy frozen targets without changing task identity, dedup or permanent fences", async () => {
    const { root, store } = await fixture(), legacy = makeRecord(), named = makeRecord();
    named.authorization = UploadAuthorizationSchema.parse({ ...named.authorization, target: { ...named.authorization.target, productName: "新产品" } });
    named.inputDigest = frozenInputDigest(named.input, named.authorization);
    const renamed = structuredClone(named); renamed.authorization.target.productName = "下个产品";
    expect(uploadTaskId(named.input, renamed.authorization.target)).toBe(named.result.upload_task_id);
    expect(sameTargetBytes(named, renamed)).toBe(true);
    await saveRecord(store, legacy); await saveRecord(store, named);
    await store.markSelecting(named.result.upload_task_id, ownership(named), 1);
    await expect(store.saveTask({ ...named, authorization: renamed.authorization })).rejects.toThrow();
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.unavailable).toBe(false);
    expect(reopened.task(legacy.result.upload_task_id)?.authorization).toEqual(legacy.authorization);
    expect(reopened.task(named.result.upload_task_id)?.authorization).toEqual(named.authorization);
    expect(reopened.task(named.result.upload_task_id)?.inputDigest).toBe(named.inputDigest);
    expect(reopened.task(named.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false });
    expect(reopened.hasMarker(named.result.upload_task_id)).toBe(true);
    await expect(reopened.markSelecting(named.result.upload_task_id, ownership(named), 1)).rejects.toThrow();
  });
  it("creates and syncs an exclusive selection fence, restoring only read-only permission after restart", async () => {
    const { root, store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    const page = ownership(task); await store.markSelecting(task.result.upload_task_id, page, 1);
    await expect(store.markSelecting(task.result.upload_task_id, page, 1)).rejects.toThrow();
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.task(task.result.upload_task_id)?.result).toMatchObject({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false });
    const marker = JSON.parse(await readFile(path.join(root, "selection-fences", `${task.result.upload_task_id}.json`), "utf8"));
    expect(marker).toMatchObject({ version: 2, input_digest: task.inputDigest, advertiserId: task.authorization.target.advertiserId, pageOwnership: page, attempt: 1 });
    expect(await readFile(path.join(root, "state.json"), "utf8")).not.toContain("MAY_HAVE_SUBMITTED");
  });
  it("binds v2 identity to target and bytes but not endpoint or filename", () => {
    const task = makeRecord(), target = task.authorization.target;
    expect(uploadTaskId({ ...task.input, video_path: "/tmp/renamed.mp4" }, { ...target, cdpEndpoint: "http://127.0.0.1:9999" })).toBe(task.result.upload_task_id);
    expect(uploadTaskId(task.input, { ...target, adId: "456" })).not.toBe(task.result.upload_task_id);
    expect(uploadTaskId({ ...task.input, artifact_sha256: "c".repeat(64) }, target)).not.toBe(task.result.upload_task_id);
  });
  it("does not authorize selection when directory sync fails, retaining any created fence", async () => {
    const { root, store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    const failing = new DouyinUploadStore(root, { syncDirectory: async () => { throw new Error("fsync failure"); } }); await failing.load();
    await expect(failing.markSelecting(task.result.upload_task_id, ownership(task), 1)).rejects.toThrow();
    expect(failing.unavailable).toBe(true); expect(failing.hasMarker(task.result.upload_task_id)).toBe(true);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    expect(reopened.tasks()[0].result.upload_outcome).toBe("MAY_HAVE_UPLOADED");
  });
  it.each(["create", "write", "sync"] as const)("fails closed when fence %s fails before permission is returned", async failure => {
    const { root, store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(filesystem.open).mockImplementation(async (...args: Parameters<typeof filesystem.open>) => {
      if (String(args[0]).includes("selection-fences") && args[1] === "wx") {
        if (failure === "create") throw new Error("injected open failure");
        const handle = await actual.open(...args);
        vi.spyOn(handle, failure === "write" ? "writeFile" : "sync").mockRejectedValueOnce(new Error("injected fence failure"));
        return handle;
      }
      return actual.open(...args);
    });
    await expect(store.markSelecting(task.result.upload_task_id, ownership(task), 1)).rejects.toThrow();
    expect(store.unavailable).toBe(true);
    expect(store.hasMarker(task.result.upload_task_id)).toBe(failure !== "create");
    vi.restoreAllMocks();
    const reopened = new DouyinUploadStore(root);
    if (failure === "write") await expect(reopened.load()).rejects.toThrow();
    else { await reopened.load(); expect(reopened.tasks()[0].result.upload_outcome).toBe(failure === "sync" ? "MAY_HAVE_UPLOADED" : "NOT_SELECTED"); }
  });
  it("rejects noncontiguous indices and a different owned modal for the same production group", async () => {
    const { store } = await fixture(), first = makeRecord(), second = makeRecord();
    second.input.project_id = first.input.project_id; second.authorization = structuredClone(first.authorization);
    second.input.artifact_sha256 = "c".repeat(64); second.input.video_path = "/tmp/b.mp4";
    second.inputDigest = frozenInputDigest(second.input, second.authorization);
    second.result = { ...second.result, project_id: first.input.project_id, file_name: "b.mp4", artifact_sha256: second.input.artifact_sha256, upload_task_id: uploadTaskId(second.input, second.authorization.target) };
    await saveRecord(store, first); await saveRecord(store, second);
    const page = ownership(first); await store.markSelecting(first.result.upload_task_id, page, 1);
    await expect(store.markSelecting(second.result.upload_task_id, page, 1)).rejects.toThrow();
    await expect(store.markSelecting(second.result.upload_task_id, { ...page, targetId: "other-tab" }, 2)).rejects.toThrow();
    expect(store.unavailable).toBe(false); expect(store.hasMarker(second.result.upload_task_id)).toBe(false);
  });
  it("recovers a separate-process crash after fence fsync without a second selection grant", async () => {
    const { root, store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    const executable = path.join(root, "crash.cjs");
    buildSync({ stdin: { contents: `import { DouyinUploadStore } from ${JSON.stringify(path.resolve("src/main/douyin-upload-store.ts"))}; const store = new DouyinUploadStore(${JSON.stringify(root)}, { syncDirectory: async () => process.exit(91) }); store.load().then(() => store.markSelecting(${JSON.stringify(task.result.upload_task_id)}, ${JSON.stringify(ownership(task))}, 1)).catch(() => process.exit(92));`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", outfile: executable, logLevel: "silent" });
    expect(spawnSync(process.execPath, [executable], { timeout: 10_000 }).status).toBe(91);
    const reopened = new DouyinUploadStore(root); await reopened.load();
    await expect(reopened.markSelecting(task.result.upload_task_id, ownership(task), 1)).rejects.toThrow();
  });
  it("deduplicates selected bytes within a target but permits independently authorized other targets", async () => {
    const { store } = await fixture(), a = makeRecord(), b = makeRecord(), c = makeRecord();
    c.authorization.target.adId = "456";
    c.inputDigest = frozenInputDigest(c.input, c.authorization); c.result.adId = "456"; c.result.upload_task_id = uploadTaskId(c.input, c.authorization.target);
    for (const task of [a, b, c]) await saveRecord(store, task);
    await store.markSelecting(a.result.upload_task_id, ownership(a), 1);
    await expect(store.markSelecting(b.result.upload_task_id, ownership(b), 1)).rejects.toThrow();
    await store.markSelecting(c.result.upload_task_id, ownership(c), 1);
  });
  it("rejects task target changes and never reverses an existing fence", async () => {
    const { store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    const intent = store.intents()[0]; intent.authorization.target.adId = "456";
    await expect(store.saveIntents([intent])).rejects.toThrow();
    await store.markSelecting(task.result.upload_task_id, ownership(task), 1);
    await expect(store.saveTask(task)).rejects.toThrow();
  });
  it.each(["corrupt-state", "unknown-version", "orphan-fence", "orphan-backup"])("blocks %s without falling back to backups", async scenario => {
    const { root, store } = await fixture(), task = makeRecord(); await saveRecord(store, task);
    if (scenario === "corrupt-state") await writeFile(path.join(root, "state.json"), "broken");
    if (scenario === "unknown-version") await writeFile(path.join(root, "state.json"), '{"version":999}');
    if (scenario === "orphan-fence") await writeFile(path.join(root, "selection-fences", `${"c".repeat(64)}.json`), "{}", { mode: 0o600 });
    if (scenario === "orphan-backup") { await rm(path.join(root, "state.json")); }
    await expect(new DouyinUploadStore(root).load()).rejects.toThrow();
  });
});

describe("v1 creator history isolation", () => {
  async function legacyFixture() {
    const { root } = await fixture(), input = makeRecord().input;
    const id = legacyTaskId(input);
    const old = { version: 1, config: DouyinUploadConfigSchema.parse({ enabled: true }), intents: [], tasks: [{ input, inputDigest: legacyInputDigest(input), config: DouyinUploadConfigSchema.parse({}), snapshotPath: "/tmp/private.mp4", revisions: [], result: { project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id, upload_task_id: id, artifact_sha256: input.artifact_sha256, file_name: "a.mp4", state: "PENDING", publish_outcome: "NOT_SUBMITTED", retryable: false, retry_count: 0, timestamp: new Date().toISOString() } }] };
    const bytes = Buffer.from(JSON.stringify(old, null, 3) + "\n"); await writeFile(path.join(root, "state.json"), bytes, { mode: 0o600 });
    return { root, old, bytes };
  }
  it("retains exact legacy bytes and old pending as read-only, defaulting new settings to disabled", async () => {
    const { root, bytes } = await legacyFixture(), migrated = new DouyinUploadStore(root); await migrated.load();
    expect(await readFile(path.join(root, "legacy-v1.json"))).toEqual(bytes);
    expect(migrated.tasks()).toEqual([]); expect(migrated.intents()).toEqual([]); expect(migrated.config.enabled).toBe(false);
    expect(migrated.legacyTasks()[0].state).toBe("PENDING");
    const reopened = new DouyinUploadStore(root); await reopened.load(); expect(reopened.legacyTasks()).toEqual(migrated.legacyTasks());
  });
  it("resumes only an identical retained-byte migration and refuses conflicting history", async () => {
    const { root, bytes } = await legacyFixture();
    await writeFile(path.join(root, "legacy-v1.json"), bytes, { mode: 0o600 });
    await new DouyinUploadStore(root).load();
    const other = await legacyFixture(); await writeFile(path.join(other.root, "legacy-v1.json"), "{}", { mode: 0o600 });
    await expect(new DouyinUploadStore(other.root).load()).rejects.toThrow();
    expect(await readFile(path.join(other.root, "state.json"))).toEqual(other.bytes);
  });
  it("rejects an orphan creator marker without overwriting the old state", async () => {
    const { root, bytes } = await legacyFixture();
    await mkdir(path.join(root, "markers"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, "markers", `${"d".repeat(64)}.json`), "{}", { mode: 0o600 });
    await expect(new DouyinUploadStore(root).load()).rejects.toThrow();
    expect(await readFile(path.join(root, "state.json"))).toEqual(bytes);
  });
});
