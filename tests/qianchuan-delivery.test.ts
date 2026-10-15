import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanDelivery, type QianchuanDeliveryAdapter } from "../src/main/qianchuan-delivery.js";
import { draftDigest, QianchuanDeliveryStore } from "../src/main/qianchuan-delivery-store.js";
import { QianchuanAccountOperations } from "../src/main/qianchuan-account-operations.js";
import { strictSyncDirectory } from "../src/main/douyin-upload-store.js";
import { QianchuanDeliveryAuthorizationSchema, QianchuanDeliveryDraftSchema, type QianchuanDeliveryDraft } from "../src/shared/qianchuan-delivery.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function draft(overrides: Partial<Extract<QianchuanDeliveryDraft, { action: "set-budget" }>> = {}): Extract<QianchuanDeliveryDraft, { action: "set-budget" }> {
  const parsed = QianchuanDeliveryDraftSchema.parse({
    schemaVersion: 1,
    draftId: "11111111-1111-4111-8111-111111111111",
    provider: "qianchuan-browser",
    accountSlot: "蝴蝶贴",
    advertiserId: "1234567890",
    mode: "product-cost-control",
    action: "set-budget",
    adId: "9876543210",
    beforeVersion: "snapshot-17",
    beforeValues: { budget: "5.00", budgetType: "daily" },
    target: { budget: "10.00", budgetType: "daily" },
    ...overrides,
  });
  if (parsed.action !== "set-budget") throw new Error("Invalid test draft action");
  return parsed;
}

function rawAuthorization(value: QianchuanDeliveryDraft, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return QianchuanDeliveryAuthorizationSchema.parse({
    authorizationId: "22222222-2222-4222-8222-222222222222",
    sessionId: "99999999-9999-4999-8999-999999999999",
    draftId: value.draftId,
    draftDigest: draftDigest(value),
    currency: "CNY",
    budgetType: "daily",
    maxTargetBudget: "20.00",
    totalBudgetIncrease: "10.00",
    maxActions: 2,
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  });
}

