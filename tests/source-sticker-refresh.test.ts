import { expect, it, vi } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { AgentController } from "../src/main/agent-controller";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import type { ExportQueue } from "../src/main/queue";
import type { StickerAssets } from "../src/main/builtin-stickers";
import { CoverReviewController } from "../src/main/cover-review-controller";
import { createCoverReviewDraft } from "../src/main/cover-review-session";
import type { MediaItem } from "../src/main/domain";

const projectId = crypto.randomUUID(), mediaId = crypto.randomUUID();
const input = { ruleId: "clean", brief: "", mediaIds: [mediaId], outputDirectory: "/tmp/output", decorations: { mode: "agent", productPrice: "手动文字" } };
it.each(["prepare", "approve"] as const)("rejects refresh in assisted %s before persisting any one-shot intent", async (method) => {
  const ffmpeg = new FfmpegAdapter("unused", "unused"), service = new ApplicationService(ffmpeg, { resolve: async () => null });
  service.currentProject.coverSticker = { enabled: true, trackingMode: "assisted", stickerIds: [], rectangle: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  const draft = createCoverReviewDraft(service.currentProject.id, [{ id: mediaId, fingerprint: "fixture", durationMs: 1000 } as MediaItem]);
  draft.status = "needs_human"; draft.media[0].disposition = "no_cover";
  service.currentProject.reviewDrafts = [draft];
  const saved = vi.spyOn(service, "saveReviewDraft");
  const agent = { assertIdle: () => {}, prepareReview: vi.fn() } as unknown as AgentController;
  const review = new CoverReviewController(service, agent, {} as ExportQueue, { root: "/unused", changed: () => {}, extract: vi.fn(), analyze: vi.fn(), verify: vi.fn() });
  const before = JSON.stringify(service.currentProject.reviewDrafts);
  const request = AgentStartSchema.parse({ ...input, sourceStickerRefresh: { projectId: service.currentProject.id, mediaIds: [mediaId] } });
  await expect(review[method](draft.id, draft.revision, request, new Set())).rejects.toThrow("重新检查");
  expect(saved).not.toHaveBeenCalled(); expect(agent.prepareReview).not.toHaveBeenCalled();
  expect(JSON.stringify(service.currentProject.reviewDrafts)).toBe(before);
});
it("accepts a one-run project-bound refresh subset without changing legacy production input", () => {
  expect(AgentStartSchema.safeParse(input).success).toBe(true);
  expect(AgentStartSchema.parse({ ...input, sourceStickerRefresh: { projectId, mediaIds: [mediaId] } }).sourceStickerRefresh).toEqual({ projectId, mediaIds: [mediaId] });
});
it("rejects unbound, duplicate or out-of-run refresh targets", () => {
  for (const sourceStickerRefresh of [{ mediaIds: [mediaId] }, { projectId, mediaIds: [] }, { projectId, mediaIds: [mediaId, mediaId] }, { projectId, mediaIds: [crypto.randomUUID()] }, { projectId, mediaIds: [mediaId], clearDisputes: true }]) {
    expect(AgentStartSchema.safeParse({ ...input, sourceStickerRefresh }).success).toBe(false);
  }
});
it.each(["stale-project", "manual", "unknown-media"])("rejects %s refresh at main-process admission before preparation", async (scenario) => {
  const ffmpeg = new FfmpegAdapter("unused", "unused");
  const service = new ApplicationService(ffmpeg, { resolve: async () => null });
  const controller = new AgentController(service, { snapshot: () => ({ batches: [] }) } as unknown as ExportQueue, ffmpeg, () => {}, {} as StickerAssets);
  for (const provider of [controller.provider, controller.visionProvider, controller.reviewerProvider]) provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://unused.invalid/v1" });
  const request = AgentStartSchema.parse({ ...input, decorations: { ...input.decorations, mode: scenario === "manual" ? "manual" : "agent" }, sourceStickerRefresh: { projectId: scenario === "stale-project" ? projectId : service.currentProject.id, mediaIds: [mediaId] } });
  await expect(controller.start(request, new Set())).rejects.toThrow(scenario === "stale-project" ? "项目" : scenario === "manual" ? "自动" : "素材");
  expect(controller.busy).toBe(false);
  expect(controller.snapshot()).toBeUndefined();
});
