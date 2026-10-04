import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinUploadService, type UploadBrowserPort } from "../src/main/douyin-upload-service";
import { DouyinUploadStore } from "../src/main/douyin-upload-store";
import { QianchuanAccountConfigReader } from "../src/main/qianchuan-account-config";
import { QIANCHUAN_PRODUCTS } from "../src/shared/qianchuan-account";
import { QianchuanPlanListSchema, type QianchuanPlanOption } from "../src/shared/qianchuan-plan-selection";
import { QianchuanUploadSelectionSchema, uploadFailure } from "../src/shared/douyin-upload";
import { BATCH_SCHEMA_VERSION, QUEUE_SCHEMA_VERSION, DEFAULT_PRESET, createDefaultTemplate, now, type QueueState } from "../src/main/domain";
import { createDefaultProject } from "../src/main/domain";
import { BatchProductionController } from "../src/main/batch-production-controller";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const plan = (adId = "9001"): QianchuanPlanOption => ({ advertiserId: "1000", adId, name: `测试计划 ${adId}` });
const selection = (adId = "9001") => ({ enabled: true as const, accountProduct: "眼贴" as const, plan: plan(adId) });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qianchuan-plan-selection-")); roots.push(root);
  const configPath = path.join(root, "accounts.json");
  const document = { version: 1, accounts: ["眼贴", ...QIANCHUAN_PRODUCTS.filter(product => product !== "眼贴")].map((product, index) => ({ product, advertiserId: String(1000 + index), adId: String(2000 + index), cdpEndpoint: `http://127.0.0.1:${11000 + index}` })) };
  const save = () => writeFile(configPath, JSON.stringify(document), { mode: 0o600 }); await save();
  const store = new DouyinUploadStore(path.join(root, "private")); await store.load();
  const readPlans = vi.fn(async () => [plan(), plan("9002")]);
  const connect = vi.fn(async () => undefined);
  const browser: UploadBrowserPort = { connect, open: async () => { throw uploadFailure("PAGE_CONTRACT_CHANGED", "page", "fixture stops before any file action", "fixture", true); },
    upload: async () => { throw new Error("Unexpected file action"); }, ready: async () => [], pollReady: async () => [], readOnlyCheck: async () => { throw new Error("Unexpected recovery"); }, stop: async () => undefined };
  const states = new Map<string, QueueState>();
  const service = new DouyinUploadService(store, { accounts: new QianchuanAccountConfigReader(), readPlans, loadBatch: async id => structuredClone(states.get(id)!), browser: () => browser, readiness: () => undefined });
  await service.chooseConfig(configPath); await service.configure({ enabled: true });
  const batchId = randomUUID(), projectId = randomUUID(), taskId = randomUUID(), video = path.join(root, "output.mp4");
  await writeFile(video, "fixture artifact");
  const task: QueueState["batch"]["tasks"][number] = { id: taskId, batchId, mediaId: randomUUID(), status: "completed", progress: 1, attempt: 1, attempts: [], createdAt: now(), outputPath: video,
    outputArtifact: { taskId, path: video, sizeBytes: 16, durationMs: 1000, createdAt: now() } };
  states.set(batchId, { schemaVersion: QUEUE_SCHEMA_VERSION, revision: 1, updatedAt: now(), batch: { schemaVersion: BATCH_SCHEMA_VERSION, id: batchId, projectId, templateSnapshot: createDefaultTemplate(), mediaIds: [], outputDirectory: root, preset: DEFAULT_PRESET, status: "completed", estimatedBytes: 0, createdAt: now(), tasks: [task] } });
  return { service, store, readPlans, connect, configPath, document, save, batch: { id: batchId, projectId, tasks: [{ id: taskId }] }, identity: { project_id: projectId, batch_id: batchId, export_task_id: taskId } };
}

