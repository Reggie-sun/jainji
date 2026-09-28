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
const panel = (upload: QianchuanUploadResult) => renderToStaticMarkup(createElement(DouyinUploadPanel, {
  projectId, status: { config: QianchuanUploadConfigSchema.parse({}), configSelected: false, accounts: [], ready: false, message: "千川生产页面合同尚未核实。", tasks: [upload], legacyTasks: [] }, onState: () => {},
}));
it("starts every production upload off and requires a manual account choice without captions", () => {
  const off = renderToStaticMarkup(createElement(DouyinUploadControls, { onChange: () => {} }));
  expect(off).toContain("默认关闭"); expect(off).toContain("停在确定前"); expect(off).not.toContain('checked=""');
  const on = renderToStaticMarkup(createElement(DouyinUploadControls, { value: { enabled: true }, onChange: () => {}, accounts: [{ product: "眼贴", advertiserId: "123", adId: "456", available: true }] }));
  expect(on).toContain("请选择一个产品账号"); expect(on).toContain('value="" selected=""');
  expect(on).toContain('value="眼贴"'); expect(on).toContain('value="热敷贴" disabled=""');
  expect(on).not.toContain("发布文案"); expect(on).not.toContain("提交发布");
});
it("keeps append selection independently off", () => {
  const batch = { id: projectId, status: "completed", mediaIds: [projectId], outputDirectory: "/tmp/out", createdAt: "2026-09-27T00:00:00.000Z", tasks: [] } as unknown as PublicExportBatch;
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元", mediaCount: 1 }, mediaLabel: "成片.mp4", onClose: () => {} }));
  expect(html).toContain("千川上传"); expect(html).toContain("停在确定前"); expect(html).not.toContain('checked=""');
});
it("projects unknown selected uploads as read-only without publish, caption or arbitrary endpoint controls", () => {
  const html = panel(task()); expect(html).toContain("只读核查页面"); expect(html).not.toContain("安全继续");
  for (const forbidden of ["提交发布", "修正文案", "人工确认平台已接受", "creator.douyin.com", "CDP 地址"]) expect(html).not.toContain(forbidden);
  expect(html).toContain("导入已有账号配置"); expect(html).toContain("千川生产页面合同尚未核实。");
});
it("keeps technical settings collapsed and recovery actions available outside them", () => {
  const html = panel(task());
  const advanced = html.match(/<details[^>]*><summary>高级设置<\/summary>[\s\S]*?<\/details>/)?.[0];
  expect(advanced).toBeDefined(); expect(advanced).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/);
  expect(advanced).toContain("操作时限"); expect(advanced).toContain("保存有限本机诊断");
  const main = html.replace(advanced!, "");
  expect(main).not.toContain('type="number"'); expect(advanced).toContain("导入已有账号配置");
  expect(main).not.toContain("导入已有账号配置"); expect(main).not.toContain("刷新账号摘要");
  expect(main).toContain("保存上传设置"); expect(main).toContain("只读核查页面"); expect(main).toContain("停止任务");
});
it("shows available products without making file configuration a daily step", () => {
  const html = renderToStaticMarkup(createElement(DouyinUploadPanel, {
    projectId, status: { config: QianchuanUploadConfigSchema.parse({}), configSelected: true, accounts: [{ product: "眼贴", advertiserId: "123", adId: "456", available: true }], ready: false, message: "自动上传已关闭。", tasks: [], legacyTasks: [] }, onState: () => {},
  }));
  const advanced = html.match(/<details[^>]*><summary>高级设置<\/summary>[\s\S]*?<\/details>/)![0];
  const main = html.replace(advanced, "");
  expect(main).toContain("千川账号设置"); expect(main).toContain("粘贴千川计划链接即可更换计划"); expect(main).toContain("眼贴<small>已设置"); expect(main).not.toContain("账户 123");
  expect(advanced).toContain("账户 123 / 计划 456"); expect(main).not.toContain('value="眼贴"');
});
it("hands ready uploads back to Chrome without a confirmation action", () => {
  const html = panel(task({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY", readyEvidence: { advertiserId: "123", adId: "456", fileName: "成片.mp4", selectedCount: 1, observedAt: "2026-09-27T00:00:00.000Z", pageOwnership: { targetId: "owned", pageBatchId: projectId, modalSessionId: projectId } } }));
  expect(html).toContain("自行确认"); expect(html).toContain("只读核查页面"); expect(html).not.toContain("停止任务"); expect(html).not.toMatch(/<button[^>]*>确定</);
});
it("allows safe continuation only before selection and no actions on duplicate aliases", () => {
  expect(panel(task({ state: "CANCELLED", upload_outcome: "NOT_SELECTED" }))).toContain("安全继续");
  const html = panel(task({ duplicate_of: "c".repeat(64) })); expect(html).toContain("已关联同目标");
  expect(html).not.toContain("只读核查页面"); expect(html).not.toContain("停止任务");
});
