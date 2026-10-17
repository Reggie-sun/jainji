import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { BatchProductionDetail } from "../src/shared/batch-production";
import type { QianchuanClosedBatchSummary } from "../src/shared/douyin-upload";
import { BatchProductionWorkList } from "../src/renderer/BatchProductionDetails";

import { BatchUploadList } from "../src/renderer/BatchUploadDetails";

const makeDetail = (patch: Partial<BatchProductionDetail> = {}): BatchProductionDetail => ({ runId: "run",
  job: { id: "job", recentProjectId: "recent", name: "蝴蝶贴", requestedCount: 2, actualCount: 2, productPrice: "手动价格", coverEnabled: true,
    displayMode: "full", status: "producing", taskIds: [], completedCount: 0, failedCount: 0 }, items: [], tasks: [], ...patch });
const render = (patch: Partial<BatchProductionDetail> = {}) => renderToStaticMarkup(createElement(BatchProductionWorkList, { detail: makeDetail(patch), onArtifact: () => undefined, onUploads: () => undefined }));
const renderUploads = (patch: Partial<BatchProductionDetail> = {}) => renderToStaticMarkup(createElement(BatchUploadList, { detail: makeDetail(patch) }));

describe("batch works presentation", () => {
  it("shows explicit recovery with original targets only for a main-process qualified historical batch", () => {
    const detail = makeDetail({ upload: { message: "历史任务", historical: true, tasks: [], recoverableBatches: [{ uploadTaskId: "id", pageBatchId: "batch", advertiserId: "7000", adId: "9001", count: 30 }] } });
    const html = renderToStaticMarkup(createElement(BatchUploadList, { detail, onResumeUpload: () => undefined }));
    expect(html).toContain("恢复本批上传"); expect(html).toContain("恢复 30 条未上传成片");
    expect(html).toContain("原账户 7000 / 原计划 9001");
    expect(renderToStaticMarkup(createElement(BatchUploadList, { detail: makeDetail({ upload: { message: "历史任务", historical: true, tasks: [] } }), onResumeUpload: () => undefined }))).not.toContain("恢复本批上传");
  });
  it("shares live row counts across works and upload details while keeping active tasks protected", () => {
    const job = { ...makeDetail().job, accountProduct: "蝴蝶贴" as const, requestedCount: 4, actualCount: 4 };
    const tasks = [
      { upload_task_id: "live", file_name: "live.mp4", state: "WAITING_UPLOAD_COMPLETE", upload_outcome: "MAY_HAVE_UPLOADED", rowReady: true },
      { upload_task_id: "processing", file_name: "processing.mp4", state: "WAITING_UPLOAD_COMPLETE", upload_outcome: "MAY_HAVE_UPLOADED" },
      { upload_task_id: "pending", file_name: "pending.mp4", state: "PENDING", upload_outcome: "NOT_SELECTED" },
      { upload_task_id: "unknown", file_name: "unknown.mp4", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", rowReady: true },
    ] as NonNullable<BatchProductionDetail["upload"]>["tasks"];
    const detail = makeDetail({ job, upload: { message: "live observation", tasks } });
    for (const html of [render(detail), renderUploads(detail)]) {
      expect(html).toContain("已上传 1 / 4 条"); expect(html).toContain("待上传 1 条");
      expect(html).toContain("处理中 1 条"); expect(html).toContain("结果未知 1 条");
    }
    const html = renderToStaticMarkup(createElement(BatchUploadList, { detail, onResumeUpload: () => undefined }));
    expect(html).toContain("已上传，等待整批处理");
    expect(html).toMatch(/disabled="">安全继续<\/button>/);
    expect(html.split("结果未知，禁止重新上传，请核查原页面。")).toHaveLength(2);
  });
  it("offers bounded resume for unselected tasks and only read-only checks for uncertain uploads", () => {
    const detail = { runId: "run", job: { id: "job", name: "蝴蝶贴", actualCount: 2, requestedCount: 2, accountProduct: "蝴蝶贴" }, items: [], tasks: [],
      upload: { tasks: [
        { upload_task_id: "a", file_name: "unknown.mp4", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" },
        { upload_task_id: "b", file_name: "pending.mp4", state: "PENDING", upload_outcome: "NOT_SELECTED" },
      ] } } as unknown as BatchProductionDetail;
    const html = renderToStaticMarkup(createElement(BatchUploadList, { detail, onResumeUpload: () => undefined }));
    expect(html).toContain('>核查原上传页</button>');
    expect(html).toMatch(/disabled="">安全继续<\/button>/);
    detail.upload!.tasks.shift();
    const pending = renderToStaticMarkup(createElement(BatchUploadList, { detail, onResumeUpload: () => undefined }));
    expect(pending).toContain('>安全继续</button>'); expect(pending).not.toContain('disabled=""');
  });
  it("keeps upload rows and recovery controls out of the works view", () => {
    const upload = { tasks: [{ upload_task_id: "a", file_name: "upload-only.mp4", state: "CANCELLED", upload_outcome: "NOT_SELECTED", attempt_count: 1, retry_count: 2 }] } as BatchProductionDetail["upload"];
    const job = { ...makeDetail().job, accountProduct: "蝴蝶贴" as const };
    const works = render({ job, upload });
    expect(works).toContain("查看本批上传任务"); expect(works).not.toContain("upload-only.mp4"); expect(works).not.toContain("安全继续");
    const uploads = renderUploads({ job, upload });
    expect(uploads).toContain("连接 / 准备已重试 2 次"); expect(uploads).toContain("启动不表示已选文件或上传成功");
    const historical = renderToStaticMarkup(createElement(BatchUploadList, { detail: makeDetail({ job, upload: { ...upload!, historical: true } }), onResumeUpload: () => undefined }));
    expect(historical).not.toContain("安全继续");
  });
  it("shows frozen Hybrid partial outcomes while keeping export errors authoritative", () => {
    const coverSummary = "自动形状匹配 · 已处理 0 个角落；右上：语义未确认；其他角落保持原样";
    const tasks = [{ id: "t1", status: "completed", progress: 1, coverSummary },
      { id: "t2", status: "failed", progress: 0, coverSummary, errorMessage: "真实导出失败" }] as BatchProductionDetail["tasks"];
    const html = render({ tasks });
    expect(html.split(coverSummary)).toHaveLength(2); expect(html).toContain("导出完成"); expect(html).toContain("真实导出失败");
  });
  it("shows live progress, completed playback and the exact production failure", () => {
    const html = render({ items: [{ id: "plan", mediaId: "m", version: 1, name: "失败素材", status: "failed", error: "主管无法确认覆盖效果" }],
      tasks: [{ id: "t1", status: "running", progress: 0.37 }, { id: "t2", status: "completed", progress: 1 }] as BatchProductionDetail["tasks"] });
    expect(html).toContain("主管无法确认覆盖效果");
    expect(html).toContain("正在渲染 37%");
    expect(html).toContain("播放"); expect(html).toContain("成片文件夹");
    expect(html).not.toContain("重试导出"); expect(html).not.toContain("追加制作");
  });

  it("describes local preparation without implying model calls", () => {
    const html = render({ usesModel: false, items: [{ id: "p", mediaId: "m", version: 1, name: "本地素材", status: "analyzing" }] });
    expect(html).toContain("正在准备本地包装"); expect(html).not.toContain("正在分析与设计包装");
  });

  it("shows queued jobs without inventing completed tasks", () => {
    const base = render();
    expect(base).toContain("正在准备制作");
    expect(base).not.toContain(">播放<");
  });

  it("keeps export completion separate from upload ready and unknown outcomes", () => {
    const base = { id: "job", recentProjectId: "recent", name: "蝴蝶贴", requestedCount: 2, actualCount: 2, productPrice: "手动价格", coverEnabled: true,
      displayMode: "full" as const, status: "completed" as const, taskIds: [], completedCount: 2, failedCount: 0, accountProduct: "蝴蝶贴" as const };
    const html = renderUploads({ job: base, upload: { message: "fixture upload", tasks: [
      { upload_task_id: "ready", file_name: "ready.mp4", advertiserId: "123", adId: "456", state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" },
      { upload_task_id: "unknown", file_name: "unknown.mp4", advertiserId: "123", adId: "456", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" },
    ] as NonNullable<BatchProductionDetail["upload"]>["tasks"] } });
    expect(html).toContain("已上传 1 / 2 条"); expect(html).toContain("等待确认"); expect(html).toContain("整批就绪后自动确认"); expect(html).toContain("结果未知，禁止重新上传");
    expect(html).not.toContain("已发布"); expect(html).not.toContain(">确定<");
  });

  it("shows the configured account name and explains a partially uploaded completed batch", () => {
    const job = { id: "job", recentProjectId: "recent", name: "晚安油", requestedCount: 30, actualCount: 30, productPrice: "", coverEnabled: true,
      displayMode: "full" as const, status: "completed" as const, taskIds: [], completedCount: 30, failedCount: 0, accountProduct: "眼贴" as const };
    const uploads = [
      ...Array.from({ length: 12 }, (_, index) => ({ upload_task_id: `ready-${index}`, file_name: `ready-${index}.mp4`, state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" })),
      ...Array.from({ length: 9 }, (_, index) => ({ upload_task_id: `unknown-${index}`, file_name: `unknown-${index}.mp4`, state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" })),
      ...Array.from({ length: 9 }, (_, index) => ({ upload_task_id: `pending-${index}`, file_name: `pending-${index}.mp4`, state: "PENDING", upload_outcome: "NOT_SELECTED" })),
    ].map(task => ({ ...task, accountProduct: "眼贴", advertiserId: "123", adId: "456" })) as NonNullable<BatchProductionDetail["upload"]>["tasks"];
    const tasks = Array.from({ length: 30 }, (_, index) => ({ id: `export-${index}`, status: "completed", progress: 1 })) as BatchProductionDetail["tasks"];
    const html = renderUploads({ job, tasks, upload: { message: "此前制作的上传记录", accounts: [{ product: "眼贴", productName: "晚安油", browserProfileName: "当前 Chrome", advertiserId: "123", adId: "456", available: true }], tasks: uploads } });
    expect(html).toContain("千川上传 · 当前 Chrome"); expect(html).not.toContain("千川上传 · 眼贴");
    const rebound = renderUploads({ job, tasks, upload: { message: "此前制作的上传记录", tasks: uploads, accounts: [{ product: "眼贴", browserProfileName: "其他 Chrome", advertiserId: "999", adId: "456", available: true }] } });
    expect(rebound).not.toContain("其他 Chrome");
    expect(html).toContain("已上传 12 / 30 条"); expect(html).toContain("待上传 9 条"); expect(html).toContain("结果未知 9 条");
    expect(html).toContain("9 条上传结果未知，需核查原 Chrome 上传页面");
    expect(html).not.toContain("安全继续"); expect(html).not.toContain("重新上传</button>");
  });

  it("shows aliases as skipped in both batch progress views without claiming old receipts as new uploads", () => {
    const aliases = Array.from({ length: 18 }, (_, index) => ({ upload_task_id: `${index + 1}`.padStart(64, "0"), file_name: `裂变-${index + 1}.mp4`,
      accountProduct: "眼贴", advertiserId: "123", adId: "456", state: "ACCEPTED", upload_outcome: "ACCEPTED", attempt_count: 0,
      duplicate_of: "c".repeat(64), acceptedEvidence: { advertiserId: "123", adId: "456", fileName: "旧批次原片.mp4", selectedCount: 1,
        observedAt: "2026-10-17T00:00:00.000Z", pageOwnership: { targetId: "old-tab", pageBatchId: "11111111-1111-4111-8111-111111111111", modalSessionId: "11111111-1111-4111-8111-111111111111" },
        platformVideoId: "old-platform-video", attempt: 1, requestSha256: "d".repeat(64), responseSha256: "e".repeat(64) },
    })) as NonNullable<BatchProductionDetail["upload"]>["tasks"];
    const closedBatch = { projectId: "11111111-1111-4111-8111-111111111111", pageBatchId: "11111111-1111-4111-8111-111111111111", advertiserId: "123", adId: "456",
      expectedCount: 50, taskIds: aliases.map(task => task.upload_task_id), readyCount: 0, acceptedCount: 18, newAcceptedCount: 0, duplicateCount: 18,
      unknownCount: 0, notSelectedCount: 0, closedAt: "2026-10-18T00:00:00.000Z", tasks: aliases } as unknown as QianchuanClosedBatchSummary;
    const job = { ...makeDetail().job, accountProduct: "眼贴" as const, requestedCount: 50, actualCount: 50 };
    const detail = makeDetail({ job, upload: { message: "历史记录", tasks: aliases, closedBatches: [closedBatch] } });
    const works = render(detail);
    const uploads = renderUploads(detail);

    expect(works).toContain("已上传 0 / 50 条"); expect(works).toContain("重复跳过 18 条");
    expect(uploads).toContain("已上传 0 / 50 条"); expect(uploads).toContain("重复跳过 18 条"); expect(uploads).toContain("需处理 0 条");
    expect(uploads).toContain("引用既有平台接收回执"); expect(uploads).not.toContain("平台已接收 · 视频 ID old-platform-video");
    expect(uploads).not.toContain("安全继续"); expect(uploads).not.toContain("恢复本批上传");
  });

  it("keeps the existing continuation block when a skipped alias refers to an unknown original", () => {
    const alias = { upload_task_id: "alias", file_name: "alias.mp4", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED", attempt_count: 0,
      duplicate_of: "c".repeat(64) } as NonNullable<BatchProductionDetail["upload"]>["tasks"][number];
    const pending = { upload_task_id: "pending", file_name: "pending.mp4", state: "PENDING", upload_outcome: "NOT_SELECTED" } as NonNullable<BatchProductionDetail["upload"]>["tasks"][number];
    const detail = makeDetail({ job: { ...makeDetail().job, accountProduct: "蝴蝶贴" }, upload: { message: "", tasks: [alias, pending] } });
    const html = renderToStaticMarkup(createElement(BatchUploadList, { detail, onResumeUpload: () => undefined }));

    expect(html).toContain("重复跳过 1 条"); expect(html).toContain("结果未知 0 条");
    expect(html).toContain("原上传结果未知"); expect(html).toMatch(/disabled="">安全继续<\/button>/);
  });
});
