import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ExportQueue, type QueueSnapshot } from "../src/main/queue";
import { JobStore, ProjectStore } from "../src/main/store";
import { CoverReviewController } from "../src/main/cover-review-controller";
import { createCoverReviewDraft, editCoverReviewDraft } from "../src/main/cover-review-session";
import { reviewDigest } from "../src/main/cover-review-approval";
import { DEFAULT_COVER_STICKER } from "../src/shared/cover-sticker";
import { createDefaultTemplate, DEFAULT_PRESET, now, BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, type MediaItem, type Project } from "../src/main/domain";
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

it("resumes historical three-second approvals without upgrading their frozen request", async () => {
  const f = await fixture();
  const input = { ...f.input, decorations: { ...f.input.decorations, displayMode: "first-3s" as const } };
  f.draft.requestJson = JSON.stringify(input);
  await f.service.saveReviewDraft(f.draft, f.draft.revision);
  await expect(f.controller.approve(f.draft.id, f.draft.revision, { ...input, decorations: { ...input.decorations, displayMode: "first-5s" } }, new Set([f.directory]))).rejects.toThrow(/设置已变化/);
  await f.controller.approve(f.draft.id, f.draft.revision, input, new Set([f.directory]));
  await f.controller.approve(f.draft.id, f.draft.revision, input, new Set([f.directory]));
  expect(f.service.currentProject.reviewDrafts![0].approval!.receipts).toHaveLength(1);
  expect(JSON.parse(f.service.currentProject.reviewDrafts![0].requestJson!).decorations.displayMode).toBe("first-3s");
});

it("approves a new five-second preview prepared from an old editable timing choice", async () => {
  const f = await fixture();
  const input = { ...f.input, decorations: { ...f.input.decorations, displayMode: "first-3s" as const } };
  const { AgentStartSchema } = await import("../src/shared/agent");
  f.draft.requestJson = JSON.stringify(AgentStartSchema.parse(input));
  await f.service.saveReviewDraft(f.draft, f.draft.revision);
  await f.controller.approve(f.draft.id, f.draft.revision, input, new Set([f.directory]));
  expect(f.service.currentProject.reviewDrafts![0].approval!.receipts).toHaveLength(1);
  expect(JSON.parse(f.service.currentProject.reviewDrafts![0].requestJson!).decorations.displayMode).toBe("first-5s");
});

it.each(["complete", "save failure", "cancel"])("publishes draft frame preparation progress and recovers after %s", async (outcome) => {
  const f = await fixture();
  const first = f.service.currentProject.mediaItems[0];
  const second = { ...first, id: randomUUID() };
  f.service.currentProject.mediaItems.push(second);
  const gate = deferred();
  const extract = vi.fn(async (media: MediaItem) => {
    if (media.id === second.id) await gate.promise;
    return { evidence: structuredClone(f.draft.media[0].evidence), images: [], frameTimesMs: [0] };
  });
  const discardEvidence = vi.fn(async () => undefined);
  const controller = new CoverReviewController(f.service, f.agent, f.queue, { root: f.directory, extract, analyze: vi.fn(), verify: async () => undefined, discardEvidence, changed() {} });
  const creating = controller.create([first.id, second.id]);
  const result = creating.catch(error => error);
  try {
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    const draft = f.service.currentProject.reviewDrafts!.at(-1)!;
    expect(draft.status).toBe("draft");
    expect(draft.media[0].evidence.length).toBeGreaterThan(0);
    expect(draft.media[1].evidence).toEqual([]);
    if (outcome === "save failure") vi.spyOn(f.service, "saveReviewDraft").mockRejectedValue(new Error("disk failure"));
    if (outcome === "cancel") { const stop = controller.cancel(); gate.resolve(); await stop; }
  } finally { gate.resolve(); await result; }
  if (outcome === "save failure") expect(await result).toMatchObject({ message: "disk failure" });
  expect(f.service.currentProject.reviewDrafts!.at(-1)!.status).toBe(outcome === "cancel" ? "cancelled" : "needs_human");
  expect(discardEvidence).not.toHaveBeenCalled();
  expect(controller.busy).toBe(false);
});

