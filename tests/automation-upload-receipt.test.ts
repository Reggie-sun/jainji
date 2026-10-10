import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, expect, it } from "vitest";
import type { Frame, Page, Request, Response } from "playwright-core";
import { createQianchuanConfirmationReceiptObserver } from "../src/main/qianchuan-confirmation-receipt";

const advertiserId = "1234567890";
const adId = "9988776655";
const origin = "https://fixture.qianchuan.test";
const filenames = ["first.mp4", "second.mp4"];
const listeners: Array<{ observer: ReturnType<typeof createQianchuanConfirmationReceiptObserver>; page: EventEmitter }> = [];
afterEach(() => { for (const { observer } of listeners.splice(0)) observer.dispose(); });

type Kind = "bind" | "add";
function makeFrame(page: EventEmitter): Frame { return { page: () => page as unknown as Page } as unknown as Frame; }

function makeRequest(frame: Frame, kind: Kind, body: unknown, options: { advertiserId?: string; duplicateAdvertiser?: boolean; bodyAdvertiserId?: string; plan?: string; redirected?: boolean; urlOrigin?: string } = {}) {
  const route = kind === "bind" ? "/ad/api/creation/material/bind-video-to-owner" : "/ad/api/pmc/v1/uni-promotion/material/add-uni-prom-materials";
  const accountQuery = `aavid=${options.advertiserId ?? advertiserId}${options.duplicateAdvertiser ? `&aavid=${options.advertiserId ?? advertiserId}` : ""}`;
  const url = `${options.urlOrigin ?? origin}${route}?${accountQuery}`;
  const shaped = kind === "add" && options.plan ? { ...(body as object), aggregateAID: options.plan } : body;
  const withAccount = options.bodyAdvertiserId === undefined ? shaped : { ...(shaped as object), aavid: options.bodyAdvertiserId };
  const raw = Buffer.from(JSON.stringify(withAccount));
  const request = {
    url: () => url,
    method: () => "POST",
    frame: () => frame,
    postDataBuffer: () => raw,
    redirectedFrom: () => options.redirected ? ({} as Request) : null,
  } as Request;
  return { request, raw };
}

