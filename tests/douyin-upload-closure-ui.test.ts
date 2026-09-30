import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QianchuanClosureConfirmation, QianchuanUploadHistory } from "../src/renderer/QianchuanUploadHistory";
import type { QianchuanUploadBatchSummary } from "../src/shared/douyin-upload";
const batch: QianchuanUploadBatchSummary = { projectId: "project", pageBatchId: "batch", advertiserId: "123", adId: "456", expectedCount: 3, taskIds: ["a", "b", "c"], readyCount: 1, unknownCount: 1, notSelectedCount: 1, canClose: true };
it("confirmation identifies full irreversible scope, original outcomes and zero platform acceptance", () => {
  const html = renderToStaticMarkup(createElement(QianchuanClosureConfirmation, { batch, busy: false, onConfirm() {}, onCancel() {} }));
  for (const text of ["项目 project", "计划 456", "批次 batch", "共 3 条", "READY 1", "UNKNOWN 1", "未选 1", "全部未选成员", "不能恢复", "平台结果不变", "保留本批"]) expect(html).toContain(text);
});
it("closed historical results expose no resume, delete or retarget action", () => {
  const html = renderToStaticMarkup(createElement(QianchuanUploadHistory, { batches: [{ ...batch, closedAt: "2026-09-30T00:00:00Z", tasks: [] }] }));
  expect(html).toContain("已结束的本地上传历史（只读）"); expect(html).toContain("原 READY 1 / UNKNOWN 1 / 未选 1");
  expect(html).not.toContain("<button"); expect(html).not.toContain("安全继续");
});
