import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanIntegration } from "../src/main/qianchuan-integration";
import { DouyinUploadService } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { QIANCHUAN_QUERY_METRICS, type QianchuanBackendResult, type QianchuanBackendQuery } from "../src/shared/qianchuan-backend";
import type { FrozenQianchuanAccount, QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { draftDigest } from "../src/main/qianchuan-delivery-store";
import type { QianchuanDeliveryDraft } from "../src/shared/qianchuan-delivery";
import { requiresMembership } from "../src/main/membership-ipc";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const target: FrozenQianchuanAccount = { product: "眼贴", advertiserId: "1879999999999999999", adId: "1878754135410692", cdpEndpoint: "http://127.0.0.1:42001", configDigest: "d".repeat(64) };
const scope = { product: target.product, expectedAdvertiserId: target.advertiserId };
function response(query: QianchuanBackendQuery): QianchuanBackendResult {
  if (query.kind !== "report" || !query.asOf) throw new Error("expected frozen report");
  return { kind: "report", advertiserId: query.expectedAdvertiserId, observedAt: query.asOf, startTime: `${query.startDate} 00:00:00`,
    endTime: [`${query.endDate} 23:59:59`, new Date(Date.parse(query.asOf) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ")].sort()[0]!,
    metrics: Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key => [key, { value: "0.01", display: "平台原值" }])) as any };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-integration-")); roots.push(root);
  const read = vi.fn(async (_target: FrozenQianchuanAccount, query: QianchuanBackendQuery, _signal: AbortSignal) => response(query));
  const freeze = vi.fn(async () => target);
  const accounts = { preflight: async () => target, prepareCatalog: async () => target, freeze } as unknown as QianchuanAccountConfigReader;
  const uploads = new DouyinUploadService(new DouyinUploadStore(path.join(root, "uploads")), { accounts, readBackendQuery: read,
    loadBatch: async () => { throw new Error("no queue"); }, browser: () => { throw new Error("no upload"); } });
  return { root, read, freeze, uploads, api: new QianchuanIntegration(uploads, root) };
}
const input = () => ({ ...scope, requestId: randomUUID(), kind: "report" as const, startDate: "2026-01-01", endDate: "2026-01-01" });
it("persists a complete report through the existing query owner and reopens it without a browser", async () => {
  const f = await fixture();
  const snapshot = await f.api.capture(input(), 7);
  expect(snapshot.complete).toBe(true); expect(f.read).toHaveBeenCalledTimes(1);
  f.read.mockClear();
  const reopened = new QianchuanIntegration(f.uploads, f.root);
  expect(await reopened.history(scope)).toEqual([snapshot]); expect(f.read).not.toHaveBeenCalled();
  expect(f.uploads.store.tasks()).toEqual([]);
  expect(await reopened.history({ ...scope, expectedAdvertiserId: "12345" })).toEqual([]);
});
it("cancellation is sender-bound, drains the original request and never stores the late report", async () => {
  const f = await fixture(), request = input(); let release!: () => void;
  f.read.mockImplementation(async (_target, query, signal) => { await new Promise<void>(resolve => { release = resolve; }); signal.throwIfAborted(); return response(query); });
  const pending = f.api.capture(request, 7); void pending.catch(() => undefined);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.api.cancel({ requestId: request.requestId }, 8); expect(f.uploads.busy).toBe(true);
  f.api.cancel({ requestId: request.requestId }, 7); expect(f.uploads.busy).toBe(true);
  release(); await expect(pending).rejects.toThrow();
  expect(await f.api.history(scope)).toEqual([]); expect(f.uploads.busy).toBe(false);
});
it("refuses to publish a complete response if the original account configuration changed", async () => {
  const f = await fixture(); let calls = 0;
  f.freeze.mockImplementation(async () => ++calls === 1 ? target : { ...target, configDigest: "e".repeat(64) });
  await expect(f.api.capture(input(), 7)).rejects.toThrow("变化");
  expect(await f.api.history(scope)).toEqual([]);
});
it("exposes no qualified live writes and refuses a forged renderer authorization with zero submissions", async () => {
  const f = await fixture(), status = await f.api.status(scope);
  expect(status.capabilities).toHaveLength(6); expect(status.capabilities.every(row => row.status === "not-investigated")).toBe(true);
  const draft: QianchuanDeliveryDraft = { schemaVersion: 1, draftId: randomUUID(), provider: "qianchuan-browser", accountSlot: target.product,
    advertiserId: target.advertiserId, mode: "product-cost-control", action: "pause", adId: target.adId, beforeVersion: "v1", beforeValues: { status: "enabled" }, target: { status: "paused" } };
  const now = new Date();
  const authorization = { authorizationId: randomUUID(), sessionId: randomUUID(), draftId: draft.draftId, draftDigest: draftDigest(draft), currency: "CNY" as const, budgetType: "daily" as const,
    maxTargetBudget: "0.00", totalBudgetIncrease: "0.00", maxActions: 1, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString() };
  await expect(f.api.execute({ requestId: randomUUID(), draft, authorization }, 7)).resolves.toMatchObject({ state: "NOT_SENT", reason: "INVALID_AUTHORIZATION" });
  expect(f.read).not.toHaveBeenCalled(); expect((await f.api.status(scope)).operations).toEqual([]);
});
it("keeps cancellation and local stop available without granting other IPC recovery permissions", async () => {
  expect(requiresMembership("qianchuanIntegration.cancel")).toBe(false); expect(requiresMembership("qianchuanIntegration.stop")).toBe(false);
  expect(requiresMembership("qianchuanIntegration.execute")).toBe(true); expect(requiresMembership("qianchuanIntegration.capture")).toBe(true);
  const f = await fixture(); await f.api.stop(7);
  expect((await f.api.status(scope)).stopped).toBe(true); expect(f.read).not.toHaveBeenCalled();
});
