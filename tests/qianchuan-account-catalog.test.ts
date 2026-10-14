import { expect, it, vi } from "vitest";
import { QianchuanAccountCatalog, type CatalogOperation, type CatalogSnapshotBase } from "../src/main/qianchuan-account-catalog";

const main = { advertiserId: "1876039035222536", name: "主账户" };
const child = { advertiserId: "1876039035222649", name: "当前网页子账户" };

interface BrowserSnapshot extends CatalogSnapshotBase {
  targetId: string;
  documentToken: string;
}

const initial: BrowserSnapshot = { targetId: "cdp-target-1876039035222536", documentToken: "document-token-before-switch", account: main, gfversion: "page-build" };
const afterSwitch: BrowserSnapshot = { ...initial, documentToken: "document-token-after-switch", account: child };
const binding = {
  parse(value: unknown): BrowserSnapshot {
    if (!value || typeof value !== "object") throw new Error("invalid snapshot");
    const snapshot = value as Partial<BrowserSnapshot>;
    if (typeof snapshot.targetId !== "string" || typeof snapshot.documentToken !== "string" || !snapshot.account || typeof snapshot.gfversion !== "string") throw new Error("invalid snapshot");
    return snapshot as BrowserSnapshot;
  },
  same(before: BrowserSnapshot, after: BrowserSnapshot): boolean {
    return before.targetId === after.targetId && before.documentToken === after.documentToken &&
      before.account.advertiserId === after.account.advertiserId && before.account.name === after.account.name && before.gfversion === after.gfversion;
  },
  switched(before: BrowserSnapshot, after: BrowserSnapshot): boolean {
    return before.targetId === after.targetId && before.documentToken !== after.documentToken;
  },
};

function response(op: CatalogOperation<BrowserSnapshot>, current: BrowserSnapshot) {
  if (op.kind !== "request") throw new Error("unexpected request");
  if (op.path.endsWith("/info")) return { kind: "user-info", accountInfo: { advId: current.account.advertiserId, advName: current.account.name } };
  return { kind: "user-list", accounts: [main, child], totalPages: 1, totalCount: 2, currentPage: 1 };
}

it("reads the main account directory, switches the same string-identified page once, then lists that child's plans", async () => {
  let current = initial;
  const call = vi.fn(async (op: CatalogOperation<BrowserSnapshot>) => {
    if (op.kind === "identity") return current;
    if (op.kind === "switch") { current = afterSwitch; return afterSwitch; }
    if (op.kind === "plans") return [{ advertiserId: current.account.advertiserId, adId: "1878488818847384", name: "子账户计划", accountSource: "current-browser" }];
    return response(op, current);
  });
  const catalog = new QianchuanAccountCatalog(call, binding);
  const signal = new AbortController().signal;

  const directory = await catalog.accounts(initial, signal);
  expect(directory.current).toEqual(main);
  expect(directory.accounts).toEqual([main, child]);
  const selected = directory.accounts.find(account => account.advertiserId === child.advertiserId)!;
  expect(selected.name).toBe(child.name);
  expect(call.mock.calls.filter(([op]) => op.kind === "request" && op.path.endsWith("user-list"))[0]![0]).toMatchObject({
    kind: "request", snapshot: initial, params: { aavid: main.advertiserId },
  });

  const switched = await catalog.switch(initial, selected.advertiserId, signal, async () => {});
  expect(switched.targetId).toBe(initial.targetId);
  expect(switched.documentToken).not.toBe(initial.documentToken);
  expect(switched.account).toEqual(child);
  expect(call.mock.calls.filter(([op]) => op.kind === "switch")).toHaveLength(1);

  await expect(catalog.plans(switched, signal)).resolves.toEqual([
    { advertiserId: child.advertiserId, adId: "1878488818847384", name: "子账户计划", accountSource: "current-browser" },
  ]);
});

it.each([
  ["target drift", { ...afterSwitch, targetId: "different-target" }],
  ["unchanged document", { ...initial, account: child }],
])("rejects a switch that does not prove the original target and a new document (%s)", async (_label, switched) => {
  const call = vi.fn(async (op: CatalogOperation<BrowserSnapshot>) => {
    if (op.kind === "identity") return initial;
    if (op.kind === "switch") return switched;
    return response(op, initial);
  });
  const catalog = new QianchuanAccountCatalog(call, binding);
  await expect(catalog.switch(initial, child.advertiserId, new AbortController().signal, async () => {})).rejects.toThrow();
  expect(call.mock.calls.filter(([op]) => op.kind === "switch")).toHaveLength(1);
});

it("refuses account and document drift and does not replay an unknown switch result", async () => {
  let current = initial;
  const call = vi.fn(async (op: CatalogOperation<BrowserSnapshot>) => {
    if (op.kind === "identity") return current;
    if (op.kind === "switch") { current = afterSwitch; throw new Error("unknown result"); }
    return response(op, current);
  });
  const catalog = new QianchuanAccountCatalog(call, binding);
  await expect(catalog.switch(initial, child.advertiserId, new AbortController().signal, async () => {})).rejects.toThrow("unknown result");
  expect(call.mock.calls.filter(([op]) => op.kind === "switch")).toHaveLength(1);

  current = { ...initial, account: child };
  const listCallsBeforeDrift = call.mock.calls.filter(([op]) => op.kind === "request" && op.path.endsWith("user-list")).length;
  await expect(catalog.accounts(initial, new AbortController().signal)).rejects.toThrow();
  expect(call.mock.calls.filter(([op]) => op.kind === "request" && op.path.endsWith("user-list"))).toHaveLength(listCallsBeforeDrift);

  current = initial;
  let listCalls = 0;
  call.mockImplementation(async (op: CatalogOperation<BrowserSnapshot>) => {
    if (op.kind === "identity") return current;
    if (op.kind === "request" && op.path.endsWith("user-list")) { listCalls++; if (listCalls === 1) current = { ...initial, documentToken: "external-page-navigation" }; }
    return response(op, current);
  });
  await expect(catalog.accounts(initial, new AbortController().signal)).rejects.toThrow();
  expect(call.mock.calls.filter(([op]) => op.kind === "switch")).toHaveLength(1);
});
