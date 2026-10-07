import { useEffect, useRef, useState } from "react";
import type { CoverReviewDraft, CoverSegment } from "../shared/cover-review";
import type { CoverReviewCommand } from "../main/cover-review-session";
import type { MediaView } from "../main/media";
import type { DesktopState } from "../shared/desktop";
import { FrozenAgentStartSchema, type AgentStartInput } from "../shared/agent";
import { interpolateCoverRectangle } from "../shared/cover-sticker";
import { HumanRegionBindingSchema, type HumanRegionBinding } from "../shared/human-region-cover";
import { ExportSettingsSchema, outputDimensions } from "../shared/export-settings";
import { QianchuanUploadSelectionSchema } from "../shared/douyin-upload";
import type { UploadSelectionDraft } from "./DouyinUploadControls";
import type { ConnectionLibrary, SelectModel } from "../shared/connections";
import type { ChatGPTStatus } from "../shared/agent";
import { ModelPicker } from "./ModelPicker";
import { CoverReviewTimeline } from "./CoverReviewTimeline";
import { CoverReviewBox } from "./CoverReviewBox";
import { CoverReviewProgress } from "./CoverReviewProgress";
import { moveCoverSegment } from "./cover-review-geometry";
import "./cover-review.css";

const labels: Record<CoverReviewDraft["status"], string> = { draft: "视频帧准备中", analyzing: "候选分析中", reviewing: "独立复核中", needs_human: "待人工审阅", preparing_preview: "动态预览准备中", awaiting_approval: "待最终确认", approved: "已批准", stale: "证据已过期", cancelled: "已停止", failed: "准备失败" };
type HumanRegionArtwork = NonNullable<CoverReviewDraft["assistedArtwork"]>;
type HumanBindingRead = { bindings: HumanRegionBinding[]; invalid: boolean };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function readHumanRegionBindings(templateJson?: string): HumanBindingRead {
  if (!templateJson) return { bindings: [], invalid: true };
  try {
    const template: unknown = JSON.parse(templateJson);
    if (!isRecord(template) || !Array.isArray(template.layers)) return { bindings: [], invalid: true };
    const bindings: HumanRegionBinding[] = [];
    let invalid = false;
    for (const layer of template.layers) {
      if (!isRecord(layer) || !isRecord(layer.cover) || !("humanRegion" in layer.cover)) continue;
      const parsed = HumanRegionBindingSchema.safeParse(layer.cover.humanRegion);
      if (parsed.success) bindings.push(parsed.data); else invalid = true;
    }
    return { bindings, invalid };
  } catch {
    return { bindings: [], invalid: true };
  }
}

function frozenOutputSize(presetJson: string | undefined, media: MediaView | undefined): { width: number; height: number } | undefined {
  if (!presetJson || !media) return undefined;
  try {
    const preset: unknown = JSON.parse(presetJson);
    if (!isRecord(preset)) return undefined;
    const settings = ExportSettingsSchema.safeParse({ resolutionMode: preset.resolutionMode, frameRateMode: preset.frameRateMode, quality: preset.quality });
    return settings.success ? outputDimensions(media, settings.data) : undefined;
  } catch {
    return undefined;
  }
}

