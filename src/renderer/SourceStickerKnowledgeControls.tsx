import type { SourceStickerRefreshIntent } from "./source-sticker-refresh";

export function SourceStickerKnowledgeControls({ projectId: _projectId, selectedReadyIds, eligible, disabled, refresh, onRequest }: {
  projectId: string; selectedReadyIds: readonly string[]; eligible: boolean; disabled: boolean;
  refresh?: SourceStickerRefreshIntent; onRequest(): void;
}) {
  const unavailable = disabled || !eligible || selectedReadyIds.length === 0 || Boolean(refresh);
  return <section className="card" aria-label="原贴纸知识重新检查">
    <div className="card-header"><h2>原贴纸知识 <span>本轮设置</span></h2><span>仅保存在本机</span></div>
    <div className="preview-caption">
      <strong>{refresh ? `已安排重新检查 ${refresh.mediaIds.length} 条素材` : "需要时重新检查已选素材"}</strong>
      <p>此按钮只为下一次制作标记当前已选素材；点击本身不会调用模型，也不会写入项目或本机设置。</p>
      <button type="button" className="button secondary compact" disabled={unavailable} onClick={onRequest}>重新检查原贴纸</button>
      {!eligible && <small>仅“全部交给 Agent 且关闭覆盖”，或“Agent 自动覆盖”可重新检查。</small>}
      <small>不会清除争议、不会修复损坏知识库，也不能人工批准被安全阻断的结果。</small>
    </div>
  </section>;
}
