import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { DouyinCdpUploader, type DouyinPageContract } from "../../src/main/douyin-cdp-uploader.js";
import { DouyinUploadService } from "../../src/main/douyin-upload-service.js";
import { DouyinUploadStore } from "../../src/main/douyin-upload-store.js";
import { now, type QueueState } from "../../src/main/domain.js";
import { DouyinUploadConfigSchema, type UploadIdentity } from "../../src/shared/douyin-upload.js";

const chromeCandidates = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"];

export async function resolveChromeExecutable(preferred?: string): Promise<string> {
  for (const candidate of preferred ? [preferred] : chromeCandidates) {
    try {
      await access(candidate);
      execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 5000 });
      return candidate;
    } catch { /* Try the next installed system browser. */ }
  }
  if (preferred) throw new Error(`UNVERIFIED: configured Chrome binary is unavailable: ${preferred}`);
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const executable = execFileSync("sh", ["-c", `command -v ${candidate}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
      if (executable) { execFileSync(executable, ["--version"], { stdio: "ignore", timeout: 5000 }); return executable; }
    } catch { /* Keep searching known browser names. */ }
  }
  throw new Error("UNVERIFIED: Google Chrome/Chromium is required for the isolated CDP fixture");
}

interface FixtureOptions {
  chromeExecutable: string;
  fixtureHtml: string;
  tempRoot: string;
  queueState: QueueState;
  packagedAttach?: (input: { cdpEndpoint: string; uploadUrl: string }) => Promise<Record<string, unknown>>;
}

interface FixtureState {
  mode: "normal" | "unknown" | "challenge" | "waiting" | "rejection";
  acceptedId?: string;
  fileSelections: Array<{ name: string; size: number }>;
  publishMarkers: boolean[];
  managementIds: string[];
}

async function bodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function waitFor<T>(read: () => T | Promise<T>, description: string, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`UNVERIFIED: timed out waiting for ${description}`);
}

async function startChrome(executable: string, profile: string): Promise<{ child: ChildProcess; endpoint: string; originalTargetId: string }> {
  await mkdir(profile, { recursive: true });
  const args = [
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions",
    "about:blank",
  ];
  const childEnvironment = {
    PATH: process.env.PATH,
    ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    HOME: profile,
    XDG_CONFIG_HOME: path.join(profile, "config"),
    XDG_CACHE_HOME: path.join(profile, "cache"),
    XDG_DATA_HOME: path.join(profile, "data"),
  };
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], env: childEnvironment });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8000); });
  try {
    const activePort = path.join(profile, "DevToolsActivePort");
    let endpoint = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`UNVERIFIED: isolated Chrome exited before CDP startup (${child.exitCode}): ${stderr}`);
      try {
        const [portText] = (await readFile(activePort, "utf8")).trim().split("\n");
        const port = Number(portText);
        if (Number.isInteger(port) && port > 0 && port <= 65535) { endpoint = `http://127.0.0.1:${port}`; break; }
      } catch { /* Chrome has not published its ephemeral port yet. */ }
      await delay(100);
    }
    if (!endpoint) throw new Error(`UNVERIFIED: isolated Chrome did not publish DevToolsActivePort: ${stderr}`);
    const pages = await waitFor(async () => {
      const response = await fetch(`${endpoint}/json/list`).catch(() => undefined);
      if (!response?.ok) return undefined;
      return (await response.json()) as Array<{ id: string; type: string; url: string }>;
    }, "Chrome's initial tab");
    assert.ok(pages);
    const initial = pages.find(page => page.type === "page" && page.url === "about:blank");
    assert.ok(initial?.id, "isolated Chrome starts with an original about:blank tab");
    return { child, endpoint, originalTargetId: initial.id };
  } catch (error) { await stopChrome(child); throw error; }
}

async function stopChrome(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), delay(2000)]);
  if (child.exitCode === null) { child.kill("SIGKILL"); await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), delay(1000)]); }
}

