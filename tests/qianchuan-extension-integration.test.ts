import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { QianchuanExtensionBridge } from "../src/main/qianchuan-extension-bridge";
import { QianchuanExtensionCatalog } from "../src/main/qianchuan-extension-catalog";
import { installQianchuanExtensionHost } from "../src/main/qianchuan-extension-install";
import { verifyExtensionProcess } from "../src/main/qianchuan-extension-process";
import type { ExtensionCall, ExtensionSnapshot } from "../src/main/qianchuan-extension-protocol";
import { QIANCHUAN_EXTENSION_ID } from "../src/main/qianchuan-extension-protocol";
import {
  createQianchuanFixture,
  FIXTURE_ACCOUNTS,
  FIXTURE_HOST,
  FIXTURE_PLANS,
  launchBoundedChrome,
  startXvfb,
  type ManagedChrome,
  type QianchuanFixture,
  type XServer,
} from "./helpers/qianchuan-extension-fixture";

const FIXTURE_FLAG = "JIANJI_QIANCHUAN_CHROME_FIXTURE";
const CHROME_BINARY = "JIANJI_QIANCHUAN_CHROME_BINARY";
const bridges: QianchuanExtensionBridge[] = [];
afterEach(() => bridges.splice(0).forEach(bridge => bridge.dispose()));

