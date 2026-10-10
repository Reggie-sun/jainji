import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QianchuanClosureConfirmation, QianchuanUploadHistory } from "../src/renderer/QianchuanUploadHistory";
import { DouyinUploadPanel } from "../src/renderer/DouyinUploadPanel";
import { QianchuanUploadConfigSchema } from "../src/shared/douyin-upload";
import type { QianchuanUploadBatchSummary } from "../src/shared/douyin-upload";
const batch: QianchuanUploadBatchSummary = { projectId: "project", pageBatchId: "batch", advertiserId: "123", adId: "456", expectedCount: 3, taskIds: ["a", "b", "c"], readyCount: 1, unknownCount: 1, notSelectedCount: 1, canClose: true };
it("confirmation identifies full irreversible scope, original outcomes and zero platform acceptance", () => {
  const html = renderToStaticMarkup(createElement(QianchuanClosureConfirmation, { batch, busy: false, onConfirm() {}, onCancel() {} }));
  for (const text of ["项目 project", "计划 456", "批次 batch", "计划 3 条", "已准入 3 条", "尚未准入 0 条", "READY 1", "UNKNOWN 1", "未选 1", "尚未准入成员不代表已上传", "不能恢复", "平台结果不变", "保留本批"]) expect(html).toContain(text);
  const partial = renderToStaticMarkup(createElement(QianchuanClosureConfirmation, { batch: { ...batch, taskIds: ["a", "b"], notSelectedCount: 0 }, busy: false, onConfirm() {}, onCancel() {} }));
  for (const text of ["计划 3 条", "已准入 2 条", "尚未准入 1 条", "尚未准入成员不代表已上传"]) expect(partial).toContain(text);
});
it("closed historical results expose no resume, delete or retarget action", () => {
  const html = renderToStaticMarkup(createElement(QianchuanUploadHistory, { batches: [{ ...batch, taskIds: ["a", "b"], notSelectedCount: 0, closedAt: "2026-09-30T00:00:00Z", tasks: [] }] }));
  expect(html).toContain("已结束的本地上传历史（只读）"); expect(html).toContain("计划 3 / 已准入 2 / 尚未准入 1"); expect(html).toContain("原 READY 1 / UNKNOWN 1 / 未选 0");
  expect(html).not.toContain("<button"); expect(html).not.toContain("安全继续");
});
it("shows scoped historical closure candidates with their frozen account, plan and full batch counts", () => {
  const foreign = { ...batch, projectId: "foreign-project", pageBatchId: "foreign-batch" };
  const html = renderToStaticMarkup(createElement(DouyinUploadPanel, { projectId: "project", status: {
    config: QianchuanUploadConfigSchema.parse({}), configSelected: false, accounts: [], ready: false, message: "", tasks: [], legacyTasks: [],
    historicalBatches: [{ ...batch, taskIds: ["a", "b"], notSelectedCount: 0 }, foreign],
  }, onState() {} }));
  const history = html.match(/<section aria-label="历史本地上传批次">[\s\S]*?<\/section>/)?.[0];
  expect(history).toContain("历史批次"); expect(history).toContain("项目 project"); expect(history).toContain("账户 123 / 计划 456");
  expect(history).toContain("计划 3 条"); expect(history).toContain("已准入 2 条"); expect(history).toContain("尚未准入 1 条");
  expect(history).toContain("READY 1"); expect(history).toContain("UNKNOWN 1"); expect(history).toContain("未选 0");
  expect(history).not.toContain("foreign-project"); expect(history).not.toContain("foreign-batch");
  expect(history).not.toContain("安全继续"); expect(history).not.toContain("只读核查页面");
  const incomplete = renderToStaticMarkup(createElement(DouyinUploadPanel, { projectId: "project", status: {
    config: QianchuanUploadConfigSchema.parse({}), configSelected: false, accounts: [], ready: false, message: "", tasks: [], legacyTasks: [],
    historicalBatches: [{ ...batch, canClose: false }],
  }, onState() {} }));
  expect(incomplete.match(/<section aria-label="历史本地上传批次">[\s\S]*?<\/section>/)?.[0]).toContain('<button type="button" disabled="">');
});