function cloneBatchFor(queueState: QueueState, batchId: string, taskId: string): QueueState {
  const copy = structuredClone(queueState);
  const source = copy.batch.tasks.find(task => task.status === "completed" && task.outputArtifact && task.outputPath);
  assert.ok(source?.outputArtifact, "fixture uses a completed real MP4 artifact");
  const clonedTask = { ...source, id: taskId, batchId, outputArtifact: { ...source.outputArtifact, taskId } };
  copy.batch = { ...copy.batch, id: batchId, status: "completed", tasks: [clonedTask] };
  copy.revision += 1;
  copy.updatedAt = now();
  return copy;
}

export async function runDouyinCdpFixture(options: FixtureOptions): Promise<Record<string, unknown>> {
  const state: FixtureState = { mode: "normal", fileSelections: [], publishMarkers: [], managementIds: [] };
  let currentMarkerCheck: () => Promise<boolean> = async () => false;
  const html = await readFile(options.fixtureHtml, "utf8");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void (async () => {
      if (request.method === "GET" && url.pathname === "/state") { json(response, 200, { mode: state.mode, acceptedId: state.acceptedId }); return; }
      if (request.method === "POST" && url.pathname === "/events/file-selected") {
        const value = JSON.parse(await bodyText(request)) as { name: string; size: number };
        state.fileSelections.push(value); response.writeHead(204).end(); return;
      }
      if (request.method === "POST" && url.pathname === "/publish") {
        await bodyText(request);
        const markerExists = await currentMarkerCheck();
        state.publishMarkers.push(markerExists);
        if (!markerExists) { json(response, 409, { error: "submit marker missing" }); return; }
        state.acceptedId = `offline-content-${state.publishMarkers.length}`;
        json(response, 200, { id: state.acceptedId }); return;
      }
      if (request.method === "GET" && (url.pathname === "/upload" || url.pathname.startsWith("/management/"))) {
        if (url.pathname.startsWith("/management/")) state.managementIds.push(decodeURIComponent(url.pathname.slice("/management/".length)));
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(html); return;
      }
      response.writeHead(404).end("not found");
    })().catch(error => { if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : "fixture error" }); else response.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const contract: DouyinPageContract = {
    version: "offline-fixture/1",
    uploadUrl: `${origin}/upload`,
    fileSelectionDoesNotPublish: true,
    captionLimit: 256,
    file: "#video-file", caption: "#caption", ready: "#ready", publish: "#publish",
    login: "#login", challenge: "#challenge", account: "#account", rejection: "#rejected",
    accepted: "#accepted", contentIdAttribute: "data-content-id", statusAttribute: "data-status",
    managementUrl: id => `${origin}/management/${encodeURIComponent(id)}`,
    evidenceUrl: id => `https://creator.douyin.com/offline-fixture/${id}`,
  };
  const chrome = await startChrome(options.chromeExecutable, path.join(options.tempRoot, "chrome-profile"));
  const chromeVersion = execFileSync(options.chromeExecutable, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  let serverClosed = false;
  const closeServer = async () => {
    if (serverClosed) return; serverClosed = true;
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  const base = options.queueState;
  const completedTask = base.batch.tasks.find(task => task.status === "completed" && task.outputArtifact && task.outputPath);
  assert.ok(completedTask?.outputArtifact, "Electron leg must provide its actual completed export");
  const projectId = base.batch.projectId;
  assert.ok(projectId, "completed export is bound to a desktop project");
  let packagedAttach: Record<string, unknown> | undefined;
  try {
    if (options.packagedAttach) packagedAttach = await options.packagedAttach({ cdpEndpoint: chrome.endpoint, uploadUrl: contract.uploadUrl });
  } catch (error) {
    await stopChrome(chrome.child);
    await closeServer();
    throw error;
  }
  const config = DouyinUploadConfigSchema.parse({
    enabled: true,
    cdpEndpoint: chrome.endpoint,
    timeouts: { connect: 8000, navigation: 8000, fileInput: 8000, processing: 4000, action: 5000, confirmation: 1800 },
    captureFailureDiagnostics: false,
  });
  const makeHarness = async (name: string, queueStates: QueueState[]) => {
    const store = new DouyinUploadStore(path.join(options.tempRoot, name));
    await store.load(); await store.setConfig(config);
    const byBatch = new Map(queueStates.map(value => [value.batch.id, value]));
    let browserFactoryCalls = 0;
    const service = new DouyinUploadService(store, {
      loadBatch: async id => { const value = byBatch.get(id); if (!value) throw new Error("missing fixture queue state"); return structuredClone(value); },
      browser: () => { browserFactoryCalls++; return new DouyinCdpUploader(contract); },
    });
    return { root: store.root, store, service, browserFactoryCalls: () => browserFactoryCalls, addState: (value: QueueState) => byBatch.set(value.batch.id, value) };
  };
  const identityFor = (queue: QueueState): UploadIdentity => ({ project_id: projectId, batch_id: queue.batch.id, export_task_id: queue.batch.tasks[0].id });
  const actualQueue = structuredClone(base);
  const success = await makeHarness("fixture-success-store", [actualQueue]);
  let successTaskId = "";
  let unknownHarness: Awaited<ReturnType<typeof makeHarness>> | undefined;
  let challengeHarness: Awaited<ReturnType<typeof makeHarness>> | undefined;
  let stopHarness: Awaited<ReturnType<typeof makeHarness>> | undefined;
  try {
    await success.service.registerIntent(identityFor(actualQueue), { enabled: true, caption: "离线测试发布文案" });
    const successTask = await success.service.enqueueFinalArtifact(identityFor(actualQueue));
    assert.ok(successTask, "actual Electron export enters upload admission");
    successTaskId = successTask.result.upload_task_id;
    currentMarkerCheck = async () => {
      const task = success.store.task(successTaskId);
      if (!task || !success.store.hasMarker(successTaskId) || task.result.state !== "SUBMITTING") return false;
      await access(path.join(success.root, "markers", `${successTaskId}.json`));
      return true;
    };
    await success.service.runPending();
    const completed = success.service.status(projectId).tasks.find(task => task.upload_task_id === successTaskId);
    assert.equal(completed?.state, "SUCCEEDED", "fixture acceptance requires the real adapter's same-ID management evidence");
    assert.equal(completed?.success?.confirmation_source, "browser");
    assert.equal(completed?.success?.platform_content_id, state.acceptedId);
    assert.deepEqual(state.managementIds, [state.acceptedId], "accepted content is reopened at its same-ID management route");
    assert.deepEqual(state.publishMarkers, [true], "the durable marker exists before the fixture receives the publish click");
    assert.equal(state.fileSelections.length, 1, "the adapter transfers one private artifact snapshot to the local form");

    const screenshotPath = path.join(options.tempRoot, "offline-fixture.png");
    const observer = await chromium.connectOverCDP(chrome.endpoint);
    try {
      const page = observer.contexts()[0]?.pages().find(value => value.url().startsWith(origin));
      assert.ok(page, "synthetic fixture tab remains open for screenshot evidence");
      await page.screenshot({ path: screenshotPath });
    } finally { await observer.close(); }

    await success.service.resume(successTaskId);
    assert.equal(state.publishMarkers.length, 1, "resuming an accepted task cannot publish again");
    await success.service.stop();

    const restoredStore = new DouyinUploadStore(success.root); await restoredStore.load();
    let restoredBrowserFactories = 0;
    const restoredStates = new Map([[actualQueue.batch.id, actualQueue]]);
    const restored = new DouyinUploadService(restoredStore, {
      loadBatch: async id => { const value = restoredStates.get(id); if (!value) throw new Error("missing restored fixture batch"); return structuredClone(value); },
      browser: () => { restoredBrowserFactories++; return new DouyinCdpUploader(contract); },
    });
    await restored.reconcile(); await restored.runPending();
    assert.equal(restoredBrowserFactories, 0, "startup reconciliation never connects to Chrome");
    await restored.resume(successTaskId);
    assert.equal(state.publishMarkers.length, 1, "restarted accepted task cannot publish again");

    const duplicateQueue = cloneBatchFor(actualQueue, crypto.randomUUID(), crypto.randomUUID());
    const duplicateTask = duplicateQueue.batch.tasks[0];
    assert.equal(duplicateTask.outputPath, completedTask.outputPath);
    assert.equal(duplicateTask.outputArtifact?.path, completedTask.outputArtifact.path);
    const duplicateIdentity = identityFor(duplicateQueue);
    await restored.registerIntent(duplicateIdentity, { enabled: true, caption: "离线测试发布文案" });
    // Reconcile the new formal task through the same durable-artifact admission path.
    restoredStates.set(duplicateQueue.batch.id, duplicateQueue);
    const admittedDuplicate = await restored.enqueueFinalArtifact(duplicateIdentity);
    assert.ok(admittedDuplicate);
    await restored.runPending();
    const duplicate = restored.status(projectId).tasks.find(task => task.export_task_id === duplicateIdentity.export_task_id);
    assert.equal(duplicate?.duplicate_of, successTaskId, "same bytes and caption resolve to the accepted original");
    assert.equal(state.publishMarkers.length, 1, "a byte-identical new task cannot publish again");
    assert.equal(restoredBrowserFactories, 0, "same-byte duplicate resolution does not construct a browser adapter");
    await restored.stop();

    const unknownQueue = cloneBatchFor(actualQueue, crypto.randomUUID(), crypto.randomUUID());
    state.mode = "unknown"; state.acceptedId = undefined;
    unknownHarness = await makeHarness("fixture-unknown-store", [unknownQueue]);
    const unknownIdentity = identityFor(unknownQueue);
    await unknownHarness.service.registerIntent(unknownIdentity, { enabled: true, caption: "离线未知结果文案" });
    const unknownTask = await unknownHarness.service.enqueueFinalArtifact(unknownIdentity);
    assert.ok(unknownTask);
    currentMarkerCheck = async () => {
      const task = unknownHarness!.store.task(unknownTask.result.upload_task_id);
      if (!task || !unknownHarness!.store.hasMarker(unknownTask.result.upload_task_id) || task.result.state !== "SUBMITTING") return false;
      await access(path.join(unknownHarness!.root, "markers", `${unknownTask.result.upload_task_id}.json`)); return true;
    };
    const publishesBeforeUnknown = state.publishMarkers.length;
    await unknownHarness.service.runPending();
    const unknown = unknownHarness.service.status(projectId).tasks.find(task => task.upload_task_id === unknownTask.result.upload_task_id);
    assert.equal(state.publishMarkers.length, publishesBeforeUnknown + 1);
    assert.equal(state.publishMarkers.at(-1), true);
    assert.deepEqual(unknown && { state: unknown.state, publish_outcome: unknown.publish_outcome, failure: unknown.failure?.code }, { state: "NEEDS_HUMAN", publish_outcome: "MAY_HAVE_SUBMITTED", failure: "PUBLISH_OUTCOME_UNKNOWN" });
    await unknownHarness.service.stop();

    const unknownRestoredStore = new DouyinUploadStore(unknownHarness.root); await unknownRestoredStore.load();
    let unknownResumeFactories = 0;
    const unknownRestored = new DouyinUploadService(unknownRestoredStore, {
      loadBatch: async () => structuredClone(unknownQueue),
      browser: () => { unknownResumeFactories++; return new DouyinCdpUploader(contract); },
    });
    await unknownRestored.reconcile(); await unknownRestored.runPending();
    assert.equal(unknownResumeFactories, 0, "unknown marked task is not resumed on startup");
    await unknownRestored.resume(unknownTask.result.upload_task_id);
    assert.equal(state.publishMarkers.length, publishesBeforeUnknown + 1, "explicit resume of an unknown marker remains read-only");
    assert.equal(unknownRestored.status(projectId).tasks.find(task => task.upload_task_id === unknownTask.result.upload_task_id)?.publish_outcome, "MAY_HAVE_SUBMITTED");
    await unknownRestored.stop();

    const challengeQueue = cloneBatchFor(actualQueue, crypto.randomUUID(), crypto.randomUUID());
    state.mode = "challenge"; state.acceptedId = undefined;
    challengeHarness = await makeHarness("fixture-challenge-store", [challengeQueue]);
    const challengeIdentity = identityFor(challengeQueue);
    await challengeHarness.service.registerIntent(challengeIdentity, { enabled: true, caption: "挑战页不提交" });
    const challengeTask = await challengeHarness.service.enqueueFinalArtifact(challengeIdentity);
    assert.ok(challengeTask);
    const publishesBeforeChallenge = state.publishMarkers.length;
    await challengeHarness.service.runPending();
    const challenge = challengeHarness.service.status(projectId).tasks.find(task => task.upload_task_id === challengeTask.result.upload_task_id);
    assert.equal(challenge?.failure?.code, "CHALLENGE_REQUIRED");
    assert.equal(challenge?.publish_outcome, "NOT_SUBMITTED");
    assert.equal(state.publishMarkers.length, publishesBeforeChallenge, "challenge is detected before the durable submission fence");
    assert.equal(challengeHarness.store.hasMarker(challengeTask.result.upload_task_id), false);
    await challengeHarness.service.stop();

    const stopQueue = cloneBatchFor(actualQueue, crypto.randomUUID(), crypto.randomUUID());
    state.mode = "waiting"; state.acceptedId = undefined;
    stopHarness = await makeHarness("fixture-stop-store", [stopQueue]);
    const stopIdentity = identityFor(stopQueue);
    await stopHarness.service.registerIntent(stopIdentity, { enabled: true, caption: "停止后不能迟到发布" });
    const stopTask = await stopHarness.service.enqueueFinalArtifact(stopIdentity);
    assert.ok(stopTask);
    const fileSelectionsBeforeStop = state.fileSelections.length;
    const publishesBeforeStop = state.publishMarkers.length;
    const pendingRun = stopHarness.service.runPending();
    await waitFor(() => state.fileSelections.length > fileSelectionsBeforeStop, "fixture file selection before stop");
    await stopHarness.service.cancel(stopTask.result.upload_task_id);
    await pendingRun;
    state.mode = "normal";
    await delay(400);
    const stopped = stopHarness.service.status(projectId).tasks.find(task => task.upload_task_id === stopTask.result.upload_task_id);
    assert.equal(stopped?.state, "CANCELLED");
    assert.equal(stopHarness.store.hasMarker(stopTask.result.upload_task_id), false);
    assert.equal(state.publishMarkers.length, publishesBeforeStop, "stopping during processing prevents any late publish click");
    await stopHarness.service.stop();

    const chromePages = await fetch(`${chrome.endpoint}/json/list`).then(response => response.json()) as Array<{ id: string; type: string; url: string }>;
    assert.equal(chrome.child.exitCode, null, "adapter detach leaves the isolated Chrome process running");
    assert.ok(chromePages.some(page => page.id === chrome.originalTargetId && page.url === "about:blank"), "adapter detach preserves Chrome's original tab");
    assert.ok(chromePages.some(page => page.type === "page" && page.url.startsWith(`${origin}/`)), "fixture task tab remains open for human inspection");
    assert.ok(state.managementIds.every(id => id === state.acceptedId || id.startsWith("offline-content-")));

    return {
      result: "PASS",
      chrome: { executable: options.chromeExecutable, version: chromeVersion, isolatedProfile: true, originalTargetPreserved: chrome.originalTargetId, processStillRunning: true },
      ...(packagedAttach ? { packagedPlaywrightAttach: packagedAttach } : {}),
      fixture: { publishRequests: state.publishMarkers.length, markerDurableBeforeEveryPublish: state.publishMarkers.every(Boolean), sameIdManagementVisits: state.managementIds, fileSelections: state.fileSelections.length, screenshotPath },
      success: { uploadTaskId: successTaskId, contentId: completed?.success?.platform_content_id, acceptedStatus: completed?.success?.accepted_status },
      duplicate: { uploadTaskId: duplicate?.upload_task_id, duplicateOf: duplicate?.duplicate_of },
      unknown: { state: unknown?.state, outcome: unknown?.publish_outcome, resumeDidNotRepublish: true },
      challenge: { state: challenge?.state, failure: challenge?.failure?.code, markerAbsent: true },
      stop: { state: stopped?.state, markerAbsent: true, noLatePublish: true },
    };
  } finally {
    await Promise.allSettled([success.service.stop(), unknownHarness?.service.stop(), challengeHarness?.service.stop(), stopHarness?.service.stop()]);
    await stopChrome(chrome.child);
    await closeServer();
  }
}
