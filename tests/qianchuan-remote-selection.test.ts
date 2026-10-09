import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { selectRemoteFiles } from "../src/main/qianchuan-remote-selection";
import { QianchuanPageSession } from "../src/main/qianchuan-page-contract";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";
import { startQianchuanFixture } from "./helpers/douyin-cdp-fixture";

it("selects nine browser-side files through the real detached production chooser without local path lookup or confirmation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianji-remote-selection-"));
  const fixture = await startQianchuanFixture({ tempRoot: root, production: true, fixtureHtml: path.resolve("tests/fixtures/qianchuan-production-page.html") });
  const browser = await chromium.connectOverCDP(fixture.cdpEndpoint, { noDefaults: true });
  try {
    const page = await browser.contexts()[0].newPage(), signal = new AbortController().signal, batch = randomUUID();
    const tasks: UploadTaskRecord[] = [];
    const paths = new Map<string, string>();
    for (let i = 0; i < 9; i++) {
      const name = `远端素材 ${i}.mp4`, bytes = Buffer.from(`remote video ${i}`), file = path.join(root, name), id = randomUUID();
      await writeFile(file, bytes); paths.set(id, file);
      tasks.push({ input: { artifact_sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length },
        authorization: { pageBatchId: batch, expectedCount: 9, target: { product: "眼贴", cdpEndpoint: fixture.cdpEndpoint, advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) } },
        config: QianchuanUploadConfigSchema.parse({ enabled: true }), snapshotPath: "/no-local-file/" + name,
        result: { upload_task_id: id, file_name: name, upload_outcome: "NOT_SELECTED" },
      } as UploadTaskRecord);
    }
    const session = new QianchuanPageSession(page, fixture.contract, s => s.throwIfAborted(), async (input, selected, s) => {
      expect(selected.every(task => task.result.upload_outcome === "MAY_HAVE_UPLOADED")).toBe(true);
      await selectRemoteFiles(page, input, selected.map(task => paths.get(task.result.upload_task_id)!), s);
    });
    await page.goto(session.url(tasks[0]));
    const cdp = await page.context().newCDPSession(page), target = await cdp.send("Target.getTargetInfo"); await cdp.detach();
    await session.prepare(tasks, [], target.targetInfo.targetId, signal);
    for (const task of tasks) task.result.upload_outcome = "MAY_HAVE_UPLOADED";
    await session.upload(tasks, signal);
    expect(await session.ready(tasks, signal)).toHaveLength(9);
    const events = (await fixture.inspect()).events;
    expect(events.filter(event => event.type === "files")).toHaveLength(1);
    expect(events.filter(event => event.type === "confirm")).toHaveLength(0);
    expect(await page.evaluate(() => Object.getOwnPropertyNames(globalThis).filter(key => key.startsWith("__jianji_remote_")))).toEqual([]);
  } finally { await browser.close(); await fixture.stop(); await rm(root, { recursive: true, force: true }); }
}, 30000);