it("repairs missing frame evidence without discarding confirmed boxes or decisions", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = [];
  const originalEvidence = structuredClone(draft.media[0].evidence);
  draft.media[0].evidence = []; delete draft.frameTimes;
  const identityId = randomUUID();
  draft.media[0].identities = [{ id: identityId, label: "人工框", semantics: "sticker", origin: "human" }];
  draft.media[0].segments = [{ id: randomUUID(), identityId, origin: "human", track: { startMs: 0, endMs: 1000, keyframes: [{ timeMs: 0, rectangle: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } }] } }];
  draft.media[0].disposition = "cover"; draft.media[0].analysis = "incomplete"; draft.media[0].analysisError = "证据准备未完成";
  await f.service.saveReviewDraft(draft, draft.revision);
  const extract = vi.fn(async () => ({ evidence: originalEvidence, images: [], frameTimesMs: [0, 500] }));
  const prepareReview = vi.fn(async () => { throw new Error("MODEL_BOUNDARY"); });
  const controller = new CoverReviewController(f.service, { ...f.agent, prepareReview } as unknown as AgentController, f.queue, { root: f.directory, extract, analyze: vi.fn(), verify: async () => undefined, changed() {} });
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("MODEL_BOUNDARY");
  const saved = (await new ProjectStore(f.file).load()).project.reviewDrafts![0];
  expect(saved.id).toBe(draft.id); expect(saved.revision).toBe(draft.revision);
  expect(saved.media[0]).toMatchObject({ disposition: "cover", segments: draft.media[0].segments, identities: draft.media[0].identities, decisions: draft.media[0].decisions, evidence: originalEvidence });
  expect(saved.media[0].analysisError).toBeUndefined(); expect(saved.frameTimes).toEqual({ [draft.media[0].mediaId]: [0, 500] });
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("MODEL_BOUNDARY");
  expect(extract).toHaveBeenCalledTimes(1);
});

it("retains old evidence references when only frame times need repair", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = []; delete draft.frameTimes;
  draft.media[0].observations = [{ evidenceId: draft.media[0].evidence[0].id, presence: "UNKNOWN", origin: "algorithm" }];
  await f.service.saveReviewDraft(draft, draft.revision);
  const generated = [{ ...draft.media[0].evidence[0], id: randomUUID() }];
  const discardEvidence = vi.fn(async () => undefined);
  const controller = new CoverReviewController(f.service, { ...f.agent, prepareReview: async () => { throw new Error("MODEL_BOUNDARY"); } } as unknown as AgentController, f.queue, { root: f.directory, extract: async () => ({ evidence: generated, images: [], frameTimesMs: [0, 500] }), analyze: vi.fn(), verify: async () => undefined, discardEvidence, changed() {} });
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("MODEL_BOUNDARY");
  expect(f.service.currentProject.reviewDrafts![0].media[0]).toMatchObject({ evidence: draft.media[0].evidence, observations: draft.media[0].observations });
  expect(discardEvidence).toHaveBeenCalledWith(draft.projectId, generated, []);
});

