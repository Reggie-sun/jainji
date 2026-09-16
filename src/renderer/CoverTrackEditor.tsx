import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MediaView } from "../main/media";
import { interpolateCoverRectangle, type CoverRectangle, type CoverTrack } from "../shared/cover-sticker";

const minimumSize = 0.01;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

type Interaction = { kind: "drag" | "resize"; x: number; y: number; timeMs: number; rectangle: CoverRectangle };
type PreviewRegion = { id: string; rectangle: CoverRectangle; track?: CoverTrack; sticker?: { url: string; label: string } };

export function CoverTrackEditor({ media, regions, activeRegionId, enabled, disabled, onActiveRegionChange, onStaticRectangleChange, onTrackChange }: {
  media: MediaView;
  regions: readonly PreviewRegion[];
  activeRegionId: string;
  enabled: boolean;
  disabled: boolean;
  onActiveRegionChange(id: string): void;
  onStaticRectangleChange(id: string, rectangle: CoverRectangle): void;
  onTrackChange(id: string, track?: CoverTrack): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>();
  const [timeMs, setTimeMs] = useState(0);
  const [notice, setNotice] = useState("");
  const durationMs = Math.max(1, Math.round(media.durationMs));
  const active = regions.find((region) => region.id === activeRegionId) ?? regions[0];
  const track = active?.track;
  const staticRectangle = active?.rectangle;
  const canEdit = enabled && Boolean(active?.sticker) && !disabled;
  const visible = (region: PreviewRegion) => !region.track || (timeMs >= region.track.startMs && timeMs < region.track.endMs);
  const rectangle = track && staticRectangle ? interpolateCoverRectangle(track.keyframes, timeMs) : staticRectangle;

  useEffect(() => {
    interaction.current = undefined;
    setTimeMs(0); setNotice("");
    if (video.current) { video.current.pause(); video.current.currentTime = 0; }
  }, [media.id]);

  useEffect(() => {
    interaction.current = undefined;
    video.current?.pause();
  }, [activeRegionId]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let callbackId: number;
    const update = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (!element.paused && !interaction.current) setTimeMs(clamp(Math.round(metadata.mediaTime * 1000), 0, durationMs));
      callbackId = element.requestVideoFrameCallback(update);
    };
    callbackId = element.requestVideoFrameCallback(update);
    return () => element.cancelVideoFrameCallback(callbackId);
  }, [media.id, durationMs]);

  const setVideoTime = (next: number) => {
    const normalized = clamp(Math.round(next), 0, durationMs);
    if (video.current) { video.current.pause(); video.current.currentTime = normalized / 1000; }
    setTimeMs(normalized);
  };
  const pauseForEdit = () => video.current?.pause();
  const updateStatic = (next: CoverRectangle) => {
    if (!active) return;
    pauseForEdit(); onStaticRectangleChange(active.id, next); setNotice("已更新固定覆盖框。");
  };
  const upsert = (next: CoverRectangle) => {
    if (!active || !rectangle) return;
    if (!track) return updateStatic(next);
    pauseForEdit();
    const frameTime = interaction.current?.timeMs ?? timeMs;
    const index = track.keyframes.findIndex((frame) => frame.timeMs === frameTime);
    if (index === -1 && track.keyframes.length >= 50) { setNotice("每条素材最多记录 50 个关键帧，请删除不需要的帧后再调整。"); return; }
    const keyframes = index === -1
      ? [...track.keyframes, { timeMs: frameTime, rectangle: next }].sort((a, b) => a.timeMs - b.timeMs)
      : track.keyframes.map((frame, frameIndex) => frameIndex === index ? { ...frame, rectangle: next } : frame);
    onTrackChange(active.id, { ...track, keyframes });
    setNotice(index === -1 ? "已自动记录当前时间的关键帧。" : "已更新当前时间的关键帧。");
  };
  const updatePosition = (field: "x" | "y", percent: number) => {
    if (!rectangle || !Number.isFinite(percent)) return;
    const value = clamp(percent / 100, 0, 1);
    const next = field === "x" ? { ...rectangle, x: clamp(value, 0, 1 - rectangle.width) } : { ...rectangle, y: clamp(value, 0, 1 - rectangle.height) };
    upsert(next);
  };
  const updateScale = (percent: number) => {
    if (!rectangle || !Number.isFinite(percent)) return;
    if (!track) {
      const width = clamp(percent / 100, minimumSize, 1 - rectangle.x);
      return upsert({ ...rectangle, width });
    }
    const ratio = (track.keyframes[0]?.rectangle.width ?? rectangle.width) / (track.keyframes[0]?.rectangle.height ?? rectangle.height);
    const width = clamp(percent / 100, minimumSize, Math.min(1 - rectangle.x, (1 - rectangle.y) * ratio));
    upsert({ ...rectangle, width, height: width / ratio });
  };
  const updateStaticHeight = (percent: number) => {
    if (!rectangle || !Number.isFinite(percent) || track) return;
    upsert({ ...rectangle, height: clamp(percent / 100, minimumSize, 1 - rectangle.y) });
  };
  const startInteraction = (event: PointerEvent<HTMLDivElement>, kind: Interaction["kind"]) => {
    if (!canEdit || !rectangle) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    pauseForEdit(); interaction.current = { kind, x: event.clientX, y: event.clientY, timeMs, rectangle: { ...rectangle } };
  };
  const moveInteraction = (event: PointerEvent<HTMLDivElement>) => {
    const current = interaction.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (!current || !bounds || !canEdit || !rectangle) return;
    const deltaX = (event.clientX - current.x) / bounds.width;
    const deltaY = (event.clientY - current.y) / bounds.height;
    if (current.kind === "drag") upsert({ ...current.rectangle, x: clamp(current.rectangle.x + deltaX, 0, 1 - current.rectangle.width), y: clamp(current.rectangle.y + deltaY, 0, 1 - current.rectangle.height) });
    else if (!track) upsert({ ...current.rectangle, width: clamp(current.rectangle.width + deltaX, minimumSize, 1 - current.rectangle.x), height: clamp(current.rectangle.height + deltaY, minimumSize, 1 - current.rectangle.y) });
    else {
      const ratio = (track.keyframes[0]?.rectangle.width ?? current.rectangle.width) / (track.keyframes[0]?.rectangle.height ?? current.rectangle.height);
      const delta = Math.abs(deltaX) >= Math.abs(deltaY * ratio) ? deltaX : deltaY * ratio;
      const width = clamp(current.rectangle.width + delta, minimumSize, Math.min(1 - current.rectangle.x, (1 - current.rectangle.y) * ratio));
      upsert({ ...current.rectangle, width, height: width / ratio });
    }
  };
  const enableTrack = () => {
    if (!active || !staticRectangle) return;
    pauseForEdit(); setVideoTime(0);
    onTrackChange(active.id, { startMs: 0, endMs: durationMs, keyframes: [{ timeMs: 0, rectangle: { ...staticRectangle } }] });
    setNotice("已为当前素材启用轨迹，0 ms 关键帧复制固定覆盖框。");
  };
  const updateInterval = (field: "startMs" | "endMs", value: number) => {
    if (!track || !active || !Number.isFinite(value)) return;
    const next = Math.round(value);
    const startMs = field === "startMs" ? clamp(next, 0, track.endMs - 1) : track.startMs;
    const endMs = field === "endMs" ? clamp(next, track.startMs + 1, durationMs) : track.endMs;
    onTrackChange(active.id, { ...track, startMs, endMs });
  };
  const deleteFrame = (time: number) => {
    if (!track || !active || track.keyframes.length === 1) return;
    onTrackChange(active.id, { ...track, keyframes: track.keyframes.filter((frame) => frame.timeMs !== time) });
    setNotice("已删除关键帧。");
  };

  return <div className="cover-track-editor">
    <div className="cover-track-preview" ref={stage} style={{ aspectRatio: `${media.width} / ${media.height}`, width: `min(100%, ${52 * media.width / media.height}vh)`, marginInline: "auto" }} onPointerMove={moveInteraction} onPointerUp={() => { interaction.current = undefined; }} onPointerCancel={() => { interaction.current = undefined; }}>
      <video ref={video} src={media.previewUrl} controls preload="metadata" onTimeUpdate={(event) => { if (event.currentTarget.paused && !interaction.current) setTimeMs(clamp(Math.round(event.currentTarget.currentTime * 1000), 0, durationMs)); }} onSeeked={(event) => { if (!interaction.current) setTimeMs(clamp(Math.round(event.currentTarget.currentTime * 1000), 0, durationMs)); }} />
      {enabled && regions.map((region, index) => {
        const regionRectangle = region.track ? interpolateCoverRectangle(region.track.keyframes, timeMs) : region.rectangle;
        const activeFrame = region.id === active?.id;
        return region.sticker && visible(region) && <div key={region.id} className={`cover-sticker-frame${activeFrame ? " active" : ""}`} style={{ zIndex: index + 1, left: `${regionRectangle.x * 100}%`, top: `${regionRectangle.y * 100}%`, width: `${regionRectangle.width * 100}%`, height: `${regionRectangle.height * 100}%` }} onPointerDown={(event) => {
          event.preventDefault(); event.stopPropagation(); onActiveRegionChange(region.id);
        }} aria-label="选择覆盖贴纸"><img src={region.sticker.url} alt={region.sticker.label} /></div>;
      })}
      {enabled && active?.sticker && rectangle && visible(active) && <div className="cover-sticker-selection" style={{ zIndex: regions.length + 1, left: `${rectangle.x * 100}%`, top: `${rectangle.y * 100}%`, width: `${rectangle.width * 100}%`, height: `${rectangle.height * 100}%` }} aria-label="拖动覆盖贴纸" onPointerDown={(event) => startInteraction(event, "drag")}><div className="cover-sticker-handle" aria-label="调整覆盖贴纸尺寸" onPointerDown={(event) => startInteraction(event, "resize")} /></div>}
    </div>
    <div className="cover-track-time"><label>当前时间 <input type="number" min={0} max={durationMs} step={1} value={timeMs} disabled={disabled} onChange={(event) => Number.isFinite(event.target.valueAsNumber) && setVideoTime(event.target.valueAsNumber)} /> ms</label><input aria-label="定位视频时间" type="range" min={0} max={durationMs} step={1} value={timeMs} disabled={disabled} onChange={(event) => setVideoTime(event.target.valueAsNumber)} /></div>
    {!active ? <p className="cover-sticker-note">添加覆盖框后，可拖动并调整它的位置。</p> : !track ? <div className="cover-track-mode"><div><strong>固定覆盖</strong><p>当前覆盖框沿用所有素材共用的位置和尺寸。启用轨迹后只影响此素材。</p></div><button type="button" className="button secondary compact" disabled={!canEdit} onClick={enableTrack}>为此素材启用轨迹</button></div> : <>
      <div className="cover-track-mode"><div><strong>此素材的关键帧轨迹</strong><p>位置和缩放只影响当前覆盖框；拖动、缩放或修改数值会暂停视频并记录当前帧。</p></div><button type="button" className="button secondary compact" disabled={disabled} onClick={() => { onTrackChange(active.id, undefined); setNotice("已移除此素材的轨迹，恢复固定覆盖框。"); }}>移除此素材轨迹</button></div>
      <div className="cover-track-interval"><label>出现 <input type="number" min={0} max={durationMs} step={1} value={track.startMs} disabled={disabled} onChange={(event) => updateInterval("startMs", event.target.valueAsNumber)} /> ms</label><label>结束 <input type="number" min={1} max={durationMs} step={1} value={track.endMs} disabled={disabled} onChange={(event) => updateInterval("endMs", event.target.valueAsNumber)} /> ms</label></div>
      <button type="button" className="button secondary compact" disabled={!canEdit || (track.keyframes.length >= 50 && !track.keyframes.some((frame) => frame.timeMs === timeMs))} onClick={() => rectangle && upsert(rectangle)}>记录当前关键帧</button>
      {!visible(active) && <p className="cover-sticker-note">当前时间不在出现时段内，当前覆盖框不会显示；仍可通过时间定位和关键帧列表继续编辑轨迹。</p>}
      <div className="cover-keyframe-list"><strong>关键帧 {track.keyframes.length}/50</strong>{track.keyframes.map((frame) => <div key={frame.timeMs}><button type="button" className={frame.timeMs === timeMs ? "active" : ""} disabled={disabled} onClick={() => setVideoTime(frame.timeMs)}>{frame.timeMs} ms</button><span>左 {Math.round(frame.rectangle.x * 100)}% · 上 {Math.round(frame.rectangle.y * 100)}% · 宽 {Math.round(frame.rectangle.width * 100)}%</span><button type="button" disabled={disabled || track.keyframes.length === 1} onClick={() => deleteFrame(frame.timeMs)}>删除</button></div>)}</div>
    </>}
    {active && rectangle && <div className="cover-track-numbers"><label>左边 <span><input type="number" min={0} max={100} step={1} value={Math.round(rectangle.x * 100)} disabled={!canEdit} onChange={(event) => updatePosition("x", event.target.valueAsNumber)} />%</span></label><label>上边 <span><input type="number" min={0} max={100} step={1} value={Math.round(rectangle.y * 100)} disabled={!canEdit} onChange={(event) => updatePosition("y", event.target.valueAsNumber)} />%</span></label><label>宽度 <span><input type="number" min={1} max={100} step={1} value={Math.round(rectangle.width * 100)} disabled={!canEdit} onChange={(event) => updateScale(event.target.valueAsNumber)} />%</span></label><label>高度 <span>{track ? `${Math.round(rectangle.height * 100)}%（等比）` : <><input type="number" min={1} max={100} step={1} value={Math.round(rectangle.height * 100)} disabled={!canEdit} onChange={(event) => updateStaticHeight(event.target.valueAsNumber)} />%</>}</span></label></div>}
    {active && !active.sticker && <p className="cover-sticker-note">为当前覆盖框选择独立贴纸，或选择统一候选款后再编辑位置。</p>}
    {!enabled && <p className="cover-sticker-note">先启用覆盖并选择贴纸，才能编辑固定位置或此素材的轨迹。</p>}
    {notice && <p className="cover-sticker-success" role="status">{notice}</p>}
  </div>;
}
