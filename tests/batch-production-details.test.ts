import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { BatchProductionDetail } from "../src/shared/batch-production";
import { BatchProductionWorkList } from "../src/renderer/BatchProductionDetails";

const render = (patch: Partial<BatchProductionDetail> = {}) => renderToStaticMarkup(createElement(BatchProductionWorkList, { detail: { runId: "run",
  job: { id: "job", recentProjectId: "recent", name: "蝴蝶贴", requestedCount: 2, actualCount: 2, productPrice: "手动价格", coverEnabled: true,
    displayMode: "full", status: "producing", taskIds: [], completedCount: 0, failedCount: 0 }, items: [], tasks: [], ...patch }, onArtifact: () => undefined }));

describe("batch works presentation", () => {
  it("offers bounded resume for unselected tasks and only read-only checks for uncertain uploads", () => {
    const detail = { runId: "run", job: { id: "job", name: "蝴蝶贴", actualCount: 2, requestedCount: 2, accountProduct: "蝴蝶贴" }, items: [], tasks: [],
      upload: { tasks: [
        { upload_task_id: "a", file_name: "unknown.mp4", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" },
        { upload_task_id: "b", file_name: "pending.mp4", state: "PENDING", upload_outcome: "NOT_SELECTED" },
      ] } } as unknown as BatchProductionDetail;
    const html = renderToStaticMarkup(createElement(BatchProductionWorkList, { detail, onArtifact: () => undefined, onResumeUpload: () => undefined }));
    expect(html).toContain('>核查原上传页</button>');
    expect(html).toMatch(/disabled="">安全继续<\/button>/);
    detail.upload!.tasks.shift();
    const pending = renderToStaticMarkup(createElement(BatchProductionWorkList, { detail, onArtifact: () => undefined, onResumeUpload: () => undefined }));
    expect(pending).toContain('>安全继续</button>'); expect(pending).not.toContain('disabled=""');
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
    const html = render({ job: base, upload: { message: "fixture upload", tasks: [
      { upload_task_id: "ready", file_name: "ready.mp4", advertiserId: "123", adId: "456", state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" },
      { upload_task_id: "unknown", file_name: "unknown.mp4", advertiserId: "123", adId: "456", state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" },
    ] as NonNullable<BatchProductionDetail["upload"]>["tasks"] } });
    expect(html).toContain("已上传 1 / 2 条"); expect(html).toContain("待在 Chrome 确认"); expect(html).toContain("结果未知，禁止重新上传");
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
    const html = render({ job, tasks, upload: { message: "此前制作的上传记录", accounts: [{ product: "眼贴", productName: "晚安油", browserProfileName: "当前 Chrome", advertiserId: "123", adId: "456", available: true }], tasks: uploads } });
    expect(html).toContain("千川上传 · 当前 Chrome"); expect(html).not.toContain("千川上传 · 眼贴");
    const rebound = render({ job, tasks, upload: { message: "此前制作的上传记录", tasks: uploads, accounts: [{ product: "眼贴", browserProfileName: "其他 Chrome", advertiserId: "999", adId: "456", available: true }] } });
    expect(rebound).not.toContain("其他 Chrome");
    expect(html).toContain("已上传 12 / 30 条"); expect(html).toContain("待上传 9 条"); expect(html).toContain("结果未知 9 条");
    expect(html).toContain("9 条上传结果未知，需核查原 Chrome 上传页面");
    expect(html).not.toContain("安全继续"); expect(html).not.toContain("重新上传</button>");
  });
});
