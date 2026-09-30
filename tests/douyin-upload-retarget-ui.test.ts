import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QianchuanUploadConfigSchema, type QianchuanUploadResult } from "../src/shared/douyin-upload";
import { AppendProductionDialog } from "../src/renderer/AppendProductionDialog";
import { DouyinUploadControls } from "../src/renderer/DouyinUploadControls";
import { DouyinUploadPanel } from "../src/renderer/DouyinUploadPanel";
import type { PublicExportBatch } from "../src/main/application";

const projectId = "11111111-1111-4111-8111-111111111111";
const task = (overrides: Partial<QianchuanUploadResult> = {}): QianchuanUploadResult => ({
  project_id: projectId, batch_id: "22222222-2222-4222-8222-222222222222", export_task_id: "33333333-3333-4333-8333-333333333333",
  upload_task_id: "a".repeat(64), artifact_sha256: "b".repeat(64), file_name: "成片.mp4", accountProduct: "眼贴", advertiserId: "123", adId: "456",
  state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: "2026-09-27T00:00:00.000Z", ...overrides,
});
const panel = (upload: QianchuanUploadResult, advertiserId = "123") => renderToStaticMarkup(createElement(DouyinUploadPanel, {
  projectId, status: { config: QianchuanUploadConfigSchema.parse({}), configSelected: false, accounts: [{product: "眼贴", advertiserId, adId:"789", available:true}], ready: false, message: "千川生产页面合同尚未核实。", tasks: [upload], legacyTasks: [] }, onState: () => {},
}));
it("shows explicit whole-batch new plan authorization and disables stale safe continue", () => {
  const html=panel(task({state:"PENDING",upload_outcome:"NOT_SELECTED"}));
  expect(html).toContain("原计划 456");expect(html).toContain("当前保存计划为 789");
  expect(html).toMatch(/<button[^>]*>本批改传当前计划 789<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>安全继续<\/button>/);
  expect(html).toContain("更改后仍需点击");
});
it("selected, cancelled and alias records cannot offer retarget", () => {
  for(const value of [task(),task({state:"WAITING_FOR_CONFIRMATION",upload_outcome:"READY"}),task({state:"CANCELLED",upload_outcome:"NOT_SELECTED"}),task({duplicate_of:"c".repeat(64)})]){
    expect(panel(value)).not.toMatch(/<button[^>]*>本批改传/);
  }
  expect(panel(task())).toContain("已有文件选择记录，不能改传或重传");
});
it("cannot offer another advertiser as a target",()=>{
  const html=panel(task({state:"PENDING",upload_outcome:"NOT_SELECTED"}),"999");
  expect(html).not.toContain("本批改传当前计划");
});
