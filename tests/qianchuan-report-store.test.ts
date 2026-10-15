import { mkdtemp, open, readFile, readlink, readdir, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QIANCHUAN_QUERY_METRICS } from "../src/shared/qianchuan-backend.js";
import { QianchuanReportStore } from "../src/main/qianchuan-report-store.js";
import { QianchuanReportSnapshotSchema } from "../src/shared/qianchuan-report.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qianchuan-report-"));
  roots.push(root);
  const directory = path.join(root, "reports");
  const store = new QianchuanReportStore(directory);
  return { root, directory, store };
}
const metrics = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "1", display: "1" }]));
const metricProvenance = Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, {
  source: "platform-reported", unit: "unknown", definition: "platform-reported",
}]));
const snapshot = (patch: Record<string, unknown> = {}) => QianchuanReportSnapshotSchema.parse({
  version: 1, id: "08b94db4-2684-42b0-8a38-2cce443c0778", source: "qianchuan-browser", product: "眼贴",
  advertiserId: "1879999999999999999", kind: "report", startTime: "2026-10-15 00:00:00", endTime: "2026-10-15 09:00:00",
  asOf: "2026-10-15T01:00:00.000Z", capturedAt: "2026-10-15T01:00:01.000Z", complete: true, metrics, metricProvenance, ...patch,
});

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("persists private immutable snapshots and reads them after store restart", async () => {
  const { directory, store } = await fixture();
  const value = snapshot();
  await store.initialize();
  await store.save(value);
  const info = await stat(directory);
  expect(info.mode & 0o777).toBe(0o700);
  expect((await stat(path.join(directory, `${value.id}.json`))).mode & 0o777).toBe(0o600);
  const restarted = new QianchuanReportStore(directory);
  await restarted.initialize();
  expect(await restarted.list("眼贴", "1879999999999999999")).toEqual([value]);
  expect(await restarted.list("蝴蝶贴", "1879999999999999999")).toEqual([]);
});

it("does not publish a complete snapshot when cancellation arrives during temporary-file sync", async () => {
  const { root, directory, store } = await fixture();
  await store.initialize();
  const probe = await open(path.join(root, "probe"), "wx", 0o600), prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const sync = prototype.sync, controller = new AbortController();
  const intercepted = vi.spyOn(prototype, "sync").mockImplementation(async function(this: FileHandle) {
    await sync.call(this);
    if ((await readlink(`/proc/self/fd/${this.fd}`)).startsWith(`${directory}/.`)) controller.abort();
  });
  try {
    await expect(store.save(snapshot(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  } finally { intercepted.mockRestore(); }
  expect(controller.signal.aborted).toBe(true);
  expect(await store.list("眼贴", "1879999999999999999")).toEqual([]);
  expect(await readdir(directory)).toEqual([]);
});

it("rejects overwrite and retains the original bytes", async () => {
  const { directory, store } = await fixture();
  const original = snapshot();
  await store.save(original);
  const file = path.join(directory, `${original.id}.json`);
  const bytes = await readFile(file);
  await expect(store.save(snapshot({ startTime: "2026-10-14 00:00:00" }))).rejects.toThrow();
  expect(await readFile(file)).toEqual(bytes);
});

it.each(["malformed JSON", "missing identity", "duplicate ID", "credential field"])("rejects %s instead of returning a partial history", async defect => {
  const { directory, store } = await fixture();
  await store.initialize();
  const value = snapshot();
  if (defect === "malformed JSON") {
    await writeFile(path.join(directory, `${value.id}.json`), "{", { mode: 0o600 });
  } else if (defect === "missing identity") {
    const { advertiserId: _advertiserId, ...missing } = value;
    await writeFile(path.join(directory, `${value.id}.json`), JSON.stringify(missing), { mode: 0o600 });
  } else if (defect === "duplicate ID") {
    await writeFile(path.join(directory, `${value.id}.json`), JSON.stringify(value), { mode: 0o600 });
    await writeFile(path.join(directory, "c6a5f63c-1fd0-43b0-b2f0-410f8a1e09e5.json"), JSON.stringify(value), { mode: 0o600 });
  } else {
    await writeFile(path.join(directory, `${value.id}.json`), JSON.stringify({ ...value, token: "secret" }), { mode: 0o600 });
  }
  await expect(store.list("眼贴", "1879999999999999999")).rejects.toThrow();
});

it("rejects leftover partial publication files", async () => {
  const { directory, store } = await fixture();
  await store.initialize();
  await writeFile(path.join(directory, "snapshot.partial"), "{}", { mode: 0o600 });
  await expect(store.list("眼贴", "1879999999999999999")).rejects.toThrow();
  expect(await readdir(directory)).toContain("snapshot.partial");
});

it("requires parent-directory durability before publishing snapshots", async () => {
  const { root, directory } = await fixture(), sync = vi.fn(async () => { throw new Error("parent sync failure"); });
  const store = new QianchuanReportStore(directory, sync);
  await expect(store.save(snapshot())).rejects.toThrow("parent sync failure");
  expect(sync).toHaveBeenCalledWith(root);
  expect(await readdir(directory)).toEqual([]);
});