function limits(overrides: Partial<{ maxTargetBudget: string; totalBudgetIncrease: string; maxActions: number; expiresAt: string }> = {}) {
  return {
    maxTargetBudget: "20.00",
    totalBudgetIncrease: "5.00",
    maxActions: 2,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function fixtureAdapter(value: Extract<QianchuanDeliveryDraft, { action: "set-budget" }>, options: {
  onRead?: (signal: AbortSignal) => Promise<unknown>;
  submit?: (signal: AbortSignal) => Promise<unknown>;
  after?: unknown;
} = {}): QianchuanDeliveryAdapter {
  return {
    capabilities: vi.fn(advertiserId => [{
      action: "set-budget", advertiserId, mode: "product-cost-control", status: "live-write-verified",
      evidenceId: "fixture:set-budget", observedAt: new Date().toISOString(),
    }]),
    readFresh: vi.fn(async (_draft, signal) => options.onRead ? options.onRead(signal) : ({
      advertiserId: value.advertiserId, adId: value.adId, version: value.beforeVersion, values: value.beforeValues,
    })),
    submitOnce: vi.fn(async (_draft, signal) => options.submit ? options.submit(signal) : ({ kind: "submitted", providerRequestId: "fixture-request-1" })),
    readback: vi.fn(async () => options.after ?? ({
      advertiserId: value.advertiserId, adId: value.adId, version: "snapshot-18", values: value.target,
    })),
  } as unknown as QianchuanDeliveryAdapter;
}

async function service(value = draft(), adapter?: QianchuanDeliveryAdapter) {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-delivery-")); roots.push(root);
  const store = new QianchuanDeliveryStore(path.join(root, "ledger"));
  await store.initialize();
  return { root, store, delivery: new QianchuanDelivery(store, adapter), draft: value };
}

it("does not submit when authorization expires while the durable submit marker is being saved", async () => {
  const value = draft(), adapter = fixtureAdapter(value), f = await service(value, adapter);
  const authorization = f.delivery.issueAuthorization(value, limits());
  const mark = f.store.markSubmitStarted.bind(f.store);
  vi.spyOn(f.store, "markSubmitStarted").mockImplementation(async operationId => {
    await mark(operationId);
    vi.setSystemTime(Date.parse(authorization.expiresAt));
  });
  try {
    expect(await f.delivery.execute(value, authorization)).toMatchObject({ state: "NOT_SENT", reason: "AUTHORIZATION_EXPIRED" });
    expect(adapter.submitOnce).not.toHaveBeenCalled();
    expect(await f.store.list(value.advertiserId)).toMatchObject([{ state: "NOT_SENT" }]);
  } finally { vi.useRealTimers(); }
}, 15000);

it("submits a frozen creation draft only once even when its product version and remaining authorization permit another action", async () => {
  const value = QianchuanDeliveryDraftSchema.parse({ schemaVersion: 1, draftId: "33333333-3333-4333-8333-333333333333",
    provider: "qianchuan-browser", accountSlot: "蝴蝶贴", advertiserId: "1234567890", mode: "product-cost-control",
    action: "create-plan", productId: "123", beforeVersion: "product-v1", beforeValues: { productEligible: true },
    target: { budget: "10.00", budgetType: "daily", roi: "2", status: "paused", materials: [{ materialId: "456", platformVideoId: "video-1" }] } });
  const adapter: QianchuanDeliveryAdapter = {
    capabilities: () => [{ action: "create-plan", advertiserId: value.advertiserId, mode: value.mode,
      status: "live-write-verified", evidenceId: "fixture:create", observedAt: new Date().toISOString() }],
    readFresh: async () => ({ advertiserId: value.advertiserId, productId: "123", version: "product-v1", values: { productEligible: true } }),
    submitOnce: vi.fn(async () => ({ kind: "submitted", adId: "789" })),
    readback: async () => ({ advertiserId: value.advertiserId, productId: "123", adId: "789", version: "plan-v1",
      values: { budget: "10.00", budgetType: "daily", roi: "2", status: "paused", materialIds: ["456"] } }),
  };
  const f = await service(draft(), adapter), authorization = f.delivery.issueAuthorization(value, limits({ totalBudgetIncrease: "20.00" }));
  expect(await f.delivery.execute(value, authorization)).toMatchObject({ state: "CONFIRMED" });
  expect(await f.delivery.execute(value, authorization)).toMatchObject({ state: "NOT_SENT", reason: "ACTION_LIMIT" });
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
});

it("preserves exact string IDs and rejects unknown draft or authorization fields and non-exact money", () => {
  const value = draft();
  expect(value.advertiserId).toBe("1234567890");
  expect(value.adId).toBe("9876543210");
  expect(typeof value.advertiserId).toBe("string");
  expect(() => QianchuanDeliveryDraftSchema.parse({ ...value, rendererRecipe: "https://example.invalid" })).toThrow();
  expect(() => QianchuanDeliveryAuthorizationSchema.parse({ ...rawAuthorization(value), unlimited: true })).toThrow();
  expect(() => QianchuanDeliveryAuthorizationSchema.parse({ ...rawAuthorization(value), maxTargetBudget: "10.001" })).toThrow();
  expect(() => QianchuanDeliveryAuthorizationSchema.parse({ ...rawAuthorization(value), maxActions: Number.POSITIVE_INFINITY })).toThrow();
});

it("reports every production action as blocked when no trusted write recipe is supplied", async () => {
  const f = await service();
  const capabilities = f.delivery.capabilities(f.draft.advertiserId);
  expect(capabilities).toHaveLength(6);
  expect(capabilities.every(value => value.status === "not-investigated" && value.reason.length > 0)).toBe(true);
  const result = await f.delivery.execute(f.draft, f.delivery.issueAuthorization(f.draft, limits()));
  expect(result).toMatchObject({ state: "NOT_SENT", reason: "CAPABILITY_UNQUALIFIED" });
  expect(await f.store.list(f.draft.advertiserId)).toEqual([]);
});

it("rejects a changed frozen draft before reading or submitting", async () => {
  const value = draft(), changed = draft({ target: { budget: "11.00", budgetType: "daily" } });
  const adapter = fixtureAdapter(value);
  const f = await service(value, adapter);
  const result = await f.delivery.execute(changed, f.delivery.issueAuthorization(value, limits()));
  expect(result).toMatchObject({ state: "NOT_SENT", reason: "INVALID_AUTHORIZATION" });
  expect(adapter.readFresh).not.toHaveBeenCalled();
  expect(adapter.submitOnce).not.toHaveBeenCalled();
});

it("requires a fresh matching version and values before creating a durable intent", async () => {
  const value = draft(), adapter = fixtureAdapter(value, { onRead: async () => ({
    advertiserId: value.advertiserId, adId: value.adId, version: "snapshot-18", values: value.beforeValues,
  }) });
  const f = await service(value, adapter);
  expect(await f.delivery.execute(value, f.delivery.issueAuthorization(value, limits()))).toMatchObject({ state: "NOT_SENT", reason: "PRECONDITION_CHANGED" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
  expect(await f.store.list(value.advertiserId)).toEqual([]);
});

it("does not submit when the target exceeds the explicit target-budget ceiling", async () => {
  const value = draft(), adapter = fixtureAdapter(value), f = await service(value, adapter);
  expect(() => f.delivery.issueAuthorization(value, limits({ maxTargetBudget: "9.99" }))).toThrow();
  expect(adapter.submitOnce).not.toHaveBeenCalled();
});

it.skipIf(process.platform === "win32")("does not submit when durable reservation sync fails", async () => {
  const value = draft(), adapter = fixtureAdapter(value);
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-delivery-durability-")); roots.push(root);
  let failSync = false;
  const store = new QianchuanDeliveryStore(path.join(root, "ledger"), async directory => {
    if (failSync) throw new Error("private filesystem failure");
    await strictSyncDirectory(directory);
  });
  await store.initialize(); failSync = true;
  const delivery = new QianchuanDelivery(store, adapter);
  const result = await delivery.execute(value, delivery.issueAuthorization(value, limits()));
  expect(result).toMatchObject({ state: "NOT_SENT", reason: "STORE_UNAVAILABLE" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
  const saved = JSON.parse(await readFile(store.statePath, "utf8")) as { records: unknown[] };
  expect(saved.records).toEqual([]);
});

it("settles only after independent readback and retains the consumed draft's budget reservation", async () => {
  const value = draft(), adapter = fixtureAdapter(value), f = await service(value, adapter);
  const auth = f.delivery.issueAuthorization(value, limits());
  expect(await f.delivery.execute(value, auth)).toMatchObject({ state: "CONFIRMED" });
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
  expect(await f.delivery.execute(value, auth)).toMatchObject({ state: "NOT_SENT", reason: "ACTION_LIMIT" });
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
  expect((await f.store.list(value.advertiserId))[0]).toMatchObject({ state: "CONFIRMED", budgetIncrease: "5.00", authorization: { authorizationId: auth.authorizationId } });
});

it("does not submit a new draft whose budget increase exceeds its explicit cumulative allowance", async () => {
  const value = draft(), adapter = fixtureAdapter(value), f = await service(value, adapter);
  const auth = f.delivery.issueAuthorization(value, limits({ totalBudgetIncrease: "4.99" }));
  expect(await f.delivery.execute(value, auth)).toMatchObject({ state: "NOT_SENT", reason: "BUDGET_LIMIT" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
  expect(await f.store.list(value.advertiserId)).toEqual([]);
});

it("limits concurrent operations under the same authorization before a second submit", async () => {
  const value = draft(); let release!: (value: unknown) => void;
  const gate = new Promise<unknown>(resolve => { release = resolve; });
  const adapter = fixtureAdapter(value, { submit: async () => gate });
  const f = await service(value, adapter), otherStore = new QianchuanDeliveryStore(path.join(f.root, "ledger"));
  await otherStore.initialize();
  const other = new QianchuanDelivery(otherStore, adapter), auth = f.delivery.issueAuthorization(value, limits({ maxActions: 1 }));
  const first = f.delivery.execute(value, auth);
  while (vi.mocked(adapter.submitOnce).mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const second = await other.execute(value, auth);
  expect(second.state).toBe("NOT_SENT");
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
  release({ kind: "submitted", providerRequestId: "fixture-request-2" });
  expect(await first).toMatchObject({ state: "CONFIRMED" });
});

it("keeps thrown submit outcomes UNKNOWN across restart and blocks a new slot or draft for that advertiser", async () => {
  const value = draft(), adapter = fixtureAdapter(value, { submit: async () => { throw new Error("private request body"); } });
  const f = await service(value, adapter), auth = f.delivery.issueAuthorization(value, limits());
  expect(await f.delivery.execute(value, auth)).toMatchObject({ state: "UNKNOWN", reason: "SUBMIT_OUTCOME_UNKNOWN" });
  const restartedStore = new QianchuanDeliveryStore(path.join(f.root, "ledger"), undefined, "44444444-4444-4444-8444-444444444444");
  await restartedStore.initialize();
  expect(await restartedStore.list(value.advertiserId)).toMatchObject([{ state: "UNKNOWN" }]);
  const nextDraft = draft({ draftId: "33333333-3333-4333-8333-333333333333", accountSlot: "氨糖膏" });
  const nextAdapter = fixtureAdapter(nextDraft), restarted = new QianchuanDelivery(restartedStore, nextAdapter);
  expect(await restarted.execute(value, auth)).toMatchObject({ state: "NOT_SENT", reason: "INVALID_AUTHORIZATION" });
  expect(await restarted.execute(nextDraft, restarted.issueAuthorization(nextDraft, limits()))).toMatchObject({ state: "NOT_SENT", reason: "ADVERTISER_HAS_UNKNOWN" });
  expect(nextAdapter.submitOnce).not.toHaveBeenCalled();
  expect(JSON.stringify(await restartedStore.list(value.advertiserId))).not.toContain("private request body");
});

it("treats cancellation during a fresh read as not sent and writes no intent", async () => {
  const value = draft(); let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const adapter = fixtureAdapter(value, { onRead: async (_signal) => {
    started(); await new Promise((_resolve, reject) => _signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } });
  const f = await service(value, adapter), controller = new AbortController();
  const execution = f.delivery.execute(value, f.delivery.issueAuthorization(value, limits()), controller.signal);
  await began; controller.abort();
  expect(await execution).toMatchObject({ state: "NOT_SENT", reason: "STOPPED" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
  expect(await f.store.list(value.advertiserId)).toEqual([]);
});

it("does not call submit when cancellation lands between the durable mark and submit microtask", async () => {
  const value = draft(), adapter = fixtureAdapter(value), f = await service(value, adapter);
  const controller = new AbortController(), markSubmitStarted = f.store.markSubmitStarted.bind(f.store);
  vi.spyOn(f.store, "markSubmitStarted").mockImplementation(operationId => new Promise<void>((resolve, reject) => {
    void markSubmitStarted(operationId).then(() => {
      resolve();
      queueMicrotask(() => controller.abort());
    }, reject);
  }));
  const execution = f.delivery.execute(value, f.delivery.issueAuthorization(value, limits()), controller.signal);
  expect(await execution).toMatchObject({ state: "NOT_SENT", reason: "STOPPED" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
  expect(await f.store.list(value.advertiserId)).toMatchObject([{ state: "NOT_SENT", reason: "STOPPED" }]);
});

it("latches local stop, marks an in-flight submit UNKNOWN, and prevents another execution", async () => {
  const value = draft(); let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const adapter = fixtureAdapter(value, { submit: async signal => new Promise((_resolve, reject) => {
    started(); signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }) });
  const f = await service(value, adapter), auth = f.delivery.issueAuthorization(value, limits());
  const execution = f.delivery.execute(value, auth);
  await began; f.delivery.stop();
  expect(f.delivery.stopped).toBe(true);
  expect(await execution).toMatchObject({ state: "UNKNOWN", reason: "SUBMIT_OUTCOME_UNKNOWN" });
  expect(await f.store.list(value.advertiserId)).toMatchObject([{ state: "UNKNOWN" }]);
  expect(await f.delivery.execute(value, auth)).toMatchObject({ state: "NOT_SENT", reason: "STOPPED" });
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
});

it("returns only structured whitelisted results when the adapter rejects", async () => {
  const value = draft(), adapter = fixtureAdapter(value, { submit: async () => ({ kind: "rejected", code: "PLATFORM_REJECTED", evidenceId: "fixture:reject" }) });
  const f = await service(value, adapter);
  const result = await f.delivery.execute(value, f.delivery.issueAuthorization(value, limits()));
  expect(result).toMatchObject({ state: "REJECTED", reason: "PLATFORM_REJECTED" });
  expect(JSON.stringify(result)).not.toContain("fixture:reject");
});

it("rejects a failed parent-directory sync before any financial submission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-parent-sync-")); roots.push(root);
  const adapter = fixtureAdapter(draft()), seen: string[] = [];
  const store = new QianchuanDeliveryStore(path.join(root, "ledger"), async directory => {
    seen.push(directory); if (directory === root) throw new Error("parent sync failed"); await strictSyncDirectory(directory);
  });
  await expect(store.initialize()).rejects.toThrow();
  expect(seen).toContain(root);
  const delivery = new QianchuanDelivery(store, adapter), value = draft();
  expect(await delivery.execute(value, delivery.issueAuthorization(value, limits()))).toMatchObject({ state: "NOT_SENT", reason: "STORE_UNAVAILABLE" });
  expect(adapter.submitOnce).not.toHaveBeenCalled();
});

it("holds delivery completion until cancelled adapter cleanup has drained", async () => {
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; }), drained = new Promise<void>(resolve => { release = resolve; });
  const value = draft(), adapter = fixtureAdapter(value, { onRead: async signal => {
    entered(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    await drained; throw new Error("cancelled after cleanup");
  } });
  const f = await service(value, adapter); let finished = false;
  const target = { product: value.accountSlot, advertiserId: value.advertiserId, adId: value.adId, cdpEndpoint: "http://127.0.0.1:42001", configDigest: "a".repeat(64) };
  const lease = new QianchuanAccountOperations({ preflight: async () => target, freeze: async () => target } as any, async () => { throw new Error("unused query"); });
  const scope = { product: value.accountSlot, expectedAdvertiserId: value.advertiserId, requestId: "55555555-5555-4555-8555-555555555555" };
  const work = lease.run(scope, 7, signal => f.delivery.execute(value, f.delivery.issueAuthorization(value, limits()), signal), async () => undefined).finally(() => { finished = true; });
  await began; lease.cancel({ requestId: scope.requestId }, 7);
  try {
    await new Promise(resolve => setTimeout(resolve, 25)); expect(finished).toBe(false); expect(lease.busy).toBe(true);
    expect(() => lease.run(scope, 8, async () => undefined, async () => undefined)).toThrow("尚未结束");
  } finally { release(); await expect(work).rejects.toMatchObject({ name: "AbortError" }); }
  expect(lease.busy).toBe(false);
  expect(adapter.submitOnce).not.toHaveBeenCalled();
});

it.each(["read failure", "mismatch", "cancel", "cancel before response"])("retains the returned creation ID through %s and restart without resending", async defect => {
  const value = QianchuanDeliveryDraftSchema.parse({ schemaVersion: 1, draftId: "33333333-3333-4333-8333-333333333333",
    provider: "qianchuan-browser", accountSlot: "蝴蝶贴", advertiserId: "1234567890", mode: "product-cost-control",
    action: "create-plan", productId: "123", beforeVersion: "product-v1", beforeValues: { productEligible: true },
    target: { budget: "10.00", budgetType: "daily", roi: "2", status: "paused", materials: [{ materialId: "456", platformVideoId: "video-1" }] } });
  const controller = new AbortController(); let storedId: string | undefined;
  const adapter: QianchuanDeliveryAdapter = {
    capabilities: () => [{ action: "create-plan", advertiserId: value.advertiserId, mode: value.mode, status: "live-write-verified", evidenceId: "fixture:create", observedAt: new Date().toISOString() }],
    readFresh: async () => ({ advertiserId: value.advertiserId, productId: "123", version: "product-v1", values: { productEligible: true } }),
    submitOnce: vi.fn(async () => { if (defect === "cancel before response") { controller.abort(); await Promise.resolve(); } return { kind: "submitted", adId: "789" }; }),
    readback: async () => {
      storedId = (JSON.parse(await readFile(f.store.statePath, "utf8"))).records[0].adId;
      if (defect === "cancel") controller.abort();
      if (defect !== "mismatch") throw new Error("readback unavailable");
      return { advertiserId: value.advertiserId, productId: "123", adId: "790", version: "v2", values: {} };
    },
  };
  const f = await service(draft(), adapter), auth = f.delivery.issueAuthorization(value, limits({ totalBudgetIncrease: "20.00" }));
  expect(await f.delivery.execute(value, auth, controller.signal)).toMatchObject({ state: "UNKNOWN", adId: "789" });
  if (defect !== "cancel before response") expect(storedId).toBe("789");
  const restarted = new QianchuanDeliveryStore(path.join(f.root, "ledger"), undefined, "44444444-4444-4444-8444-444444444444"); await restarted.initialize();
  expect(await restarted.list(value.advertiserId)).toMatchObject([{ state: "UNKNOWN", adId: "789" }]);
  expect(adapter.submitOnce).toHaveBeenCalledTimes(1);
});