it.each(["cancel", "save failure"])("handles recovered evidence ownership after %s", async (failure) => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = [];
  const generated = draft.media[0].evidence; draft.media[0].evidence = []; delete draft.frameTimes;
  await f.service.saveReviewDraft(draft, draft.revision);
  const gate = deferred(); const prepareReview = vi.fn(); const discardEvidence = vi.fn(async () => undefined);
  const extract = vi.fn(async () => { await gate.promise; return { evidence: generated, images: [], frameTimesMs: [0, 500] }; });
  const controller = new CoverReviewController(f.service, { ...f.agent, prepareReview } as unknown as AgentController, f.queue, { root: f.directory, extract, analyze: vi.fn(), verify: async () => undefined, discardEvidence, changed() {} });
  const work = controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory])).catch(() => undefined);
  await vi.waitFor(() => expect(extract).toHaveBeenCalled());
  if (failure === "cancel") { const stop = controller.cancel(); gate.resolve(); await Promise.all([stop, work]); }
  else { const save = vi.spyOn(f.service, "saveReviewDraft").mockRejectedValue(new Error("disk failure")); gate.resolve(); await work; save.mockRestore(); }
  expect(prepareReview).not.toHaveBeenCalled();
  if (failure === "cancel") expect(discardEvidence).toHaveBeenCalledWith(draft.projectId, generated, []);
  else expect(discardEvidence).not.toHaveBeenCalled();
  expect(f.service.currentProject.reviewDrafts![0].media[0].evidence).toEqual([]);
  expect(f.service.currentProject.reviewDrafts![0].media[0].decisions).toEqual(draft.media[0].decisions);
});

it("keeps evidence committed before a queue-triggered rewrite fails", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = [];
  const generated = draft.media[0].evidence; draft.media[0].evidence = []; delete draft.frameTimes;
  await f.service.saveReviewDraft(draft, draft.revision);
  const batchId = randomUUID(), stamp = now();
  const snapshot: QueueSnapshot = { revision: 1, batches: [{ schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: stamp, batch: { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId: draft.projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [draft.media[0].mediaId], outputDirectory: f.directory, preset: DEFAULT_PRESET, status: "active", estimatedBytes: 1, createdAt: stamp, tasks: [{ id: randomUUID(), batchId, mediaId: draft.media[0].mediaId, status: "running", progress: 0.3, attempt: 1, createdAt: stamp, attempts: [] }] } }] };
  const realSave = ProjectStore.prototype.save; let writes = 0;
  const save = vi.spyOn(ProjectStore.prototype, "save").mockImplementation(async function(this: ProjectStore, project) {
    const attempt = ++writes;
    if (attempt >= 3) throw new Error("disk failure");
    await realSave.call(this, project);
    if (attempt === 2) await f.service.syncQueue(snapshot);
  });
  const prepareReview = vi.fn(), discardEvidence = vi.fn(async () => undefined);
  const controller = new CoverReviewController(f.service, { ...f.agent, prepareReview } as unknown as AgentController, f.queue, { root: f.directory, extract: async () => ({ evidence: generated, images: [], frameTimesMs: [0, 500] }), analyze: vi.fn(), verify: async () => undefined, discardEvidence, changed() {} });
  try {
    await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("disk failure");
    expect(JSON.parse(await readFile(f.file, "utf8")).reviewDrafts[0].media[0].evidence).toEqual(generated);
    expect(f.service.currentProject.reviewDrafts![0].media[0].evidence).toEqual([]);
    expect(discardEvidence).not.toHaveBeenCalled(); expect(prepareReview).not.toHaveBeenCalled();
  } finally { save.mockRestore(); }
});

it("failed evidence recovery preserves confirmations and cannot call a model", async () => {
  const f = await fixture();
  const draft = structuredClone(f.draft); draft.status = "needs_human"; draft.frozen = []; draft.media[0].evidence = []; delete draft.frameTimes;
  await f.service.saveReviewDraft(draft, draft.revision);
  const prepareReview = vi.fn();
  const extract = vi.fn(async () => { throw new Error("抽帧失败"); });
  const controller = new CoverReviewController(f.service, { ...f.agent, prepareReview } as unknown as AgentController, f.queue, { root: f.directory, extract, analyze: vi.fn(), verify: async () => undefined, changed() {} });
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("抽帧失败");
  expect(prepareReview).not.toHaveBeenCalled();
  expect(f.service.currentProject.reviewDrafts![0].media[0].decisions).toEqual(draft.media[0].decisions);
  await writeFile(f.service.currentProject.mediaItems[0].sourcePath, "changed");
  await expect(controller.prepare(draft.id, draft.revision, f.input, new Set([f.directory]))).rejects.toThrow("原素材已变化");
  expect(extract).toHaveBeenCalledTimes(1);
});

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
