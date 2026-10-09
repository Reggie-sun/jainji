import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { DouyinCdpUploader } from "../src/main/douyin-cdp-uploader";
import * as egress from "../src/main/qianchuan-egress-browser";
import { startQianchuanFixture } from "./helpers/douyin-cdp-fixture";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";

it("refuses an unverified route before opening any upload connection", async () => {
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockRejectedValue(new Error("wrong route"));
  const uploader = new DouyinCdpUploader();
  try {
    await expect(uploader.connect({ authorization: { target: { cdpEndpoint: "http://127.0.0.1:9222" } } } as UploadTaskRecord, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "ACCOUNT_UNCONFIRMED" } });
  } finally { await uploader.stop(); verify.mockRestore(); }
});
it("tunnel loss detaches automation and rejects later delivery while keeping original Chrome open", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-egress-upload-"));
  const fixture = await startQianchuanFixture({ tempRoot: root });
  const controller = new AbortController();
  const verify = vi.spyOn(egress, "verifyBrowserEgress").mockResolvedValue({ identity: "frozen-route", signal: controller.signal });
  const uploader = new DouyinCdpUploader(fixture.contract);
  try {
    await uploader.connect({ authorization: { target: { cdpEndpoint: fixture.cdpEndpoint } }, config: { timeouts: { connect: 5000 } } } as UploadTaskRecord, new AbortController().signal);
    controller.abort(new Error("tunnel disconnected"));
    await expect(uploader.upload([], new AbortController().signal)).rejects.toThrow();
    const evidence = await fixture.inspect();
    expect(evidence.chromeRunning).toBe(true);
    expect(evidence.pages.some(page => page.id === fixture.originalTargetId)).toBe(true);
    expect(evidence.events).toHaveLength(0);
  } finally { await uploader.stop(); verify.mockRestore(); await fixture.stop(); await rm(root, { recursive: true, force: true }); }
}, 15000);
