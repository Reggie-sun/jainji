import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DouyinCdpUploader } from "../../src/main/douyin-cdp-uploader.js";
import { PRODUCTION_QIANCHUAN_CONTRACT, type QianchuanPageContract } from "../../src/main/qianchuan-page-contract.js";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../../src/main/douyin-upload-store.js";
import { now, type QueueState } from "../../src/main/domain.js";
import { QianchuanUploadConfigSchema } from "../../src/shared/douyin-upload.js";

const chromeCandidates = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome"];
const defaultControls: QianchuanFixtureControls = { screen: "normal", capacity: 10, readyState: "ready" };

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

export interface QianchuanFixtureControls {
  screen?: "normal" | "login" | "challenge";
  capacity?: number;
  readyState?: "ready" | "processing" | "failed";
  processingDelayMs?: number;
  rowAppearanceDelayMs?: number;
  pendingName?: string;
  successVisibility?: "hidden" | "collapse";
  reorderRows?: boolean;
  unknownName?: string;
  extraRow?: boolean;
  removeName?: string;
  selectedCountOverride?: number;
  wrongDrawerPlan?: boolean;
  wrongGlobalPlan?: boolean;
  duplicateAddButton?: boolean;
  duplicateDropTarget?: boolean;
  wrongAdvertiser?: boolean;
  wrongPlan?: boolean;
  duplicateUpload?: boolean;
  duplicateConfirm?: boolean;
  drift?: boolean;
  failure?: boolean;
}
export interface QianchuanFixtureEvent {
  type: string; control?: string; names?: string[]; name?: string; scope?: string; selectedCount?: string;
  rows?: Array<{ name: string; ready: boolean }>; cancelVisible?: boolean; confirmEnabled?: boolean;
}
export interface QianchuanFixture {
  contract: QianchuanPageContract;
  cdpEndpoint: string;
  uploadUrl: string;
  originalTargetId: string;
  setControls(controls: QianchuanFixtureControls): void;
  reset(): void;
  inspect(): Promise<{ chromeRunning: boolean; pages: Array<{ id: string; type: string; url: string }>; events: QianchuanFixtureEvent[] }>;
  stop(): Promise<void>;
}
export interface StartFixtureOptions { tempRoot: string; chromeExecutable?: string; fixtureHtml?: string; production?: boolean; }

async function bodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, description: string, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error(`UNVERIFIED: timed out waiting for ${description}`);
}
async function startChrome(executable: string, profile: string): Promise<{ child: ChildProcess; endpoint: string; originalTargetId: string }> {
  await mkdir(profile, { recursive: true });
  const args = [
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "about:blank",
  ];
  const childEnvironment = {
    PATH: process.env.PATH,
    ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    HOME: profile, XDG_CONFIG_HOME: path.join(profile, "config"), XDG_CACHE_HOME: path.join(profile, "cache"), XDG_DATA_HOME: path.join(profile, "data"),
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
      return await response.json() as Array<{ id: string; type: string; url: string }>;
    }, "Chrome's initial tab");
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

