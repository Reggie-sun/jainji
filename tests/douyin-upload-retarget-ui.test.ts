import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QianchuanUploadConfigSchema, type QianchuanUploadResult } from "../src/shared/douyin-upload";
import { AppendProductionDialog } from "../src/renderer/AppendProductionDialog";
import { DouyinUploadControls } from "../src/renderer/DouyinUploadControls";
import { DouyinUploadPanel } from "../src/renderer/DouyinUploadPanel";
import { QianchuanAccountSettings } from "../src/renderer/QianchuanAccountSettings";
import type { PublicExportBatch } from "../src/main/application";

const projectId = "11111111-1111-4111-8111-111111111111";
const task = (overrides: Partial<QianchuanUploadResult> = {}): QianchuanUploadResult => ({
  project_id: projectId, batch_id: "22222222-2222-4222-8222-222222222222", export_task_id: "33333333-3333-4333-8333-333333333333",
  upload_task_id: "a".repeat(64), artifact_sha256: "b".repeat(64), file_name: "成片.mp4", accountProduct: "眼贴", advertiserId: "123", adId: "456",
  state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", retryable: false, retry_count: 0, attempt_count: 1, timestamp: "2026-09-27T00:00:00.000Z", ...overrides,
});
const panel = (upload: QianchuanUploadResult, advertiserId = "123", adId = "789") => renderToStaticMarkup(createElement(DouyinUploadPanel, {
  projectId, status: { config: QianchuanUploadConfigSchema.parse({}), configSelected: false, accounts: [{product: "眼贴", advertiserId, adId, available:true}], ready: false, message: "千川生产页面合同尚未核实。", tasks: [upload], legacyTasks: [] }, onState: () => {},
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
it("offers a direct product and plan editor before a replacement plan has been saved", () => {
  const html = panel(task({ state: "NEEDS_HUMAN", upload_outcome: "NOT_SELECTED" }), "123", "456");
  expect(html).toContain("更换产品 / 千川计划");
  expect(html).toContain("保存新计划不会自动重传旧任务");
  expect(html).not.toContain("本批改传当前计划");
});
it("opens the existing account editor on the requested slot and preserves its account identity", () => {
  const html = renderToStaticMarkup(createElement(QianchuanAccountSettings, {
    accounts: [{ product: "眼贴", productName: "晚安油", advertiserId: "123", adId: "456", available: true }],
    initialProduct: "眼贴", expectedAdvertiserId: "123", busy: false,
    onSave: async () => true, onOpenBrowser: async () => true, onControlBrowser: async () => true,
  }));
  expect(html).toContain('value="晚安油"');
  expect(html).toContain("aavid=123&amp;adId=456");
  expect(html).toContain("账户 123 保持不变");
  expect(html).toContain("保存新产品和计划");
});
it("blocks a different advertiser in task-driven plan editing", () => {
  const html = renderToStaticMarkup(createElement(QianchuanAccountSettings, {
    accounts: [{ product: "眼贴", advertiserId: "999", adId: "456", available: true }],
    initialProduct: "眼贴", expectedAdvertiserId: "123", busy: false,
    onSave: async () => true, onOpenBrowser: async () => true, onControlBrowser: async () => true,
  }));
  expect(html).toContain("请使用原账户 123 的新计划链接");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存新产品和计划<\/button>/);
});
