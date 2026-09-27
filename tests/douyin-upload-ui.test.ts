import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DouyinUploadConfigSchema, type UploadResult } from "../src/shared/douyin-upload";
import { AppendProductionDialog } from "../src/renderer/AppendProductionDialog";
import { DouyinUploadControls } from "../src/renderer/DouyinUploadControls";
import { DouyinUploadPanel } from "../src/renderer/DouyinUploadPanel";
import type { PublicExportBatch } from "../src/main/application";

const projectId = "11111111-1111-4111-8111-111111111111";
const uploadTaskId = "a".repeat(64);
const config = DouyinUploadConfigSchema.parse({});
const task = (overrides: Partial<UploadResult>): UploadResult => ({
  project_id: projectId,
  batch_id: "22222222-2222-4222-8222-222222222222",
  export_task_id: "33333333-3333-4333-8333-333333333333",
  upload_task_id: uploadTaskId,
  artifact_sha256: "b".repeat(64),
  file_name: "成片.mp4",
  state: "NEEDS_HUMAN",
  publish_outcome: "NOT_SUBMITTED",
  retryable: false,
  retry_count: 0,
  timestamp: "2026-09-27T00:00:00.000Z",
  ...overrides,
});
const renderPanel = (upload: UploadResult, ready = false) => renderToStaticMarkup(createElement(DouyinUploadPanel, {
  projectId,
  status: { config, ready, message: "生产上传页面合同尚未核实。", tasks: [upload] },
  onState: () => {},
}));

it("keeps opt-in off by default and separates the manual publish caption from display text", () => {
  const html = renderToStaticMarkup(createElement(DouyinUploadControls, { onChange: () => {} }));
  expect(html).toContain("本次制作的成片会传到抖音并提交发布");
  expect(html).toContain("默认关闭");
  expect(html).toContain("与展示文字 / 价格分开");
  expect(html).not.toContain("checked=\"\"");
  expect(html).not.toContain("抖音发布文案");
});

it("keeps append upload opt-in off in the existing append flow", () => {
  const batch = { id: projectId, status: "completed", mediaIds: [projectId], outputDirectory: "/tmp/out", createdAt: "2026-09-27T00:00:00.000Z", tasks: [] } as unknown as PublicExportBatch;
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元", mediaCount: 1 }, mediaLabel: "成片.mp4", onClose: () => {} }));
  expect(html).toContain("抖音上传");
  expect(html).toContain("本次制作的成片会传到抖音并提交发布");
  expect(html).not.toContain("checked=\"\"");
});

it("shows an unverified production page and restricts possible-submit recovery to read-only verification and human evidence", () => {
  const html = renderPanel(task({
    publish_outcome: "MAY_HAVE_SUBMITTED",
    failure: { category: "publish", code: "PUBLISH_OUTCOME_UNKNOWN", retryable: false, requires_human: true, message: "提交结果未知。", next_action: "在创作者后台核查同一作品。" },
  }));
  expect(html).toContain("生产上传页面合同尚未核实。");
  expect(html).toContain("只读核查 / 人工处理");
  expect(html).toContain("人工确认平台已接受");
  expect(html).toContain("同一 content ID 的创作者后台详情页 URL");
  expect(html).toContain("实际观察依据");
  expect(html).not.toContain("重新发布");
  expect(html).not.toContain("清除提交记录");
  expect(html).not.toContain("creator.douyin.com/upload");
});

it("allows caption correction only before submission and never offers human success for that state", () => {
  const html = renderPanel(task({
    failure: { category: "page", code: "CAPTION_REQUIRED", retryable: false, requires_human: true, message: "需要手动填写发布文案。", next_action: "输入文案后继续。" },
  }));
  expect(html).toContain("修正文案（尚未提交）");
  expect(html).toContain("保存文案");
  expect(html).toContain("继续处理");
  expect(html).not.toContain("人工确认平台已接受");
});

it("distinguishes a reviewing acceptance from a published result", () => {
  const html = renderPanel(task({
    state: "SUCCEEDED",
    publish_outcome: "ACCEPTED",
    success: {
      platform_content_id: "content-123",
      accepted_status: "reviewing",
      url: "https://creator.douyin.com/content-123",
      observed_at: "2026-09-27T00:00:00.000Z",
      confirmation_source: "browser",
      evidence: "同一 content ID 的后台状态为审核中。",
    },
  }));
  expect(html).toContain("已确认接受");
  expect(html).toContain("平台状态：审核中");
  expect(html).not.toContain("停止任务");
});

it("offers explicit continuation after stopping but no mutation controls for a duplicate alias", () => {
  expect(renderPanel(task({ state: "CANCELLED" }))).toContain("继续处理");
  const duplicate = renderPanel(task({ publish_outcome: "MAY_HAVE_SUBMITTED", duplicate_of: "c".repeat(64) }));
  expect(duplicate).toContain("已关联既有结果");
  expect(duplicate).not.toContain("只读核查 / 人工处理");
  expect(duplicate).not.toContain("人工确认平台已接受");
  expect(duplicate).not.toContain("停止任务");
});
