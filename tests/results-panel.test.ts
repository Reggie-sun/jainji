import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ResultsPanel, SupervisorPreviewDialog } from "../src/renderer/ResultsPanel";
import type { DesktopState } from "../src/shared/desktop";

it("counts only the latest production run in the results summary", () => {
  const completedTaskId = crypto.randomUUID();
  const failedTaskId = crypto.randomUUID();
  const historicalTaskId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const html = renderToStaticMarkup(createElement(ResultsPanel, {
    state: {
      project: { mediaItems: [] },
      queue: { batches: [
        { batch: { tasks: [{ id: historicalTaskId, mediaId: crypto.randomUUID(), status: "completed", progress: 1 }] } },
        { batch: { tasks: [
          { id: completedTaskId, mediaId: crypto.randomUUID(), status: "completed", progress: 1 },
          { id: failedTaskId, mediaId: crypto.randomUUID(), status: "failed", progress: 0 },
        ] } },
      ] },
      agentRun: {
        id: crypto.randomUUID(), projectId, ruleId: "clean", status: "running",
        items: [
          { id: crypto.randomUUID(), version: 1, mediaId: crypto.randomUUID(), name: "完成项", status: "exporting", taskId: completedTaskId },
          { id: crypto.randomUUID(), version: 1, mediaId: crypto.randomUUID(), name: "失败项", status: "exporting", taskId: failedTaskId },
          { id: crypto.randomUUID(), version: 1, mediaId: crypto.randomUUID(), name: "等待项", status: "waiting" },
        ],
      },
    } as unknown as DesktopState,
    busy: false, retryingIds: [], onCancel: () => {}, onRetry: () => {}, onOpen: () => {}, onReveal: () => {}, onNew: () => {},
  }));

  expect(html).toContain("<span>本轮制作</span><strong>3<small>条</small></strong>");
  expect(html).toContain("<span>正在处理</span><strong>01</strong>");
  expect(html).toContain("<span>已完成</span><strong class=\"green-text\">01</strong>");
  expect(html).toContain("<span>需要处理</span><strong class=\"red-text\">01</strong>");
});

it("makes an accepted supervisor preview playable while formal export is waiting", () => {
  const taskId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const previewUrl = `jianji-agent-preview://${runId}/${itemId}`;
  const html = renderToStaticMarkup(createElement(ResultsPanel, {
    state: {
      project: { mediaItems: [] },
      queue: { batches: [{ batch: { tasks: [{ id: taskId, mediaId: crypto.randomUUID(), status: "queued", progress: 0 }] } }] },
      agentRun: { id: runId, projectId: crypto.randomUUID(), ruleId: "clean", status: "running", items: [{
        id: itemId, version: 1, mediaId: crypto.randomUUID(), name: "已通过样片", status: "exporting", taskId,
        previewUrl,
      }] },
    } as unknown as DesktopState,
    busy: false, retryingIds: [], onCancel: () => {}, onRetry: () => {}, onOpen: () => {}, onReveal: () => {}, onNew: () => {},
  }));

  expect(html).toContain(`aria-label="播放 已通过样片 的主管样片"`);
  expect(html).toContain("等待导出");
  expect(html).not.toContain("/home/");
  const dialog = renderToStaticMarkup(createElement(SupervisorPreviewDialog, { preview: { url: previewUrl, name: "已通过样片" }, onClose: () => {} }));
  expect(dialog).toContain("controls=\"\"");
  expect(dialog).toContain(`src=\"${previewUrl}\"`);
  expect(dialog).toContain("aria-label=\"关闭样片\"");
});