export async function startQianchuanFixture(options: StartFixtureOptions): Promise<QianchuanFixture> {
  const chromeExecutable = await resolveChromeExecutable(options.chromeExecutable);
  const html = await readFile(options.fixtureHtml ?? path.resolve("tests/fixtures/qianchuan-upload-page.html"), "utf8");
  const production = options.production === true;
  const initialControls: QianchuanFixtureControls = { ...defaultControls, ...(production ? { capacity: 64 } : {}) };
  const controls: QianchuanFixtureControls = { ...initialControls };
  const events: QianchuanFixtureEvent[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void (async () => {
      if (request.method === "GET" && url.pathname === "/controls") { json(response, 200, controls); return; }
      if (request.method === "POST" && url.pathname === "/events") {
        const value = JSON.parse(await bodyText(request)) as QianchuanFixtureEvent;
        events.push(value); response.writeHead(204).end(); return;
      }
      if (request.method === "GET" && ["/uni-prom", "/upload"].includes(url.pathname)) {
        const pageHtml = html.replace(/const state = \{ controls: \{\}, (files|uploads): \[\] \};/, (_match, collection: string) => `const state = { controls: ${JSON.stringify(controls)}, ${collection}: [] };`);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(pageHtml); return;
      }
      response.writeHead(404).end("not found");
    })().catch(error => { if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : "fixture error" }); else response.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let chrome: Awaited<ReturnType<typeof startChrome>>;
  try { chrome = await startChrome(chromeExecutable, path.join(options.tempRoot, "chrome-profile")); }
  catch (error) { await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
  let stopped = false;
  return {
    cdpEndpoint: chrome.endpoint,
    originalTargetId: chrome.originalTargetId,
    uploadUrl: `${origin}/upload`,
    contract: production ? {
      ...PRODUCTION_QIANCHUAN_CONTRACT,
      origin,
      fixtureUrl: `${origin}/uni-prom`,
    } : {
      kind: "fixture",
      version: "qianchuan-local-fixture/2", origin, route: "/uni-prom", fixtureUrl: `${origin}/uni-prom`,
      drawer: "#qianchuan-drawer", modal: "#upload-modal", count: "#selected-count", row: ".upload-row",
      fileNameAttribute: "data-file-name", stateAttribute: "data-upload-state", login: "#login-required", challenge: "#challenge-required", failure: "#upload-failure",
      fileSelectionDoesNotConfirm: true,
    },
    setControls(value) { Object.assign(controls, value); },
    reset() { for (const key of Object.keys(controls) as (keyof QianchuanFixtureControls)[]) delete controls[key]; Object.assign(controls, initialControls); events.length = 0; },
    async inspect() {
      const pages = await fetch(`${chrome.endpoint}/json/list`).then(response => response.json()) as Array<{ id: string; type: string; url: string }>;
      return { chromeRunning: chrome.child.exitCode === null, pages, events: structuredClone(events) };
    },
    async stop() {
      if (stopped) return; stopped = true;
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
      await stopChrome(chrome.child);
    },
  };
}

function fixtureTask(input: { projectId: string; batchId: string; taskId: string; fileName: string; filePath: string; bytes: Buffer; endpoint: string; pageBatchId: string; expectedCount: number }): UploadTaskRecord {
  const artifactHash = createHash("sha256").update(input.bytes).digest("hex");
  const target = { product: "眼贴" as const, cdpEndpoint: input.endpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
  const authorization = { target, pageBatchId: input.pageBatchId, expectedCount: input.expectedCount };
  const artifactInput = { project_id: input.projectId, batch_id: input.batchId, export_task_id: input.taskId, video_path: input.filePath, artifact_sha256: artifactHash, size_bytes: input.bytes.byteLength };
  return {
    input: artifactInput, inputDigest: frozenInputDigest(artifactInput, authorization),
    config: QianchuanUploadConfigSchema.parse({ enabled: true, timeouts: { connect: 8_000, navigation: 8_000, fileInput: 8_000, processing: 4_000, action: 5_000 } }),
    authorization, snapshotPath: input.filePath,
    result: {
      ...{ project_id: input.projectId, batch_id: input.batchId, export_task_id: input.taskId }, upload_task_id: uploadTaskId(artifactInput, target), artifact_sha256: artifactHash, file_name: input.fileName,
      accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: now(),
    },
  };
}

/** Backward-compatible smoke entry: the browser leg now proves local upload readiness only. */
export async function runDouyinCdpFixture(options: {
  chromeExecutable: string; fixtureHtml: string; tempRoot: string; queueState?: QueueState;
  packagedAttach?: (input: { cdpEndpoint: string; uploadUrl: string }) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const fixture = await startQianchuanFixture(options);
  const chromeVersion = execFileSync(options.chromeExecutable, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  const completed = options.queueState?.batch.tasks.find(task => task.status === "completed" && task.outputPath && task.outputArtifact);
  let projectId: string, batchId: string, exportTaskId: string, filePath: string, fileName: string, bytes: Buffer;
  if (options.queueState) {
    assert.ok(completed?.outputPath && completed.outputArtifact, "provided queue state must contain a completed export artifact");
    assert.ok(options.queueState?.batch.projectId, "completed export fixture is bound to a desktop project");
    projectId = options.queueState.batch.projectId;
    batchId = completed.batchId; exportTaskId = completed.id; filePath = completed.outputPath; fileName = path.basename(filePath);
    const taskStat = await stat(filePath); bytes = await readFile(filePath);
    assert.equal(bytes.byteLength, taskStat.size, "fixture consumes the unchanged formal export bytes");
  } else {
    projectId = randomUUID(); batchId = randomUUID(); exportTaskId = randomUUID();
    fileName = "offline-fixture.mp4"; filePath = path.join(options.tempRoot, fileName);
    bytes = Buffer.from("local Qianchuan browser fixture; not a production video");
    await writeFile(filePath, bytes, { mode: 0o600 });
  }
  let packagedAttach: Record<string, unknown> | undefined;
  let uploader: DouyinCdpUploader | undefined;
  try {
    if (options.packagedAttach) packagedAttach = await options.packagedAttach({ cdpEndpoint: fixture.cdpEndpoint, uploadUrl: fixture.uploadUrl });
    const task = fixtureTask({ projectId, batchId, taskId: exportTaskId, fileName, filePath, bytes, endpoint: fixture.cdpEndpoint, pageBatchId: randomUUID(), expectedCount: 1 });
    uploader = new DouyinCdpUploader(fixture.contract);
    const signal = new AbortController().signal;
    await uploader.connect(task, signal);
    const prepared = await uploader.open([task], [], signal);
    task.result = { ...task.result, upload_outcome: "MAY_HAVE_UPLOADED", state: "UPLOADING" };
    await uploader.upload([task], signal);
    const readyEvidence = (await uploader.ready([task], signal))[0]!;
    assert.equal(readyEvidence.advertiserId, task.authorization.target.advertiserId);
    assert.equal(readyEvidence.adId, task.authorization.target.adId);
    assert.equal(readyEvidence.fileName, task.result.file_name);
    assert.equal(readyEvidence.selectedCount, 1);
    assert.equal(Number.isNaN(Date.parse(readyEvidence.observedAt)), false);
    assert.deepEqual(readyEvidence.pageOwnership, prepared.pageOwnership);
    await uploader.stop(); uploader = undefined;
    const observed = await fixture.inspect();
    assert.equal(observed.chromeRunning, true, "adapter detach preserves isolated Chrome process");
    assert.ok(observed.pages.some(page => page.id === fixture.originalTargetId && page.url === "about:blank"), "adapter detach preserves the original Chrome tab");
    assert.ok(observed.pages.some(page => page.type === "page" && page.url.startsWith(`${new URL(fixture.contract.fixtureUrl!).origin}/uni-prom`)), "upload fixture task tab remains available for human inspection");
    assert.equal(observed.events.filter(event => event.type === "confirm" || event.type === "settings").length, 0, "fixture receives no confirm or ad-settings click");
    assert.deepEqual(observed.events.filter(event => event.type === "files").map(event => event.names), [[fileName]]);
    return {
      result: "PASS", boundary: "isolated local fixture upload readiness; no real Qianchuan account or platform acceptance",
      chrome: { executable: options.chromeExecutable, version: chromeVersion, isolatedProfile: true, originalTargetPreserved: fixture.originalTargetId, processStillRunning: true },
      ...(packagedAttach ? { packagedPlaywrightAttach: packagedAttach } : {}),
      fixture: { confirmClicks: 0, settingsChanges: 0, fileSelections: observed.events.filter(event => event.type === "files").length, readyEvidence, taskPagePreserved: true },
    };
  } finally {
    await uploader?.stop().catch(() => undefined);
    await fixture.stop();
  }
}
