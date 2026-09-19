import { CoverTrackSchema, interpolateCoverRectangle, type CoverKeyframe, type CoverTrack } from "../shared/cover-sticker.js";
import { COVER_SAMPLE_INTERVAL_MS, MAX_AUTOMATIC_COVER_TRACKS, type DetectedCoverFrame } from "../shared/automatic-cover.js";
import { ProviderError } from "./api-transport.js";

export interface AutomaticCoverTrack { targetId: string; track: CoverTrack }

function expandFrames(frames: readonly CoverKeyframe[]): CoverKeyframe[] {
  const maxWidth = Math.max(...frames.map(({ rectangle }) => Math.min(1, rectangle.width + 0.02)));
  const maxHeight = Math.max(...frames.map(({ rectangle }) => Math.min(1, rectangle.height + 0.02)));
  const ratio = maxWidth / maxHeight;
  return frames.map(({ timeMs, rectangle: rect }) => {
    const width = Math.min(maxWidth, Math.max(Math.min(1, rect.width + 0.02), Math.min(1, rect.height + 0.02) * ratio));
    const height = Math.min(maxHeight, width / ratio);
    return { timeMs, rectangle: { x: Math.max(0, Math.min(1 - width, rect.x + rect.width / 2 - width / 2)), y: Math.max(0, Math.min(1 - height, rect.y + rect.height / 2 - height / 2)), width, height } };
  });
}

/** Safety padding is a rendering decision, never a mutation of reusable source facts. */
export function expandSourceCoverTracks(tracks: readonly AutomaticCoverTrack[]): AutomaticCoverTrack[] {
  return tracks.map(({ targetId, track }) => ({ targetId, track: CoverTrackSchema.parse({ ...track, keyframes: expandFrames(track.keyframes) }) }));
}

function simplify(frames: CoverKeyframe[], detections: CoverKeyframe[]): CoverKeyframe[] {
  if (frames.length <= 2) return frames;
  const kept = new Set([0, frames.length - 1]);
  const pending = [[0, frames.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let greatest = 0.002, selected = -1;
    for (let index = start + 1; index < end; index++) {
      const predicted = interpolateCoverRectangle([frames[start], frames[end]], frames[index].timeMs);
      const actual = frames[index].rectangle;
      const original = detections[index].rectangle;
      if (predicted.x > original.x + 1e-10 || predicted.y > original.y + 1e-10
        || predicted.x + predicted.width < original.x + original.width - 1e-10
        || predicted.y + predicted.height < original.y + original.height - 1e-10) {
        selected = index;
        break;
      }
      const error = Math.max(Math.abs(predicted.x - actual.x), Math.abs(predicted.y - actual.y), Math.abs(predicted.x + predicted.width - actual.x - actual.width), Math.abs(predicted.y + predicted.height - actual.y - actual.height));
      if (error > greatest) { greatest = error; selected = index; }
    }
    if (selected !== -1) { kept.add(selected); pending.push([start, selected], [selected, end]); }
  }
  return [...kept].sort((a, b) => a - b).map((index) => frames[index]);
}

export function automaticCoverTracks(frames: readonly DetectedCoverFrame[], durationMs: number): AutomaticCoverTrack[] {
  const runs: { id: string; frames: CoverKeyframe[]; startMs: number; endMs: number }[] = [];
  let active = new Map<string, typeof runs[number]>();
  for (const frame of frames) {
    const next = new Map<string, typeof runs[number]>();
    for (const target of frame.targets) {
      let run = active.get(target.id);
      if (!run) {
        run = { id: target.id, frames: [], startMs: Math.max(0, frame.timeMs - COVER_SAMPLE_INTERVAL_MS), endMs: durationMs };
        runs.push(run);
      }
      run.frames.push({ timeMs: frame.timeMs, rectangle: target.rectangle });
      run.endMs = Math.min(durationMs, frame.timeMs + COVER_SAMPLE_INTERVAL_MS);
      next.set(target.id, run);
    }
    active = next;
  }
  const tracks: AutomaticCoverTrack[] = [];
  for (const run of runs) {
    const expanded = expandFrames(run.frames);
    const reduced = simplify(expanded, run.frames);
    for (let offset = 0; offset < reduced.length; offset += 49) {
      const keyframes = reduced.slice(offset, offset + 50);
      const startMs = offset === 0 ? run.startMs : keyframes[0].timeMs;
      const endMs = offset + 50 < reduced.length ? keyframes[keyframes.length - 1].timeMs : run.endMs;
      if (endMs > startMs) tracks.push({ targetId: run.id, track: CoverTrackSchema.parse({ startMs, endMs, keyframes }) });
      if (offset + 50 >= reduced.length) break;
    }
  }
  if (tracks.length > MAX_AUTOMATIC_COVER_TRACKS) throw new ProviderError("素材中的贴纸数量或运动过于复杂，无法可靠完成全部自动覆盖；本条已停止。请检查素材。");
  return tracks;
}
