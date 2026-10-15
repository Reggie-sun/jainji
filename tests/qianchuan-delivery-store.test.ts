import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { draftDigest, QianchuanDeliveryStore } from "../src/main/qianchuan-delivery-store.js";
import { QianchuanDeliveryAuthorizationSchema, QianchuanDeliveryDraftSchema } from "../src/shared/qianchuan-delivery.js";

const rootFor = async () => mkdtemp(path.join(tmpdir(), "qianchuan-delivery-store-"));
const rawDraft = () => QianchuanDeliveryDraftSchema.parse({
  schemaVersion: 1, draftId: "11111111-1111-4111-8111-111111111111", provider: "qianchuan-browser", accountSlot: "蝴蝶贴",
  advertiserId: "1234567890", mode: "product-cost-control", action: "set-budget", adId: "9876543210", beforeVersion: "v1",
  beforeValues: { budget: "5.00", budgetType: "daily" }, target: { budget: "8.00", budgetType: "daily" },
});
const rawAuthorization = (draft: ReturnType<typeof rawDraft>, sessionId: string) => QianchuanDeliveryAuthorizationSchema.parse({
  authorizationId: "22222222-2222-4222-8222-222222222222", sessionId, draftId: draft.draftId, draftDigest: draftDigest(draft),
  currency: "CNY", budgetType: "daily", maxTargetBudget: "10.00", totalBudgetIncrease: "3.00", maxActions: 1,
  issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

it.skipIf(process.platform === "win32")("shares concurrent initialization without poisoning the audit store", async () => {
  const root = await rootFor();
  try {
    const store = new QianchuanDeliveryStore(root);
    await Promise.all([store.initialize(), store.initialize(), store.initialize()]);
    expect(await store.list("1234567890")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("persists a reserved intent and upgrades it to UNKNOWN after restart", async () => {
  const root = await rootFor();
  try {
    const store = new QianchuanDeliveryStore(root); await store.initialize();
    const value = rawDraft(), auth = rawAuthorization(value, store.sessionId);
    const operationId = await store.reserve(value, auth);
    expect(await store.list(value.advertiserId)).toMatchObject([{ operationId, state: "PENDING" }]);
    const restarted = new QianchuanDeliveryStore(root, undefined, "33333333-3333-4333-8333-333333333333"); await restarted.initialize();
    expect(await restarted.list(value.advertiserId)).toMatchObject([{ operationId, state: "UNKNOWN" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("serializes reservations across store instances sharing the same ledger path", async () => {
  const root = await rootFor();
  try {
    const first = new QianchuanDeliveryStore(root), second = new QianchuanDeliveryStore(root);
    await first.initialize(); await second.initialize();
    const value = rawDraft(), auth = rawAuthorization(value, first.sessionId);
    const reservations = await Promise.allSettled([first.reserve(value, auth), second.reserve(value, auth)]);
    expect(reservations.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await first.list(value.advertiserId)).toHaveLength(1);
    expect(await first.list(value.advertiserId)).toMatchObject([{ state: "PENDING" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("rejects corrupt or unknown persisted keys instead of accepting partial audit state", async () => {
  const root = await rootFor();
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, "state.json"), JSON.stringify({ version: 1, records: [], extra: "not allowed" }), { mode: 0o600 });
    await expect(new QianchuanDeliveryStore(root).initialize()).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("fails closed on an existing lock without stale-lock recovery", async () => {
  const root = await rootFor();
  try {
    const store = new QianchuanDeliveryStore(root); await store.initialize();
    await writeFile(path.join(root, "ledger.lock"), "stale", { mode: 0o600 });
    await expect(new QianchuanDeliveryStore(root).initialize()).rejects.toThrow();
    expect(await store.list("1234567890")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("retains an unconfirmed created plan ID when a pending operation restarts", async () => {
  const root = await rootFor(); try {
    const store = new QianchuanDeliveryStore(root); await store.initialize();
    const value = QianchuanDeliveryDraftSchema.parse({ schemaVersion: 1, draftId: "11111111-1111-4111-8111-111111111111", provider: "qianchuan-browser", accountSlot: "蝴蝶贴",
      advertiserId: "1234567890", mode: "product-cost-control", action: "create-plan", productId: "123", beforeVersion: "v1", beforeValues: { productEligible: true },
      target: { budget: "1.00", budgetType: "daily", roi: "2", status: "paused", materials: [{ materialId: "456", platformVideoId: "video-1" }] } });
    const auth = rawAuthorization(value as any, store.sessionId), id = await store.reserve(value, auth);
    await store.markSubmitStarted(id); await store.recordCreatedPlan(id, "789");
    const restarted = new QianchuanDeliveryStore(root, undefined, "33333333-3333-4333-8333-333333333333"); await restarted.initialize();
    expect(await restarted.list(value.advertiserId)).toMatchObject([{ state: "UNKNOWN", adId: "789", budgetIncrease: "1.00" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
