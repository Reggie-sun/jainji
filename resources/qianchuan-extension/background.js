export const NATIVE_HOST_NAME = "com.jianji.qianchuan";
export const RETRY_ALARM = "jianji-qianchuan-native-retry";
const ORIGIN = "https://qianchuan.jinritemai.com";
const ACCOUNT_ID = /^[1-9][0-9]{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set(["UNAVAILABLE", "CHANGED", "INVALID"]);

class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new BridgeError(code); };
const checkCancelled = signal => { if (signal?.aborted) fail("UNAVAILABLE"); };
const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeName = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);

function targetUrl(value, { picker = false, expectedId } = {}) {
  let url;
  try { url = new URL(value); } catch { fail("CHANGED"); }
  const ids = url.searchParams.getAll("aavid");
  const planIds = url.searchParams.getAll("adId");
  if (url.origin !== ORIGIN || url.username || url.password || !["/", "/uni-prom"].includes(url.pathname) || ids.length !== 1 || !ACCOUNT_ID.test(ids[0]) ||
    planIds.length > 1 || planIds.some(value => value !== "") || url.searchParams.has("jianjiPlanPicker")) fail("CHANGED");
  const marker = url.searchParams.getAll("jianjiExtensionPlanPicker");
  if (picker) {
    if (url.pathname !== "/uni-prom" || marker.length > 1 || marker.length === 1 && marker[0] !== "1") fail("CHANGED");
  } else if (marker.length) fail("CHANGED");
  if (expectedId !== undefined && ids[0] !== expectedId) fail("CHANGED");
  return { url, advertiserId: ids[0] };
}

export function selectUniqueActiveQianchuanTab(tabs) {
  if (!Array.isArray(tabs)) fail("UNAVAILABLE");
  const matches = tabs.filter(tab => {
    if (!tab || typeof tab.url !== "string") return false;
    try { return new URL(tab.url).origin === ORIGIN; } catch { return false; }
  });
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id < 0) fail("CHANGED");
  targetUrl(matches[0].url);
  return matches[0];
}

function validateSnapshot(value) {
  return exactKeys(value, ["tabId", "documentId", "account", "gfversion"]) && Number.isSafeInteger(value.tabId) && value.tabId >= 0 &&
    UUID.test(value.documentId) && exactKeys(value.account, ["advertiserId", "name"]) && ACCOUNT_ID.test(value.account.advertiserId) && safeName(value.account.name) &&
    typeof value.gfversion === "string" && value.gfversion.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value.gfversion);
}

function sameSnapshot(actual, expected) {
  return validateSnapshot(actual) && validateSnapshot(expected) && actual.tabId === expected.tabId && actual.documentId === expected.documentId &&
    actual.account.advertiserId === expected.account.advertiserId && actual.account.name === expected.account.name && actual.gfversion === expected.gfversion;
}

async function readMainVersion(api, tabId, signal) {
  checkCancelled(signal);
  const results = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func: () => {
    const value = globalThis.gfdatav1?.ver;
    return typeof value === "string" && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value) ? value : "dev";
  } });
  checkCancelled(signal);
  if (!Array.isArray(results) || results.length !== 1 || results[0].frameId !== 0 || typeof results[0].result !== "string" || results[0].result.length > 80) fail("CHANGED");
  return results[0].result;
}

