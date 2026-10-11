import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationScheduler } from "../src/main/automation-scheduler";
import { AutomationRequestSchema, type AutomationTask } from "../src/shared/automation";
import { migrateCleanupSchedules } from "../src/main/automation-cleanup-migration";
import { QianchuanVideoLibrarySchedule } from "../src/main/qianchuan-video-library-schedule";

const roots: string[] = [], owners: AutomationScheduler[] = [];
const request = { name: "清理", time: "12:00", enabled: true, upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION" as const,
  cleanup: { confirmation: "DELETE_PLAN_MATERIALS" as const, accounts: [{ product: "蝴蝶贴" as const, expectedAdvertiserId: "123", expectedAdId: "456" }] } };
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.stop())); vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-")); roots.push(root);
  let now = new Date(2026, 9, 10, 11, 59);
  const execute = vi.fn(async (_task: AutomationTask, _signal: AbortSignal) => ({})), busy = vi.fn(() => false);
  const dependencies = { prepare: vi.fn(async () => ({ binding: "a".repeat(64), summary: "固定账号计划" })), execute, busy, changed: vi.fn(), now: () => now };
  const owner = new AutomationScheduler(root, dependencies); owners.push(owner); await owner.load(); owner.start();
  return { root, owner, dependencies, setTime: (date: Date) => { now = date; } };
}
it("persists the occurrence before any effect and fences repeated tick, restart and clock rollback", async () => {
  const f = await fixture(); await f.owner.create(request);
  f.dependencies.execute.mockImplementation(async () => {
    const state = JSON.parse(await readFile(path.join(f.root, "tasks.json"), "utf8"));
    expect(state.tasks[0].lastRun.state).toBe("RUNNING"); return {};
  });
  f.setTime(new Date(2026, 9, 10, 12)); await Promise.all([f.owner.tick(), f.owner.tick()]);
  expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
  await f.owner.stop();
  const restored = new AutomationScheduler(f.root, f.dependencies); owners.push(restored); await restored.load(); restored.start();
  f.setTime(new Date(2026, 9, 9, 12)); await restored.tick();
  f.setTime(new Date(2026, 9, 10, 12)); await restored.tick();
  expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
});
it.each(["late", "busy"])("skips %s occurrences without catchup", async reason => {
  const f = await fixture(); await f.owner.create(request);
  f.dependencies.busy.mockReturnValue(reason === "busy");
  f.setTime(new Date(2026, 9, 10, 12, reason === "late" ? 2 : 0)); await f.owner.tick();
  f.dependencies.busy.mockReturnValue(false); await f.owner.tick();
  expect(f.owner.snapshot().tasks[0].lastRun?.state).toBe("SKIPPED"); expect(f.dependencies.execute).not.toHaveBeenCalled();
});
it("does not replay after time edits, failure or enabling again", async () => {
  const f = await fixture(); const created = await f.owner.create(request), id = created.tasks[0].id;
  f.dependencies.execute.mockRejectedValue(new Error("结果未知"));
  f.setTime(new Date(2026, 9, 10, 12)); await f.owner.tick();
  await f.owner.configure({ id, time: "13:00", enabled: false }); await f.owner.configure({ id, time: "13:00", enabled: true });
  f.setTime(new Date(2026, 9, 10, 13)); await f.owner.tick();
  expect(f.dependencies.execute).toHaveBeenCalledTimes(1); expect(f.owner.snapshot().tasks[0].lastRun?.state).toBe("BLOCKED");
});
it("fails closed for corrupted state and interrupted runs", async () => {
  const f = await fixture(); await f.owner.create(request); await f.owner.stop();
  const file = path.join(f.root, "tasks.json"), state = JSON.parse(await readFile(file, "utf8"));
  state.tasks[0].lastRun = { id: "11111111-1111-4111-8111-111111111111", day: "2026-10-10", startedAt: new Date().toISOString(), state: "RUNNING", message: "running" };
  await writeFile(file, JSON.stringify(state));
  const restored = new AutomationScheduler(f.root, f.dependencies); owners.push(restored); await restored.load(); restored.start();
  f.setTime(new Date(2026, 9, 10, 12)); await restored.tick(); expect(restored.snapshot().tasks[0].lastRun?.state).toBe("BLOCKED");
  await writeFile(file, "{}"); const broken = new AutomationScheduler(f.root, f.dependencies); owners.push(broken); await broken.load(); broken.start();
  await expect(broken.create(request)).rejects.toThrow("不可用"); await broken.tick(); expect(f.dependencies.execute).not.toHaveBeenCalled();
});
it("never runs a task created after its time until the next day", async () => {
  const f = await fixture(); f.setTime(new Date(2026, 9, 10, 12, 0, 20)); await f.owner.create(request); await f.owner.tick();
  expect(f.dependencies.execute).not.toHaveBeenCalled();
  f.setTime(new Date(2026, 9, 11, 12)); await f.owner.tick(); expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
});
it("rejects no-op tasks and dangling upload references", async () => {
  const f = await fixture();
  expect(AutomationRequestSchema.safeParse({ ...request, cleanup: undefined }).success).toBe(false);
  await expect(f.owner.create({ ...request, cleanup: undefined, upload: true, uploadFrom: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow("制作任务");
});
it("accepts an explicitly authorized combined cleanup without changing its saved plans or rule", () => {
  const input = { ...request, cleanup: { ...request.cleanup, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", planMaterialRule: "AUDIT_AND_ZERO_IMPRESSIONS_15D" } };
  expect(AutomationRequestSchema.parse(input)).toEqual(input);
  expect(AutomationRequestSchema.safeParse({ ...input, cleanup: { ...input.cleanup, confirmation: "DELETE_ALL_VIDEOS" } }).success).toBe(false);
});

it("rejects a production result too large for the durable run ledger before effects", () => {
  const entries = Array.from({ length: 11 }, () => ({ recentProjectId: crypto.randomUUID(), requestedCount: 250,
    productPrice: "", coverEnabled: false, displayMode: "full", mode: "random" }));
  const parsed = AutomationRequestSchema.safeParse({ ...request, cleanup: undefined, production: { entries } });
  expect(parsed.success).toBe(false);
});
it("does not execute when the durable daily claim cannot be saved", async () => {
  const f = await fixture(); await f.owner.create(request);
  await rename(path.join(f.root, "tasks.json"), path.join(f.root, "previous.json"));
  await mkdir(path.join(f.root, "tasks.json"));
  f.setTime(new Date(2026, 9, 10, 12)); await f.owner.tick();
  expect(f.dependencies.execute).not.toHaveBeenCalled(); expect(f.owner.busy).toBe(false);
  expect(f.owner.snapshot().error).toContain("保存结果未知");
  await f.owner.tick(); expect(f.dependencies.execute).not.toHaveBeenCalled();
});
it("explicit shutdown cancels the current execution and retains its non-replay claim", async () => {
  const f = await fixture(); await f.owner.create(request);
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.dependencies.execute.mockImplementation(async (_task, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    return {};
  });
  f.setTime(new Date(2026, 9, 10, 12)); const ticking = f.owner.tick(); await started;
  await f.owner.stop(); await ticking;
  expect(f.owner.snapshot().tasks[0].lastRun?.state).toBe("BLOCKED"); expect(f.owner.busy).toBe(false);
  f.owner.start(); await f.owner.tick(); expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
});

async function migrationFixture(includePlanMaterials = false) {
  const f = await fixture(); await f.owner.stop();
  const clear = vi.fn(async () => []);
  const launch = { configure: vi.fn(async () => {}), snapshot: vi.fn(() => undefined) };
  const legacyDependencies = { accounts: () => [{ product: "蝴蝶贴" as const, advertiserId: "123", adId: "456", available: true }], clear, changed: vi.fn(),
    automaticLaunch: launch as unknown as ConstructorParameters<typeof QianchuanVideoLibrarySchedule>[1]["automaticLaunch"] };
  const legacy = new QianchuanVideoLibrarySchedule(f.root, legacyDependencies); await legacy.load();
  await legacy.save({ confirmation: "DELETE_ALL_VIDEOS", time: "12:00", enabled: true, includePlanMaterials, accounts: request.cleanup.accounts });
  const verify = vi.fn(async (_task: AutomationTask) => {});
  return { ...f, legacy, legacyDependencies, clear, launch, verify };
}
it("merges both saved authorizations into one task, retires the old trigger, and synchronizes only its time and enabled state", async () => {
  const f = await migrationFixture(); const source = f.owner.task((await f.owner.create(request)).tasks[0].id)!;
  await migrateCleanupSchedules(f.owner, f.legacy, f.verify);
  const task = f.owner.snapshot().tasks[0];
  expect(f.owner.snapshot().tasks).toHaveLength(1); expect(task.id).not.toBe(source.id);
  expect(task.request).toEqual({ ...request, cleanup: { ...request.cleanup, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" } });
  expect(f.legacy.snapshot().settings.enabled).toBe(false); expect(f.legacy.snapshot().mergedTaskId).toBe(task.id);
  f.legacy.start(); await f.legacy.tick(); await expect(f.legacy.save({})).rejects.toThrow("已合并"); expect(f.clear).not.toHaveBeenCalled();
  await f.owner.configure({ id: task.id, time: "13:00", enabled: false }); await f.legacy.initializeAutomaticLaunch();
  expect(f.launch.configure).toHaveBeenLastCalledWith(expect.objectContaining({ time: "13:00", enabled: false }));
  await migrateCleanupSchedules(f.owner, f.legacy, f.verify); expect(f.owner.task(task.id)?.request.time).toBe("13:00");
  await f.owner.remove(task.id); await migrateCleanupSchedules(f.owner, f.legacy, f.verify); await f.legacy.initializeAutomaticLaunch();
  expect(f.owner.snapshot().tasks).toEqual([]); expect(f.launch.configure).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
});
it("recovers an interrupted local installation using its exact saved task and keeps both previous daily claims", async () => {
  const f = await migrationFixture(); await f.owner.create(request);
  f.owner.start(); f.setTime(new Date(2026, 9, 10, 12)); await f.owner.tick(); await f.owner.stop();
  const original = JSON.parse(await readFile(path.join(f.root, "video-library-schedule.json"), "utf8"));
  original.lastRun = { day: "2026-10-11", startedAt: new Date(2026, 9, 11, 12).toISOString(), state: "BLOCKED", message: "历史未知", results: [] };
  await writeFile(path.join(f.root, "video-library-schedule.json"), JSON.stringify(original)); await f.legacy.load();
  const installation = vi.spyOn(f.owner, "installCleanupMigration").mockRejectedValueOnce(new Error("模拟中断"));
  await expect(migrateCleanupSchedules(f.owner, f.legacy, f.verify)).rejects.toThrow("模拟中断"); installation.mockRestore();
  expect(f.legacy.cleanupMigration()?.complete).toBe(false); expect(f.legacy.snapshot().settings.enabled).toBe(false);
  const savedId = f.legacy.cleanupMigration()!.task.id;
  const restored = new AutomationScheduler(f.root, f.dependencies); owners.push(restored); await restored.load();
  const legacy = new QianchuanVideoLibrarySchedule(f.root, f.legacyDependencies); await legacy.load();
  await migrateCleanupSchedules(restored, legacy, f.verify);
  expect(restored.snapshot().tasks.map(task => task.id)).toEqual([savedId]); expect(legacy.cleanupMigration()?.complete).toBe(true);
  expect(legacy.snapshot().previousAutomationRun?.day).toBe("2026-10-10"); expect(legacy.snapshot().lastRun?.message).toBe("历史未知");
  restored.start(); f.setTime(new Date(2026, 9, 11, 12)); await restored.tick(); expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
  f.setTime(new Date(2026, 9, 12, 12)); await restored.tick(); expect(f.dependencies.execute).toHaveBeenCalledTimes(2); expect(f.clear).not.toHaveBeenCalled();
});
it("rejects ambiguous matches and never retires old authorization after a frozen binding verification failure", async () => {
  const f = await migrationFixture(); await f.owner.create(request); await f.owner.create(request);
  await expect(migrateCleanupSchedules(f.owner, f.legacy, f.verify)).rejects.toThrow("多个"); expect(f.legacy.cleanupMigration()).toBeUndefined();
  await f.owner.remove(f.owner.snapshot().tasks[1].id); f.verify.mockRejectedValue(new Error("绑定变化"));
  await expect(migrateCleanupSchedules(f.owner, f.legacy, f.verify)).rejects.toThrow("绑定变化");
  expect(f.legacy.snapshot().settings.enabled).toBe(true); expect(f.dependencies.execute).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
});
it("does not overwrite a changed migration source or expand audit cleanup to newly authorized plans", async () => {
  const f = await migrationFixture(true); const source = f.owner.task((await f.owner.create(request)).tasks[0].id)!;
  const task = await f.owner.prepareCleanupMigration({ ...request, cleanup: { ...request.cleanup, confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS" } }, source);
  await f.owner.configure({ id: source.id, time: "13:00", enabled: true });
  await expect(f.owner.installCleanupMigration({ task, source, complete: false })).rejects.toThrow("已变化");
  await f.owner.remove(source.id);
  const plan = { advertiserId: "123", adId: "456", name: "原计划" }, extra = { ...plan, adId: "789", name: "另一个计划" };
  const zero = { ...request, cleanup: { confirmation: "DELETE_PLAN_MATERIALS" as const, planMaterialRule: "ZERO_IMPRESSIONS_15D" as const,
    accounts: [{ product: "蝴蝶贴" as const, expectedAdvertiserId: "123", plans: [plan, extra] }] } };
  await f.owner.create(zero); await migrateCleanupSchedules(f.owner, f.legacy, f.verify);
  expect(f.owner.snapshot().tasks).toHaveLength(2); expect(f.owner.snapshot().tasks[0].request).toEqual(zero);
  expect(f.owner.snapshot().tasks[1].request.cleanup).toEqual({ confirmation: "DELETE_VIDEOS_AND_PLAN_MATERIALS", accounts: request.cleanup.accounts });
});
it("unions the old audit rule only for the same single-plan scope", async () => {
  const f = await migrationFixture(true);
  await f.owner.create({ ...request, cleanup: { ...request.cleanup, planMaterialRule: "ZERO_IMPRESSIONS_15D" } });
  await migrateCleanupSchedules(f.owner, f.legacy, f.verify);
  expect(f.owner.snapshot().tasks).toHaveLength(1); expect(f.owner.snapshot().tasks[0].request.cleanup?.planMaterialRule).toBe("AUDIT_AND_ZERO_IMPRESSIONS_15D");
});
it("admits a bounded system launch only for the current task identity and time, and claims it once", async () => {
  const f = await fixture(); const task = (await f.owner.create(request)).tasks[0]; f.setTime(new Date(2026, 9, 10, 12, 20));
  const received = new Date(2026, 9, 10, 12);
  await f.owner.requestSystemLaunch(crypto.randomUUID(), "12:00", received);
  await f.owner.requestSystemLaunch(task.id, "13:00", received);
  await f.owner.requestSystemLaunch(task.id, "12:00", new Date(2026, 9, 10, 12, 2)); expect(f.dependencies.execute).not.toHaveBeenCalled();
  await f.owner.requestSystemLaunch(task.id, "12:00", received); await f.owner.requestSystemLaunch(task.id, "12:00", received);
  expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
  f.setTime(new Date(2026, 9, 11, 12, 31)); await f.owner.requestSystemLaunch(task.id, "12:00", new Date(2026, 9, 11, 12));
  expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
});