async function findFixtureChrome(): Promise<string> {
  const configured = process.env[CHROME_BINARY];
  if (configured) {
    const binary = path.resolve(configured);
    try {
      const info = await stat(binary);
      await access(binary, constants.X_OK);
      if (info.isFile()) return binary;
    } catch { /* Report a bounded fixture blocker below. */ }
    throw new Error(`BLOCKED: ${CHROME_BINARY} must name an executable Chrome for Testing binary.`);
  }

  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  let builds: Array<{ name: string; path: string }>;
  try {
    builds = (await readdir(cache, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^chromium-[0-9]+$/.test(entry.name))
      .map(entry => ({ name: entry.name, path: path.join(cache, entry.name) }))
      .sort((left, right) => Number(right.name.slice("chromium-".length)) - Number(left.name.slice("chromium-".length)))
      .slice(0, 32);
  } catch {
    throw new Error(`BLOCKED: set ${CHROME_BINARY} or provide a Chrome for Testing binary under ${cache}.`);
  }
  for (const build of builds) {
    const platforms = (await readdir(build.path, { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory() && /^chrome-linux[^/]*$/.test(entry.name));
    for (const platform of platforms) {
      const binary = path.join(build.path, platform.name, "chrome");
      try {
        const info = await stat(binary);
        await access(binary, constants.X_OK);
        if (info.isFile()) return binary;
      } catch { /* Try the next bounded candidate. */ }
    }
  }
  throw new Error(`BLOCKED: set ${CHROME_BINARY} or provide an executable under one of the newest 32 ${cache}/chromium-* builds.`);
}

async function waitForConnection(bridge: QianchuanExtensionBridge, profile: string, chrome: ManagedChrome) {
  const deadline = Date.now() + 18_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { return await bridge.connection("local", profile, "Default"); }
    catch (error) {
      lastError = error;
      if (chrome.child.exitCode !== null || chrome.child.signalCode !== null) {
        throw new Error(`fixture Chrome exited before native connection: ${chrome.stderr() || String(error)}`);
      }
      await delay(150);
    }
  }
  throw new Error(`fixture Chrome did not connect to the native host: ${chrome.stderr() || String(lastError)}`);
}

describe("Qianchuan extension in isolated Chromium", () => {
  it("reads accounts, switches once, reads plans, and cancels only its owned picker tab", async () => {
    if (process.env[FIXTURE_FLAG] !== "1") {
      throw new Error(`BLOCKED: this required integration check needs ${FIXTURE_FLAG}=1 and the isolated local fixture; it does not skip.`);
    }

    const binary = await findFixtureChrome();
    const extensionDirectory = path.resolve("resources/qianchuan-extension");
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jianji-qianchuan-extension-fixture-"));
    const profile = path.join(temporaryRoot, "chrome-profile");
    const runtimeRoot = path.join(temporaryRoot, "runtime");
    let fixture: QianchuanFixture | undefined;
    let xserver: XServer | undefined;
    let chrome: ManagedChrome | undefined;
    let bridge: QianchuanExtensionBridge | undefined;

    try {
      await Promise.all([
        mkdir(profile, { recursive: true, mode: 0o700 }),
        mkdir(runtimeRoot, { recursive: true, mode: 0o700 }),
      ]);
      await mkdir(path.join(profile, "Default"), { mode: 0o700 });
      fixture = await createQianchuanFixture(path.join(temporaryRoot, "fixture"));
      xserver = await startXvfb();
      bridge = new QianchuanExtensionBridge(temporaryRoot, verifyExtensionProcess, (root, config) => installQianchuanExtensionHost(root, config, {
        profiles: [profile],
        resources: extensionDirectory,
        executable: process.execPath,
      }));
      bridges.push(bridge);
      await bridge.start();

      const environment: NodeJS.ProcessEnv = { ...process.env, DISPLAY: xserver.display };
      delete environment.WAYLAND_DISPLAY;
      const initialUrl = `https://${FIXTURE_HOST}/?aavid=${FIXTURE_ACCOUNTS[0].advertiserId}`;
      chrome = launchBoundedChrome(binary, [
        `--load-extension=${extensionDirectory}`,
        `--user-data-dir=${profile}`,
        "--profile-directory=Default",
        `--proxy-server=http://127.0.0.1:${fixture.proxyPort}`,
        `--host-resolver-rules=MAP ${FIXTURE_HOST} 127.0.0.1,MAP * ~NOTFOUND,EXCLUDE 127.0.0.1,EXCLUDE localhost`,
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        `--ignore-certificate-errors-spki-list=${fixture.certificateSpki}`,
        initialUrl,
      ], environment, 53_000);

      try {
        await fixture.waitFor(() => fixture!.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[0].advertiserId) === 1, "initial account document");
      } catch (error) {
        throw new Error(`${String(error)}; chromeExit=${chrome.child.exitCode ?? chrome.child.signalCode ?? "running"}; stderr=${chrome.stderr()}; rejectedProxyTargets=${JSON.stringify(fixture.state.rejectedProxyTargets)}`);
      }
      await delay(300);
      const connection = await waitForConnection(bridge, profile, chrome);
      const first = await connection.call({ kind: "identity" }) as ExtensionSnapshot;
      expect(first.account).toEqual(FIXTURE_ACCOUNTS[0]);

      let switchCalls = 0;
      const call: ExtensionCall = (operation, signal) => {
        if (operation.kind === "switch") switchCalls++;
        return connection.call(operation, signal);
      };
      const catalog = new QianchuanExtensionCatalog(call);
      const accounts = await catalog.accounts(first, new AbortController().signal);
      expect(accounts).toEqual({ current: FIXTURE_ACCOUNTS[0], accounts: [...FIXTURE_ACCOUNTS] });

      const second = await catalog.switch(first, FIXTURE_ACCOUNTS[1].advertiserId, new AbortController().signal, async () => {});
      expect(second.tabId).toBe(first.tabId);
      expect(second.documentId).not.toBe(first.documentId);
      expect(second.account).toEqual(FIXTURE_ACCOUNTS[1]);
      expect(switchCalls).toBe(1);
      expect(fixture.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[1].advertiserId)).toBe(1);

      const plans = await catalog.plans(second, new AbortController().signal);
      expect(plans).toEqual([FIXTURE_PLANS[1]]);
      await fixture.waitFor(() => fixture!.state.closedPlanPages.includes(1), "successful owned plan tab cleanup");

      const cancellation = new AbortController();
      const pendingPlans = connection.call({ kind: "plans", snapshot: second }, cancellation.signal);
      await fixture.waitFor(() => fixture!.state.planPageLoads >= 2, "second owned plan tab");
      await delay(300);
      cancellation.abort();
      await expect(pendingPlans).rejects.toThrow();
      await fixture.waitFor(() => fixture!.state.closedPlanPages.includes(2), "cancelled owned plan tab cleanup");
      expect(await connection.call({ kind: "identity" })).toEqual(second);

      expect(fixture.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[0].advertiserId)).toBe(1);
      expect(fixture.state.accountDocumentLoads.get(FIXTURE_ACCOUNTS[1].advertiserId)).toBe(1);
      expect(fixture.state.apiRequests.length).toBeGreaterThan(0);
      expect(new Set(fixture.state.apiRequests.map(request => request.path))).toEqual(new Set([
        "/ad/api/v1/account/user/info",
        "/ad/api/v1/account/user-list",
      ]));
      expect(fixture.state.apiRequests.every(request => request.csrf === "fixture-only-csrf" && request.signed)).toBe(true);
      expect(fixture.state.acceptedProxyTargets.length).toBeGreaterThan(0);
      expect(fixture.state.acceptedProxyTargets.every(target => target === `${FIXTURE_HOST}:443`)).toBe(true);
    } finally {
      await chrome?.stop();
      bridge?.dispose();
      await xserver?.stop();
      await fixture?.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