async function sendContent(api, tabId, commandId, operation, signal, { picker = false, budgetMs } = {}) {
  checkCancelled(signal);
  try { await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" }); }
  catch { checkCancelled(signal); fail("UNAVAILABLE"); }
  checkCancelled(signal);
  const command = { kind: "command", id: commandId, tabId, operation, ...(picker ? { picker: true } : {}),
    ...(budgetMs === undefined ? {} : { budgetMs }) };
  let cancelListener;
  let response;
  try {
    if (signal) {
      cancelListener = () => { void api.tabs.sendMessage(tabId, { kind: "cancel", id: commandId, tabId }).catch(() => undefined); };
      signal.addEventListener("abort", cancelListener, { once: true });
      checkCancelled(signal);
    }
    response = await api.tabs.sendMessage(tabId, command);
  } catch { checkCancelled(signal); fail("UNAVAILABLE"); }
  finally { if (cancelListener) signal.removeEventListener("abort", cancelListener); }
  checkCancelled(signal);
  if (!isRecord(response) || typeof response.ok !== "boolean") fail("UNAVAILABLE");
  if (!response.ok) fail(ERROR_CODES.has(response.error) ? response.error : "UNAVAILABLE");
  return response.value;
}

export function createQianchuanDispatcher(api = globalThis.chrome) {
  if (!api?.tabs || !api?.scripting) throw new TypeError("Chrome extension APIs are required");

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true });
    return selectUniqueActiveQianchuanTab(tabs);
  }

  async function readIdentity(tab, commandId, signal, picker = false, budgetMs) {
    checkCancelled(signal);
    const target = targetUrl(tab.url, { picker });
    const account = await sendContent(api, tab.id, commandId, { kind: "identity" }, signal, { picker, budgetMs });
    checkCancelled(signal);
    if (!isRecord(account) || account.tabId !== tab.id || !UUID.test(account.documentId) || !exactKeys(account.account, ["advertiserId", "name"]) ||
      account.account.advertiserId !== target.advertiserId || !safeName(account.account.name)) fail("CHANGED");
    const gfversion = await readMainVersion(api, tab.id, signal);
    return { tabId: tab.id, documentId: account.documentId, account: account.account, gfversion };
  }

  async function currentSnapshot(expected, commandId, signal) {
    checkCancelled(signal);
    if (!validateSnapshot(expected)) fail("INVALID");
    const tab = await activeTab();
    checkCancelled(signal);
    if (tab.id !== expected.tabId) fail("CHANGED");
    const actual = await readIdentity(tab, commandId, signal);
    if (!sameSnapshot(actual, expected)) fail("CHANGED");
    return { tab, snapshot: actual };
  }

  async function waitUntilComplete(tabId, deadline, signal) {
    while (Date.now() < deadline) {
      checkCancelled(signal);
      let tab;
      try { tab = await api.tabs.get(tabId); } catch { fail("CHANGED"); }
      checkCancelled(signal);
      if (!tab || tab.id !== tabId) fail("CHANGED");
      if (tab.status === "complete") return tab;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fail("UNAVAILABLE");
  }

  async function waitForSwitchedAccount(tabId, before, chosen, commandId, signal) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      checkCancelled(signal);
      let tab;
      try { tab = await api.tabs.get(tabId); } catch { fail("CHANGED"); }
      checkCancelled(signal);
      if (!tab || tab.id !== tabId) fail("CHANGED");
      const active = await activeTab();
      if (active.id !== tabId) fail("CHANGED");
      try {
        const target = targetUrl(tab.url, { expectedId: chosen.advertiserId });
        const actual = await readIdentity({ ...tab, url: target.url.href }, commandId, signal);
        if (actual.documentId === before.documentId) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        if (actual.account.name !== chosen.name) fail("CHANGED");
        return actual;
      } catch (error) {
        if (error?.code === "CHANGED") {
          let currentId;
          try { currentId = new URL(tab.url).searchParams.get("aavid"); } catch { fail("CHANGED"); }
          if (currentId && currentId !== before.account.advertiserId && currentId !== chosen.advertiserId) fail("CHANGED");
        } else if (error?.code !== "UNAVAILABLE") throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fail("UNAVAILABLE");
  }

  async function readPlans(operation, commandId, signal) {
    const deadline = Date.now() + 30_000;
    const checkPlanBudget = () => {
      checkCancelled(signal);
      if (Date.now() >= deadline) fail("UNAVAILABLE");
    };
    checkPlanBudget();
    const { tab: originalTab, snapshot: originalSnapshot } = await currentSnapshot(operation.snapshot, commandId, signal);
    checkPlanBudget();
    const url = new URL("/uni-prom", ORIGIN);
    url.searchParams.set("aavid", originalSnapshot.account.advertiserId);
    url.searchParams.set("jianjiExtensionPlanPicker", "1");
    let ownedTabId;
    try {
      if (Date.now() >= deadline) fail("UNAVAILABLE");
      const created = await api.tabs.create({ url: url.href, active: false });
      if (!created || !Number.isSafeInteger(created.id) || created.id < 0) fail("UNAVAILABLE");
      ownedTabId = created.id;
      checkPlanBudget();
      const picker = await waitUntilComplete(ownedTabId, deadline, signal);
      checkPlanBudget();
      targetUrl(picker.url, { picker, expectedId: originalSnapshot.account.advertiserId });
      const pickerSnapshot = await readIdentity(picker, commandId, signal, true, deadline - Date.now());
      checkPlanBudget();
      if (pickerSnapshot.account.advertiserId !== originalSnapshot.account.advertiserId || pickerSnapshot.account.name !== originalSnapshot.account.name) fail("CHANGED");
      const budgetMs = deadline - Date.now();
      if (budgetMs <= 0) fail("UNAVAILABLE");
      const plans = await sendContent(api, ownedTabId, commandId, { kind: "plans", snapshot: pickerSnapshot }, signal, { budgetMs });
      checkPlanBudget();
      if (!Array.isArray(plans) || plans.length > 1000 || plans.some(plan => !exactKeys(plan, ["advertiserId", "adId", "name"]) ||
        plan.advertiserId !== originalSnapshot.account.advertiserId || !ACCOUNT_ID.test(plan.adId) || !safeName(plan.name))) fail("INVALID");
      const pickerTab = await api.tabs.get(ownedTabId);
      checkPlanBudget();
      const pickerAfter = await readIdentity(pickerTab, commandId, signal, true);
      checkPlanBudget();
      if (!sameSnapshot(pickerAfter, pickerSnapshot)) fail("CHANGED");
      const activeAfter = await currentSnapshot(originalSnapshot, commandId, signal);
      checkPlanBudget();
      if (activeAfter.tab.id !== originalTab.id) fail("CHANGED");
      return plans;
    } finally {
      if (ownedTabId !== undefined) {
        try { await api.tabs.remove(ownedTabId); }
        catch { fail("UNAVAILABLE"); }
      }
    }
  }

  async function dispatchOperation(message, signal) {
    if (!isRecord(message) || message.kind !== "command" || !UUID.test(message.id) || !isRecord(message.operation)) fail("INVALID");
    checkCancelled(signal);
    const operation = message.operation;
    if (operation.kind === "identity" && exactKeys(operation, ["kind"])) {
      const tab = await activeTab();
      return await readIdentity(tab, message.id, signal);
    }
    if (operation.kind === "request") {
      const { tab, snapshot } = await currentSnapshot(operation.snapshot, message.id, signal);
      const value = await sendContent(api, tab.id, message.id, operation, signal);
      checkCancelled(signal);
      const after = await currentSnapshot(operation.snapshot, message.id, signal);
      if (after.tab.id !== tab.id || !sameSnapshot(after.snapshot, snapshot)) fail("CHANGED");
      return value;
    }
    if (operation.kind === "switch" && exactKeys(operation, ["kind", "snapshot", "chosen"])) {
      const { tab, snapshot } = await currentSnapshot(operation.snapshot, message.id, signal);
      if (!exactKeys(operation.chosen, ["advertiserId", "name"]) || !ACCOUNT_ID.test(operation.chosen.advertiserId) || !safeName(operation.chosen.name)) fail("INVALID");
      const nav = await sendContent(api, tab.id, message.id, operation, signal);
      checkCancelled(signal);
      if (!isRecord(nav) || typeof nav.navigating !== "boolean") fail("UNAVAILABLE");
      if (!nav.navigating) return snapshot;
      return await waitForSwitchedAccount(tab.id, snapshot, operation.chosen, message.id, signal);
    }
    if (operation.kind === "plans" && exactKeys(operation, ["kind", "snapshot"])) return await readPlans(operation, message.id, signal);
    fail("INVALID");
  }

  const activeCommands = new Map();
  return {
    cancel: id => {
      const controller = activeCommands.get(id);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    cancelAll: () => { for (const controller of activeCommands.values()) controller.abort(); },
    dispatch: async message => {
    let id = typeof message?.id === "string" && UUID.test(message.id) ? message.id : undefined;
    if (!id || activeCommands.has(id)) return { kind: "result", id, ok: false, error: "INVALID" };
    const controller = new AbortController();
    activeCommands.set(id, controller);
    try {
      const value = await dispatchOperation(message, controller.signal);
      checkCancelled(controller.signal);
      return { kind: "result", id, ok: true, value };
    } catch (error) {
      return { kind: "result", id, ok: false, error: ERROR_CODES.has(error?.code) ? error.code : "UNAVAILABLE" };
    } finally { if (activeCommands.get(id) === controller) activeCommands.delete(id); }
  } };
}

export function startQianchuanNativeBridge(api = globalThis.chrome) {
  const dispatcher = createQianchuanDispatcher(api);
  let port;
  let connecting = false;
  const connect = () => {
    if (port || connecting) return;
    connecting = true;
    try {
      const current = api.runtime.connectNative(NATIVE_HOST_NAME);
      port = current;
      current.onMessage.addListener(message => {
        if (isRecord(message) && exactKeys(message, ["kind", "id"]) && message.kind === "cancel" && UUID.test(message.id)) {
          dispatcher.cancel(message.id);
          return;
        }
        void dispatcher.dispatch(message).then(result => {
          if (port === current) current.postMessage(result);
        });
      });
      current.onDisconnect.addListener(() => { dispatcher.cancelAll(); if (port === current) port = undefined; connecting = false; });
    } catch { port = undefined; connecting = false; }
  };
  const armRetry = () => { void api.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }); };
  api.runtime.onStartup.addListener(() => { armRetry(); connect(); });
  api.runtime.onInstalled.addListener(() => { armRetry(); connect(); });
  api.alarms.onAlarm.addListener(alarm => { if (alarm.name === RETRY_ALARM) connect(); });
  api.tabs.onActivated?.addListener(() => connect());
  armRetry();
  connect();
  return { connect };
}

if (typeof globalThis.chrome !== "undefined" && globalThis.chrome?.runtime?.connectNative) startQianchuanNativeBridge(globalThis.chrome);
