import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationScheduler } from "../src/main/automation-scheduler";
import { AutomationRequestSchema, type AutomationTask } from "../src/shared/automation";

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
it("rejects no-op tasks, whole library deletion and dangling upload references", async () => {
  const f = await fixture();
  expect(AutomationRequestSchema.safeParse({ ...request, cleanup: undefined }).success).toBe(false);
  expect(AutomationRequestSchema.safeParse({ ...request, cleanup: { ...request.cleanup, confirmation: "DELETE_ALL_VIDEOS" } }).success).toBe(false);
  await expect(f.owner.create({ ...request, cleanup: undefined, upload: true, uploadFrom: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow("制作任务");
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
