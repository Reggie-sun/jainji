import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import { nextLibraryClearTime, QianchuanVideoLibrarySchedule } from "../src/main/qianchuan-video-library-schedule";
import type { QianchuanLibraryResult } from "../src/shared/qianchuan-video-library";

const accounts = [{ product: "蝴蝶贴" as const, advertiserId: "1876024170199244", adId: "123", available: true }];
const settings = { confirmation: "DELETE_ALL_VIDEOS" as const, enabled: true, time: "00:30", accounts: [{ product: "蝴蝶贴" as const, expectedAdvertiserId: accounts[0]!.advertiserId }] };
const roots: string[] = [];
const owners: QianchuanVideoLibrarySchedule[] = [];
afterEach(async () => { owners.forEach(owner => owner.stop()); owners.length = 0; vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(clear: Mock<() => Promise<QianchuanLibraryResult[]>> = vi.fn<() => Promise<QianchuanLibraryResult[]>>(async () => [{ product: "蝴蝶贴", advertiserId: accounts[0]!.advertiserId, state: "CLEARED", deletedCount: 0, message: "视频库已清空。" }])) {
  const root = await mkdtemp(path.join(os.tmpdir(), "library-schedule-")); roots.push(root);
  const owner = new QianchuanVideoLibrarySchedule(root, { accounts: () => accounts, clear, changed: () => {} }); owners.push(owner);
  await owner.load(); owner.start(); return { root, owner, clear };
}
it("claims the day on disk before deleting and does not run twice after restart or a clock rollback", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const f = await fixture(); await f.owner.save(settings);
  f.clear.mockImplementationOnce(async () => {
    const record = JSON.parse(await readFile(path.join(f.root, "video-library-schedule.json"), "utf8"));
    expect(record.lastRun.state).toBe("RUNNING"); expect(record.lastRun.day).toBe("2026-10-04");
    return [{ product: "蝴蝶贴", advertiserId: accounts[0]!.advertiserId, state: "CLEARED", deletedCount: 0, message: "视频库已清空。" }];
  });
  vi.setSystemTime(new Date(2026, 9, 4, 0, 30)); await f.owner.tick(); await f.owner.tick(); expect(f.clear).toHaveBeenCalledTimes(1);
  f.owner.stop();
  vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const restored = new QianchuanVideoLibrarySchedule(f.root, { accounts: () => accounts, clear: f.clear, changed: () => {} }); owners.push(restored);
  await restored.load(); restored.start();
  expect(new Date(restored.snapshot().nextRunAt!).getDate()).toBe(5);
  vi.setSystemTime(new Date(2026, 9, 4, 0, 30)); await restored.tick(); expect(f.clear).toHaveBeenCalledTimes(1);
});
it("skips a missed time after sleep and never catches up by deleting later", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const f = await fixture(); await f.owner.save(settings);
  vi.setSystemTime(new Date(2026, 9, 4, 2)); await f.owner.tick();
  expect(f.clear).not.toHaveBeenCalled(); expect(f.owner.snapshot().lastRun?.state).toBe("SKIPPED");
});
it("preserves an interrupted day and rejects a changed target when saving", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const f = await fixture(); f.owner.stop();
  await writeFile(path.join(f.root, "video-library-schedule.json"), JSON.stringify({ version: 1, settings,
    lastRun: { day: "2026-10-04", startedAt: new Date().toISOString(), state: "RUNNING", message: "interrupted", results: [] } }), { mode: 0o600 });
  await f.owner.load(); f.owner.start(); expect(f.owner.snapshot().lastRun?.state).toBe("BLOCKED");
  expect(new Date(f.owner.snapshot().nextRunAt!).getDate()).toBe(5);
  await expect(f.owner.save({ ...settings, accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "999" }] })).rejects.toThrow("已变化");
  expect(f.clear).not.toHaveBeenCalled();
});
it("does not repeat a claimed day when the production owner is busy", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const clear = vi.fn<() => Promise<QianchuanLibraryResult[]>>(async () => { throw new Error("视频仍在导出"); });
  const f = await fixture(clear); await f.owner.save(settings);
  vi.setSystemTime(new Date(2026, 9, 4, 0, 30)); await f.owner.tick(); await f.owner.tick();
  expect(clear).toHaveBeenCalledTimes(1); expect(f.owner.snapshot().lastRun?.state).toBe("BLOCKED");
});
it("plans a later local calendar day after changing settings or rolling the clock back", () => {
  expect(nextLibraryClearTime(new Date(2026, 9, 4, 0, 10), "00:30", "2026-10-04")).toEqual(new Date(2026, 9, 5, 0, 30));
});
it("accepts a timely system launch after cold startup and fences duplicate wake requests", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const f = await fixture(); await f.owner.save(settings);
  vi.setSystemTime(new Date(2026, 9, 4, 0, 40));
  await f.owner.requestSystemLaunch("00:30", new Date(2026, 9, 4, 0, 30));
  await f.owner.requestSystemLaunch("00:30", new Date(2026, 9, 4, 0, 30));
  expect(f.clear).toHaveBeenCalledTimes(1); expect(f.owner.snapshot().lastRun?.day).toBe("2026-10-04");
});
it("refuses stale, early, invalid or mismatching system wake requests", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 0, 29));
  const f = await fixture(); await f.owner.save(settings);
  await f.owner.requestSystemLaunch("00:30", new Date(2026, 9, 4, 0, 29));
  await f.owner.requestSystemLaunch("00:30", new Date(NaN));
  vi.setSystemTime(new Date(2026, 9, 4, 0, 40));
  await f.owner.requestSystemLaunch("00:31", new Date(2026, 9, 4, 0, 30));
  await f.owner.requestSystemLaunch("00:30", new Date(2026, 9, 4, 0, 35));
  vi.setSystemTime(new Date(2026, 9, 4, 1, 1));
  await f.owner.requestSystemLaunch("00:30", new Date(2026, 9, 4, 0, 30));
  expect(f.clear).not.toHaveBeenCalled();
});
