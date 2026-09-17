import type { SourceKnowledgeProgress } from "../shared/source-sticker-knowledge";

const phaseLabels: Record<SourceKnowledgeProgress["phase"], string> = {
  checking: "正在核对源贴纸知识", recognizing: "正在识别原贴纸", reusing: "正在复用已核查知识",
  correcting: "正在修正源贴纸事实", reviewed: "源贴纸已复核", "not-saved": "已核查，未写入本机知识库", blocked: "本轮源贴纸流程已停止",
};
const originLabels: Record<NonNullable<SourceKnowledgeProgress["origin"]>, string> = { cold: "首次检查", warm: "复用已核查结果", refresh: "按本轮请求重新检查", run: "本轮同源复用" };
function elapsed(ms: number): string { return `${(Math.max(0, ms) / 1000).toFixed(ms >= 10_000 ? 0 : 1)} 秒`; }
function ranges(progress: SourceKnowledgeProgress): string {
  return progress.reviewedRanges?.map((range) => `${(range.startMs / 1000).toFixed(1)}–${(range.endMs / 1000).toFixed(1)} 秒`).join("；") ?? "尚未形成已核查时段";
}

/** Safe renderer projection only: never expose source keys, revisions, evidence bytes, or local paths. */
export function SourceStickerKnowledgeDetails({ progress }: { progress?: SourceKnowledgeProgress }) {
  if (!progress) return null;
  return <div className="preview-caption">
    <strong>{progress.origin && `${originLabels[progress.origin]} · `}{phaseLabels[progress.phase]}</strong>
    {progress.reason && <p>{progress.reason}</p>}
    <details>
      <summary>查看核查说明</summary>
      <p>{progress.origin ? originLabels[progress.origin] : "本轮源贴纸检查"}；已核查时段：{ranges(progress)}。</p>
      <p>识别 {progress.recognitionRequests} 次，样片 {progress.previewRequests} 次，修订 {progress.revisions} 次，渲染 {progress.renders} 次，用时 {elapsed(progress.elapsedMs)}。</p>
      {(progress.executor || progress.supervisor) && <p>本轮执行模型：{progress.executor ?? "未公开"}；复核模型：{progress.supervisor ?? "未公开"}。</p>}
      <small>这是抽样核查，不保证快速闪现、遮挡或复杂运动中的每一帧都能识别。</small>
    </details>
  </div>;
}
