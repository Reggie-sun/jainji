import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QianchuanAccountSettings } from "../src/main/qianchuan-account-settings";
import { QianchuanBrowserManager } from "../src/main/qianchuan-browser-manager";
import type { ExtensionAccountSession, ExtensionAccountsPort } from "../src/main/qianchuan-extension-accounts";
import type { QianchuanExtensionCatalog } from "../src/main/qianchuan-extension-catalog";
import { qianchuanSelectedAccountTargets } from "../src/main/qianchuan-selected-account-targets";
import type { FrozenQianchuanAccount } from "../src/main/qianchuan-account-config";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import type { QianchuanCurrentAccount } from "../src/shared/qianchuan-plan-selection";
import type { QianchuanSubaccountCatalog } from "../src/shared/qianchuan-subaccounts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  qianchuanSelectedAccountTargets.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("reads and switches dynamic local, proxy, and VPS child accounts through the extension while frozen targets keep their saved anchor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qianchuan-extension-accounts-")); roots.push(root);
  vi.spyOn(QianchuanBrowserManager.prototype, "assertClosed").mockResolvedValue();
  const accountRows = QIANCHUAN_PRODUCTS.map((product, index) => {
    const egress = index % 3 === 0 ? undefined : {
      ...(index % 3 === 2 ? { mode: "remote-browser" as const } : {}),
      group: `future-egress-${index}`, sshHost: `future-host-${index}`, expectedIp: `8.8.${index + 1}.1`, localPort: 31_000 + index,
    };
    return {
      product, advertiserId: String(9_000_000_000_000_000_000n + BigInt(index)),
      adId: String(9_100_000_000_000_000_000n + BigInt(index)),
      cdpEndpoint: `http://127.0.0.1:${32_000 + index}`, ...(egress ? { egress } : {}),
    };
  });
  const source = path.join(root, "accounts.json");
  await writeFile(source, JSON.stringify({ version: 1, accounts: accountRows }), { mode: 0o600 });

  const currentIds = new Map(QIANCHUAN_PRODUCTS.map((product, index) => [product, String(9_200_000_000_000_000_000n + BigInt(index))]));
  const nextIds = new Map(QIANCHUAN_PRODUCTS.map((product, index) => [product, String(9_300_000_000_000_000_000n + BigInt(index))]));
  const currentNames = new Map(QIANCHUAN_PRODUCTS.map(product => [product, `网页子账户 ${product}`]));
  const documentIds = new Map(QIANCHUAN_PRODUCTS.map(product => [product, randomUUID()]));
  const account = (advertiserId: string, label: string): QianchuanCurrentAccount & { name: string } => ({ advertiserId, name: label });
  const session = (target: FrozenQianchuanAccount, liveId: string): ExtensionAccountSession => {
    const snapshotAccount = account(liveId, currentNames.get(target.product)!);
    return {
      identity: `${target.product}:${documentIds.get(target.product)!}`,
      endpoint: target.cdpEndpoint,
      uploadEndpointVerified: true,
      account: snapshotAccount,
      snapshot: { tabId: QIANCHUAN_PRODUCTS.indexOf(target.product), documentId: documentIds.get(target.product)!, account: snapshotAccount, gfversion: "fixture" },
      catalog: {} as QianchuanExtensionCatalog,
    };
  };
  const current = vi.fn(async (target: FrozenQianchuanAccount, _signal?: AbortSignal, _excludedTargets?: ReadonlySet<string>) => session(target, currentIds.get(target.product)!));
  const accounts = vi.fn(async (bound: ExtensionAccountSession, _signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanSubaccountCatalog> => {
    await guard();
    const currentAccount = bound.snapshot.account;
    const candidateId = nextIds.get(QIANCHUAN_PRODUCTS.find(product => bound.identity.startsWith(`${product}:`))!)!;
    return { current: currentAccount, accounts: [currentAccount, account(candidateId, `下一子账户 ${bound.identity}`)] };
  });
  const switchAccount = vi.fn(async (bound: ExtensionAccountSession, advertiserId: string, _signal: AbortSignal, guard: () => Promise<void>) => {
    await guard();
    const product = QIANCHUAN_PRODUCTS.find(value => bound.identity.startsWith(`${value}:`))!;
    if (advertiserId !== nextIds.get(product)) throw new Error("unexpected fixture child");
    currentIds.set(product, advertiserId);
    const name = `已切换子账户 ${product}`; currentNames.set(product, name);
    const documentId = randomUUID(); documentIds.set(product, documentId);
    return { ...bound.snapshot, documentId, account: account(advertiserId, name) };
  });
  const plans = vi.fn(async (bound: ExtensionAccountSession, _signal: AbortSignal, guard: () => Promise<void>) => {
    await guard();
    const product = QIANCHUAN_PRODUCTS.find(value => bound.identity.startsWith(`${value}:`))!;
    return [{ advertiserId: bound.snapshot.account.advertiserId, adId: String(9_400_000_000_000_000_000n + BigInt(QIANCHUAN_PRODUCTS.indexOf(product))), name: `动态计划 ${product}`, accountSource: "current-browser" as const }];
  });
  const extension: ExtensionAccountsPort = { current, accounts, switch: switchAccount, plans };
  const discover = vi.fn(async (id: string) => `http://127.0.0.1:${Number(BigInt(id) % 10_000n) + 40_000}`);
  const discoverExisting = vi.fn(async (id: string) => `http://127.0.0.1:${Number(BigInt(id) % 10_000n) + 41_000}`);
  const legacyCurrent = vi.fn(async () => { throw new Error("legacy CDP current-account reader used"); });
  const legacySubaccounts = {
    read: vi.fn(async () => { throw new Error("legacy CDP list reader used"); }),
    switch: vi.fn(async () => { throw new Error("legacy CDP switch reader used"); }),
  };
  const settings = new QianchuanAccountSettings(path.join(root, "app"), discover, discoverExisting, legacyCurrent, legacySubaccounts, extension);
  await settings.authorizeFile(source);
  const savedMapping = await readFile(settings.file);

  for (const configuredRow of accountRows) {
    const anchor = await settings.preflight(configuredRow.product);
    const initialChild = currentIds.get(configuredRow.product)!;
    const expectedChild = nextIds.get(configuredRow.product)!;
    const guards: string[] = [];
    const guard = (target: FrozenQianchuanAccount) => guards.push(target.advertiserId);

    const catalog = await settings.listSubaccounts({ product: configuredRow.product, expectedAdvertiserId: anchor.advertiserId }, new AbortController().signal, new Set(), guard);
    expect(catalog.current).toEqual(account(initialChild, `网页子账户 ${configuredRow.product}`));
    expect(catalog.accounts.map(value => value.advertiserId)).toEqual([initialChild, expectedChild]);

    const excludedTargets = new Set(["protected-upload-page"]);
    const currentPage = await settings.prepareCurrentCatalog(configuredRow.product, undefined, excludedTargets);
    expect(current.mock.lastCall?.[2]).toBe(excludedTargets);
    expect(currentPage.configured.advertiserId).toBe(anchor.advertiserId);
    expect(currentPage.target.advertiserId).toBe(initialChild);
    const plan = (await settings.readCurrentPlans(currentPage.target, new AbortController().signal, excludedTargets))[0]!;
    expect(current.mock.calls.slice(-2).every(call => call[2] === excludedTargets)).toBe(true);
    expect(plan).toMatchObject({ advertiserId: initialChild, accountSource: "current-browser" });

    const authorization = {
      target: { ...currentPage.target, adId: plan.adId }, pageBatchId: randomUUID(), expectedCount: 1,
    };
    qianchuanSelectedAccountTargets.remember(authorization, currentPage.configured);
    const oldFrozenTarget = structuredClone(authorization.target);
    const selected = { enabled: true as const, accountProduct: configuredRow.product, plan };

    await expect(settings.switchSubaccount({ product: configuredRow.product, expectedAdvertiserId: anchor.advertiserId,
      expectedCurrentAdvertiserId: initialChild, advertiserId: expectedChild }, new AbortController().signal, new Set(), guard))
      .resolves.toEqual(account(expectedChild, `已切换子账户 ${configuredRow.product}`));

    const after = await settings.prepareCurrentCatalog(configuredRow.product);
    expect(after.configured.advertiserId).toBe(anchor.advertiserId);
    expect(after.target.advertiserId).toBe(expectedChild);
    expect(qianchuanSelectedAccountTargets.browserAnchor(authorization)).toEqual(currentPage.configured);
    expect(qianchuanSelectedAccountTargets.resolve(authorization, selected, after.configured)).toEqual(oldFrozenTarget);
    expect(await settings.preflight(configuredRow.product)).toMatchObject({ advertiserId: anchor.advertiserId, adId: configuredRow.adId });
    expect(await readFile(settings.file)).toEqual(savedMapping);
    expect(guards).toContain(anchor.advertiserId);
    expect(guards).toContain(initialChild);
    expect(guards).toContain(expectedChild);
  }

  const driftProduct = QIANCHUAN_PRODUCTS[0]!, driftAnchor = await settings.preflight(driftProduct);
  const driftId = "9600000000000000001";
  accounts.mockImplementationOnce(async (bound, _signal, guard) => {
    await guard();
    currentIds.set(driftProduct, driftId);
    return { current: bound.snapshot.account, accounts: [bound.snapshot.account] };
  });
  await expect(settings.listSubaccounts({ product: driftProduct, expectedAdvertiserId: driftAnchor.advertiserId }, new AbortController().signal, new Set(), () => {}))
    .rejects.toThrow("网页账户或浏览器连接已变化");

  const planReadTarget = await settings.prepareCurrentCatalog(driftProduct);
  plans.mockImplementationOnce(async (bound, _signal, guard) => {
    await guard();
    currentIds.set(driftProduct, "9600000000000000002");
    return [{ advertiserId: bound.snapshot.account.advertiserId, adId: "9600000000000000011", name: "过期快照计划", accountSource: "current-browser" as const }];
  });
  await expect(settings.readCurrentPlans(planReadTarget.target, new AbortController().signal)).rejects.toThrow("网页账户或浏览器连接已变化");

  expect(current).toHaveBeenCalled();
  expect(accounts).toHaveBeenCalledTimes(QIANCHUAN_PRODUCTS.length + 1);
  expect(switchAccount).toHaveBeenCalledTimes(QIANCHUAN_PRODUCTS.length);
  expect(plans).toHaveBeenCalledTimes(QIANCHUAN_PRODUCTS.length + 1);
  expect(legacyCurrent).not.toHaveBeenCalled();
  expect(legacySubaccounts.read).not.toHaveBeenCalled();
  expect(legacySubaccounts.switch).not.toHaveBeenCalled();
  expect(discover).not.toHaveBeenCalled();
  expect(discoverExisting).not.toHaveBeenCalled();
});
