import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore, ProjectStore } from "../src/main/store";
import { CoverReviewController } from "../src/main/cover-review-controller";
import { createCoverReviewDraft, editCoverReviewDraft } from "../src/main/cover-review-session";
import { reviewDigest } from "../src/main/cover-review-approval";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { createDefaultTemplate, DEFAULT_PRESET, now, type MediaItem, type Project } from "../src/main/domain";
import type { AgentController } from "../src/main/agent-controller";
import { fingerprintFile } from "../src/main/paths";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-assisted-"));
  const sourcePath = path.join(directory, "source.mp4"); await writeFile(sourcePath, "source");
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  const media: MediaItem = { id: randomUUID(), sourcePath, fingerprint: await fingerprintFile(sourcePath), displayName: "source", durationMs: 1000, width: 100, height: 100, rotation: 0, sizeBytes: 6, importedAt: now(), probeStatus: "ready" };
  service.currentProject.mediaItems.push(media);
  service.setCoverSticker({ ...DEFAULT_COVER_STICKER, enabled: true, trackingMode: "assisted" });
  const file = path.join(directory, "project.json"); await service.saveProject(file);
  const queue = new ExportQueue({ ffmpeg, jobStore: new JobStore(path.join(directory, "jobs")), fontResolver: { resolve: async () => null } });
  vi.spyOn(queue, "start").mockResolvedValue();
  const agent = { assertIdle() {}, cancel: async () => undefined } as unknown as AgentController;
  const controller = new CoverReviewController(service, agent, queue, { root: directory, extract: vi.fn(), analyze: vi.fn(), verify: async () => undefined, changed() {} });
  let draft = createCoverReviewDraft(service.currentProject.id, [media]);
  draft = editCoverReviewDraft(draft, { projectId: draft.projectId, draftId: draft.id, mediaId: media.id, expectedRevision: draft.revision, type: "no_cover" });
  const input = { mediaIds: [media.id], ruleId: "clean" as const, brief: "", outputDirectory: directory, decorations: { mode: "agent" as const, productPrice: "人工文字", sticker: "template" as const, fontFamily: "Noto Sans CJK SC" } };
  const { AgentStartSchema } = await import("../src/shared/agent");
  draft.requestJson = JSON.stringify(AgentStartSchema.parse(input));
  draft.settingsDigest = reviewDigest(service.currentProject.coverSticker);
  const template = createDefaultTemplate();
  const previewRelative = `${draft.projectId}/${draft.id}/${draft.revision}/previews/${randomUUID()}.mp4`;
  const previewFile = path.join(directory, previewRelative); await mkdir(path.dirname(previewFile), { recursive: true }); await writeFile(previewFile, "preview");
  draft.frameTimes = { [media.id]: [0, 500] };
  draft.media[0].evidence = [{ id: randomUUID(), relativePath: `${draft.id}/frame.png`, digest: "a".repeat(64), pts: 0, timeBase: 0.001, width: 100, height: 100, rotation: 0, transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 } }];
  draft.status = "awaiting_approval";
  draft.frozen = [{ mediaId: media.id, version: 1, templateJson: JSON.stringify(template), templateDigest: reviewDigest(template), presetJson: JSON.stringify(DEFAULT_PRESET), bindingDigest: reviewDigest({ projectId: draft.projectId, template, media: [media], preset: DEFAULT_PRESET, outputDirectory: directory }), preview: { relativePath: previewRelative, digest: createHash("sha256").update("preview").digest("hex"), viewed: true } }];
  await service.saveReviewDraft(draft);
  return { directory, service, queue, controller, agent, draft, input, file, previewFile };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("rejects changed output settings, missing preview and forged premature approval", async () => {
  const f = await fixture();
  await expect(f.controller.approve(f.draft.id, f.draft.revision, { ...f.input, brief: "changed" }, new Set([f.directory]))).rejects.toThrow(/设置已变化/);
  await writeFile(f.previewFile, "tampered");
  await expect(f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]))).rejects.toThrow(/摘要/);
  expect(f.queue.snapshot().batches).toHaveLength(0);
});
it("persists intent before queue creation and recovers job-save/receipt-save failure without duplicates", async () => {
  const f = await fixture();
  const original = f.service.saveReviewDraft.bind(f.service);
  const save = vi.spyOn(f.service, "saveReviewDraft");
  let writes = 0;
  save.mockImplementation(async (draft, revision) => { if (++writes === 2) throw new Error("receipt disk failure"); await original(draft, revision); });
  await expect(f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]))).rejects.toThrow(/receipt disk/);
  expect(f.queue.snapshot().batches).toHaveLength(1);
  const disk = JSON.parse(await readFile(f.file, "utf8"));
  expect(disk.reviewDrafts[0].approval.submissionId).toBeTruthy();
  save.mockRestore();
  await f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]));
  await f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]));
  expect(f.queue.snapshot().batches).toHaveLength(1);
  expect((await new ProjectStore(f.file).load()).project.reviewDrafts![0].approval!.receipts).toHaveLength(1);
});

