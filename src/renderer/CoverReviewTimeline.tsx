import type { CoverReviewMedia } from "../shared/cover-review";

export function CoverReviewTimeline({ media, timeMs, onSeek, activeId, onSelect }: { media: CoverReviewMedia; timeMs: number; onSeek(time: number): void; activeId?: string; onSelect(id: string): void }) {
  return <div className="cover-review-timeline">
    <label>时间线 · {(timeMs / 1000).toFixed(3)} 秒<input aria-label="审阅时间线" type="range" min={0} max={media.durationMs} step="any" value={timeMs} onChange={(event) => onSeek(Number(event.target.value))} /></label>
    {media.segments.map((segment, index) => <button key={segment.id} type="button" aria-pressed={activeId === segment.id} onClick={() => { onSelect(segment.id); onSeek(segment.track.startMs); }}>框 {index + 1}</button>)}
  </div>;
}
