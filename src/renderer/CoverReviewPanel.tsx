import { useEffect, useRef, useState } from "react";
import type { CoverReviewDraft, CoverSegment } from "../shared/cover-review";
import type { CoverReviewCommand } from "../main/cover-review-session";
import type { MediaView } from "../main/media";
import type { DesktopState } from "../shared/desktop";
import type { AgentStartInput } from "../shared/agent";
import { interpolateCoverRectangle } from "../shared/cover-sticker";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";
import type { ChatGPTStatus } from "../shared/agent";
import { ModelPicker } from "./ModelPicker";
import { CoverReviewTimeline } from "./CoverReviewTimeline";
import "./cover-review.css";

const labels: Record<CoverReviewDraft["status"], string> = { draft: "草稿", analyzing: "候选分析中", reviewing: "独立复核中", needs_human: "待人工审阅", preparing_preview: "动态预览准备中", awaiting_approval: "待最终确认", approved: "已批准", stale: "证据已过期", cancelled: "已停止", failed: "准备失败" };

export function CoverReviewPanel({ drafts, mediaItems, input, library, chatgpt, onState }: { library: ConnectionLibrary; chatgpt?: ChatGPTStatus; drafts: CoverReviewDraft[]; mediaItems: MediaView[]; input: AgentStartInput; onState(state: DesktopState): void }) {
  const draft = drafts.at(-1);
  const [mediaId, setMediaId] = useState("");
  const [activeId, setActiveId] = useState("");
  const [buffer, setBuffer] = useState<CoverSegment>();
  const [timeMs, setTimeMs] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<SelectModel>();
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const media = draft?.media.find((item) => item.mediaId === mediaId) ?? draft?.media[0];
  const source = mediaItems.find(({ id }) => id === media?.mediaId);
  const active = media?.segments.find(({ id }) => id === activeId);
  useEffect(() => { setBuffer(active && structuredClone(active)); }, [activeId, draft?.revision]);
  useEffect(() => { setVersion(0); setTimeMs(0); setActiveId(""); }, [media?.mediaId, draft?.id]);
  const run = async (work: () => Promise<DesktopState>) => { setBusy(true); setError(""); try { onState(await work()); } catch (error) { setError(error instanceof Error ? error.message : "审阅操作失败。"); } finally { setBusy(false); } };
  if (!draft || !media || !source) return <section className="cover-review"><h3>半自动覆盖审阅</h3><p>先保存项目，再建立审阅草稿。原片抽帧会保存在本机，不调用模型。</p><button type="button" disabled={busy || !input.mediaIds.length} onClick={() => void run(() => window.jianji.createCoverReview(input.mediaIds))}>建立人工审阅草稿</button>{error && <p role="alert">{error}</p>}</section>;
  const ref = { projectId: draft.projectId, draftId: draft.id, expectedRevision: draft.revision, mediaId: media.mediaId };
  const command = (value: Omit<CoverReviewCommand, keyof typeof ref> & Record<string, unknown>) => run(() => window.jianji.editCoverReview({ ...ref, ...value } as CoverReviewCommand));
  const seek = (value: number) => { video.current?.pause(); if (video.current) video.current.currentTime = value / 1000; setTimeMs(value); };
  const step = (direction: number) => {
    const frames = draft.frameTimes?.[media.mediaId] ?? [];
    const next = direction > 0 ? frames.find((time) => time > timeMs + 0.01) : [...frames].reverse().find((time) => time < timeMs - 0.01);
    if (next !== undefined) seek(next);
  };
  const editable = !busy && ["needs_human", "awaiting_approval"].includes(draft.status);
  const versions = draft.frozen.filter((item) => item.mediaId === media.mediaId);
  const frozen = versions.find((item) => item.version === version);
  const rect = buffer && interpolateCoverRectangle(buffer.track.keyframes, timeMs);
  const updateRect = (key: "x" | "y" | "width" | "height", value: number) => {
    if (!buffer || !rect) return;
    const rectangle = { ...rect, [key]: value / 100 };
    if (buffer.track.keyframes.length > 1) {
      if (key === "width") rectangle.height = rectangle.width * rect.height / rect.width;
      if (key === "height") rectangle.width = rectangle.height * rect.width / rect.height;
    }
    const keyTime = buffer.track.keyframes.length === 1 ? buffer.track.keyframes[0].timeMs : Math.floor(timeMs);
    const keyframes = [...buffer.track.keyframes.filter((item) => item.timeMs !== keyTime), { timeMs: keyTime, rectangle }].sort((a, b) => a.timeMs - b.timeMs);
    setBuffer({ ...buffer, track: { ...buffer.track, keyframes } });
  };
  const estimated = draft.media.reduce((sum, item) => sum + Math.max(1, Math.ceil((item.evidence.length - 1) / 7)), 0);
  return <section className="cover-review" aria-label="半自动覆盖审阅">
    <header><h3>半自动覆盖审阅 · {labels[draft.status]}</h3><span>修订 {draft.revision}</span></header>
    <p>算法候选需要人工核对。未观察时段仍为未知；最终确认表示接受当前结果。</p>
    <div className="cover-review-actions">
      <button type="button" disabled={busy} onClick={() => void run(() => window.jianji.createCoverReview(input.mediaIds))}>新建草稿</button>
      <button type="button" disabled={!editable || draft.media.some((item) => item.analysis !== "not_started" || item.decisions.length > 0)} onClick={() => void run(() => window.jianji.analyzeCoverReview(draft.id, draft.revision))}>分析候选（最多 {estimated} 次视觉请求）</button>
      <button type="button" onClick={() => void run(() => window.jianji.cancelCoverReview())}>停止准备</button>
    </div>
    <p>已用识别请求：{draft.requestPlan?.usedRequests ?? 0}；费用未知。</p>
    <label><input type="checkbox" checked={reviewEnabled} disabled={busy || !!draft.review} onChange={(event) => setReviewEnabled(event.target.checked)} />启用单轮独立复核试点（默认关闭，零自动修正）</label>
    {reviewEnabled && <fieldset disabled={busy || !!draft.review}><legend>复核连接</legend><select aria-label="复核连接" value={reviewSelection?.connectionId ?? ""} onChange={(event) => { const profile = library.profiles.find(({ id }) => id === event.target.value); setReviewSelection(profile ? { connectionId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort } : event.target.value === "chatgpt" && chatgpt?.model ? { connectionId: "chatgpt", model: chatgpt.model } : undefined); }}><option value="">明确选择复核连接</option><option value="chatgpt" disabled={chatgpt?.status !== "ready"}>ChatGPT</option>{library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
    {reviewSelection && <ModelPicker connection={{ configured: true, baseUrl: "", model: reviewSelection.model, reasoningEffort: reviewSelection.reasoningEffort, source: reviewSelection.connectionId === "chatgpt" ? "chatgpt" : "api" }} library={{ ...library, selected: reviewSelection.connectionId }} chatgpt={chatgpt} disabled={busy || !!draft.review} title="复核模型" description="本轮独立请求使用" onSelect={async (value) => { setReviewSelection(value); return true; }} />}
    <p>先全画面盲检，再核对候选与局部图。共 {2 * draft.media.reduce((sum, item) => sum + Math.ceil(item.evidence.length / 8), 0)} 次请求，失败计数、无重试；费用未知。同模型独立请求不代表独立正确性证据。</p>
    <button type="button" disabled={!reviewSelection || draft.status !== "needs_human" || busy || !!draft.review} onClick={() => { if (reviewSelection) void run(() => window.jianji.reviewCoverReview(draft.id, draft.revision, reviewSelection)); }}>运行一轮复核</button></fieldset>}
    {draft.review && <p>复核 {draft.review.model} · {draft.review.status === "complete" ? "本轮完成，仍需人工确认" : draft.review.status === "incomplete" ? "未完成，需人工处置" : "运行中"} · {draft.review.usedRequests}/{draft.review.maxRequests} 次请求 · 绑定修订 {draft.review.revision}</p>}
    <label>审阅素材<select value={media.mediaId} onChange={(event) => setMediaId(event.target.value)}>{draft.media.map((item) => <option key={item.mediaId} value={item.mediaId}>{mediaItems.find(({ id }) => id === item.mediaId)?.displayName} · {item.disposition === "unresolved" ? "未确认" : item.disposition === "no_cover" ? "明确不覆盖" : "覆盖范围已确认"}</option>)}</select></label>
    {media.analysisError && <p role="status">自动分析未完成：{media.analysisError}</p>}
    <div className="cover-review-actions"><button type="button" onClick={() => setVersion(0)}>原片与人工框</button>{versions.map((item) => <button type="button" key={item.version} onClick={() => setVersion(item.version)}>第 {item.version} 版动态预览 {item.preview?.viewed ? "✓" : "待查看"}</button>)}</div>
    <div className="cover-review-frame" style={{ aspectRatio: `${source.width}/${source.height}` }}>
      <video ref={video} key={`${source.id}:${version}:${draft.revision}`} controls preload="metadata" onLoadedMetadata={() => { if (video.current && !frozen) video.current.currentTime = timeMs / 1000; }} src={frozen ? `jianji-review://${draft.id}/${draft.revision}/${source.id}/${version}` : source.previewUrl} onTimeUpdate={() => setTimeMs((video.current?.currentTime ?? 0) * 1000)} />
      {!frozen && media.segments.filter(({ track }) => timeMs >= track.startMs && timeMs < track.endMs).map((segment) => { const rectangle = interpolateCoverRectangle(segment.id === buffer?.id ? buffer.track.keyframes : segment.track.keyframes, timeMs); return <button aria-label={`选择覆盖框 ${segment.id}`} type="button" key={segment.id} className={`review-box ${segment.origin}`} style={{ left: `${rectangle.x * 100}%`, top: `${rectangle.y * 100}%`, width: `${rectangle.width * 100}%`, height: `${rectangle.height * 100}%` }} onClick={() => setActiveId(segment.id)} />; })}
    </div>
    <div className="cover-review-actions"><button type="button" onClick={() => step(-1)} disabled={!!frozen}>上一原帧</button><button type="button" onClick={() => step(1)} disabled={!!frozen}>下一原帧</button>{frozen && <button type="button" disabled={busy} onClick={() => void run(() => window.jianji.viewCoverReview(draft.id, draft.revision, media.mediaId, version))}>我已查看此版动态预览</button>}</div>
    <CoverReviewTimeline media={media} timeMs={timeMs} onSeek={seek} activeId={activeId} onSelect={setActiveId} />
    <details><summary>算法观察（{media.observations.length}）· 抽样外为未知</summary>{media.observations.map((observation, index) => {
      const evidence = media.evidence.find(({ id }) => id === observation.evidenceId)!;
      const at = (evidence.pts * evidence.timeBase - (evidence.timeOriginSeconds ?? 0)) * 1000;
      const identity = media.identities.find(({ id }) => id === observation.identityId);
      return <div key={index}><button type="button" onClick={() => { setVersion(0); seek(at); }}>{(at / 1000).toFixed(3)}s · {identity?.label ?? "未确认目标"} · {observation.presence} · {identity?.semantics ?? "unknown"}</button>{observation.rectangle && identity && <button type="button" disabled={!editable} onClick={() => { const segment: CoverSegment = { id: crypto.randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: media.durationMs, keyframes: [{ timeMs: Math.floor(at), rectangle: observation.rectangle! }] } }; void command({ type: "put_segment", identity, segment }).then(() => setActiveId(segment.id)); }}>从候选人工建框（需调整时段）</button>}</div>;
    })}</details>
    <div className="cover-review-actions">
      <button type="button" disabled={!editable} onClick={() => { const identity = { id: crypto.randomUUID(), label: "人工补框", semantics: "sticker" as const, origin: "human" as const }; const segment: CoverSegment = { id: crypto.randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: media.durationMs, keyframes: [{ timeMs: 0, rectangle: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 } }] } }; void command({ type: "put_segment", identity, segment }).then(() => setActiveId(segment.id)); }}>新增覆盖框</button>
      <button type="button" disabled={!editable} onClick={() => void command({ type: "no_cover" })}>此素材明确不覆盖</button>
      <button type="button" disabled={!editable || !media.segments.length} onClick={() => void command({ type: "confirm_geometry" })}>确认此素材覆盖范围</button>
    </div>
    {buffer && <fieldset disabled={!editable}><legend>编辑完整边界与区间</legend><div className="cover-review-fields">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{({ x: "左侧", y: "顶部", width: "宽", height: "高" })[key]} %<input type="number" min={0} max={100} step={0.1} value={Number(((rect?.[key] ?? 0) * 100).toFixed(3))} onChange={(event) => updateRect(key, Number(event.target.value))} /></label>)}{(["startMs", "endMs"] as const).map((key) => <label key={key}>{key === "startMs" ? "开始毫秒" : "结束毫秒（不含）"}<input type="number" min={0} max={media.durationMs} value={buffer.track[key]} onChange={(event) => setBuffer({ ...buffer, track: { ...buffer.track, [key]: Number(event.target.value) } })} /></label>)}</div>
      <button type="button" onClick={() => void command({ type: "put_segment", identity: media.identities.find(({ id }) => id === buffer.identityId)!, segment: buffer })}>保存此框</button>
      <label>身份语义<select value={media.identities.find(({ id }) => id === buffer.identityId)?.semantics ?? "unknown"} onChange={(event) => void command({ type: "put_segment", identity: { ...media.identities.find(({ id }) => id === buffer.identityId)!, semantics: event.target.value }, segment: buffer })}><option value="unknown">未知</option><option value="sticker">贴纸</option><option value="subtitle">字幕</option><option value="product">商品</option></select></label>
      <button type="button" onClick={() => { if (!rect) return; const at = Math.floor(timeMs); const keyframes = [...buffer.track.keyframes.filter(({ timeMs }) => timeMs !== at), { timeMs: at, rectangle: { ...rect } }].sort((a, b) => a.timeMs - b.timeMs); setBuffer({ ...buffer, track: { ...buffer.track, keyframes } }); }}>记录当前帧关键帧</button>
      <p>关键帧：{buffer.track.keyframes.map((frame) => <button type="button" key={frame.timeMs} onClick={() => seek(frame.timeMs)}>{frame.timeMs}ms</button>)}</p>
      <button type="button" onClick={() => void command({ type: "delete_segment", segmentId: buffer.id })}>删除误框</button>
      <button type="button" onClick={() => void command({ type: "split", segmentId: buffer.id, atMs: Math.ceil(timeMs) })}>在当前时间拆分区间</button>
      <button type="button" onClick={() => void command({ type: "put_segment", identity: { ...media.identities.find(({ id }) => id === buffer.identityId)!, id: buffer.id, derivedFrom: [buffer.identityId] }, segment: { ...buffer, identityId: buffer.id } })}>拆为独立身份</button>
      <label>合并到身份<select defaultValue="" onChange={(event) => { if (event.target.value) void command({ type: "merge", fromId: buffer.identityId, intoId: event.target.value }); }}><option value="">选择另一个身份</option>{media.identities.filter(({ id }) => id !== buffer.identityId).map((identity) => <option key={identity.id} value={identity.id}>{identity.label} · {identity.semantics}</option>)}</select></label>
    </fieldset>}
    <div>{media.issues.map((issue) => <div key={issue.id} className="cover-review-issue"><p>{issue.kind} · {issue.reason}</p><div>{issue.evidenceIds.map((id) => { const evidence = media.evidence.find((item) => item.id === id); if (!evidence) return null; const at = (evidence.pts * evidence.timeBase - (evidence.timeOriginSeconds ?? 0)) * 1000; return <button type="button" key={id} onClick={() => { setVersion(0); setActiveId(issue.segmentId ?? media.segments.find((item) => item.identityId === issue.identityId)?.id ?? ""); seek(at); }}>查看证据 {(at / 1000).toFixed(3)}s</button>; })}</div>{issue.suggestion && <p>复核建议（只读，需人工建框）：左 {(issue.suggestion.x * 100).toFixed(1)}%、上 {(issue.suggestion.y * 100).toFixed(1)}%、宽 {(issue.suggestion.width * 100).toFixed(1)}%、高 {(issue.suggestion.height * 100).toFixed(1)}%。</p>}{media.decisions.some(({ issueId }) => issueId === issue.id) ? <span>已人工处置</span> : <><button disabled={!editable} onClick={() => void command({ type: "resolve_issue", issueId: issue.id, action: "accept_uncertainty" })}>明确接受此项不确定性</button><button disabled={!editable} onClick={() => void command({ type: "resolve_issue", issueId: issue.id, action: "correct" })}>已人工修正</button></>}</div>)}</div>
    <p>准备每版预计使用 2 次覆盖选材请求，自动装饰另需 2 次创作请求；手动装饰需 1 次创作请求。共 {draft.media.length * (input.multiplier ?? 1)} 个版本，费用未知。</p>
    <div className="cover-review-actions"><button type="button" disabled={busy || draft.status !== "needs_human"} onClick={() => void run(() => window.jianji.prepareCoverReview(draft.id, draft.revision, input))}>冻结所有版本并准备动态预览</button><button type="button" disabled={busy || !["awaiting_approval", "approved"].includes(draft.status)} onClick={() => void run(() => window.jianji.approveCoverReview(draft.id, draft.revision, input))}>{draft.status === "approved" ? "核对并继续未提交版本" : "确认全部版本并导出"}</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
