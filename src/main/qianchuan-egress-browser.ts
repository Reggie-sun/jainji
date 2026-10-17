import { setTimeout as delay } from "node:timers/promises";
import { egressIdentity, egressProxy, QIANCHUAN_EGRESS_PROBE_ENDPOINTS, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { runningChromeBrowsers, type RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { qianchuanEgressRuntime, type EgressLease } from "./qianchuan-egress-runtime.js";
import { BrowserEgressProbeError, probeChromeEgress } from "./qianchuan-egress-probe.js";
import { qianchuanRemoteRuntime } from "./qianchuan-remote-runtime.js";

export interface BrowserEgressPreparation {
  signal: AbortSignal;
  check: () => void | Promise<void>;
}

const PREPARED_PROBE_BACKOFF_MS = [1_000, 2_000] as const;
const PREPARED_PROBE_ATTEMPTS = PREPARED_PROBE_BACKOFF_MS.length + 1;

function browserIdentity(browser: RunningChromeBrowser): string {
  return JSON.stringify([browser.endpoint, browser.profile, browser.profileDirectory, browser.windowClass,
    browser.processId, browser.startedAt, browser.egressArguments ?? []]);
}

function hasStrongProcessIdentity(browser: RunningChromeBrowser): boolean {
  return Number.isSafeInteger(browser.processId) && (browser.processId ?? 0) > 0 &&
    typeof browser.startedAt === "string" && /^[0-9]+$/.test(browser.startedAt);
}

async function preparedBrowser(endpoint: string, route: QianchuanEgress, browsers: typeof runningChromeBrowsers): Promise<RunningChromeBrowser> {
  const matches = (await browsers()).filter(browser => browser.endpoint === endpoint);
  if (matches.length !== 1 || matches[0].connectionIssue) throw new Error("无法唯一验证账号浏览器的固定出口。");
  assertEgressArguments(matches[0], route);
  return matches[0];
}

async function checkPreparation(preparation: BrowserEgressPreparation): Promise<void> {
  preparation.signal.throwIfAborted();
  await preparation.check();
  preparation.signal.throwIfAborted();
}

async function verifyPreparedBrowserEgress(
  endpoint: string,
  route: QianchuanEgress,
  browsers: typeof runningChromeBrowsers,
  preparation: BrowserEgressPreparation,
): Promise<EgressLease> {
  const preparedRoute = Object.freeze({ ...route });
  const expectedIp = preparedRoute.expectedIp;
  const routeIdentity = egressIdentity(preparedRoute);
  let initialBrowserIdentity: string | undefined;
  let initialLease: EgressLease | undefined;

  for (let attempt = 0; attempt < PREPARED_PROBE_ATTEMPTS; attempt++) {
    await checkPreparation(preparation);
    initialLease?.signal.throwIfAborted();

    const browser = await preparedBrowser(endpoint, preparedRoute, browsers);
    const currentBrowserIdentity = browserIdentity(browser);
    if (initialBrowserIdentity === undefined) initialBrowserIdentity = currentBrowserIdentity;
    else if (currentBrowserIdentity !== initialBrowserIdentity) throw new Error("账号浏览器身份或固定出口已变化，未执行自动化。");

    await checkPreparation(preparation);
    initialLease?.signal.throwIfAborted();
    const lease = await qianchuanEgressRuntime.verify(preparedRoute);
    if (lease.identity !== routeIdentity) throw new Error("固定出口租约与准备中的账号配置不一致。");
    if (initialLease === undefined) initialLease = lease;
    else if (lease !== initialLease) throw new Error("固定出口租约已变化，未执行自动化。");
    lease.signal.throwIfAborted();
    await checkPreparation(preparation);
    lease.signal.throwIfAborted();

    const activeSignal = AbortSignal.any([preparation.signal, lease.signal]);
    try {
      await probeChromeEgress(endpoint, expectedIp, activeSignal, attempt);
    } catch (error) {
      if (!(error instanceof BrowserEgressProbeError) || !error.retryable) throw error;
      await checkPreparation(preparation);
      lease.signal.throwIfAborted();
      if (attempt + 1 >= PREPARED_PROBE_ATTEMPTS || !hasStrongProcessIdentity(browser)) throw error;
      await delay(PREPARED_PROBE_BACKOFF_MS[attempt], undefined, { signal: activeSignal });
      await checkPreparation(preparation);
      lease.signal.throwIfAborted();
      continue;
    }

    await checkPreparation(preparation);
    lease.signal.throwIfAborted();
    const confirmedBrowser = await preparedBrowser(endpoint, preparedRoute, browsers);
    if (browserIdentity(confirmedBrowser) !== initialBrowserIdentity) throw new Error("账号浏览器身份或固定出口已变化，未执行自动化。");
    await checkPreparation(preparation);
    lease.signal.throwIfAborted();
    return lease;
  }

  throw new Error("账号浏览器固定出口校验失败，未执行自动化。");
}

export function chromeEgressArguments(route: QianchuanEgress): string[] {
  return [`--proxy-server=${egressProxy(route)}`, "--proxy-bypass-list=<-loopback>", "--disable-quic",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];
}
export function assertEgressArguments(browser: RunningChromeBrowser, route?: QianchuanEgress): void {
  const actual = browser.egressArguments ?? [], expected = route ? chromeEgressArguments(route) : [];
  // Legacy Chrome may have unrelated flags; an explicit proxy cannot stand in for a frozen direct route.
  if (!route && !actual.some(arg => ["--proxy-server", "--proxy-pac-url", "--proxy-auto-detect"].some(flag => arg === flag || arg.startsWith(`${flag}=`)))) return;
  const compatible = route && actual.includes("--disable-extensions") ? [...expected, "--disable-extensions"] : expected;
  if (actual.length !== compatible.length || compatible.some(arg => !actual.includes(arg))) throw new Error("账号浏览器的固定出口与配置不一致，未执行自动化。请先关闭该账号浏览器，核查设置后重启并连接。");
}
export async function verifyBrowserEgress(endpoint: string, route?: QianchuanEgress, browsers = runningChromeBrowsers,
  preparation?: BrowserEgressPreparation, attempt = 0): Promise<EgressLease | undefined> {
  if (route?.mode === "remote-browser") return qianchuanRemoteRuntime.verify(endpoint, route);
  if (route && (!Number.isInteger(attempt) || attempt < 0 || attempt >= QIANCHUAN_EGRESS_PROBE_ENDPOINTS.length)) {
    throw new BrowserEgressProbeError(false);
  }
  if (preparation && route) return verifyPreparedBrowserEgress(endpoint, route, browsers, preparation);
  const matches = (await browsers()).filter(browser => browser.endpoint === endpoint);
  if (matches.length !== 1 || matches[0].connectionIssue) throw new Error("无法唯一验证账号浏览器的固定出口。");
  assertEgressArguments(matches[0], route);
  if (!route) return;
  const lease = await qianchuanEgressRuntime.verify(route);
  await probeChromeEgress(endpoint, route.expectedIp, lease.signal, attempt);
  return lease;
}
