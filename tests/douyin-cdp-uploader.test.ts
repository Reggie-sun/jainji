import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { DouyinCdpUploader, douyinReadiness, type DouyinPageContract } from "../src/main/douyin-cdp-uploader";
import { DouyinUploadConfigSchema } from "../src/shared/douyin-upload";
import { frozenInputDigest, uploadTaskId, type UploadTaskRecord } from "../src/main/douyin-upload-store";

const doubles = vi.hoisted(() => ({ browser: undefined as any, connect: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { connectOverCDP: (...args: any[]) => { doubles.connect(...args); return Promise.resolve(doubles.browser); } } }));
export const contract: DouyinPageContract = {
  version: "offline-fixture/1", uploadUrl: "http://127.0.0.1:12345/upload", fileSelectionDoesNotPublish: true, captionLimit: 100,
  file: "file", caption: "caption", ready: "ready", publish: "publish", login: "login", challenge: "challenge", account: "account", rejection: "rejected", accepted: "accepted", contentIdAttribute: "content-id", statusAttribute: "status",
  managementUrl: id => `http://127.0.0.1:12345/detail/${id}`, evidenceUrl: id => `https://creator.douyin.com/detail/${id}`,
};
function record(): UploadTaskRecord {
  const input = { project_id: crypto.randomUUID(), batch_id: crypto.randomUUID(), export_task_id: crypto.randomUUID(), video_path: "/private/source.mp4", artifact_sha256: "a".repeat(64), size_bytes: 1, caption: "手工文案" };
  return { input, inputDigest: frozenInputDigest(input), config: DouyinUploadConfigSchema.parse({ timeouts: { processing: 10, confirmation: 50 } }), snapshotPath: "/private/snapshot.mp4", revisions: [], result: { ...{ project_id: input.project_id, batch_id: input.batch_id, export_task_id: input.export_task_id }, upload_task_id: uploadTaskId(input), artifact_sha256: input.artifact_sha256, file_name: "source.mp4", state: "PENDING", publish_outcome: "NOT_SUBMITTED", retry_count: 0, retryable: false, timestamp: new Date().toISOString() } };
}
function pageFixture(options: { challenge?: boolean; count?: number; id?: string; status?: string; changedId?: string; ready?: boolean } = {}) {
  let url = "about:blank", reopened = false; const events: string[] = [];
  const page = {
    url: () => url, goto: async (next: string) => { url = next; reopened = next.includes("detail"); events.push("navigate"); }, waitForTimeout: async () => {},
    locator: (selector: string) => ({
      count: async () => selector === "file" ? options.count ?? 1 : 1,
      isVisible: async () => selector === "challenge" ? options.challenge ?? false : ["login", "rejected"].includes(selector) ? false : selector === "ready" ? options.ready ?? true : true,
      textContent: async () => "fixture-account", isEnabled: async () => true,
      inputValue: async () => "手工文案",
      getAttribute: async (attribute: string) => attribute === "content-id" ? (reopened ? options.changedId ?? options.id ?? "123" : options.id ?? "123") : options.status ?? "reviewing",
      waitFor: async () => {}, setInputFiles: async () => { events.push("file"); }, fill: async (caption: string) => { events.push(`caption:${caption}`); }, click: async () => { events.push("publish"); },
    }),
  };
  doubles.browser = { contexts: () => [{ newPage: async () => page }], close: async () => { events.push("detach"); } };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fixture" }) })));
  return { page, events };
}
afterEach(() => { vi.unstubAllGlobals(); doubles.connect.mockClear(); });

