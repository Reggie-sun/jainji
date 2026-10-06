import { describe, expect, it, vi } from "vitest";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import type { ExportQueue } from "../src/main/queue";
import type { ShapeCoverCandidateRequest } from "../src/main/shape-cover-candidates";
import { createCoverReviewDraft } from "../src/main/cover-review-session";
import type { MediaItem } from "../src/main/domain";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import { AgentStartSchema, FrozenAgentStartSchema, type AgentStartInput } from "../src/shared/agent";
import type { CoverSticker } from "../src/shared/cover-sticker";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";

const input = () => ({
  ruleId: "clean" as const, brief: "", mediaIds: [crypto.randomUUID()], outputDirectory: "/unused-output",
  decorations: { mode: "agent" as const, productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" },
});
const shapeInput = () => ({ ...input(), coverStrategy: "shape-matched-static-v1" as const });
const cover = (trackingMode: CoverSticker["trackingMode"] = "agent", enabled = true): CoverSticker => ({
  enabled, trackingMode, stickerIds: [], rectangle: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 },
});

function fixture(settings: CoverSticker | undefined = cover(), knowledge?: SourceStickerKnowledgeStore) {
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  service.currentProject.coverSticker = settings;
  const calls = { createBatch: vi.fn(), renderPreview: vi.fn(), publishApprovedSample: vi.fn(), createShapeCoverArtifactStore: vi.fn() };
  const queue = { snapshot: () => ({ revision: 1, batches: [] }), ...calls } as unknown as ExportQueue;
  const register = vi.fn(), preflight = vi.fn();
  const stickers = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map(id => [id, { assetPath: `/unused/${id}.png`, assetFingerprint: `sha256:${"a".repeat(64)}` }])) as BuiltinStickerAssets;
  const controller = new AgentController(service, queue, ffmpeg, () => {}, stickers, undefined, undefined, undefined, undefined, knowledge, register, preflight);
  const providerCalls = [controller.provider, controller.visionProvider, controller.reviewerProvider].flatMap(provider =>
    [vi.spyOn(provider, "plan"), vi.spyOn(provider, "shortlist"), vi.spyOn(provider, "detectCovers"), vi.spyOn(provider, "superviseShapePreview")]);
  return { controller, service, calls, register, preflight, providerCalls };
}

function expectNoExecution(test: ReturnType<typeof fixture>) {
  for (const spy of [...Object.values(test.calls), test.register, test.preflight, ...test.providerCalls]) expect(spy).not.toHaveBeenCalled();
  expect(test.controller.snapshot()).toBeUndefined();
  expect(test.controller.busy).toBe(false);
}

describe("shape product intent schema", () => {
  it("accepts a versioned choice without treating it as admission", () => {
    expect(AgentStartSchema.parse(shapeInput())).toMatchObject({ coverStrategy: "shape-matched-static-v1" });
    expect(FrozenAgentStartSchema.parse(shapeInput())).toMatchObject({ coverStrategy: "shape-matched-static-v1" });
  });

  it("keeps legacy frozen requests without a strategy field", () => {
    for (const schema of [AgentStartSchema, FrozenAgentStartSchema]) {
      expect(schema.parse(input())).not.toHaveProperty("coverStrategy");
    }
  });

  it.each(["shape-matched-static-v2", "legacy_opaque_rect", "", true, { version: 1, enabled: true }])("rejects an unsupported choice %j", choice => {
    for (const schema of [AgentStartSchema, FrozenAgentStartSchema]) expect(schema.safeParse({ ...input(), coverStrategy: choice }).success).toBe(false);
  });

  it.each(["enabled", "approved", "admission", "shapeRequest", "assetPath"])("does not accept caller authority or resource field %s", field => {
    expect(AgentStartSchema.safeParse({ ...shapeInput(), [field]: true }).success).toBe(false);
  });

  it("still rejects missing manual display text", () => {
    expect(AgentStartSchema.safeParse({ ...shapeInput(), decorations: { mode: "agent" } }).success).toBe(false);
  });
});

