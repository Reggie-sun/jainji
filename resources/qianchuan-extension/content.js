(function installQianchuanContent(global) {
  "use strict";

  if (global.__jianjiQianchuanContent) return;

  const ORIGIN = "https://qianchuan.jinritemai.com";
  const ID_PATTERN = /^[1-9][0-9]{0,19}$/;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const USER_LIST = "/ad/api/v1/account/user-list";
  const USER_INFO = "/ad/api/v1/account/user/info";
  const MAX_PLANS = 1000;
  const MAX_PAGES = 100;

  class QianchuanError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const fail = code => { throw new QianchuanError(code); };
  const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
  const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const safeText = (value, max = 200) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const normalizeText = value => String(value ?? "").replace(/\s+/g, " ").trim();

  function visible(element, env) {
    if (!element || typeof element.getClientRects !== "function" || !element.getClientRects().length) return false;
    const style = env.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function advertiserId(value) {
    if (typeof value === "string" && ID_PATTERN.test(value)) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
    fail("INVALID");
  }

  function countValue(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
    fail("INVALID");
  }

  function accountFromText(text, expectedId) {
    const normalized = normalizeText(text);
    const markers = [...normalized.matchAll(/ID\s*[：:]/gi)];
    const match = /ID\s*[：:]\s*([1-9][0-9]{0,19})(?![\p{L}\p{N}_])/iu.exec(normalized);
    if (markers.length !== 1 || !match || match[1] !== expectedId) fail("CHANGED");
    const name = normalized.slice(0, match.index).trim();
    if (!safeText(name)) fail("CHANGED");
    return { advertiserId: match[1], name };
  }

  function parseAccountList(data, expectedPage, limit) {
    if (!isRecord(data) || !Array.isArray(data.userAccountInfos) || data.userAccountInfos.length > limit || data.userAccountInfos.length > 100) fail("INVALID");
    const totalPages = countValue(data.totalPages);
    const totalCount = countValue(data.totalCount);
    const currentPage = countValue(data.currentPage);
    if (currentPage !== expectedPage || (totalCount === 0 && totalPages !== 0 && totalPages !== 1) ||
      (totalCount > 0 && totalPages === 0) || data.userAccountInfos.length > totalCount) fail("INVALID");
    const seen = new Set();
    const accounts = data.userAccountInfos.map(entry => {
      if (!isRecord(entry)) fail("INVALID");
      const id = advertiserId(entry.id);
      if (Object.hasOwn(entry, "advid") && advertiserId(entry.advid) !== id) fail("CHANGED");
      if (!safeText(entry.name) || seen.has(id)) fail("INVALID");
      seen.add(id);
      return { advertiserId: id, name: entry.name };
    });
    return { accounts, totalPages, totalCount, currentPage };
  }

  function parsePlanRows(snapshot, expectedAdvertiserId, idsSeen) {
    const plans = [];
    for (const row of snapshot.rows) {
      if (row.cellCount !== 1 || row.names.length !== 1 || row.ids.length !== 1 || row.deletedTags.length > 1) fail("INVALID");
      const name = row.names[0].trim();
      const idMatch = /^ID[：:]\s*([1-9][0-9]{0,19})$/.exec(row.ids[0].trim());
      if (!safeText(name) || !idMatch) fail("INVALID");
      const adId = idMatch[1];
      if (idsSeen.has(adId)) fail("INVALID");
      idsSeen.add(adId);
      if (!row.deletedTags.includes("已删除")) plans.push({ advertiserId: expectedAdvertiserId, adId, name });
    }
    return plans;
  }

  async function collectPlanCatalog(readPage, advance, check, expectedAdvertiserId, limits = {}) {
    const maxPages = limits.maxPages ?? MAX_PAGES;
    const maxPlans = limits.maxPlans ?? MAX_PLANS;
    let expectedTotal;
    let rawRows = 0;
    let pageNumber = 1;
    const idsSeen = new Set();
    const plans = [];
    while (pageNumber <= maxPages) {
      check();
      const page = await readPage(pageNumber);
      check();
      if (!page || page.pageNumber !== pageNumber || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > maxPlans ||
        typeof page.nextDisabled !== "boolean" || !Array.isArray(page.rows)) fail("INVALID");
      if (expectedTotal === undefined) expectedTotal = page.total;
      else if (page.total !== expectedTotal) fail("CHANGED");
      rawRows += page.rows.length;
      if (rawRows > page.total || rawRows > maxPlans) fail("INVALID");
      plans.push(...parsePlanRows(page, expectedAdvertiserId, idsSeen));
      if (page.nextDisabled) {
        if (rawRows !== page.total) fail("INVALID");
        return plans;
      }
      if (rawRows >= page.total || pageNumber === maxPages) fail("INVALID");
      check();
      await advance();
      pageNumber++;
    }
    fail("INVALID");
  }

  function createContentController(env = global) {
    const boundDocument = env.document;
    const documentId = env.crypto.randomUUID();
    const activeCommands = new Map();
    let navigationStarted = false;

    function checkCancelled(signal) {
      if (signal?.aborted) fail("UNAVAILABLE");
    }

    function wait(milliseconds, signal) {
      checkCancelled(signal);
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          if (timer !== undefined) env.clearTimeout(timer);
          signal?.removeEventListener("abort", cancelled);
        };
        const done = () => { cleanup(); resolve(); };
        const cancelled = () => { cleanup(); reject(new QianchuanError("UNAVAILABLE")); };
        timer = env.setTimeout(done, milliseconds);
        signal?.addEventListener("abort", cancelled, { once: true });
        if (signal?.aborted) cancelled();
      });
    }

    function checkDocument() {
      if (env.document !== boundDocument) fail("CHANGED");
    }

    function pageUrl(expectedId, allowPicker = false, readOnlyIdentity = false) {
      checkDocument();
      let url;
      try { url = new URL(env.location.href); } catch { fail("CHANGED"); }
      const extensionMarkers = url.searchParams.getAll("jianjiExtensionPlanPicker");
      const planIds = url.searchParams.getAll("adId");
      if (url.origin !== ORIGIN || !(["/", "/uni-prom"].includes(url.pathname) || readOnlyIdentity && url.pathname === "/account-center/account-info") || url.username || url.password ||
        url.searchParams.getAll("aavid").length !== 1 || url.searchParams.get("aavid") !== expectedId || planIds.length > 1 ||
        planIds.some(value => value !== "" && (!readOnlyIdentity || url.pathname !== "/uni-prom" || !ID_PATTERN.test(value))) ||
        url.searchParams.has("jianjiPlanPicker") || extensionMarkers.length > 1 || extensionMarkers.length === 1 &&
          (!allowPicker || extensionMarkers[0] !== "1")) fail("CHANGED");
      if (allowPicker && url.pathname !== "/uni-prom") fail("CHANGED");
      return url;
    }

    function currentAccount(expectedId, allowMissing = false, readOnlyIdentity = false) {
      const uploadDrawers = Array.from(boundDocument.querySelectorAll(".ovui-drawer:not(.ovui-drawer--no-maskable):has(.oc-create-material-submit-bar-count)"))
        .filter(element => visible(element, env));
      const confirmationTitles = Array.from(boundDocument.querySelectorAll(".oc-modal-confirm-title")).filter(element => visible(element, env));
      if (!readOnlyIdentity && (uploadDrawers.length || confirmationTitles.length)) fail("CHANGED");
      const containers = Array.from(boundDocument.querySelectorAll(".account-info-container")).filter(element => {
        if (!element?.getClientRects?.().length) return false;
        const style = env.getComputedStyle(element);
        const rect = element.getBoundingClientRect?.();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity ?? 1) > 0 && rect && rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.right > 0 && rect.top < env.innerHeight && rect.left < env.innerWidth;
      });
      if (!containers.length && allowMissing) return undefined;
      if (containers.length !== 1) fail("CHANGED");
      const box = containers[0].querySelector(".account-info-box") || containers[0];
      const text = box.innerText ?? box.textContent;
      return accountFromText(text, expectedId);
    }

    function accountIdentity(allowPicker = false, expectedId, readOnlyIdentity = false) {
      checkDocument();
      let url;
      try { url = new URL(env.location.href); } catch { fail("CHANGED"); }
      const ids = url.searchParams.getAll("aavid");
      if (ids.length !== 1 || !ID_PATTERN.test(ids[0])) fail("CHANGED");
      pageUrl(ids[0], allowPicker, readOnlyIdentity);
      const account = currentAccount(ids[0], false, readOnlyIdentity);
      if (expectedId && account.advertiserId !== expectedId) fail("CHANGED");
      return { documentId, account };
    }

    function identity(tabId, allowPicker = false, expectedId) {
      if (!Number.isSafeInteger(tabId) || tabId < 0) fail("CHANGED");
      return { tabId, ...accountIdentity(allowPicker, expectedId) };
    }

    async function waitForPickerIdentity(tabId, budgetMs, signal) {
      const ids = new URL(env.location.href).searchParams.getAll("aavid");
      if (ids.length !== 1 || !ID_PATTERN.test(ids[0])) fail("CHANGED");
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        checkCancelled(signal);
        pageUrl(ids[0], true);
        if (currentAccount(ids[0], true)) return identity(tabId, true, ids[0]);
        await wait(Math.min(100, deadline - Date.now()), signal);
      }
      fail("UNAVAILABLE");
    }

    function checkSnapshot(expected, tabId, allowPicker = false) {
      if (!exactKeys(expected, ["tabId", "documentId", "account", "gfversion"]) || expected.tabId !== tabId ||
        expected.documentId !== documentId || !UUID_PATTERN.test(expected.documentId) || !exactKeys(expected.account, ["advertiserId", "name"]) ||
        !ID_PATTERN.test(expected.account.advertiserId) || !safeText(expected.account.name) || typeof expected.gfversion !== "string" || expected.gfversion.length > 80) fail("CHANGED");
      const fresh = identity(tabId, allowPicker, expected.account.advertiserId);
      if (fresh.account.name !== expected.account.name) fail("CHANGED");
      return fresh;
    }

    function csrfToken() {
      const match = boundDocument.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("csrftoken="));
      const value = match?.slice("csrftoken=".length);
      if (!value || value.length > 4096) fail("UNAVAILABLE");
      return value;
    }

    function validateRequest(operation, fresh) {
      if (!exactKeys(operation, ["kind", "snapshot", "path", "params", "headers"]) ||
        ![USER_LIST, USER_INFO].includes(operation.path) || !isRecord(operation.params) || !isRecord(operation.headers) ||
        !exactKeys(operation.headers, ["qc-date", "qc-key", "qc-auth"]) || Object.values(operation.headers).some(value => !safeText(value, 1024))) fail("INVALID");
      const params = operation.params;
      if (params.aavid !== fresh.account.advertiserId || params.gfversion !== operation.snapshot.gfversion) fail("CHANGED");
      const allowed = operation.path === USER_LIST ? ["page", "limit", "keyword", "aavid", "gfversion"] : ["aavid", "gfversion"];
      if (Object.keys(params).length !== allowed.length || Object.keys(params).some(key => !allowed.includes(key))) fail("INVALID");
      if (operation.path === USER_LIST && (!Number.isSafeInteger(params.page) || params.page < 1 || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 100 ||
        typeof params.keyword !== "string" || params.keyword.length > 200 || /[\u0000-\u001f\u007f]/.test(params.keyword))) fail("INVALID");
      return params;
    }

    async function readAccountRequest(operation, signal, checkFresh) {
      checkCancelled(signal);
      const before = checkFresh(operation.snapshot);
      const params = validateRequest(operation, before);
      const url = new URL(operation.path, ORIGIN);
      if (url.origin !== ORIGIN || url.pathname !== operation.path) fail("INVALID");
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const abort = new env.AbortController();
      const timeout = env.setTimeout(() => abort.abort(), 10_000);
      const cancelRequest = () => abort.abort();
      signal?.addEventListener("abort", cancelRequest, { once: true });
      try {
        let response;
        try {
          response = await env.fetch(url.href, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store",
            headers: { ...operation.headers, "X-CSRFToken": csrfToken() }, signal: abort.signal });
        } catch { checkCancelled(signal); fail("UNAVAILABLE"); }
        checkCancelled(signal);
        if (response.status !== 200 || response.url && new URL(response.url).origin !== ORIGIN) fail("UNAVAILABLE");
        const length = response.headers?.get?.("content-length");
        if (length !== null && length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 1024 * 1024)) fail("INVALID");
        let text;
        try {
          const reader = response.body?.getReader();
          if (!reader) fail("UNAVAILABLE");
          const chunks = [];
          let size = 0;
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            checkCancelled(signal);
            size += item.value.byteLength;
            if (size > 1024 * 1024) {
              await reader.cancel().catch(() => undefined);
              fail("INVALID");
            }
            chunks.push(item.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          text = new env.TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (error) {
          checkCancelled(signal);
          if (["UNAVAILABLE", "CHANGED", "INVALID"].includes(error?.code)) throw error;
          fail("UNAVAILABLE");
        }
        checkCancelled(signal);
        let payload;
        try { payload = JSON.parse(text); } catch { fail("INVALID"); }
        checkFresh(operation.snapshot);
        if (!isRecord(payload) || payload.status_code !== 0 || !isRecord(payload.data)) fail("UNAVAILABLE");
        if (operation.path === USER_LIST) {
          const page = parseAccountList(payload.data, params.page, params.limit);
          return { kind: "user-list", ...page };
        }
        const info = payload.data.accountInfo;
        if (!isRecord(info)) fail("INVALID");
        const advId = advertiserId(info.advId);
        if (advId !== before.account.advertiserId || !safeText(info.advName)) fail("CHANGED");
        return { kind: "user-info", accountInfo: { advId, advName: info.advName } };
      } finally { env.clearTimeout(timeout); signal?.removeEventListener("abort", cancelRequest); }
    }

    async function readRequest(operation, tabId, signal) {
      return readAccountRequest(operation, signal, snapshot => checkSnapshot(snapshot, tabId));
    }

    function beginAccountSwitch(operation, before, route = "/") {
      if (!exactKeys(operation.chosen, ["advertiserId", "name"]) || !ID_PATTERN.test(operation.chosen.advertiserId) || !safeText(operation.chosen.name)) fail("INVALID");
      if (navigationStarted) fail("CHANGED");
      if (operation.chosen.advertiserId === before.account.advertiserId) {
        if (operation.chosen.name !== before.account.name) fail("CHANGED");
        return { navigating: false };
      }
      navigationStarted = true;
      env.location.replace(`${ORIGIN}${route}?aavid=${encodeURIComponent(operation.chosen.advertiserId)}`);
      return { navigating: true };
    }

    async function switchAccount(operation, tabId, signal) {
      checkCancelled(signal);
      return beginAccountSwitch(operation, checkSnapshot(operation.snapshot, tabId));
    }

    function checkAccountSnapshot(expected) {
      if (!exactKeys(expected, ["documentId", "account", "gfversion"]) || expected.documentId !== documentId || !UUID_PATTERN.test(expected.documentId) ||
        !exactKeys(expected.account, ["advertiserId", "name"]) || !ID_PATTERN.test(expected.account.advertiserId) || !safeText(expected.account.name) ||
        typeof expected.gfversion !== "string" || expected.gfversion.length > 80 || /[\u0000-\u001f\u007f]/.test(expected.gfversion)) fail("CHANGED");
      const fresh = accountIdentity(false, expected.account.advertiserId);
      if (fresh.account.name !== expected.account.name) fail("CHANGED");
      return { ...fresh, gfversion: expected.gfversion };
    }

    function accountForPlans(expected, tabId, signal) {
      checkCancelled(signal);
      const fresh = checkSnapshot(expected, tabId, true);
      const url = pageUrl(fresh.account.advertiserId, true);
      return fresh;
    }

    function readDomPage(expected, expectedPage, signal) {
      const account = accountForPlans(expected, expected.tabId, signal);
      const groups = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"]')).filter(element => visible(element, env));
      const group = groups.length === 1 ? groups[0] : undefined;
      const totals = group ? Array.from(group.querySelectorAll(".ovui-page-total")).filter(element => visible(element, env)) : [];
      const activePages = group ? Array.from(group.querySelectorAll(".ovui-page-turner__item--active")).filter(element => visible(element, env)) : [];
      const nextItems = group ? Array.from(group.querySelectorAll("li.ovui-page-turner__item:has(.ovui-page-turner__next-icon)")).filter(element => visible(element, env)) : [];
      const rows = Array.from(boundDocument.querySelectorAll("tr.ovui-tr")).filter(element => visible(element, env)).flatMap(row => {
        const cells = Array.from(row.querySelectorAll(".p-c-ad-name-col")).filter(element => visible(element, env));
        if (!cells.length) return [];
        const cell = cells.length === 1 ? cells[0] : row;
        const text = element => normalizeText(element.innerText ?? element.textContent);
        const names = Array.from(cell.querySelectorAll(".oc-promotion-product-adinfo-name .oc-typography-value-int")).filter(element => visible(element, env)).map(text);
        const ids = Array.from(cell.querySelectorAll(".oc-promotion-product-adinfo-id-fade")).filter(element => visible(element, env)).map(text);
        const deletedTags = Array.from(row.querySelectorAll(".oc-tag-text")).filter(tag => {
          if (text(tag) !== "已删除") return false;
          for (let ancestor = tag; ancestor && ancestor !== row; ancestor = ancestor.parentElement) {
            const style = env.getComputedStyle(ancestor);
            if (style.display === "none" || style.visibility !== "visible") return false;
          }
          const range = boundDocument.createRange();
          range.selectNodeContents(tag);
          return Array.from(range.getClientRects()).some(box => box.width > 0 && box.height > 0);
        }).map(text);
        return [{ cellCount: cells.length, names, ids, deletedTags, rowText: text(row) }];
      });
      if (groups.length !== 1 || totals.length !== 1 || activePages.length !== 1 || nextItems.length !== 1) return undefined;
      const totalMatch = /^共\s*(0|[1-9][0-9]*)\s*条记录$/.exec(normalizeText(totals[0].innerText ?? totals[0].textContent));
      const pageMatch = /^([1-9][0-9]*)$/.exec(normalizeText(activePages[0].innerText ?? activePages[0].textContent));
      if (!totalMatch || !pageMatch || Number(pageMatch[1]) !== expectedPage) return undefined;
      const total = Number(totalMatch[1]);
      if (!Number.isSafeInteger(total) || total > MAX_PLANS) fail("INVALID");
      return { total, pageNumber: expectedPage, nextDisabled: nextItems[0].classList.contains("ovui-page-turner__item--disabled"), rows,
        rowSignature: JSON.stringify(rows.map(row => [row.rowText, row.cellCount, row.names, row.ids, row.deletedTags])), account };
    }

    function prepareProductView() {
      const productTabs = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_1"]')).filter(element => visible(element, env) &&
        normalizeText(element.textContent) === "商品自选" && element.closest(".ovui-tabs__tab"));
      const managedTabs = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_2"]')).filter(element => visible(element, env) &&
        normalizeText(element.textContent) === "全店托管" && element.closest(".ovui-tabs__tab"));
      if (!productTabs.length && !managedTabs.length) return true;
      if (productTabs.length !== 1 || managedTabs.length !== 1) return false;
      const productTab = productTabs[0].closest(".ovui-tabs__tab");
      const managedTab = managedTabs[0].closest(".ovui-tabs__tab");
      if (productTab.classList.contains("ovui-tabs__tab--active")) return true;
      if (managedTab.classList.contains("ovui-tabs__tab--active") && !viewClickRequested) {
        viewClickRequested = true;
        productTabs[0].click();
      }
      return false;
    }

    function prepareCostControlView() {
      const controls = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_0"]')).filter(element => visible(element, env) &&
        normalizeText(element.textContent) === "控成本投放" && element.classList.contains("ovui-radio-item"));
      const broad = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom_7"]')).filter(element => visible(element, env) &&
        normalizeText(element.textContent).includes("放量投放") && element.classList.contains("ovui-radio-item"));
      if (!controls.length && !broad.length) return true;
      if (controls.length !== 1 || broad.length !== 1) return false;
      if (controls[0].classList.contains("ovui-radio-item--checked")) return true;
      if (broad[0].classList.contains("ovui-radio-item--checked") && !costClickRequested) {
        costClickRequested = true;
        controls[0].click();
      }
      return false;
    }

    let viewClickRequested = false;
    let costClickRequested = false;

    async function waitForInitialPage(expected, deadline, signal) {
      while (Date.now() < deadline) {
        checkCancelled(signal);
        accountForPlans(expected, expected.tabId, signal);
        if (prepareProductView() && prepareCostControlView()) {
          const page = readDomPage(expected, 1, signal);
          if (page && !(page.total > 0 && page.rows.length === 0)) return page;
        }
        await wait(100, signal);
      }
      fail("UNAVAILABLE");
    }

    async function waitForStablePage(expected, pageNumber, previousSignature, deadline, signal) {
      let previous;
      let stable = 0;
      while (Date.now() < deadline) {
        checkCancelled(signal);
        accountForPlans(expected, expected.tabId, signal);
        const page = readDomPage(expected, pageNumber, signal);
        if (page && (previousSignature === undefined || page.rowSignature !== previousSignature) && !(page.total > 0 && page.rows.length === 0)) {
          const signature = JSON.stringify(page);
          if (signature === previous) stable++;
          else { previous = signature; stable = 1; }
          if (stable >= 3) return page;
        } else { previous = undefined; stable = 0; }
        await wait(100, signal);
      }
      fail("UNAVAILABLE");
    }

    async function readPlans(expected, tabId, signal, budgetMs) {
      if (tabId !== expected.tabId) fail("CHANGED");
      if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 30_000) fail("INVALID");
      const deadline = Date.now() + budgetMs;
      let first = await waitForInitialPage(expected, deadline, signal);
      first = await waitForStablePage(expected, 1, undefined, deadline, signal);
      const check = () => {
        checkCancelled(signal);
        if (Date.now() >= deadline) fail("UNAVAILABLE");
        return accountForPlans(expected, tabId, signal);
      };
      let previousRowSignature = first.rowSignature;
      const next = async () => {
        check();
        const groups = Array.from(boundDocument.querySelectorAll('[data-e2e="oc_emptyKey_uni-prom__ocTable_pagination_group"]')).filter(element => visible(element, env));
        const items = groups.length === 1 ? Array.from(groups[0].querySelectorAll("li.ovui-page-turner__item:has(.ovui-page-turner__next-icon)")).filter(element => visible(element, env)) : [];
        if (items.length !== 1 || items[0].classList.contains("ovui-page-turner__item--disabled")) fail("CHANGED");
        await items[0].click();
        checkCancelled(signal);
      };
      return collectPlanCatalog(async pageNumber => {
        if (pageNumber === 1) return first;
        const page = await waitForStablePage(expected, pageNumber, previousRowSignature, deadline, signal);
        previousRowSignature = page.rowSignature;
        return page;
      }, next, check, expected.account.advertiserId, { maxPages: MAX_PAGES, maxPlans: MAX_PLANS });
    }

    async function handleMessage(message) {
      if (!isRecord(message) || typeof message.kind !== "string") fail("INVALID");
      if (message.kind === "cancel") {
        if (!exactKeys(message, ["kind", "id", "tabId"]) || !UUID_PATTERN.test(message.id) || !Number.isSafeInteger(message.tabId) || message.tabId < 0) fail("INVALID");
        const active = activeCommands.get(message.id);
        if (active && active.tabId === message.tabId) active.controller.abort();
        return { cancelled: !!active && active.tabId === message.tabId };
      }
      if (message.kind !== "command" || !UUID_PATTERN.test(message.id) || !Number.isSafeInteger(message.tabId) || message.tabId < 0 || !isRecord(message.operation)) fail("INVALID");
      const allowedKeys = ["kind", "id", "tabId", "operation"];
      if (Object.hasOwn(message, "picker")) allowedKeys.push("picker");
      if (Object.hasOwn(message, "budgetMs")) allowedKeys.push("budgetMs");
      if (!exactKeys(message, allowedKeys) || Object.hasOwn(message, "picker") && message.picker !== true) fail("INVALID");
      const operation = message.operation;
      if (message.picker && operation.kind !== "identity") fail("INVALID");
      if (Object.hasOwn(message, "budgetMs") && (operation.kind !== "plans" && !(operation.kind === "identity" && message.picker) || !Number.isSafeInteger(message.budgetMs) || message.budgetMs < 1 || message.budgetMs > 30_000)) fail("INVALID");
      if (activeCommands.has(message.id)) fail("INVALID");
      const controller = new env.AbortController();
      activeCommands.set(message.id, { controller, owner: "extension", tabId: message.tabId });
      try {
        checkCancelled(controller.signal);
        if (operation.kind === "identity" && exactKeys(operation, ["kind"])) return message.picker && message.budgetMs !== undefined
          ? await waitForPickerIdentity(message.tabId, message.budgetMs, controller.signal) : identity(message.tabId, message.picker === true);
        if (operation.kind === "request") return await readRequest(operation, message.tabId, controller.signal);
        if (operation.kind === "switch" && exactKeys(operation, ["kind", "snapshot", "chosen"])) return await switchAccount(operation, message.tabId, controller.signal);
        if (operation.kind === "plans" && exactKeys(operation, ["kind", "snapshot"])) return await readPlans(operation.snapshot, message.tabId, controller.signal, message.budgetMs);
        fail("INVALID");
      } finally { if (activeCommands.get(message.id)?.controller === controller) activeCommands.delete(message.id); }
    }

    async function handleAccountMessage(message) {
      if (!isRecord(message) || typeof message.kind !== "string") fail("INVALID");
      if (message.kind === "cancel") {
        if (!exactKeys(message, ["kind", "id"]) || !UUID_PATTERN.test(message.id)) fail("INVALID");
        const active = activeCommands.get(message.id);
        if (active?.owner === "cdp") active.controller.abort();
        return { cancelled: active?.owner === "cdp" };
      }
      if (message.kind !== "account-command" || !exactKeys(message, ["kind", "id", "operation"]) || !UUID_PATTERN.test(message.id) || !isRecord(message.operation) || activeCommands.has(message.id)) fail("INVALID");
      const operation = message.operation;
      if (operation.kind === "identity" && !exactKeys(operation, ["kind"]) ||
        operation.kind === "request" && !exactKeys(operation, ["kind", "snapshot", "path", "params", "headers"]) ||
        operation.kind === "switch" && !exactKeys(operation, ["kind", "snapshot", "chosen"]) ||
        !["identity", "request", "switch"].includes(operation.kind)) fail("INVALID");
      const controller = new env.AbortController();
      activeCommands.set(message.id, { controller, owner: "cdp" });
      try {
        checkCancelled(controller.signal);
        if (operation.kind === "identity") return accountIdentity();
        if (operation.kind === "request") return await readAccountRequest(operation, controller.signal, checkAccountSnapshot);
        if (operation.kind === "switch") return beginAccountSwitch(operation, checkAccountSnapshot(operation.snapshot), "/uni-prom");
        fail("INVALID");
      } finally { if (activeCommands.get(message.id)?.controller === controller) activeCommands.delete(message.id); }
    }

    // Identity observation grants no account request, navigation or upload authority.
    return { documentId, accountIdentity, readAccountIdentity: () => accountIdentity(false, undefined, true), handleMessage, handleAccountMessage };
  }

  global.__jianjiQianchuanContent = Object.freeze({ createContentController, projectAccountList: (data, page, limit) => {
    try { return parseAccountList(data, page, limit); } catch { fail("INVALID"); }
  }, collectPlanCatalog, QianchuanError });

  if (global.chrome?.runtime?.onMessage?.addListener) {
    const controller = createContentController(global);
    global.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const extensionId = global.chrome.runtime.id;
      const extensionUrl = (value, pathname) => {
        if (typeof value !== "string") return false;
        try {
          const url = new URL(value);
          return url.protocol === "chrome-extension:" && url.hostname === extensionId && !url.port && !url.username && !url.password &&
            (url.pathname === pathname || pathname === "/" && url.pathname === "") && !url.search && !url.hash;
        } catch { return false; }
      };
      const trustedSender = typeof extensionId === "string" && sender?.id === extensionId &&
        extensionUrl(sender.origin, "/") && extensionUrl(sender.url, "/background.js");
      const tabMatches = sender?.tab === undefined || Number.isSafeInteger(sender.tab?.id) && sender.tab.id === message?.tabId;
      if (!trustedSender || !tabMatches) { sendResponse({ ok: false, error: "CHANGED" }); return false; }
      void controller.handleMessage(message).then(value => sendResponse({ ok: true, value })).catch(error => {
        const code = ["UNAVAILABLE", "CHANGED", "INVALID"].includes(error?.code) ? error.code : "UNAVAILABLE";
        sendResponse({ ok: false, error: code });
      });
      return true;
    });
  }
})(globalThis);