describe("finite CDP page flow", () => {
  it("blocks unverified production routes before discovery or file selection", async () => {
    const task = record(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const uploader = new DouyinCdpUploader();
    expect(douyinReadiness(task.config)).toContain("尚未核实");
    await expect(uploader.connect(task, new AbortController().signal)).rejects.toMatchObject({ failure: { code: "PAGE_CONTRACT_UNVERIFIED" } });
    expect(fetch).not.toHaveBeenCalled(); expect(doubles.connect).not.toHaveBeenCalled();
  });
  it.each(["ws://remote.test/devtools/browser/1", "ws://u:p@127.0.0.1:9222/devtools/browser/1", "ws://127.0.0.1:9223/devtools/browser/1"])("rejects unsafe discovery WS %s", async url => {
    pageFixture(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: url }) })));
    await expect(new DouyinCdpUploader(contract).connect(record(), new AbortController().signal)).rejects.toThrow();
    expect(doubles.connect).not.toHaveBeenCalled();
  });
  it("requires the service fence, accepts only same stable ID reopened in management and detaches", async () => {
    const f = pageFixture(), task = record(), signal = new AbortController().signal, uploader = new DouyinCdpUploader(contract);
    try {
      await uploader.connect(task, signal); await uploader.open(task, signal); await uploader.upload(task, signal); await uploader.ready(task, signal); await uploader.fill(task, signal);
      await expect(uploader.publish(task, signal)).rejects.toThrow(); task.result.publish_outcome = "MAY_HAVE_SUBMITTED";
      await uploader.publish(task, signal); await expect(uploader.publish(task, signal)).rejects.toThrow();
      expect(await uploader.verify(task, signal)).toMatchObject({ platform_content_id: "123", accepted_status: "reviewing" });
      expect(f.events.filter(event => event === "publish")).toHaveLength(1);
      expect(f.events).toContain("caption:手工文案");
    } finally { await uploader.stop(); }
    expect(f.events).toContain("detach");
  });
  it.each([{ status: "draft" }, { id: "" }, { changedId: "other" }])("does not accept weak/contradictory evidence %s", async options => {
    pageFixture(options); const task = record(), signal = new AbortController().signal, uploader = new DouyinCdpUploader(contract);
    try { await uploader.connect(task, signal); await uploader.open(task, signal); task.result.publish_outcome = "MAY_HAVE_SUBMITTED"; await uploader.publish(task, signal); await expect(uploader.verify(task, signal)).rejects.toMatchObject({ failure: { code: "PUBLISH_CONFIRMATION_UNAVAILABLE" } }); }
    finally { await uploader.stop(); }
  });
  it.each([{ challenge: true }, { count: 2 }])("stops on challenge/ambiguous input %s", async options => {
    const f = pageFixture(options), uploader = new DouyinCdpUploader(contract), task = record(), signal = new AbortController().signal;
    try { await uploader.connect(task, signal); await expect((async () => { await uploader.open(task, signal); await uploader.upload(task, signal); })()).rejects.toThrow(); expect(f.events).not.toContain("file"); expect(f.events).not.toContain("publish"); }
    finally { await uploader.stop(); }
  });
  it("read-only reconnection cannot choose a new file or infer ownership from the first tab", async () => {
    const f = pageFixture(), uploader = new DouyinCdpUploader(contract), task = record(), signal = new AbortController().signal; task.result.publish_outcome = "MAY_HAVE_SUBMITTED";
    try { await uploader.connect(task, signal); await expect(uploader.verify(task, signal)).rejects.toThrow(); expect(f.events).not.toContain("file"); expect(f.events).not.toContain("publish"); expect(f.events).not.toContain("navigate"); }
    finally { await uploader.stop(); }
  });
  it("does not start a late CDP attach when stopped while the local relay starts", async () => {
    pageFixture(); const controller = new AbortController(), uploader = new DouyinCdpUploader(contract);
    const listen = http.Server.prototype.listen;
    const hook = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function(this: http.Server, ...args: any[]) {
      const callback = args[args.length - 1];
      args[args.length - 1] = () => { controller.abort(); callback(); };
      return Reflect.apply(listen, this, args);
    } as any);
    try {
      await expect(uploader.connect(record(), controller.signal)).rejects.toThrow();
      expect(doubles.connect).not.toHaveBeenCalled();
    } finally { hook.mockRestore(); await uploader.stop(); }
  });
});