function makeResponse(request: Request, body: unknown, options: { status?: number; contentLength?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const response = {
    request: () => request,
    status: () => options.status ?? 200,
    headers: () => options.contentLength === undefined ? { "content-length": String(raw.length) } : options.contentLength === "" ? {} : { "content-length": options.contentLength },
    body: async () => raw,
  } as unknown as Response;
  return { response, raw };
}

function directAdd(ids: string[]) {
  return { aggregateAID: adId, aavid: advertiserId, _origin_ajax_: 1,
    proceduralCreative: { videoMaterial: ids.map(videoId => ({ videoId })), titleMaterial: [] } };
}

function fixture(timeoutMs = 1_000) {
  const page = new EventEmitter();
  const frame = makeFrame(page);
  const observer = createQianchuanConfirmationReceiptObserver({ page: page as unknown as Page, frame, advertiserId, adId, filenames, origin });
  listeners.push({ observer, page });
  const pending = observer.wait(new AbortController().signal, timeoutMs);
  return { page, frame, observer, pending };
}

function bindBody(rows = [{ file_name: filenames[0], video_id: "video-1" }, { file_name: filenames[1], video_id: "video-2" }]) {
  return { vids: rows, aavid: advertiserId, _origin_ajax_: 1 };
}

async function emitAcceptedPair(page: EventEmitter, frame: Frame, addPayload: unknown = directAdd(["video-2", "video-1"]), options: { plan?: string } = {}) {
  const bind = makeRequest(frame, "bind", bindBody());
  const add = makeRequest(frame, "add", addPayload, options);
  page.emit("request", bind.request);
  page.emit("request", add.request);
  const addResponse = makeResponse(add.request, { status_code: 0, data: {} });
  const bindResponse = makeResponse(bind.request, { status_code: 0, data: {} });
  page.emit("response", addResponse.response);
  page.emit("response", bindResponse.response);
  return { bind, add, bindResponse, addResponse };
}

it("returns a receipt only after the bound videos and exact plan receive both successful responses", async () => {
  const { page, frame, pending } = fixture();
  const { add, addResponse } = await emitAcceptedPair(page, frame);
  const receipt = await pending;
  expect(receipt).toEqual({
    videoIds: ["video-1", "video-2"],
    requestSha256: createHash("sha256").update(add.raw).digest("hex"),
    responseSha256: createHash("sha256").update(addResponse.raw).digest("hex"),
    observedAt: expect.any(String),
  });
  expect(Number.isNaN(Date.parse(receipt.observedAt))).toBe(false);
  expect(page.listenerCount("request")).toBe(0);
  expect(page.listenerCount("response")).toBe(0);
  expect(page.listenerCount("requestfailed")).toBe(0);
});

it("accepts the platform multi-product video material shape", async () => {
  const { page, frame, pending } = fixture();
  const payload = { aggregateAID: adId, aavid: advertiserId, _origin_ajax_: 1, createMultiProductsCreative: [
    { productId: "product-1", createCreativeInfo: { proceduralCreative: { videoMaterial: [{ videoId: "video-1" }], titleMaterial: [] } } },
    { productId: "product-2", createCreativeInfo: { proceduralCreative: { videoMaterial: [{ videoId: "video-2" }], titleMaterial: [] } } },
  ] };
  await emitAcceptedPair(page, frame, payload);
  await expect(pending).resolves.toMatchObject({ videoIds: ["video-1", "video-2"] });
});

it("rejects a second add request before treating the first response as accepted", async () => {
  const { page, frame, pending } = fixture();
  const bind = makeRequest(frame, "bind", bindBody());
  const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
  page.emit("request", bind.request);
  page.emit("request", add.request);
  page.emit("request", makeRequest(frame, "add", directAdd(["video-1", "video-2"])).request);
  await expect(pending).rejects.toThrow(/重复/);
});

it("rejects a repeated bind request", async () => {
  const { page, frame, pending } = fixture();
  page.emit("request", makeRequest(frame, "bind", bindBody()).request);
  page.emit("request", makeRequest(frame, "bind", bindBody()).request);
  await expect(pending).rejects.toThrow(/重复/);
});

it("rejects a mismatched advertiser before recording any receipt", async () => {
  const { page, frame, pending } = fixture();
  page.emit("request", makeRequest(frame, "bind", bindBody(), { advertiserId: "different-account" }).request);
  await expect(pending).rejects.toThrow(/账号/);
});

it("rejects wrong origins, duplicate account parameters, redirects, and a mismatched body account", async () => {
  const cases: Array<{ options: Parameters<typeof makeRequest>[3]; message: RegExp }> = [
    { options: { urlOrigin: "https://other.qianchuan.test" }, message: /来源/ },
    { options: { duplicateAdvertiser: true }, message: /账号/ },
    { options: { redirected: true }, message: /重定向/ },
    { options: { bodyAdvertiserId: "other-account" }, message: /正文账号/ },
  ];
  for (const { options, message } of cases) {
    const { page, frame, pending } = fixture();
    page.emit("request", makeRequest(frame, "bind", bindBody(), options).request);
    await expect(pending).rejects.toThrow(message);
  }
});

it("ignores requests from a different frame and rejects an exact-frame request failure", async () => {
  {
    const { page, pending } = fixture(20);
    page.emit("request", makeRequest(makeFrame(new EventEmitter()), "bind", bindBody()).request);
    await expect(pending).rejects.toThrow(/超时/);
  }
  {
    const { page, frame, pending } = fixture(20);
    const request = makeRequest(frame, "bind", bindBody()).request;
    page.emit("request", request);
    page.emit("requestfailed", request);
    await expect(pending).rejects.toThrow(/未收到平台响应/);
  }
});

it("rejects a mismatched plan, ambiguous binding, or unsuccessful response", async () => {
  {
    const { page, frame, pending } = fixture();
    await emitAcceptedPair(page, frame, directAdd(["video-1", "video-2"]), { plan: "different-plan" });
    await expect(pending).rejects.toThrow(/计划/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody([{ file_name: filenames[0], video_id: "same" }, { file_name: filenames[1], video_id: "same" }]));
    page.emit("request", bind.request);
    await expect(pending).rejects.toThrow(/唯一/);
  }
  {
    const { page, frame, pending } = fixture();
    page.emit("request", makeRequest(frame, "bind", bindBody([{ file_name: filenames[0], video_id: "video-1" }, { file_name: "unexpected.mp4", video_id: "video-2" }])).request);
    await expect(pending).rejects.toThrow(/文件名/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", directAdd(["video-1", "wrong-video"]));
    page.emit("request", bind.request);
    page.emit("request", add.request);
    page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
    page.emit("response", makeResponse(add.request, { status_code: 0 }).response);
    await expect(pending).rejects.toThrow(/不一致/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
    page.emit("request", bind.request);
    page.emit("request", add.request);
    page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
    page.emit("response", makeResponse(add.request, { status_code: 0 }, { status: 503 }).response);
    await expect(pending).rejects.toThrow(/HTTP/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
    page.emit("request", bind.request);
    page.emit("request", add.request);
    page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
    page.emit("response", makeResponse(add.request, { status_code: 1 }).response);
    await expect(pending).rejects.toThrow(/未确认/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", { ...directAdd(["video-1", "video-2"]), padding: "x".repeat(1024 * 1024) });
    page.emit("request", bind.request);
    page.emit("request", add.request);
    await expect(pending).rejects.toThrow(/大小限制/);
  }
});

it("rejects mixed media, nonempty titles, extra settings, and invalid multi-product entries", async () => {
  const invalidBodies: unknown[] = [
    { ...directAdd(["video-1", "video-2"]), settings: { budget: 999 } },
    { ...directAdd(["video-1", "video-2"]), proceduralCreative: { videoMaterial: [{ videoId: "video-1" }, { videoId: "video-2" }], imageMaterial: [{ imageId: "image-1" }] } },
    { ...directAdd(["video-1", "video-2"]), proceduralCreative: { videoMaterial: [{ videoId: "video-1" }, { videoId: "video-2" }], titleMaterial: [{ titleId: "title-1" }] } },
    { aggregateAID: adId, createMultiProductsCreative: [{ productId: "product-1", createCreativeInfo: {
      extraSetting: true, proceduralCreative: { videoMaterial: [{ videoId: "video-1" }, { videoId: "video-2" }] },
    } }] },
    { aggregateAID: adId, createMultiProductsCreative: [{ productId: "bad product", createCreativeInfo: {
      proceduralCreative: { videoMaterial: [{ videoId: "video-1" }, { videoId: "video-2" }] },
    } }] },
  ];
  for (const body of invalidBodies) {
    const { page, frame, pending } = fixture();
    page.emit("request", makeRequest(frame, "add", body).request);
    await expect(pending).rejects.toThrow();
  }
});

it("rejects an oversized response before parsing it and refuses responses without a bounded length", async () => {
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
    page.emit("request", bind.request); page.emit("request", add.request);
    page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
    page.emit("response", makeResponse(add.request, { status_code: 0, padding: "x".repeat(1024 * 1024) }).response);
    await expect(pending).rejects.toThrow(/大小限制/);
  }
  {
    const { page, frame, pending } = fixture();
    const bind = makeRequest(frame, "bind", bindBody());
    const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
    page.emit("request", bind.request); page.emit("request", add.request);
    page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
    page.emit("response", makeResponse(add.request, { status_code: 0 }, { contentLength: "" }).response);
    await expect(pending).rejects.toThrow();
  }
});

it("rejects when either successful response is missing by the bounded deadline", async () => {
  const page = new EventEmitter();
  const frame = makeFrame(page);
  const observer = createQianchuanConfirmationReceiptObserver({ page: page as unknown as Page, frame, advertiserId, adId, filenames, origin });
  listeners.push({ observer, page });
  const pending = observer.wait(new AbortController().signal, 15);
  const bind = makeRequest(frame, "bind", bindBody());
  const add = makeRequest(frame, "add", directAdd(["video-1", "video-2"]));
  page.emit("request", bind.request);
  page.emit("request", add.request);
  page.emit("response", makeResponse(bind.request, { status_code: 0 }).response);
  await expect(pending).rejects.toThrow(/超时/);
  expect(page.listenerCount("request")).toBe(0);
});

it("stops observing and rejects promptly when the upload is aborted", async () => {
  const controller = new AbortController();
  const page = new EventEmitter();
  const frame = makeFrame(page);
  const observer = createQianchuanConfirmationReceiptObserver({ page: page as unknown as Page, frame, advertiserId, adId, filenames, origin });
  listeners.push({ observer, page });
  const pending = observer.wait(controller.signal, 1_000);
  controller.abort();
  await expect(pending).rejects.toThrow(/中止/);
  expect(page.listenerCount("request")).toBe(0);
});
