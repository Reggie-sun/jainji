import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanPlanMaterials } from "../src/main/qianchuan-plan-materials";
import { QianchuanPlanMaterialRecovery } from "../src/main/qianchuan-plan-material-recovery";
import { QianchuanPlanRecoverySchema } from "../src/shared/qianchuan-video-library";

const target = { product: "肥皂" as const, advertiserId: "1004", adId: "2004", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "cleanup-recovery-")); roots.push(root);
  const directory = path.join(root, "plan-material-deletions"); await mkdir(directory, { mode: 0o700 });
  const gate = path.join(directory, "1004-2004.pending.json");
  const pending = { version: 1, attempt: "11111111-1111-4111-8111-111111111111", advertiserId: "1004", adId: "2004", ids: ["7001", "7002"], zeroWindow: { startTime: "2026-09-30 00:00:00", endTime: "2026-10-06 23:59:59", createdBefore: "2026-10-05 19:44:48" } };
  const bytes = JSON.stringify(pending, null, 2) + "\n"; await writeFile(gate, bytes, { mode: 0o600 });
  const recovery = new QianchuanPlanMaterialRecovery(directory, target);
  const detail = (await recovery.pending())!;
  const request = { product: target.product, advertiserId: target.advertiserId, adId: target.adId, attempt: detail.attempt, digest: detail.digest, confirmation: "MANUALLY_HANDLED_PLAN_DELETION" as const };
  return { root, directory, gate, pending, bytes, recovery, detail, request };
}
it("returns exact historical material IDs without connecting or changing an unresolved intent", async () => {
  const f = await fixture(), connect = vi.fn();
  const result = await new QianchuanPlanMaterials(f.root, connect).clear(target, async () => {});
  expect(result).toMatchObject({ state: "BLOCKED", pendingPlanDeletion: f.detail });
  expect(connect).not.toHaveBeenCalled(); expect(await readFile(f.gate, "utf8")).toBe(f.bytes);
});
it("requires explicit confirmation bound to account, plan, attempt and exact bytes", async () => {
  const f = await fixture();
  for (const delta of [{ confirmation: "RETRY" }, { advertiserId: "1005" }, { adId: "2005" }, { attempt: "22222222-2222-4222-8222-222222222222" }, { digest: "0".repeat(64) }, { path: f.gate }]) {
    await expect(f.recovery.resolve({ ...f.request, ...delta }, async () => {})).rejects.toThrow();
    expect(await readFile(f.gate, "utf8")).toBe(f.bytes);
  }
  expect(() => QianchuanPlanRecoverySchema.parse({ ...f.request, confirmation: undefined })).toThrow();
});
it("archives original bytes, preserves UNKNOWN and fences every historical ID across restart", async () => {
  const f = await fixture(); await f.recovery.resolve(f.request, async () => {});
  await expect(readFile(f.gate)).rejects.toMatchObject({ code: "ENOENT" });
  const history = path.join(f.directory, "manual-history", "1004-2004");
  expect(await readFile(path.join(history, `${f.pending.attempt}.pending.json`), "utf8")).toBe(f.bytes);
  expect(JSON.parse(await readFile(path.join(history, `${f.pending.attempt}.json`), "utf8"))).toMatchObject({ outcome: "UNKNOWN", digest: f.detail.digest, confirmation: f.request.confirmation });
  expect(await new QianchuanPlanMaterialRecovery(f.directory, target).protectedIds()).toEqual(new Set(["7001", "7002"]));
});
it("blocks automatic replay of a historical ID after manual disposition", async () => {
  const f = await fixture(); await f.recovery.resolve(f.request, async () => {});
  const page = { open: vi.fn(), filter: vi.fn(async () => ({ skippedEcological: false })), read: vi.fn(async () => ({ total: 1, ids: ["7001"] })), deleteBatch: vi.fn() };
  const owner = new QianchuanPlanMaterials(f.root, async () => ({ page, close: async () => {} }));
  expect(await owner.clear(target, async () => {})).toMatchObject({ state: "BLOCKED", message: expect.stringContaining("历史未知") });
  expect(page.deleteBatch).not.toHaveBeenCalled();
});
it("allows a separately initiated cleanup of new IDs without changing the historical result", async () => {
  const f = await fixture(); await f.recovery.resolve(f.request, async () => {});
  let ids = ["8001"];
  const page = { open: vi.fn(), filter: vi.fn(async () => ({ skippedEcological: false })), read: vi.fn(async () => ({ total: ids.length, ids })), deleteBatch: vi.fn(async (_snapshot, confirm) => { await confirm(); ids = []; }) };
  expect(await new QianchuanPlanMaterials(f.root, async () => ({ page, close: async () => {} })).clear(target, async () => {})).toMatchObject({ state: "CLEARED", deletedCount: 1 });
  expect(await f.recovery.protectedIds()).toEqual(new Set(["7001", "7002"]));
});
it("rejects missing history evidence instead of authorizing a new deletion", async () => {
  const f = await fixture(); await f.recovery.resolve(f.request, async () => {});
  await unlink(path.join(f.directory, "manual-history", "1004-2004", `${f.pending.attempt}.pending.json`));
  const connect = vi.fn();
  expect((await new QianchuanPlanMaterials(f.root, connect).clear(target, async () => {})).state).toBe("BLOCKED");
  expect(connect).not.toHaveBeenCalled();
});
it("preserves the pending gate when cancelled and can finish an interrupted archive only on explicit reconfirmation", async () => {
  const f = await fixture(); let calls = 0;
  await expect(f.recovery.resolve(f.request, async () => { if (++calls === 2) throw new Error("cancelled"); })).rejects.toThrow("cancelled");
  expect(await readFile(f.gate, "utf8")).toBe(f.bytes);
  expect((await readdir(path.join(f.directory, "manual-history", "1004-2004"))).length).toBeGreaterThan(0);
  await expect(f.recovery.protectedIds()).rejects.toThrow();
  await f.recovery.resolve(f.request, async () => {});
  expect(await f.recovery.protectedIds()).toEqual(new Set(["7001", "7002"]));
});