it("does not publish a draft mutation when project storage fails", async () => {
  const f = await fixture();
  const previous = structuredClone(f.service.currentProject.reviewDrafts![0]);
  const spy = vi.spyOn(ProjectStore.prototype, "save").mockRejectedValue(new Error("disk unavailable"));
  try {
    await expect(f.service.saveReviewDraft({ ...previous, status: "preparing_preview" }, previous.revision)).rejects.toThrow(/disk/);
    expect(f.service.currentProject.reviewDrafts![0]).toEqual(previous);
  } finally { spy.mockRestore(); }
});

it("does not let a pending display text save overwrite a review revision", async () => {
  const f = await fixture();
  const gate = deferred();
  const started = deferred();
  const original = ProjectStore.prototype.save;
  let chain = Promise.resolve();
  let firstWrite = true;
  vi.spyOn(ProjectStore.prototype, "save").mockImplementation(function (this: ProjectStore, project: Project) {
    const frozen = structuredClone(project);
    const work = chain.then(async () => {
      if (firstWrite) {
        firstWrite = false;
        started.resolve();
        await gate.promise;
      }
      await original.call(this, frozen);
    });
    chain = work.catch(() => undefined);
    return work;
  });

  f.service.setProductPriceDraft("19.9元");
  const firstPriceSave = f.service.persistCurrentProject();
  await started.promise;
  f.service.setProductPriceDraft("29.9元");
  const finalPriceSave = f.service.persistCurrentProject();
  const previous = structuredClone(f.service.currentProject.reviewDrafts![0]);
  const revised = { ...previous, status: "preparing_preview" as const };
  const reviewSave = f.service.saveReviewDraft(revised, previous.revision);

  gate.resolve();
  await Promise.all([firstPriceSave, finalPriceSave, reviewSave]);
  const disk = JSON.parse(await readFile(f.file, "utf8"));
  expect(disk.templates[0].productPriceDraft).toBe("29.9元");
  expect(disk.reviewDrafts[0].status).toBe("preparing_preview");
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("preparing_preview");
});

it("cancelling while validating evidence cannot start a later creative request", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = [];
  await f.service.saveReviewDraft(draft, draft.revision);
  let release!: () => void;
  const prepareReview = vi.fn();
  const agent = { assertIdle() {}, cancel: async () => undefined, prepareReview } as unknown as AgentController;
  const verify = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new CoverReviewController(f.service, agent, f.queue, { root: f.directory, extract: vi.fn(), analyze: vi.fn(), verify, changed() {} });
  const work = controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory])).catch(() => undefined);
  await vi.waitFor(() => expect(verify).toHaveBeenCalled());
  const cancel = controller.cancel(); release(); await Promise.all([work, cancel]);
  expect(prepareReview).not.toHaveBeenCalled();
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("cancelled");
});

it("disabled cover cannot analyze an old assisted draft; cancellation invalidates approval waiting", async () => {
  const f = await fixture();
  f.service.setCoverSticker({ ...DEFAULT_COVER_STICKER, enabled: false });
  await expect(f.controller.analyze(f.draft.id, f.draft.revision)).rejects.toThrow(/显式启用/);
  await f.controller.cancel();
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("cancelled");
  expect(f.queue.snapshot().batches).toHaveLength(0);
});

