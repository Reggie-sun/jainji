import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BatchProductionController } from "../src/main/batch-production-controller";
import { createDefaultProject } from "../src/main/domain";
import { ProjectWorkspaceSchema } from "../src/shared/project-workspace";
import type { QianchuanAccountSummary } from "../src/shared/qianchuan-account";
import type { QueueSnapshot } from "../src/main/queue";
import { DEFAULT_EXPORT_SETTINGS } from "../src/shared/export-settings";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const account: QianchuanAccountSummary = { product: "眼贴", productName: "晚安油", advertiserId: "123", adId: "456", available: true };
it.each([
  { title: "wrong stable slot", name: "晚安油", product: "蝴蝶贴", accounts: [account], message: "不一致" },
  { title: "missing account", name: "晚安油", product: "眼贴", accounts: [], message: "未找到" },
  { title: "unavailable account", name: "晚安油", product: "眼贴", accounts: [{ ...account, available: false }], message: "不可用" },
  { title: "ambiguous account", name: "晚安油", product: "眼贴", accounts: [account, { ...account, product: "蝴蝶贴" }], message: "不唯一" },
  { title: "renamed slot fallback", name: "眼贴", product: "眼贴", accounts: [account], message: "未找到" },
])("rejects $title against the loaded project before preflight or production", async ({ name, product, accounts, message }) => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-auto-upload-admission-")); directories.push(root);
  const project = createDefaultProject(name);
  const mediaId = crypto.randomUUID();
  project.mediaItems = [{ id: mediaId, sourcePath: "/fixture/source.mp4", displayName: "source.mp4", fingerprint: "fixture", sizeBytes: 100, durationMs: 1000,
    width: 720, height: 1280, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() }];
  project.workspaceDraft = ProjectWorkspaceSchema.parse({ step: "templates", selectedMediaIds: [mediaId], ruleId: "clean", brief: "", decorations: { mode: "random" }, requestedCount: 1, exportFormat: "mp4", exportSettings: DEFAULT_EXPORT_SETTINGS });
  const dependencies = {
    // The registry label must not replace the loaded project's actual name.
    name: () => "其他名称", loadProject: vi.fn(async () => project), uploadAccounts: () => accounts as QianchuanAccountSummary[],
    preflightUpload: vi.fn(async () => undefined), outputDirectory: vi.fn(async () => "/output"), session: vi.fn(),
    queue: () => ({ revision: 0, batches: [] } as QueueSnapshot), taskStatuses: () => new Map(), cancelExport: vi.fn(), changed: vi.fn(),
  };
  const controller = new BatchProductionController(root, dependencies);
  await controller.start({ entries: [{ recentProjectId: crypto.randomUUID(), requestedCount: 1, productPrice: "手动文字", coverEnabled: false,
    displayMode: "full", mode: "random", douyinUpload: { enabled: true, accountProduct: product } }] });
  await vi.waitFor(() => expect(controller.snapshot()?.status).toBe("finished"));
  expect(controller.snapshot()?.jobs[0].error).toContain(message);
  expect(dependencies.preflightUpload).not.toHaveBeenCalled();
  expect(dependencies.outputDirectory).not.toHaveBeenCalled();
  expect(dependencies.session).not.toHaveBeenCalled();
});