export function CoverReviewPanel({ drafts, mediaItems, input, library, chatgpt, agentRun, assistedArtwork, uploadSelection, onResolveOutputDirectory, onState }: { library: ConnectionLibrary; chatgpt?: ChatGPTStatus; agentRun?: DesktopState["agentRun"]; assistedArtwork?: HumanRegionArtwork; uploadSelection?: UploadSelectionDraft; drafts: CoverReviewDraft[]; mediaItems: MediaView[]; input: AgentStartInput; onResolveOutputDirectory(existingDirectory?: string): Promise<string>; onState(state: DesktopState): void }) {
  const selectedIds = new Set(input.mediaIds);
  const eligibleDrafts = drafts.filter((item) => item.assistedArtwork === assistedArtwork);
  const draft = [...eligibleDrafts].reverse().find((item) => item.media.length === selectedIds.size && item.media.every(({ mediaId }) => selectedIds.has(mediaId)));
  const humanRegion = assistedArtwork === "human-region-v1";
  const [mediaId, setMediaId] = useState("");
  const [activeId, setActiveId] = useState("");
  const [buffer, setBuffer] = useState<CoverSegment>();
  const [timeMs, setTimeMs] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<SelectModel>();
  const [showHumanGuides, setShowHumanGuides] = useState(true);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const requestedVersion = useRef<number>();
  const media = draft?.media.find((item) => item.mediaId === mediaId) ?? draft?.media[0];
  const source = mediaItems.find(({ id }) => id === media?.mediaId);
  const active = media?.segments.find(({ id }) => id === activeId);
  useEffect(() => { setBuffer(active && structuredClone(active)); }, [activeId, draft?.revision]);
  useEffect(() => { setVersion(requestedVersion.current ?? 0); requestedVersion.current = undefined; setTimeMs(0); setActiveId(""); }, [media?.mediaId, draft?.id]);
  const running = useRef(false);
  const run = async (work: () => Promise<DesktopState>) => { if (running.current) return false; running.current = true; setBusy(true); setError(""); try { onState(await work()); return true; } catch (error) { setError(error instanceof Error ? error.message : "审阅操作失败。"); return false; } finally { running.current = false; setBusy(false); } };
  const priorRequest = (() => { try { return draft?.requestJson ? FrozenAgentStartSchema.safeParse(JSON.parse(draft.requestJson)).data : undefined; } catch { return undefined; } })();
  const resolvedInput = async (): Promise<AgentStartInput> => ({ ...input, outputDirectory: await onResolveOutputDirectory(priorRequest?.outputDirectory) });
  const approvalInput = async (): Promise<AgentStartInput> => {
    if (uploadSelection && !uploadSelection.plan) throw new Error("请选择千川产品账号和上传计划后再确认。");
    const douyinUpload = uploadSelection ? QianchuanUploadSelectionSchema.parse(uploadSelection) : undefined;
    return { ...await resolvedInput(), ...(douyinUpload ? { douyinUpload } : {}) };
  };
  if (!draft || !media || !source) {
    const firstSource = mediaItems.find(item => selectedIds.has(item.id));
    return <section className="cover-review"><h3>{humanRegion ? "人工区域贴纸覆盖" : "半自动覆盖审阅"}</h3><p>{eligibleDrafts.length ? `当前选择了 ${selectedIds.size} 条素材，需要为这批素材建立${humanRegion ? "人工区域" : "审阅"}草稿。其他策略的审阅记录已保留。` : humanRegion ? "建立人工区域草稿后，即可在视频上新增、拖动和缩放覆盖框。覆盖框由你指定，本地贴纸匹配不会调用模型。" : "先保存项目，再建立审阅草稿。原片抽帧会保存在本机，不调用模型。"}</p>{humanRegion && firstSource && <div className="cover-review-frame" style={{ aspectRatio: `${firstSource.width}/${firstSource.height}`, width: `min(100%, 640px, ${520 * firstSource.width / firstSource.height}px)` }}><video key={firstSource.id} src={firstSource.previewUrl} controls preload="metadata" /></div>}<button type="button" disabled={busy || !input.mediaIds.length} onClick={() => void run(() => window.jianji.createCoverReview(input.mediaIds))}>{busy ? "正在准备素材…" : humanRegion ? "建立人工区域草稿" : "建立人工审阅草稿"}</button>{error && <p role="alert">{error}</p>}</section>;
  }
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
  const frozenHumanRead = humanRegion && frozen ? readHumanRegionBindings(frozen.templateJson) : { bindings: [], invalid: false };
  const frozenHumanBindings = frozenHumanRead.bindings.filter((binding) => binding.mediaId === media?.mediaId);
  const outputSize = frozen && humanRegion
    ? frozenHumanBindings[0]?.projection ?? frozenOutputSize(frozen.presetJson, source) ?? source ?? { width: 1, height: 1 }
    : source ?? { width: 1, height: 1 };
  const projectionMismatch = frozenHumanBindings.some(({ projection }) => projection.width !== outputSize.width || projection.height !== outputSize.height);
  const shownHumanBindings = frozenHumanBindings.filter((binding) => timeMs >= binding.range.startMs && timeMs < binding.range.endMs);
  const dirty = !!buffer && JSON.stringify(buffer) !== JSON.stringify(active);
  const unsupportedHumanTrack = humanRegion && media.segments.some((segment) => segment.track.keyframes.length !== 1);
  const viewedCount = draft.frozen.filter((item) => item.preview?.viewed).length;
  const openPreview = () => {
    const target = draft.frozen.find((item) => !item.preview?.viewed) ?? versions[0] ?? draft.frozen[0];
    if (!target) return;
    if (target.mediaId !== media.mediaId) requestedVersion.current = target.version;
    setMediaId(target.mediaId); setVersion(target.version);
    requestAnimationFrame(() => { video.current?.scrollIntoView({ behavior: "smooth", block: "center" }); video.current?.focus({ preventScroll: true }); });
  };
  const rect = buffer && interpolateCoverRectangle(buffer.track.keyframes, timeMs);
  const updateRect = (key: "x" | "y" | "width" | "height", value: number) => {
    if (!buffer || !rect) return;
    const rectangle = { ...rect, [key]: value / 100 };
    if (!humanRegion && buffer.track.keyframes.length > 1) {
      if (key === "width") rectangle.height = rectangle.width * rect.height / rect.width;
      if (key === "height") rectangle.width = rectangle.height * rect.width / rect.height;
    }
    const keyTime = humanRegion || buffer.track.keyframes.length === 1 ? buffer.track.keyframes[0].timeMs : Math.floor(timeMs);
    const keyframes = humanRegion ? [{ timeMs: keyTime, rectangle }] : [...buffer.track.keyframes.filter((item) => item.timeMs !== keyTime), { timeMs: keyTime, rectangle }].sort((a, b) => a.timeMs - b.timeMs);
    setBuffer({ ...buffer, track: { ...buffer.track, keyframes } });
  };
  const estimated = draft.media.reduce((sum, item) => sum + Math.max(1, Math.ceil((item.evidence.length - 1) / 7)), 0);
  return <section className="cover-review" aria-label={humanRegion ? "人工区域贴纸覆盖" : "半自动覆盖审阅"}>
    <header><h3>{humanRegion ? "人工区域贴纸覆盖" : "半自动覆盖审阅"}</h3><span>{busy ? "正在保存或准备…" : labels[draft.status]}</span></header>
    {humanRegion && <p className="human-region-coverage-note">请把需要盖住的旧贴纸和阴影完整放进目标框。目标框只代表你指定的覆盖范围，不证明框外没有其他旧贴纸。冻结预览会显示新贴纸实际占用范围；贴纸图案可能大于目标框，超出画布的部分不可见。</p>}
    {!humanRegion && <><details className="cover-review-options"><summary>自动找框与复核</summary>
    <div className="cover-review-actions">
      <button type="button" disabled={!editable || dirty || draft.media.some((item) => item.analysis !== "not_started" || item.decisions.length > 0)} onClick={() => void run(() => window.jianji.analyzeCoverReview(draft.id, draft.revision))}>分析候选（最多 {estimated} 次视觉请求）</button>
    </div>
    <label><input type="checkbox" checked={reviewEnabled} disabled={busy || dirty || !!draft.review} onChange={(event) => setReviewEnabled(event.target.checked)} />让模型再检查一遍</label>
    {reviewEnabled && <fieldset disabled={busy || !!draft.review}><legend>复核连接</legend><select aria-label="复核连接" value={reviewSelection?.connectionId ?? ""} onChange={(event) => { const profile = library.profiles.find(({ id }) => id === event.target.value); setReviewSelection(profile ? { connectionId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort } : event.target.value === "chatgpt" && chatgpt?.model ? { connectionId: "chatgpt", model: chatgpt.model } : undefined); }}><option value="">明确选择复核连接</option><option value="chatgpt" disabled={chatgpt?.status !== "ready"}>ChatGPT</option>{library.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
    {reviewSelection && <ModelPicker connection={{ configured: true, baseUrl: "", model: reviewSelection.model, reasoningEffort: reviewSelection.reasoningEffort, source: reviewSelection.connectionId === "chatgpt" ? "chatgpt" : "api" }} library={{ ...library, selected: reviewSelection.connectionId }} chatgpt={chatgpt} disabled={busy || !!draft.review} title="复核模型" description="本轮独立请求使用" onSelect={async (value) => { setReviewSelection(value); return true; }} />}
    <p>先全画面盲检，再核对候选与局部图。共 {2 * draft.media.reduce((sum, item) => sum + Math.ceil(item.evidence.length / 8), 0)} 次请求，失败计数、无重试；费用未知。同模型独立请求不代表独立正确性证据。</p>
    <button type="button" disabled={!reviewSelection || draft.status !== "needs_human" || busy || dirty || !!draft.review} onClick={() => { if (reviewSelection) void run(() => window.jianji.reviewCoverReview(draft.id, draft.revision, reviewSelection)); }}>运行一轮复核</button></fieldset>}
    {draft.review && <p>{draft.review.status === "complete" ? "检查完成，请确认画面" : draft.review.status === "incomplete" ? "检查未完成，请人工确认" : "正在检查…"}</p>}
    </details></>}
    <label>审阅素材<select disabled={busy || dirty} value={media.mediaId} onChange={(event) => setMediaId(event.target.value)}>{draft.media.map((item) => <option key={item.mediaId} value={item.mediaId}>{mediaItems.find(({ id }) => id === item.mediaId)?.displayName} · {item.disposition === "unresolved" ? "未确认" : item.disposition === "no_cover" ? "明确不覆盖" : "覆盖范围已确认"}</option>)}</select></label>
    {!humanRegion && media.analysisError && <p role="status">{!media.evidence.length || !draft.frameTimes?.[media.mediaId]?.length ? "视频帧尚未准备完成。点击“生成预览”会继续准备，已确认的框会保留。" : `自动分析未完成：${media.analysisError}`}</p>}
    {versions.length > 0 && <div className="cover-review-actions"><button type="button" disabled={busy || dirty} onClick={() => setVersion(0)}>{humanRegion ? "原片与目标区域" : "原片与人工框"}</button>{versions.map((item) => <button type="button" key={item.version} disabled={busy || dirty} onClick={() => setVersion(item.version)}>第 {item.version} 版动态预览 {item.preview?.viewed ? "✓" : "待查看"}</button>)}</div>}
    {frozen && humanRegion && <div className="human-region-guide-controls"><label><input type="checkbox" checked={showHumanGuides} onChange={(event) => setShowHumanGuides(event.target.checked)} />显示冻结覆盖范围</label><span><i className="human-region-target-key" />待覆盖区域</span><span><i className="human-region-artwork-key" />贴纸实际占用范围</span></div>}
    <div className="cover-review-frame" style={{ aspectRatio: `${outputSize.width}/${outputSize.height}`, width: `min(100%, 640px, ${520 * outputSize.width / outputSize.height}px)` }}>
      <video ref={video} key={`${source.id}:${frozen ? `${version}:${draft.revision}` : "source"}`} controls preload="metadata" onLoadedMetadata={() => { if (!video.current) return; if (frozen) setTimeMs(video.current.currentTime * 1000); else video.current.currentTime = timeMs / 1000; }} src={frozen ? `jianji-review://${draft.id}/${draft.revision}/${source.id}/${version}` : source.previewUrl} onTimeUpdate={() => setTimeMs((video.current?.currentTime ?? 0) * 1000)} />
      {!frozen && media.segments.map((segment, index) => timeMs >= segment.track.startMs && timeMs < segment.track.endMs && <CoverReviewBox key={`${draft.id}:${media.mediaId}:${segment.id}:${draft.revision}`} rectangle={interpolateCoverRectangle(segment.id === buffer?.id ? buffer.track.keyframes : segment.track.keyframes, timeMs)} selected={activeId === segment.id} disabled={!editable || dirty || (humanRegion && segment.track.keyframes.length !== 1)} keepRatio={segment.track.keyframes.length > 1} label={`覆盖框 ${index + 1}`} onSelect={() => setActiveId(segment.id)} onPause={() => video.current?.pause()} onSave={(rectangle) => run(() => window.jianji.editCoverReview({ ...ref, type: "put_segment", identity: media.identities.find(({ id }) => id === segment.identityId)!, segment: moveCoverSegment(segment, timeMs, rectangle) }))} />)}
      {frozen && humanRegion && showHumanGuides && !projectionMismatch && shownHumanBindings.map((binding) => <div className="human-region-guides" key={binding.segmentId} aria-label="冻结人工覆盖范围">
        <div className="human-region-guide human-region-guide-target" style={{ left: `${binding.target.x / binding.projection.width * 100}%`, top: `${binding.target.y / binding.projection.height * 100}%`, width: `${binding.target.width / binding.projection.width * 100}%`, height: `${binding.target.height / binding.projection.height * 100}%` }}><span>待覆盖区域</span></div>
        <div className="human-region-guide human-region-guide-artwork" style={{ left: `${binding.visualBounds.x / binding.projection.width * 100}%`, top: `${binding.visualBounds.y / binding.projection.height * 100}%`, width: `${binding.visualBounds.width / binding.projection.width * 100}%`, height: `${binding.visualBounds.height / binding.projection.height * 100}%` }}><span>贴纸实际占用范围</span></div>
      </div>)}
    </div>
    {frozen && humanRegion && (frozenHumanRead.invalid || projectionMismatch || (media.disposition === "cover" && frozenHumanBindings.length !== media.segments.length)) && <p role="alert">冻结人工覆盖范围与当前预览不匹配，不能据此确认这版覆盖效果。</p>}
    {frozen && humanRegion && media.disposition === "no_cover" && <p>此素材已明确选择不覆盖，没有新增贴纸层。</p>}
    {frozen && humanRegion && media.disposition === "cover" && frozenHumanBindings.length === 0 && <p role="alert">冻结模板中没有可显示的人工覆盖范围，不能据此确认这版覆盖效果。</p>}
    {!frozen && <p className="cover-review-hint">拖动框移动，拉右下角调整大小，松手自动保存。</p>}
    {dirty && <p role="status">数值修改尚未保存。<button type="button" disabled={!editable} onClick={() => void command({ type: "put_segment", identity: media.identities.find(({ id }) => id === buffer.identityId)!, segment: buffer })}>保存此框</button><button type="button" disabled={busy} onClick={() => setBuffer(active && structuredClone(active))}>放弃修改</button></p>}
    <div className="cover-review-actions"><button type="button" onClick={() => step(-1)} disabled={!!frozen}>上一原帧</button><button type="button" onClick={() => step(1)} disabled={!!frozen}>下一原帧</button>{frozen && <><button type="button" disabled={busy || !!frozen.preview?.viewed || draft.status !== "awaiting_approval"} onClick={() => void run(() => window.jianji.viewCoverReview(draft.id, draft.revision, media.mediaId, version))}>{frozen.preview?.viewed ? "此版已查看 ✓" : "我已查看此版动态预览"}</button>{frozen.preview?.viewed && viewedCount < draft.frozen.length && <button type="button" disabled={busy || dirty} onClick={openPreview}>下一待查看预览</button>}</>}</div>
    <CoverReviewTimeline media={media} timeMs={timeMs} onSeek={seek} activeId={activeId} onSelect={(id) => { if (!dirty) setActiveId(id); }} />
    {!humanRegion && media.observations.length > 0 && <details><summary>查看识别候选</summary>{media.observations.map((observation, index) => {
      const evidence = media.evidence.find(({ id }) => id === observation.evidenceId)!;
      const at = (evidence.pts * evidence.timeBase - (evidence.timeOriginSeconds ?? 0)) * 1000;
      const identity = media.identities.find(({ id }) => id === observation.identityId);
      return <div key={index}><button type="button" onClick={() => { setVersion(0); seek(at); }}>{(at / 1000).toFixed(3)}s · {identity?.label ?? "未确认目标"} · {observation.presence} · {identity?.semantics ?? "unknown"}</button>{observation.rectangle && identity && <button type="button" disabled={!editable || dirty} onClick={() => { const segment: CoverSegment = { id: crypto.randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: media.durationMs, keyframes: [{ timeMs: Math.floor(at), rectangle: observation.rectangle! }] } }; void command({ type: "put_segment", identity, segment }).then((saved) => { if (saved) { setActiveId(segment.id); setVersion(0); seek(segment.track.startMs); } }); }}>从候选人工建框（需调整时段）</button>}</div>;
    })}</details>}
    <div className="cover-review-actions">
      <button type="button" disabled={!editable || dirty} onClick={() => { const identity = { id: crypto.randomUUID(), label: humanRegion ? "人工覆盖区域" : "人工补框", semantics: "sticker" as const, origin: "human" as const }; const segment: CoverSegment = { id: crypto.randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: media.durationMs, keyframes: [{ timeMs: 0, rectangle: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 } }] } }; void command({ type: "put_segment", identity, segment }).then((saved) => { if (saved) { setActiveId(segment.id); setVersion(0); seek(segment.track.startMs); } }); }}>{humanRegion ? "新增人工覆盖区域" : "新增覆盖框"}</button>
      <button type="button" disabled={!editable || dirty} onClick={() => void command({ type: "no_cover" })}>不需要覆盖</button>
      <button type="button" disabled={!editable || dirty || !media.segments.length || unsupportedHumanTrack} onClick={() => void command({ type: "confirm_geometry" })}>确认范围</button>
      {buffer && <button type="button" disabled={!editable || dirty} onClick={() => void command({ type: "delete_segment", segmentId: buffer.id })}>删除选中框</button>}
    </div>
    {humanRegion && unsupportedHumanTrack && <p role="alert">人工区域模式只支持固定框；删除含移动关键帧的区间后再确认。</p>}
    {buffer && <details><summary>精确位置与跟随设置</summary><fieldset disabled={!editable || (humanRegion && buffer.track.keyframes.length !== 1)}><legend>位置与出现时间</legend><div className="cover-review-fields">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{({ x: "左侧", y: "顶部", width: "宽", height: "高" })[key]} %<input type="number" min={0} max={100} step={0.1} value={Number(((rect?.[key] ?? 0) * 100).toFixed(3))} onChange={(event) => updateRect(key, Number(event.target.value))} /></label>)}{(["startMs", "endMs"] as const).map((key) => <label key={key}>{key === "startMs" ? "开始毫秒" : "结束毫秒（不含）"}<input type="number" min={0} max={media.durationMs} value={buffer.track[key]} onChange={(event) => setBuffer({ ...buffer, track: { ...buffer.track, [key]: Number(event.target.value) } })} /></label>)}</div>
      <button type="button" onClick={() => void command({ type: "put_segment", identity: media.identities.find(({ id }) => id === buffer.identityId)!, segment: buffer })}>保存此框</button>
      {!humanRegion && <><button type="button" onClick={() => { if (!rect) return; const at = Math.floor(timeMs); const keyframes = [...buffer.track.keyframes.filter(({ timeMs }) => timeMs !== at), { timeMs: at, rectangle: { ...rect } }].sort((a, b) => a.timeMs - b.timeMs); setBuffer({ ...buffer, track: { ...buffer.track, keyframes } }); }}>记录当前帧关键帧</button>
      <p>关键帧：{buffer.track.keyframes.map((frame) => <button type="button" key={frame.timeMs} onClick={() => seek(frame.timeMs)}>{frame.timeMs}ms</button>)}</p></>}
      {humanRegion && buffer.track.keyframes.length > 1 && <p role="alert">此草稿包含移动轨迹，人工区域模式只支持固定框。删除该区间后新建固定框。</p>}
      <button type="button" disabled={dirty || (humanRegion && buffer.track.keyframes.length !== 1)} onClick={() => void command({ type: "split", segmentId: buffer.id, atMs: Math.ceil(timeMs) })}>在当前时间拆分区间</button>
    </fieldset></details>}
    {!humanRegion && <div>{media.issues.filter((issue) => !media.decisions.some(({ issueId }) => issueId === issue.id)).map((issue) => <div key={issue.id} className="cover-review-issue"><p>{issue.reason}</p><div>{issue.evidenceIds.map((id) => { const evidence = media.evidence.find((item) => item.id === id); if (!evidence) return null; const at = (evidence.pts * evidence.timeBase - (evidence.timeOriginSeconds ?? 0)) * 1000; return <button type="button" key={id} disabled={busy || dirty} onClick={() => { setVersion(0); setActiveId(issue.segmentId ?? media.segments.find((item) => item.identityId === issue.identityId)?.id ?? ""); seek(at); }}>查看证据 {(at / 1000).toFixed(3)}s</button>; })}</div>{issue.suggestion && <p>复核建议（只读，需人工建框）：左 {(issue.suggestion.x * 100).toFixed(1)}%、上 {(issue.suggestion.y * 100).toFixed(1)}%、宽 {(issue.suggestion.width * 100).toFixed(1)}%、高 {(issue.suggestion.height * 100).toFixed(1)}%。</p>}<><button disabled={!editable || dirty} onClick={() => void command({ type: "resolve_issue", issueId: issue.id, action: "accept_uncertainty" })}>明确接受此项不确定性</button><button disabled={!editable || dirty} onClick={() => void command({ type: "resolve_issue", issueId: issue.id, action: "correct" })}>已人工修正</button></></div>)}</div>}
    {!humanRegion && ["draft", "analyzing", "reviewing", "preparing_preview"].includes(draft.status) && <CoverReviewProgress draft={draft} agentRun={agentRun} onStop={() => void window.jianji.cancelCoverReview().then(onState).catch((error: Error) => setError(error.message))} />}
    {humanRegion && draft.status === "preparing_preview" && <p role="status">正在本地搜索匹配贴纸并准备冻结预览… <button type="button" onClick={() => void window.jianji.cancelCoverReview().then(onState).catch((error: Error) => setError(error.message))}>停止准备</button></p>}
    {busy && !["draft", "analyzing", "reviewing", "preparing_preview"].includes(draft.status) && <p role="status">正在处理，请稍候…</p>}
    <details><summary>{humanRegion ? "模型调用说明" : "预览费用说明"}</summary><p>{humanRegion ? input.decorations?.mode === "agent" ? "人工框选和本地贴纸匹配：0 次模型调用。Agent 创作装饰仍沿用现有创作模型与预算。" : "人工框选、本地贴纸匹配及手动/本地随机装饰：0 次模型调用。" : `准备每版预计使用 2 次覆盖选材请求，自动装饰另需 2 次创作请求；手动装饰需 1 次创作请求。共 ${draft.media.length * (input.multiplier ?? 1)} 个版本，费用未知。`}</p></details>
    {draft.frozen.length > 0 && <p role="status">预览已生成 · 已查看 {viewedCount}/{draft.frozen.length}。逐版播放并确认后即可导出。</p>}
    {uploadSelection && <p>本次确认后，正式 MP4 成片将上传到所选千川计划，停在确定前；预览不会上传。账号和计划仅用于本次操作，不随审阅草稿保存。</p>}
    <div className="cover-review-actions">{draft.frozen.length > 0 ? <button className="button primary" type="button" disabled={busy || dirty} onClick={openPreview}>查看预览</button> : <button className="button primary" type="button" disabled={busy || dirty || draft.status !== "needs_human"} onClick={() => void run(async () => window.jianji.prepareCoverReview(draft.id, draft.revision, await resolvedInput()))}>生成预览</button>}<button className="button primary" type="button" disabled={busy || dirty || !["awaiting_approval", "approved"].includes(draft.status) || (draft.status === "awaiting_approval" && (!draft.frozen.length || viewedCount < draft.frozen.length))} onClick={() => void run(async () => window.jianji.approveCoverReview(draft.id, draft.revision, await approvalInput()))}>{draft.status === "approved" ? "核对并继续未提交版本" : uploadSelection ? "确认全部版本、导出并上传千川" : "确认全部版本并导出"}</button></div>
    <details><summary>重新开始</summary><button type="button" disabled={busy || dirty} onClick={() => void run(() => window.jianji.createCoverReview(input.mediaIds))}>新建草稿</button></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
