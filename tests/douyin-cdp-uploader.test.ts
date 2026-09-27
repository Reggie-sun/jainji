import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DouyinCdpUploader, douyinReadiness } from "../src/main/douyin-cdp-uploader.js";
import type { QianchuanFixture, QianchuanFixtureControls } from "./helpers/douyin-cdp-fixture.js";
import { resolveChromeExecutable, startQianchuanFixture } from "./helpers/douyin-cdp-fixture.js";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store.js";
import { now } from "../src/main/domain.js";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let tempRoot = "";
let fixture: QianchuanFixture;
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
});
afterAll(async () => {
  await fixture?.stop();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

function makeUploader(): DouyinCdpUploader {
  const uploader = new DouyinCdpUploader(fixture.contract);
  uploaders.push(uploader);
  return uploader;
}

async function makeTask(input: { name: string; content?: string; pageBatchId?: string; expectedCount?: number; batchId?: string }): Promise<UploadTaskRecord> {
  const fileName = input.name;
  const bytes = Buffer.from(input.content ?? `isolated fixture bytes for ${fileName}`);
  const snapshotPath = path.join(tempRoot, fileName);
  await writeFile(snapshotPath, bytes, { mode: 0o600 });
  const identity = { project_id: randomUUID(), batch_id: input.batchId ?? randomUUID(), export_task_id: randomUUID() };
  const target = { product: "眼贴" as const, cdpEndpoint: fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
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

async function waitForEvents(predicate: (events: Awaited<ReturnType<QianchuanFixture["inspect"]>>["events"]) => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate((await fixture.inspect()).events)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for isolated fixture event");
}

async function openAndFence(uploader: DouyinCdpUploader, task: UploadTaskRecord, selected: Array<{ fileName: string; index: number }> = []) {
  await uploader.connect(task, new AbortController().signal);
  const prepared = await uploader.open(task, selected, new AbortController().signal);
  task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
  return prepared;
}

describe("千川 CDP upload-only adapter", () => {
  it("keeps production blocked before CDP discovery until page semantics are source-verified", async () => {
    const task = await makeTask({ name: "blocked.mp4" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const uploader = new DouyinCdpUploader();
    uploaders.push(uploader);
    try {
      expect(douyinReadiness(task.config)).toContain("尚未核实");
      await expect(uploader.connect(task, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_UNVERIFIED" } });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it.each([
    "ws://remote.example/devtools/browser/fake",
    "ws://user:password@127.0.0.1:9222/devtools/browser/fake",
    "ws://127.0.0.1:9223/devtools/browser/fake",
  ])("rejects unsafe CDP websocket discovery %s before attaching", async websocketUrl => {
    const task = await makeTask({ name: `unsafe-${randomUUID()}.mp4` });
    const before = (await fixture.inspect()).pages.map(page => page.id);
    const networkFetch = globalThis.fetch.bind(globalThis);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl).pathname === "/json/version") return Promise.resolve(new Response(JSON.stringify({ webSocketDebuggerUrl: websocketUrl }), { status: 200 }));
      return networkFetch(input, init);
    });
    const uploader = makeUploader();
    try {
      await expect(uploader.connect(task, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "CDP_UNAVAILABLE" } });
      expect((await fixture.inspect()).pages.map(page => page.id)).toEqual(before);
    } finally { fetchSpy.mockRestore(); }
  });

  it("uploads two files sequentially into one owned modal after each prior item is ready", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "first.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "second.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    const firstPrepared = await openAndFence(uploader, first);
    await uploader.upload(first, signal);
    const firstReady = await uploader.ready(first, signal);
    expect(firstReady).toMatchObject({ fileName: "first.mp4", selectedCount: 1, pageOwnership: firstPrepared.pageOwnership });

    const prior = [{ fileName: "first.mp4", index: 1 }];
    const secondPrepared = await uploader.open(second, prior, signal);
    expect(secondPrepared.pageOwnership).toEqual(firstPrepared.pageOwnership);
    expect(secondPrepared.selectedIndex).toBe(2);
    second.result = { ...second.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await uploader.upload(second, signal);
    const secondReady = await uploader.ready(second, signal);
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
    await expect(uploader.open(task, [], new AbortController().signal)).rejects.toMatchObject({ failure: { code: "CAPACITY_INSUFFICIENT" } });
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
    await expect(uploader.open(task, [], new AbortController().signal)).rejects.toMatchObject({ failure: { code } });
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toEqual([]);
    expect((await fixture.inspect()).events.filter(event => ["confirm", "settings"].includes(event.type))).toEqual([]);
  });

  it("rejects a changed selected filename before the next task can choose a file", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "stable.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "next.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    await openAndFence(uploader, first); await uploader.upload(first, signal); await uploader.ready(first, signal);
    fixture.setControls({ drift: true });
    await new Promise(resolve => setTimeout(resolve, 160));
    await expect(uploader.open(second, [{ fileName: "stable.mp4", index: 1 }], signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    const files = (await fixture.inspect()).events.filter(event => event.type === "files");
    expect(files).toHaveLength(1);
  });

  it("blocks the next selection while the prior item is still processing", async () => {
    fixture.reset(); fixture.setControls({ readyState: "processing" });
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const first = await makeTask({ name: "processing.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "must-not-start.mp4", pageBatchId, batchId, expectedCount: 2 });
    const uploader = makeUploader(), signal = new AbortController().signal;
    await openAndFence(uploader, first); await uploader.upload(first, signal);
    await waitForEvents(events => events.some(event => event.type === "files"));
    await expect(uploader.open(second, [{ fileName: "processing.mp4", index: 1 }], signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_CHANGED" } });
    expect((await fixture.inspect()).events.filter(event => event.type === "files")).toHaveLength(1);
  });

  it("recovers only the original owned tab and does not select another file", async () => {
    fixture.reset();
    const pageBatchId = randomUUID(), batchId = randomUUID();
    const task = await makeTask({ name: "recover.mp4", pageBatchId, batchId, expectedCount: 2 });
    const second = await makeTask({ name: "recover-second.mp4", pageBatchId, batchId, expectedCount: 2 });
    const firstUploader = makeUploader(), signal = new AbortController().signal;
    const prepared = await openAndFence(firstUploader, task);
    await firstUploader.upload(task, signal);
    await firstUploader.ready(task, signal);
    await firstUploader.open(second, [{ fileName: task.result.file_name, index: 1 }], signal);
    second.result = { ...second.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
    await firstUploader.upload(second, signal);
    const originalEvidence = await firstUploader.ready(second, signal);
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
    await uploader.upload(task, controller.signal);
    await waitForEvents(events => events.some(event => event.type === "files"));
    const waiting = uploader.ready(task, controller.signal);
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
