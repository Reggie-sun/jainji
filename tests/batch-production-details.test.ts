import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { BatchProductionDetail } from "../src/shared/batch-production";
import { BatchProductionWorkList } from "../src/renderer/BatchProductionDetails";

const render = (patch: Partial<BatchProductionDetail> = {}) => renderToStaticMarkup(createElement(BatchProductionWorkList, { detail: { runId: "run",
  job: { id: "job", recentProjectId: "recent", name: "蝴蝶贴", requestedCount: 2, actualCount: 2, productPrice: "手动价格", coverEnabled: true,
    displayMode: "full", status: "producing", taskIds: [], completedCount: 0, failedCount: 0 }, items: [], tasks: [], ...patch }, onArtifact: () => undefined }));

describe("batch works presentation", () => {
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
});
