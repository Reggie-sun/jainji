import { useEffect, useState } from "react";
import type { AgentRun } from "../shared/agent";
import type { CoverReviewDraft } from "../shared/cover-review";

export function CoverReviewProgress({ draft, agentRun, onStop }: { draft: CoverReviewDraft; agentRun?: AgentRun; onStop(): void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [draft.id, draft.status]);
  const ready = draft.media.filter((media) => media.evidence.length && draft.frameTimes?.[media.mediaId]?.length).length;
  const run = agentRun?.projectId === draft.projectId && agentRun.status === "running" ? agentRun : undefined;
  const completed = run?.items.filter((item) => item.status === "prepared").length ?? 0;
  const active = run?.items.find((item) => item.status === "analyzing");
  const extracting = draft.status === "preparing_preview" && ready < draft.media.length;
  const message = extracting ? `正在准备视频帧：${ready} / ${draft.media.length} 个素材` : draft.status === "preparing_preview" ? `正在设计并生成预览${run ? `：${completed} / ${run.items.length} 个版本` : "…"}` : draft.status === "analyzing" ? "正在识别覆盖位置…" : "正在复核画面…";
  return <div className="cover-review-progress">
    <div role="status" aria-live="polite"><strong>{message}</strong>{active && <p>当前：{active.name}</p>}</div>
    <progress aria-label="预览准备进度" max={extracting ? draft.media.length : run?.items.length ?? 1} value={extracting ? ready : run ? completed : undefined} />
    <div className="cover-review-actions"><span>本页已等待 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</span><button type="button" onClick={onStop}>停止准备</button></div>
    {!extracting && draft.status === "preparing_preview" && <p>此阶段包含模型请求和本地渲染，可能需要几分钟，请勿重复提交。</p>}
  </div>;
}
