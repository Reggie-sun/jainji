import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { DouyinCdpUploader } from "../src/main/douyin-cdp-uploader";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";
import { QianchuanUploadConfigSchema, type ReadyEvidence } from "../src/shared/douyin-upload";
import { resolveChromeExecutable, startQianchuanFixture, type QianchuanFixture } from "./helpers/douyin-cdp-fixture";

const roots: string[] = [];
const fixtures: QianchuanFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-upload-page-")); roots.push(root);
  const fixture = await startQianchuanFixture({ tempRoot: root, chromeExecutable: await resolveChromeExecutable(), production: true,
    fixtureHtml: path.resolve("tests/fixtures/qianchuan-production-page.html") }); fixtures.push(fixture);
  const bytes = Buffer.from("isolated automation upload confirmation fixture"), filePath = path.join(root, "approved-output.mp4");
  await writeFile(filePath, bytes);
  const input = { project_id: randomUUID(), batch_id: randomUUID(), export_task_id: randomUUID(), video_path: filePath,
    artifact_sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length };
  const target = { product: "眼贴" as const, cdpEndpoint: fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) };
  const authorization = { target, pageBatchId: randomUUID(), expectedCount: 1 };
  const task: UploadTaskRecord = { input, inputDigest: frozenInputDigest(input, authorization), authorization, snapshotPath: filePath,
    config: QianchuanUploadConfigSchema.parse({ enabled: true, timeouts: { connect: 8_000, navigation: 8_000, fileInput: 8_000, processing: 4_000, action: 5_000 } }),
    result: { ...input, upload_task_id: uploadTaskId(input, target), artifact_sha256: input.artifact_sha256, file_name: path.basename(filePath),
      accountProduct: target.product, advertiserId: target.advertiserId, adId: target.adId, state: "PENDING", upload_outcome: "NOT_SELECTED",
      retryable: false, retry_count: 0, attempt_count: 1, timestamp: new Date().toISOString() } };
  return { fixture, task };
}

async function markReady(uploader: DouyinCdpUploader, task: UploadTaskRecord, signal: AbortSignal) {
  const opened = await uploader.open([task], [], signal);
  task.result = { ...task.result, state: "UPLOADING", upload_outcome: "MAY_HAVE_UPLOADED" };
  await uploader.upload([task], signal);
  const [readyEvidence] = await uploader.ready([task], signal);
  task.result = { ...task.result, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: readyEvidence as ReadyEvidence };
  return opened.pageOwnership;
}

it("clicks only the exact complete owned modal once and does not treat the click as platform acceptance", async () => {
  const { fixture, task } = await setup(), uploader = new DouyinCdpUploader(fixture.contract), signal = new AbortController().signal;
  try {
    await uploader.connect(task, signal);
    const ownership = await markReady(uploader, task, signal);
    task.config.timeouts.action = 300;
    await expect(uploader.confirmAutomation([task], ownership, signal)).rejects.toThrow();
    await expect(uploader.confirmAutomation([task], ownership, signal)).rejects.toThrow();
    const observed = await fixture.inspect();
    expect(observed.events.filter(event => event.type === "files").map(event => event.names)).toEqual([[task.result.file_name]]);
    expect(observed.events.filter(event => event.type === "confirm")).toHaveLength(1);
  } finally { await uploader.stop(); }
});

it("confirms both owned dialogs once and binds the successful plan response to the selected file", async () => {
  const { fixture, task } = await setup(), uploader = new DouyinCdpUploader(fixture.contract), signal = new AbortController().signal;
  const browser = await chromium.connectOverCDP(fixture.cdpEndpoint, { isLocal: true });
  try {
    await uploader.connect(task, signal);
    const ownership = await markReady(uploader, task, signal);
    const page = browser.contexts()[0]!.pages().find(value => value.url().includes("adId=987654"))!;
    await page.route("**/ad/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"status_code":0}' }));
    await page.evaluate(fileName => {
      document.querySelector("#confirm-button")!.addEventListener("click", () => {
        const modal = document.createElement("div"); modal.className = "ovui-modal";
        modal.innerHTML = '<div class="oc-modal-confirm-title">确认添加并开始投放 1 个素材吗？</div><button>确定</button>';
        document.body.append(modal);
        modal.querySelector("button")!.addEventListener("click", async () => {
          modal.querySelector("button")!.disabled = true;
          await fetch("/ad/api/creation/material/bind-video-to-owner?aavid=123456", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vids: [{ file_name: fileName, video_id: "fixture_video" }] }) });
          await fetch("/ad/api/pmc/v1/uni-promotion/material/add-uni-prom-materials?aavid=123456", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aggregateAID: "987654", proceduralCreative: { videoMaterial: [{ videoId: "fixture_video" }] } }) });
          modal.remove();
        });
      });
    }, task.result.file_name);
    const [proof] = await uploader.confirmAutomation([task], ownership, signal);
    expect(proof).toMatchObject({ advertiserId: "123456", adId: "987654", platformVideoId: "fixture_video", fileName: task.result.file_name, pageOwnership: ownership });
    await expect(uploader.confirmAutomation([task], ownership, signal)).rejects.toThrow();
    expect((await fixture.inspect()).events.filter(event => event.type === "confirm")).toHaveLength(1);
  } finally { await browser.close(); await uploader.stop(); }
});

it("refuses ambiguous confirmation controls without clicking", async () => {
  const { fixture, task } = await setup(), uploader = new DouyinCdpUploader(fixture.contract), signal = new AbortController().signal;
  try {
    await uploader.connect(task, signal);
    const ownership = await markReady(uploader, task, signal);
    fixture.setControls({ duplicateConfirm: true });
    await expect(uploader.confirmAutomation([task], ownership, signal)).rejects.toThrow();
    const observed = await fixture.inspect();
    expect(observed.events.filter(event => event.type === "confirm")).toHaveLength(0);
  } finally { await uploader.stop(); }
});
