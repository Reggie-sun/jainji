import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DouyinCdpUploader, douyinReadiness } from "../src/main/douyin-cdp-uploader.js";
import { PRODUCTION_QIANCHUAN_CONTRACT, type QianchuanPageContract } from "../src/main/qianchuan-page-contract.js";
import type { QianchuanFixture, QianchuanFixtureControls } from "./helpers/douyin-cdp-fixture.js";
import { resolveChromeExecutable, startQianchuanFixture } from "./helpers/douyin-cdp-fixture.js";
import { DouyinUploadStore, frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store.js";
import { DouyinUploadService } from "../src/main/douyin-upload-service.js";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config.js";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account.js";
import { BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, DEFAULT_PRESET, createDefaultTemplate, now, type QueueState } from "../src/main/domain.js";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let tempRoot = "";
let fixture: QianchuanFixture;
let productionFixture: QianchuanFixture | undefined;
let productionContract: QianchuanPageContract | undefined;
let chromeExecutable = "";
const uploaders: DouyinCdpUploader[] = [];

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "jianji-qianchuan-cdp-test-"));
  chromeExecutable = await resolveChromeExecutable();
  fixture = await startQianchuanFixture({ tempRoot, chromeExecutable });
});
afterEach(async () => {
  await Promise.all(uploaders.splice(0).map(uploader => uploader.stop()));
  fixture?.reset();
  productionFixture?.reset();
});
afterAll(async () => {
  await productionFixture?.stop();
  await fixture?.stop();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

function makeUploader(contract: QianchuanPageContract = fixture.contract): DouyinCdpUploader {
  const uploader = new DouyinCdpUploader(contract);
  uploaders.push(uploader);
  return uploader;
}

async function makeTask(input: { name: string; content?: string; pageBatchId?: string; expectedCount?: number; batchId?: string; projectId?: string; endpoint?: string }): Promise<UploadTaskRecord> {
  const fileName = input.name;
  const bytes = Buffer.from(input.content ?? `isolated fixture bytes for ${fileName}`);
  const snapshotPath = path.join(tempRoot, fileName);
  await writeFile(snapshotPath, bytes, { mode: 0o600 });
  const identity = { project_id: input.projectId ?? randomUUID(), batch_id: input.batchId ?? randomUUID(), export_task_id: randomUUID() };
  const target = { product: "眼贴" as const, cdpEndpoint: input.endpoint ?? fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
  const authorization = { target, pageBatchId: input.pageBatchId ?? randomUUID(), expectedCount: input.expectedCount ?? 1 };
  const artifactHash = createHash("sha256").update(bytes).digest("hex");
  const artifactInput = { ...identity, video_path: snapshotPath, artifact_sha256: artifactHash, size_bytes: bytes.byteLength };
  return {
    input: artifactInput,
    inputDigest: frozenInputDigest(artifactInput, authorization),
    config: QianchuanUploadConfigSchema.parse({ enabled: true, timeouts: { connect: 8_000, navigation: 8_000, fileInput: 8_000, processing: 500, action: 2_000 } }),
    authorization,
    snapshotPath,
    result: {
      ...identity,
      upload_task_id: uploadTaskId(artifactInput, target),
      artifact_sha256: artifactHash,
      file_name: fileName,
      accountProduct: target.product,
      advertiserId: target.advertiserId,
      adId: target.adId,
      state: "PENDING",
      upload_outcome: "NOT_SELECTED",
      retryable: false,
      retry_count: 0,
      attempt_count: 1,
      timestamp: now(),
    },
  };
}

async function waitForEvents(predicate: (events: Awaited<ReturnType<QianchuanFixture["inspect"]>>["events"]) => boolean, source: QianchuanFixture = fixture): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate((await source.inspect()).events)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const events = (await source.inspect()).events;
  throw new Error(`Timed out waiting for isolated fixture event; latest events: ${JSON.stringify(events.slice(-12))}`);
}

async function openAndFence(uploader: DouyinCdpUploader, task: UploadTaskRecord, selected: Array<{ fileName: string; index: number }> = []) {
  await uploader.connect(task, new AbortController().signal);
  const prepared = await uploader.open([task], selected, new AbortController().signal);
  task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
  return prepared;
}

describe("千川 CDP upload-only adapter", () => {
  it("fails closed before CDP discovery when the finite page contract is absent", async () => {
    const task = await makeTask({ name: "readiness.mp4" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const uploader = new DouyinCdpUploader(null as unknown as QianchuanPageContract);
    uploaders.push(uploader);
    try {
      await expect(uploader.connect(task, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_UNVERIFIED" } });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("exposes a source-owned production contract without treating fixture evidence as live acceptance", async () => {
    const task = await makeTask({ name: "readiness.mp4" });
    expect(PRODUCTION_QIANCHUAN_CONTRACT).toBeDefined();
    expect(douyinReadiness(task.config)).toBeUndefined();
  });

  it.each([
    "ws://remote.example/devtools/browser/fake",
    "ws://user:password@127.0.0.1:9222/devtools/browser/fake",
    "ws://127.0.0.1:9223/devtools/browser/fake",
  ])("rejects unsafe CDP websocket discovery %s before attaching", async websocketUrl => {
    const task = await makeTask({ name: `unsafe-${randomUUID()}.mp4` });
    const before = (await fixture.inspect()).pages.filter(page => page.type === "page").map(page => page.id).sort();
    const networkFetch = globalThis.fetch.bind(globalThis);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl).pathname === "/json/version") return Promise.resolve(new Response(JSON.stringify({ webSocketDebuggerUrl: websocketUrl }), { status: 200 }));
      return networkFetch(input, init);
    });
    const uploader = makeUploader();
    try {
      await expect(uploader.connect(task, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "CDP_UNAVAILABLE" } });
      expect((await fixture.inspect()).pages.filter(page => page.type === "page").map(page => page.id).sort()).toEqual(before);
    } finally { fetchSpy.mockRestore(); }
  });

  it("uploads two files sequentially into one owned modal after each prior item is ready", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "first.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "second.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    const firstPrepared = await openAndFence(uploader, first);
    await uploader.upload([first], signal);
    const firstReady = (await uploader.ready([first], signal))[0]!;
    expect(firstReady).toMatchObject({ fileName: "first.mp4", selectedCount: 1, pageOwnership: firstPrepared.pageOwnership });

    const prior = [{ fileName: "first.mp4", index: 1 }];
    const secondPrepared = await uploader.open([second], prior, signal);
    expect(secondPrepared.pageOwnership).toEqual(firstPrepared.pageOwnership);
    expect(secondPrepared.selectedIndex).toBe(2);
    second.result = { ...second.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([second], signal);
    const secondReady = (await uploader.ready([second], signal))[0]!;
    expect(secondReady).toMatchObject({ fileName: "second.mp4", selectedCount: 2, pageOwnership: firstPrepared.pageOwnership });

    await waitForEvents(events => events.filter(event => event.type === "files").length === 2);
    const observed = await fixture.inspect();
    expect(observed.events.filter(event => event.type === "files").map(event => event.names)).toEqual([["first.mp4"], ["second.mp4"]]);
    expect(observed.events.filter(event => ["confirm", "settings"].includes(event.type))).toEqual([]);
    expect(observed.events.filter(event => event.type === "click").map(event => event.control)).toEqual(["素材", "添加视频", "上传视频"]);
  });

  it("checks whole-batch capacity before the first file selection", async () => {
    fixture.reset(); fixture.setControls({ capacity: 1 });
    const task = await makeTask({ name: "over-capacity.mp4", expectedCount: 2 });
    const uploader = makeUploader();
    await uploader.connect(task, new AbortController().signal);
    await expect(uploader.open([task], [], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "CAPACITY_INSUFFICIENT" } });
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toEqual([]);
  });

  it.each([
    [{ screen: "login" } satisfies QianchuanFixtureControls, "LOGIN_REQUIRED"],
    [{ screen: "challenge" } satisfies QianchuanFixtureControls, "CHALLENGE_REQUIRED"],
    [{ wrongAdvertiser: true } satisfies QianchuanFixtureControls, "PAGE_CONTRACT_CHANGED"],
    [{ wrongPlan: true } satisfies QianchuanFixtureControls, "PAGE_CONTRACT_CHANGED"],
    [{ duplicateUpload: true } satisfies QianchuanFixtureControls, "PAGE_CONTRACT_CHANGED"],
    [{ duplicateConfirm: true } satisfies QianchuanFixtureControls, "PAGE_CONTRACT_CHANGED"],
  ])("stops before selection on challenge, identity mismatch, or ambiguous controls: %s", async (controls, code) => {
    fixture.reset(); fixture.setControls(controls);
    const task = await makeTask({ name: `guard-${randomUUID()}.mp4` });
    const uploader = makeUploader();
    await uploader.connect(task, new AbortController().signal);
    await expect(uploader.open([task], [], new AbortController().signal)).rejects.toMatchObject({ failure: { code } });
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toEqual([]);
    expect((await fixture.inspect()).events.filter(event => ["confirm", "settings"].includes(event.type))).toEqual([]);
  });

  it("rejects a changed selected filename before the next task can choose a file", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "stable.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "next.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    await openAndFence(uploader, first); await uploader.upload([first], signal); (await uploader.ready([first], signal))[0]!;
    fixture.setControls({ drift: true });
    await new Promise(resolve => setTimeout(resolve, 160));
    await expect(uploader.open([second], [{ fileName: "stable.mp4", index: 1 }], signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    const files = (await fixture.inspect()).events.filter(event => event.type === "files");
    expect(files).toHaveLength(1);
  });

  it("blocks the next selection while the prior item is still processing", async () => {
    fixture.reset(); fixture.setControls({ readyState: "processing" });
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "processing.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "must-not-start.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    await openAndFence(uploader, first); await uploader.upload([first], signal);
    await waitForEvents(events => events.some(event => event.type === "files"));
    await expect(uploader.open([second], [{ fileName: "processing.mp4", index: 1 }], signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toHaveLength(1);
  });

  it("recovers only the original owned tab and does not select another file", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const task = await makeTask({ name: "recover.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "recover-second.mp4", pageBatchId, batchId, expectedCount: 2 });
    const firstUploader = makeUploader(), signal = new AbortController().signal;
    const prepared = await openAndFence(firstUploader, task);
    await firstUploader.upload([task], signal);
    await firstUploader.ready([task], signal);
    await firstUploader.open([second], [{ fileName: task.result.file_name, index: 1 }], signal);
    second.result = { ...second.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await firstUploader.upload([second], signal);
    const originalEvidence = (await firstUploader.ready([second], signal))[0]!;
    await firstUploader.stop();
    const detached = await fixture.inspect();
    expect(detached.chromeRunning).toBe(true);
    expect(detached.pages.some(page => page.id === prepared.pageOwnership.targetId && page.url.startsWith(`${new URL(fixture.contract.fixtureUrl!).origin}/uni-prom`))).toBe(true);

    const recoveredUploader = makeUploader();
    await recoveredUploader.connect(task, signal);
    const recovered = await recoveredUploader.readOnlyCheck(task, originalEvidence.pageOwnership, [
      { fileName: task.result.file_name, index: 1 }, { fileName: second.result.file_name, index: 2 },
    ], signal);
    expect(recovered).toMatchObject({ fileName: task.result.file_name, selectedCount: 2, pageOwnership: prepared.pageOwnership });
    const observed = await fixture.inspect();
    expect(observed.events.filter(event => event.type === "files")).toHaveLength(2);
    expect(observed.events.filter(event => ["confirm", "settings"].includes(event.type))).toEqual([]);
  });

  it("aborts an in-flight readiness wait and detaches without closing Chrome or its task tab", async () => {
    fixture.reset(); fixture.setControls({ readyState: "processing" });
    const task = await makeTask({ name: "abort-during-processing.mp4" });
    const uploader = makeUploader(), controller = new AbortController();
    await openAndFence(uploader, task);
    await uploader.upload([task], controller.signal);
    await waitForEvents(events => events.some(event => event.type === "files"));
    const waiting = uploader.ready([task], controller.signal);
    await new Promise(resolve => setTimeout(resolve, 150));
    controller.abort();
    await expect(waiting).rejects.toThrow();
    await uploader.stop();

    const observed = await fixture.inspect();
    expect(observed.chromeRunning).toBe(true);
    expect(observed.pages.some(page => page.id === fixture.originalTargetId && page.url === "about:blank")).toBe(true);
    expect(observed.pages.some(page => page.type === "page" && page.url.startsWith(`${new URL(fixture.contract.fixtureUrl!).origin}/uni-prom`))).toBe(true);
    expect(observed.events.filter(event => ["confirm", "settings"].includes(event.type))).toEqual([]);
  });
});

describe.skipIf(!PRODUCTION_QIANCHUAN_CONTRACT)("source-owned Qianchuan production DOM contract on an isolated Chrome fixture", () => {
  beforeAll(async () => {
    const fixtureHtml = path.resolve("tests/fixtures/qianchuan-production-page.html");
    productionFixture = await startQianchuanFixture({
      tempRoot: path.join(tempRoot, "production-dom"), chromeExecutable, fixtureHtml, production: true,
    });
    productionContract = productionFixture.contract;
  });

  function productionUploader(): DouyinCdpUploader {
    if (!productionContract) throw new Error("production fixture contract is not initialized");
    return makeUploader(productionContract);
  }

  async function productionTask(name: string, batchId = randomUUID(), pageBatchId = randomUUID(), expectedCount = 1, projectId = randomUUID()): Promise<UploadTaskRecord> {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    return makeTask({ name, batchId, pageBatchId, expectedCount, projectId, endpoint: productionFixture.cdpEndpoint });
  }

  async function uploadReady(uploader: DouyinCdpUploader, task: UploadTaskRecord, selected: Array<{ fileName: string; index: number }> = []) {
    const prepared = await uploader.open([task], selected, new AbortController().signal);
    task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([task], new AbortController().signal);
    return { prepared, evidence: (await uploader.ready([task], new AbortController().signal))[0]! };
  }

  it("delivers 21 production snapshots in 9+9+3 groups, allowing late rows but waiting for the last member before advancing", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ processingDelayMs: 250, rowAppearanceDelayMs: 80, reorderRows: true });
    const batchId = randomUUID(), pageBatchId = randomUUID(), projectId = randomUUID();
    const tasks = await Promise.all(Array.from({ length: 21 }, (_, index) => productionTask(`group-${index}.mp4`, batchId, pageBatchId, 21, projectId)));
    const uploader = productionUploader(), signal = new AbortController().signal;
    await uploader.connect(tasks[0]!, signal);
    const selected: Array<{ fileName: string; index: number; ready: boolean }> = [];
    let ownership;
    for (let index = 0; index < tasks.length; index += 9) {
      const group = tasks.slice(index, index + 9);
      if (index === 0) productionFixture.setControls({ pendingName: group.at(-1)!.result.file_name });
      const prepared = await uploader.open(group, selected, signal);
      if (ownership) expect(prepared.pageOwnership).toEqual(ownership); else ownership = prepared.pageOwnership;
      expect(prepared.selectedIndex).toBe(index + 1);
      for (const task of group) task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
      await uploader.upload(group, signal);
      let finished = false;
      const waiting = uploader.ready(group, signal).then(evidence => { finished = true; return evidence; });
      if (index === 0) {
        await waitForEvents(events => events.some(event => event.type === "dom" && event.rows?.length === 9 && event.rows.filter(row => row.ready).length === 8 && event.cancelVisible && !event.confirmEnabled), productionFixture);
        expect(finished).toBe(false);
        const next = tasks.slice(9, 18);
        await expect(uploader.open(next, group.map((task, i) => ({ fileName: task.result.file_name, index: i + 1 })), signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
        expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
        productionFixture.setControls({ pendingName: "" });
      }
      const evidence = await waiting;
      expect(evidence.map(item => item.fileName)).toEqual(group.map(task => task.result.file_name));
      expect(evidence.every(item => item.selectedCount === index + group.length)).toBe(true);
      selected.push(...group.map((task, i) => ({ fileName: task.result.file_name, index: index + i + 1, ready: true })));
    }
    const observed = await productionFixture.inspect();
    expect(observed.events.filter(event => event.type === "drop").map(event => event.names?.length)).toEqual([9, 9, 3]);
    expect(observed.events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it.each(["hidden", "collapse"] as const)("does not report a nine-file group ready when success markers have visibility:%s", async visibility => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ successVisibility: visibility });
    const batchId = randomUUID(), pageBatchId = randomUUID(), projectId = randomUUID();
    const tasks = await Promise.all(Array.from({ length: 9 }, (_, index) => productionTask(`invisible-${index}.mp4`, batchId, pageBatchId, 9, projectId)));
    const uploader = productionUploader(), signal = new AbortController().signal;
    await uploader.connect(tasks[0]!, signal); await uploader.open(tasks, [], signal);
    for (const task of tasks) task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload(tasks, signal);
    await expect(uploader.ready(tasks, signal)).rejects.toMatchObject({ failure: { code: "TIMEOUT" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
    expect((await productionFixture.inspect()).events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it("recovers every unknown member of an interrupted nine-file group on the original page without another drop", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ processingDelayMs: 160, rowAppearanceDelayMs: 300 });
    const batchId = randomUUID(), pageBatchId = randomUUID(), projectId = randomUUID();
    const tasks = await Promise.all(Array.from({ length: 9 }, (_, index) => productionTask(`recover-group-${index}.mp4`, batchId, pageBatchId, 9, projectId)));
    const uploader = productionUploader(), signal = new AbortController().signal;
    await uploader.connect(tasks[0]!, signal);
    const prepared = await uploader.open(tasks, [], signal);
    for (const task of tasks) task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload(tasks, signal); await uploader.stop();
    const recovery = productionUploader(); await recovery.connect(tasks[0]!, signal);
    const selected = tasks.map((task, index) => ({ fileName: task.result.file_name, index: index + 1, ready: false }));
    for (const task of tasks) expect(await recovery.readOnlyCheck(task, prepared.pageOwnership, selected, signal)).toMatchObject({ fileName: task.result.file_name, selectedCount: 9, pageOwnership: prepared.pageOwnership });
    const observed = await productionFixture.inspect();
    expect(observed.events.filter(event => event.type === "drop")).toHaveLength(1);
    expect(observed.events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it("refuses more than nine members and an unfenced member before production file delivery", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    const batchId = randomUUID(), pageBatchId = randomUUID(), projectId = randomUUID();
    const tasks = await Promise.all(Array.from({ length: 10 }, (_, index) => productionTask(`bound-${index}.mp4`, batchId, pageBatchId, 10, projectId)));
    const uploader = productionUploader(), signal = new AbortController().signal;
    await uploader.connect(tasks[0]!, signal);
    await expect(uploader.open(tasks, [], signal)).rejects.toThrow();
    const group = tasks.slice(0, 9); await uploader.open(group, [], signal);
    for (const task of group.slice(0, 8)) task.result = { ...task.result, upload_outcome: "MAY_HAVE_UPLOADED" };
    await expect(uploader.upload(group, signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toEqual([]);
  });

  it("drops two snapshots on the actual production selector branch, waits through processing, and matches reordered rows by filename", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    productionFixture.setControls({ processingDelayMs: 250, rowAppearanceDelayMs: 80, reorderRows: true });
    const batchId = randomUUID(), pageBatchId = randomUUID();
    const first = await productionTask("production-first.mp4", batchId, pageBatchId, 2);
    const second = await productionTask("production-second.mp4", batchId, pageBatchId, 2);
    const uploader = productionUploader();
    await uploader.connect(first, new AbortController().signal);

    const firstPrepared = await uploader.open([first], [], new AbortController().signal);
    first.result = { ...first.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([first], new AbortController().signal);
    await waitForEvents(events => events.some(event => event.type === "dom" && event.rows?.some(row => row.name === first.result.file_name && !row.ready) && event.selectedCount === "已选择 0/64：" && event.cancelVisible && !event.confirmEnabled), productionFixture);
    const firstReady = (await uploader.ready([first], new AbortController().signal))[0]!;
    expect(firstReady).toMatchObject({ fileName: first.result.file_name, selectedCount: 1, pageOwnership: firstPrepared.pageOwnership });

    const secondPrepared = await uploader.open([second], [{ fileName: first.result.file_name, index: 1 }], new AbortController().signal);
    expect(secondPrepared.pageOwnership).toEqual(firstPrepared.pageOwnership);
    expect(secondPrepared.selectedIndex).toBe(2);
    second.result = { ...second.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([second], new AbortController().signal);
    const secondReady = (await uploader.ready([second], new AbortController().signal))[0]!;
    expect(secondReady).toMatchObject({ fileName: second.result.file_name, selectedCount: 2, pageOwnership: firstPrepared.pageOwnership });

    const events = (await productionFixture.inspect()).events;
    expect(events.filter(event => event.type === "drop").map(event => event.names)).toEqual([[first.result.file_name], [second.result.file_name]]);
    expect(events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
    const finalDom = events.filter(event => event.type === "dom").at(-1);
    expect(finalDom).toMatchObject({ selectedCount: "已选择 2/64：", cancelVisible: false, confirmEnabled: true, rows: [
      { name: second.result.file_name, ready: true }, { name: first.result.file_name, ready: true },
    ] });
  });

  it("checks whole-batch capacity before the first production-page drop", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ capacity: 1 });
    const task = await productionTask(`capacity-${randomUUID()}.mp4`, randomUUID(), randomUUID(), 2);
    const uploader = productionUploader();
    await uploader.connect(task, new AbortController().signal);
    await expect(uploader.open([task], [], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "CAPACITY_INSUFFICIENT" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toEqual([]);
  });

  it.each([
    { controls: { screen: "login" } satisfies QianchuanFixtureControls, code: "LOGIN_REQUIRED" },
    { controls: { screen: "challenge" } satisfies QianchuanFixtureControls, code: "CHALLENGE_REQUIRED" },
    { controls: { wrongAdvertiser: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { wrongAdvertiser: true, unrelatedAdvertiserId: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { duplicateAccount: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { wrongDrawerPlan: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { duplicateAddButton: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { duplicateUpload: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { duplicateConfirm: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { duplicateDropTarget: true } satisfies QianchuanFixtureControls, code: "PAGE_CONTRACT_CHANGED" },
    { controls: { failure: true } satisfies QianchuanFixtureControls, code: "CONTENT_REJECTED" },
  ])("blocks production upload for $code without selecting a file", async ({ controls, code }) => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls(controls);
    const task = await productionTask(`guard-${randomUUID()}.mp4`);
    const uploader = productionUploader();
    await uploader.connect(task, new AbortController().signal);
    await expect(uploader.open([task], [], new AbortController().signal)).rejects.toMatchObject({ failure: { code } });
    const events = (await productionFixture.inspect()).events;
    expect(events.filter(event => event.type === "drop")).toEqual([]);
    expect(events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it("scopes a duplicated visible plan id to the selected plan drawer", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ wrongGlobalPlan: true });
    const task = await productionTask(`scoped-plan-${randomUUID()}.mp4`);
    const uploader = productionUploader();
    await uploader.connect(task, new AbortController().signal);
    const prepared = await uploader.open([task], [], new AbortController().signal);
    expect(prepared.pageOwnership.pageBatchId).toBe(task.authorization.pageBatchId);
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toEqual([]);
  });

  it("ignores an unrelated matching advertiser id when the unique account region matches", async () => {
    productionFixture!.setControls({ unrelatedAdvertiserId: true });
    const task = await productionTask(`scoped-account-${randomUUID()}.mp4`);
    const uploader = productionUploader(), signal = new AbortController().signal;
    await uploader.connect(task, signal);
    expect((await uploader.open([task], [], signal)).selectedIndex).toBe(1);
    expect((await productionFixture!.inspect()).events.filter(event => event.type === "drop" || event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it("retains permanent fences and blocks later groups when a newly dropped row never appears, including read-only recovery", async () => {
    const source = productionFixture!;
    const batchId = randomUUID(), projectId = randomUUID(), pageBatchId = randomUUID();
    const tasks = await Promise.all(Array.from({ length: 21 }, (_, i) => productionTask(`missing-new-${i}.mp4`, batchId, pageBatchId, 21, projectId)));
    source.setControls({ removeName: tasks[9]!.result.file_name, processingDelayMs: 100 });
    const state: QueueState = {
      schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(),
      batch: { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [],
        outputDirectory: tempRoot, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(),
        tasks: tasks.map(task => ({ id: task.input.export_task_id, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, attempts: [], createdAt: now(), outputPath: task.input.video_path,
          outputArtifact: { taskId: task.input.export_task_id, path: task.input.video_path, sizeBytes: task.input.size_bytes, durationMs: 1000, createdAt: now() } })),
      },
    };
    const store = new DouyinUploadStore(path.join(tempRoot, `missing-row-store-${randomUUID()}`));
    await store.load();
    const configPath = path.join(tempRoot, `accounts-${randomUUID()}.json`);
    await writeFile(configPath, JSON.stringify({ version: 1, accounts: QIANCHUAN_PRODUCTS.map((product, i) => ({ product,
      cdpEndpoint: product === "眼贴" ? source.cdpEndpoint : `http://127.0.0.1:${14000 + i}`,
      advertiserId: product === "眼贴" ? "123456" : String(200000 + i), adId: product === "眼贴" ? "987654" : String(300000 + i) })) }), { mode: 0o600 });
    const service = new DouyinUploadService(store, { loadBatch: async () => structuredClone(state), browser: productionUploader, accounts: new QianchuanAccountConfigReader() });
    try {
      await service.chooseConfig(configPath);
      await service.configure({ enabled: true, timeouts: { processing: 1500, confirmation: 3000 } });
      const selection = { enabled: true as const, accountProduct: "眼贴" as const };
      await service.registerBatch(state.batch, selection, await service.preflight(selection, 21));
      for (const task of tasks) await service.enqueueFinalArtifact({ project_id: projectId, batch_id: batchId, export_task_id: task.input.export_task_id });
      await service.runPending();
      const records = tasks.map(task => store.tasks().find(record => record.input.export_task_id === task.input.export_task_id)!);
      expect(records.slice(0, 9).every(task => task.result.upload_outcome === "READY")).toBe(true);
      expect(records.slice(9, 18).every(task => task.result.state === "NEEDS_HUMAN" && task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toBe(true);
      expect(records.slice(18).every(task => task.result.upload_outcome === "NOT_SELECTED" && !store.hasMarker(task.result.upload_task_id))).toBe(true);
      const fencePaths = records.slice(0, 18).map(task => path.join(store.root, "selection-fences", `${task.result.upload_task_id}.json`));
      const fences = await Promise.all(fencePaths.map(file => readFile(file)));
      const eventsBefore = (await source.inspect()).events.filter(event => ["drop", "click", "confirm", "settings"].includes(event.type));
      expect(eventsBefore.filter(event => event.type === "drop").map(event => event.names?.length)).toEqual([9, 9]);
      await service.resume(records[9]!.result.upload_task_id);
      await service.runPending();
      expect((await source.inspect()).events.filter(event => ["drop", "click", "confirm", "settings"].includes(event.type))).toEqual(eventsBefore);
      expect(eventsBefore.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
      expect(await Promise.all(fencePaths.map(file => readFile(file)))).toEqual(fences);
      const reopened = new DouyinUploadStore(store.root); await reopened.load();
      expect(reopened.tasks().filter(task => reopened.hasMarker(task.result.upload_task_id))).toHaveLength(18);
      expect(records.slice(9, 18).every(task => reopened.task(task.result.upload_task_id)!.result.upload_outcome === "MAY_HAVE_UPLOADED")).toBe(true);
    } finally { await service.stop(); }
  });

  it.each(["unknown-name", "extra-row"] as const)("rejects a production upload list containing %s", async kind => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    const task = await productionTask(`invalid-${randomUUID()}.mp4`);
    const uploader = productionUploader();
    await uploader.connect(task, new AbortController().signal);
    await uploader.open([task], [], new AbortController().signal);
    task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([task], new AbortController().signal);
    productionFixture.setControls(kind === "unknown-name" ? { unknownName: task.result.file_name } : { extraRow: true });
    await waitForEvents(events => events.some(event => event.type === "dom" && event.rows?.some(row => row.name === (kind === "unknown-name" ? "unknown-file.mp4" : "unexpected-extra.mp4"))), productionFixture);
    await expect(uploader.ready([task], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
    expect((await productionFixture.inspect()).events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });

  it("treats a stale zero count as pending and never records ready without the exact count", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset(); productionFixture.setControls({ selectedCountOverride: 0, processingDelayMs: 100 });
    const task = await productionTask(`count-lag-${randomUUID()}.mp4`);
    const uploader = productionUploader();
    await uploader.connect(task, new AbortController().signal);
    await uploader.open([task], [], new AbortController().signal);
    task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload([task], new AbortController().signal);
    await expect(uploader.ready([task], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "TIMEOUT" } });
    await waitForEvents(events => events.some(event => event.type === "dom" && event.selectedCount === "已选择 0/64：" && event.rows?.some(row => row.name === task.result.file_name && row.ready)), productionFixture);
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
  });

  it("rejects a renamed prior production row before preparing another snapshot", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    const batchId = randomUUID(), pageBatchId = randomUUID();
    const first = await productionTask("production-drift-first.mp4", batchId, pageBatchId, 2);
    const second = await productionTask("production-drift-second.mp4", batchId, pageBatchId, 2);
    const uploader = productionUploader();
    await uploader.connect(first, new AbortController().signal);
    await uploadReady(uploader, first);
    productionFixture.setControls({ drift: true });
    await waitForEvents(events => events.some(event => event.type === "dom" && event.rows?.some(row => row.name === `drifted-${first.result.file_name}`)), productionFixture);
    await expect(uploader.open([second], [{ fileName: first.result.file_name, index: 1 }], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
  });

  it("rejects disappearance of a previous ready row before preparing the next drop", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    const batchId = randomUUID(), pageBatchId = randomUUID();
    const first = await productionTask("production-previous.mp4", batchId, pageBatchId, 2);
    const second = await productionTask("production-missing-previous.mp4", batchId, pageBatchId, 2);
    const uploader = productionUploader();
    await uploader.connect(first, new AbortController().signal);
    await uploadReady(uploader, first);
    const domCount = (await productionFixture.inspect()).events.filter(event => event.type === "dom").length;
    productionFixture.setControls({ removeName: first.result.file_name });
    await waitForEvents(events => {
      const laterDom = events.filter(event => event.type === "dom").slice(domCount);
      return laterDom.length > 0 && laterDom.at(-1)?.rows?.length === 0;
    }, productionFixture);
    await expect(uploader.open([second], [{ fileName: first.result.file_name, index: 1 }], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await productionFixture.inspect()).events.filter(event => event.type === "drop")).toHaveLength(1);
  });

  it("recovers the original production modal read-only with actual list count and no new drop", async () => {
    if (!productionFixture) throw new Error("production fixture is not initialized");
    productionFixture.reset();
    const batchId = randomUUID(), pageBatchId = randomUUID();
    const first = await productionTask("production-recover-first.mp4", batchId, pageBatchId, 2);
    const second = await productionTask("production-recover-second.mp4", batchId, pageBatchId, 2);
    const original = productionUploader();
    await original.connect(first, new AbortController().signal);
    const firstUpload = await uploadReady(original, first);
    await uploadReady(original, second, [{ fileName: first.result.file_name, index: 1 }]);
    await original.stop();

    const recovery = productionUploader();
    await recovery.connect(first, new AbortController().signal);
    const evidence = await recovery.readOnlyCheck(first, firstUpload.prepared.pageOwnership, [
      { fileName: first.result.file_name, index: 1 }, { fileName: second.result.file_name, index: 2 },
    ], new AbortController().signal);
    expect(evidence).toMatchObject({ fileName: first.result.file_name, selectedCount: 2, pageOwnership: firstUpload.prepared.pageOwnership });
    const events = (await productionFixture.inspect()).events;
    expect(events.filter(event => event.type === "drop")).toHaveLength(2);
    expect(events.filter(event => event.type === "confirm" || event.type === "settings")).toEqual([]);
  });
});