it("shutdown preserves waiting and approved drafts and stop blocks concurrent approval", async () => {
  const f = await fixture();
  await f.controller.shutdown();
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("awaiting_approval");
  await f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]));
  await f.controller.shutdown();
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("approved");
  let release!: () => void;
  const save = f.service.saveReviewDraft.bind(f.service);
  const entered = vi.fn();
  vi.spyOn(f.service, "saveReviewDraft").mockImplementation(async (draft, revision) => {
    entered(); await new Promise<void>((resolve) => { release = resolve; }); await save(draft, revision);
  });
  const stopping = f.controller.cancel();
  await vi.waitFor(() => expect(entered).toHaveBeenCalled());
  expect(f.controller.busy).toBe(true);
  await expect(f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory]))).rejects.toThrow(/正在进行/);
  release(); await stopping;
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("cancelled");
});

it("optional review persists blind findings, never approves, and cannot rerun after edits", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = [];
  await f.service.saveReviewDraft(draft, draft.revision);
  const { AgentProvider } = await import("../src/main/agent-provider");
  const calls: unknown[] = [];
  const provider = new AgentProvider();
  provider.useChatGPT("fixture-review", async (messages) => {
    calls.push(messages);
    if (calls.length === 1) return JSON.stringify({ status: "issues", findings: [{ kind: "missing_target", evidenceIds: [draft.media[0].evidence[0].id], reason: "fixture missing target" }] });
    expect(f.service.currentProject.reviewDrafts![0].media[0].issues.some(({ reason }) => reason === "fixture missing target")).toBe(true);
    return JSON.stringify({ status: "no_issue_observed", findings: [] });
  });
  const controller = new CoverReviewController(f.service, f.agent, f.queue, { root: f.directory, extract: vi.fn(), analyze: vi.fn(), verify: async () => undefined, changed() {}, reviewMedia: async () => [{ mediaId: draft.media[0].mediaId, candidates: [], frames: draft.media[0].evidence.map(({ relativePath, digest, ...frame }) => ({ ...frame, url: "data:image/jpeg;base64,YQ==" })) }] });
  const selection = { connectionId: "chatgpt" as const, model: "fixture-review" };
  await controller.review(draft.id, draft.revision, selection, provider);
  expect(calls).toHaveLength(2);
  const result = f.service.currentProject.reviewDrafts![0];
  expect(result.review).toMatchObject({ usedRequests: 2, maxRequests: 2, status: "complete" });
  expect(result.status).toBe("needs_human"); expect(result.approval).toBeUndefined();
  expect(f.queue.snapshot().batches).toHaveLength(0);
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow();
  await expect(controller.review(draft.id, draft.revision, selection, provider)).rejects.toThrow(/一次/);
});

it("shutdown during receipt persistence leaves the committed job recoverable", async () => {
  const f = await fixture();
  const save = f.service.saveReviewDraft.bind(f.service);
  let release!: () => void;
  const receiptSave = vi.fn();
  vi.spyOn(f.service, "saveReviewDraft").mockImplementation(async (draft, revision) => {
    if (draft.approval?.receipts.length) { receiptSave(); await new Promise<void>((resolve) => { release = resolve; }); }
    await save(draft, revision);
  });
  const approving = f.controller.approve(f.draft.id, f.draft.revision, f.input, new Set([f.directory])).catch(() => undefined);
  await vi.waitFor(() => expect(receiptSave).toHaveBeenCalled());
  const stopping = f.controller.shutdown(); release(); await Promise.all([approving, stopping]);
  expect(f.service.currentProject.reviewDrafts![0].status).toBe("approved");
  expect(f.queue.snapshot().batches[0].batch.tasks[0].status).toBe("queued");
  await f.queue.shutdown();
  const restored = new ExportQueue({ ffmpeg: new FfmpegAdapter("unused", "unused"), jobStore: new JobStore(path.join(f.directory, "jobs")), fontResolver: { resolve: async () => null } });
  await restored.recover();
  expect(restored.snapshot().batches[0].batch.tasks[0].status).toBe("interrupted");
});