describe("explicit upload plan selection", () => {
  it("keeps legacy selection compatible while rejecting duplicate or cross-advertiser catalogs", async () => {
    expect(QianchuanUploadSelectionSchema.parse({ enabled: true, accountProduct: "眼贴" }).plan).toBeUndefined();
    expect(QianchuanPlanListSchema.safeParse([plan(), plan()]).success).toBe(false);
    expect(QianchuanPlanListSchema.safeParse([plan(), { ...plan("9002"), advertiserId: "1001" }]).success).toBe(false);
    const f = await fixture(); const authorization = await f.service.preflight({ enabled: true, accountProduct: "眼贴" }, 1);
    expect(authorization?.target.adId).toBe("2000"); expect(f.readPlans).not.toHaveBeenCalled();
  });
  it("reads only the expected account and rejects settings drift during catalog read", async () => {
    const f = await fixture();
    await expect(f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1001" })).rejects.toThrow("广告账户已变化");
    expect(f.readPlans).not.toHaveBeenCalled();
    expect(await f.service.listPlans({ product: "眼贴", expectedAdvertiserId: "1000" })).toEqual([plan(), plan("9002")]);
    f.readPlans.mockImplementation(async () => { f.document.accounts[0]!.adId = "3000"; await f.save(); return [plan()]; });
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow(); expect(f.store.intents()).toHaveLength(0);
  });
  it("rejects a foreign or vanished plan before registering any intent", async () => {
    const f = await fixture();
    await expect(f.service.preflight({ ...selection(), plan: { ...plan(), advertiserId: "1001" } }, 1)).rejects.toThrow("不属于");
    expect(f.readPlans).not.toHaveBeenCalled();
    f.readPlans.mockResolvedValue([]);
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow("已失效");
    f.readPlans.mockResolvedValue([{ ...plan(), advertiserId: "1001" }]);
    await expect(f.service.preflight(selection(), 1)).rejects.toThrow("不属于");
    expect(f.store.intents()).toHaveLength(0); expect(f.connect).not.toHaveBeenCalled();
  });
  it("freezes independent plans for the same account without changing the saved default", async () => {
    const f = await fixture(), original = await readFile(f.configPath, "utf8");
    const first = (await f.service.preflight(selection(), 1))!, second = (await f.service.preflight(selection("9002"), 1))!;
    expect(first.target.adId).toBe("9001"); expect(second.target.adId).toBe("9002");
    expect(first.target.configDigest).toBe(second.target.configDigest);
    await f.service.registerBatch(f.batch, selection("9002"), first);
    expect(f.store.intents()).toHaveLength(0);
    await f.service.registerBatch(f.batch, selection(), first);
    expect(f.store.intents()[0]!.selection.plan?.adId).toBe("9001");
    expect(await readFile(f.configPath, "utf8")).toBe(original);
  });
  it("uses the frozen explicit plan when the saved default changes before file selection", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization);
    await f.service.enqueueFinalArtifact(f.identity);
    f.document.accounts[0]!.adId = "3000"; await f.save();
    await f.service.runPending();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.store.tasks()[0]!.authorization.target.adId).toBe("9001");
    expect(f.store.tasks()[0]!.result.upload_outcome).toBe("NOT_SELECTED");
    expect(f.store.hasMarker(f.store.tasks()[0]!.result.upload_task_id)).toBe(false);
  });
  it("still blocks an advertiser change and preserves the original frozen plan", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization); await f.service.enqueueFinalArtifact(f.identity);
    f.document.accounts[0]!.advertiserId = "3000"; await f.save(); await f.service.runPending();
    expect(f.connect).not.toHaveBeenCalled(); expect(f.store.tasks()[0]!.result.failure?.code).toBe("INPUT_CONFLICT");
    expect(f.store.tasks()[0]!.authorization.target).toEqual(authorization.target);
  });
  it("updates explicit plan identity on the existing unfenced retarget path and survives reload", async () => {
    const f = await fixture(), authorization = (await f.service.preflight(selection(), 1))!;
    await f.service.registerBatch(f.batch, selection(), authorization); await f.service.enqueueFinalArtifact(f.identity);
    const task = f.store.tasks()[0]!;
    await f.store.retargetBatch(task.result.upload_task_id, { ...authorization, pageBatchId: randomUUID(), target: { ...authorization.target, adId: "9002" } });
    const restored = new DouyinUploadStore(f.store.root); await restored.load();
    expect(restored.unavailable).toBe(false); expect(restored.intents()[0]!.selection.plan?.adId).toBe("9002");
    expect(restored.tasks()[0]!.authorization.target.adId).toBe("9002");
  });
  it.each([true, false])("cross-template admission accepts only the explicit selected plan (matching=%s)", async matching => {
    const f = await fixture(), project = createDefaultProject("眼贴"), mediaId = randomUUID();
    project.mediaItems = [{ id: mediaId, sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100, durationMs: 1000,
      width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: now() }];
    project.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [mediaId], ruleId: "clean", brief: "", decorations: { mode: "random" }, requestedCount: 1, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
    const authorization = (await f.service.preflight(selection(), 1))!;
    const outputDirectory = vi.fn(async () => { throw new Error("Fixture stops after admission"); });
    const controller = new BatchProductionController(f.store.root, {
      name: () => "眼贴", loadProject: async () => project,
      uploadAccounts: () => [{ product: "眼贴", advertiserId: "1000", adId: "2000", available: true }],
      preflightUpload: async () => matching ? authorization : { ...authorization, target: { ...authorization.target, adId: "9002" } },
      outputDirectory, session: vi.fn(), queue: () => ({ revision: 0, batches: [] }), taskStatuses: () => new Map(), cancelExport: vi.fn(), changed: vi.fn(),
    });
    await controller.start({ entries: [{ recentProjectId: randomUUID(), requestedCount: 1, productPrice: "手动文字", coverEnabled: false, displayMode: "full", mode: "random", douyinUpload: selection() }] });
    await vi.waitFor(() => expect(controller.snapshot()?.status).toBe("finished"));
    if (matching) expect(outputDirectory).toHaveBeenCalledOnce();
    else { expect(outputDirectory).not.toHaveBeenCalled(); expect(controller.snapshot()?.jobs[0]?.error).toContain("计划"); }
  });
});
