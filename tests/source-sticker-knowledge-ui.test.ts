import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceStickerKnowledgeControls } from "../src/renderer/SourceStickerKnowledgeControls";
import { SourceStickerKnowledgeDetails } from "../src/renderer/SourceStickerKnowledgeDetails";
import { ResultsPanel } from "../src/renderer/ResultsPanel";
import type { DesktopState } from "../src/shared/desktop";
import { consumeSourceStickerRefresh, reconcileSourceStickerRefresh, requestSourceStickerRefresh, sourceStickerRefreshInput } from "../src/renderer/source-sticker-refresh";

describe("source sticker refresh intent", () => {
  it("clears a one-shot refresh intent when selected scope, project, or eligibility changes", () => {
    const projectId = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID();
    const context = { projectId, selectedReadyIds: [first, second], eligible: true, modeKey: "preserve" };
    const intent = requestSourceStickerRefresh(context);
    expect(intent).toEqual({ projectId, mediaIds: [first, second], modeKey: "preserve" });
    expect(reconcileSourceStickerRefresh(intent, { ...context, selectedReadyIds: [first] })).toBeUndefined();
    expect(reconcileSourceStickerRefresh(undefined, context)).toBeUndefined();
    expect(reconcileSourceStickerRefresh(intent, { ...context, projectId: crypto.randomUUID() })).toBeUndefined();
    expect(reconcileSourceStickerRefresh(intent, { ...context, eligible: false })).toBeUndefined();
    expect(reconcileSourceStickerRefresh(intent, { ...context, modeKey: "cover-agent:agent" })).toBeUndefined();
  });

  it("retains intent until admission succeeds, then consumes it", () => {
    const intent = requestSourceStickerRefresh({ projectId: crypto.randomUUID(), selectedReadyIds: [crypto.randomUUID()], eligible: true, modeKey: "preserve" });
    expect(reconcileSourceStickerRefresh(intent, { projectId: intent!.projectId, selectedReadyIds: intent!.mediaIds, eligible: true, modeKey: "preserve" })).toEqual(intent);
    expect(sourceStickerRefreshInput(intent)).toEqual({ projectId: intent!.projectId, mediaIds: intent!.mediaIds });
    expect(consumeSourceStickerRefresh(intent)).toBeUndefined();
  });

  it("renders a disabled, local-only control without any dispute-clearing affordance", () => {
    const html = renderToStaticMarkup(createElement(SourceStickerKnowledgeControls, {
      projectId: crypto.randomUUID(), selectedReadyIds: [crypto.randomUUID()], eligible: false, disabled: true,
      refresh: undefined, onRequest: () => {},
    }));
    expect(html).toContain("重新检查原贴纸");
    expect(html).toContain("不会清除争议");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("不能人工批准");
  });

  it("shows safe sampled progress without exposing source or revision identifiers", () => {
    const html = renderToStaticMarkup(createElement(SourceStickerKnowledgeDetails, {
      progress: {
        phase: "reviewed", origin: "warm", reason: "已核查", sourceKey: "sha256:secret", revisionId: "revision-secret",
        reviewedRanges: [{ startMs: 0, endMs: 3000 }], recognitionRequests: 2, previewRequests: 3,
        revisions: 1, renders: 2, elapsedMs: 1234, executor: "vision-model", supervisor: "review-model",
      },
    }));
    expect(html).toContain("源贴纸已复核");
    expect(html).toContain("查看核查说明");
    expect(html).toContain("抽样核查");
    expect(html).toContain("识别 2 次");
    expect(html).not.toContain("sha256:secret");
    expect(html).not.toContain("revision-secret");
  });

  it("projects source knowledge progress into the results row", () => {
    const html = renderToStaticMarkup(createElement(ResultsPanel, {
      state: { queue: { batches: [] }, project: { mediaItems: [] }, agentRun: { id: crypto.randomUUID(), projectId: crypto.randomUUID(), ruleId: "clean", status: "running", items: [{ id: crypto.randomUUID(), version: 1, mediaId: crypto.randomUUID(), name: "素材", status: "analyzing", sourceKnowledge: { phase: "blocked", reason: "已有反证，已安全停止。", recognitionRequests: 1, previewRequests: 0, revisions: 0, renders: 0, elapsedMs: 12 } }] } } as unknown as DesktopState,
      busy: false, retryingIds: [], onCancel: () => {}, onRetry: () => {}, onOpen: () => {}, onReveal: () => {}, onNew: () => {},
    }));
    expect(html).toContain("本轮源贴纸流程已停止");
    expect(html).toContain("已有反证，已安全停止。");
  });
});