describe("Hybrid shape product controller entry", () => {
  it("rejects an unavailable selected frame before Hybrid preparation or model calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "hybrid-frame-admission-"));
    const test = fixture(cover(), {} as SourceStickerKnowledgeStore), request = shapeInput();
    test.service.currentProject.mediaItems.push({ id: request.mediaIds[0], sourcePath: join(root, "source.mp4"), displayName: "source.mp4",
      fingerprint: `sha256:${"a".repeat(64)}`, sizeBytes: 1000, durationMs: 2000, width: 160, height: 160,
      rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() });
    try {
      await expect(test.controller.start({ ...request, outputDirectory: root, decorations: { ...request.decorations, frameId: "frame-stars" } }, new Set([root])))
        .rejects.toThrow("所选边框缺失或已变化");
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
  });
  it.each(["agent", "random"] as const)("does not inherit an inactive saved shape choice when coverage is off in %s mode", async mode => {
    const test = fixture({ ...cover("agent", false), coverStrategy: "shape-matched-static-v1" });
    try {
      const request = { ...input(), decorations: { ...input().decorations, mode, productPrice: undefined, displayText: { enabled: false, x: 0.5, y: 0.7 } } };
      await expect(test.controller.start(request, new Set())).rejects.toThrow(mode === "agent" ? "请先接入模型。" : "请通过系统对话框选择输出目录。");
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("requires the original output directory authorization before any execution", async () => {
    const test = fixture();
    try {
      await expect(test.controller.start(shapeInput(), new Set())).rejects.toThrow(/系统对话框选择输出目录/);
      expectNoExecution(test);
      await test.controller.cancel();
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it.each([
    ["disabled cover", cover("agent", false)], ["manual", cover("manual")],
    ["assisted", cover("assisted")], ["missing cover", undefined],
  ] as const)("rejects shape intent with %s instead of silently using the old mode", async (_label, settings) => {
    const test = fixture();
    // Assign separately so undefined means a missing setting, not the fixture default.
    test.service.currentProject.coverSticker = settings;
    try {
      await expect(test.controller.start(shapeInput(), new Set())).rejects.toThrow(/UNSAFE:.*自动覆盖/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it.each(["mov", "mkv"] as const)("does not enable shape for %s", async exportFormat => {
    const test = fixture();
    try {
      await expect(test.controller.start({ ...shapeInput(), exportFormat }, new Set())).rejects.toThrow(/UNSAFE:.*MP4/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("rejects source refresh in the same shape request", async () => {
    const test = fixture(), request = shapeInput();
    try {
      await expect(test.controller.start({ ...request, sourceStickerRefresh: { projectId: crypto.randomUUID(), mediaIds: request.mediaIds } }, new Set())).rejects.toThrow(/UNSAFE:.*重新检查/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("keeps local-random shape combinations closed", async () => {
    const test = fixture(), request = shapeInput();
    try {
      await expect(test.controller.start({ ...request, decorations: { ...request.decorations, mode: "random" } }, new Set())).rejects.toThrow(/UNSAFE:.*本地随机/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("does not run upload preflight for a shape combination", async () => {
    const test = fixture();
    try {
      await expect(test.controller.start({ ...shapeInput(), douyinUpload: { enabled: true, accountProduct: "蝴蝶贴" } }, new Set())).rejects.toThrow(/UNSAFE:.*上传/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("cannot borrow the M4 explicit seam to activate a product choice", async () => {
    const test = fixture();
    try {
      await expect(test.controller.startShapeMatched(shapeInput(), new Set(), { intendedTargets: [], outputSettings: [], candidates: [] } satisfies ShapeCoverCandidateRequest)).rejects.toThrow(/UNSAFE:.*strict development/);
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("also guards the actual assisted preview preparation entry", async () => {
    const test = fixture(cover("assisted")), request = shapeInput(), prepared = vi.fn();
    const draft = createCoverReviewDraft(test.service.currentProject.id, [{ id: request.mediaIds[0], fingerprint: "fixture", durationMs: 1000 } as MediaItem]);
    draft.status = "preparing_preview";
    draft.media[0].disposition = "no_cover";
    try {
      await expect(test.controller.prepareReview(request, new Set(), draft, prepared)).rejects.toThrow(/UNSAFE:.*自动覆盖/);
      expect(prepared).not.toHaveBeenCalled();
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("rejects unknown versions at the actual controller without falling through", async () => {
    const test = fixture();
    try {
      await expect(test.controller.start({ ...input(), coverStrategy: "shape-matched-static-v2" } as unknown as AgentStartInput, new Set())).rejects.toThrow();
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("leaves legacy requests on their existing model admission", async () => {
    const test = fixture();
    try {
      await expect(test.controller.start(input(), new Set())).rejects.toThrow("请先接入模型。");
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });

  it("cannot enable product execution by adding a caller availability flag", async () => {
    const test = fixture();
    try {
      await expect(test.controller.start({ ...shapeInput(), enabled: true } as unknown as AgentStartInput, new Set())).rejects.toThrow();
      expectNoExecution(test);
    } finally { vi.restoreAllMocks(); }
  });
});
