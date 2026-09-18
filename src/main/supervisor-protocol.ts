import { z } from "zod";
import { DetectedCoverFrameSchema, MAX_AUTOMATIC_COVER_TRACKS } from "../shared/automatic-cover.js";
import type { CoverDetectionImage, DetectedCoverFrame } from "../shared/automatic-cover.js";
import { CoverRectangleSchema, CoverTrackSchema } from "../shared/cover-sticker.js";
import { CORNER_SAFE_POLICY } from "../shared/layout-policy.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import type { SupervisorEvidenceImage } from "./supervisor-evidence.js";
import { SourceFactsSchema, ReviewedRangeSchema, KnowledgeDisputeSchema, type KnowledgeEvidence } from "../shared/source-sticker-knowledge.js";

export const MAX_RECOGNITION_TURNS = 3;
export const MAX_PREVIEW_TURNS = 5;
export const MAX_PREVIEW_REVISIONS = 2;
const reason = z.string().trim().min(1).max(500);
export const InspectionRequestSchema = z.object({ timeMs: z.number().int().nonnegative(), crop: CoverRectangleSchema.optional() }).strict();
const InspectSchema = z.object({ action: z.literal("inspect"), reason, requests: z.array(InspectionRequestSchema).min(1).max(4) }).strict();
const StopSchema = z.object({ action: z.literal("stop"), reason }).strict();
export const RecognitionDecisionSchema = z.discriminatedUnion("action", [
  InspectSchema, StopSchema,
  z.object({ action: z.literal("resolve"), reason, frames: z.array(DetectedCoverFrameSchema).min(1).max(8) }).strict(),
]);
export const SupervisorTracksSchema = z.array(z.object({ targetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), track: CoverTrackSchema }).strict()).max(MAX_AUTOMATIC_COVER_TRACKS);
const CornerCorrectionSchema = z.object({
  corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
  width: z.number().positive().max(CORNER_SAFE_POLICY.maxStickerWidth),
  rotationDeg: z.number().min(-CORNER_SAFE_POLICY.maxStickerRotation).max(CORNER_SAFE_POLICY.maxStickerRotation),
}).strict();
const IssueFields = { id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), reason, ranges: z.array(ReviewedRangeSchema).min(1).max(64), evidenceIds: z.array(z.string().min(1).max(120)).min(1).max(64) };
export const PreviewIssueSchema = z.discriminatedUnion("scope", [
  z.object({ ...IssueFields, scope: z.literal("source"), kind: KnowledgeDisputeSchema.shape.kind, targetId: z.string().min(1).max(120).optional() }).strict(),
  z.object({ ...IssueFields, scope: z.literal("render"), kind: z.enum(["missing_corner", "duplicate_corner", "occlusion", "coverage", "content_timing"]) }).strict(),
]);
const issues = z.array(PreviewIssueSchema).max(32).optional();
export const PreviewDecisionSchema = z.discriminatedUnion("action", [
  InspectSchema.extend({ issues }), StopSchema.extend({ issues }),
  z.object({ action: z.literal("pass"), reason }).strict(),
  z.object({ action: z.literal("revise"), reason, tracks: SupervisorTracksSchema, corners: z.array(CornerCorrectionSchema).max(4).optional(),
    issues, resolvedIssueIds: z.array(z.string().min(1).max(120)).max(32).optional(), sourceFacts: SourceFactsSchema.optional() }).strict(),
]);
export type PreviewIssue = z.infer<typeof PreviewIssueSchema>;
export type PreviewIssueRecord = PreviewIssue & { status: "open" | "awaiting-review" | "resolved"; reportedTurn: number; resolvedTurn?: number; disputedRevisionId?: string };
export type PreviewRevision = Extract<z.infer<typeof PreviewDecisionSchema>, { action: "revise" }>;
export interface RecognitionReviewInput {
  images: readonly CoverDetectionImage[];
  proposal?: DetectedCoverFrame[];
  previous?: DetectedCoverFrame;
  evidence: SupervisorEvidenceImage[];
  feedback?: string;
  turn: number;
}
export interface PreviewReviewInput {
  trackPurpose?: "cover-placement";
  durationMs: number;
  trackHorizonMs: number;
  displayMode: "full" | "first-3s" | "first-5s";
  stickerDisplayMode?: "full";
  coverEnabled: boolean;
  automaticCorners: boolean;
  tracks: AutomaticCoverTrack[];
  // A deliberately path-free, read-only projection of the current rendered layers.
  layers: Array<Record<string, unknown>>;
  evidence: SupervisorEvidenceImage[];
  feedback?: string;
  turn: number;
  revision: number;
  remainingRevisions: number;
  history: Array<{ turn: number; revision: number; action: string; reason: string; applied?: boolean; feedback?: string }>;
  issues?: PreviewIssueRecord[];
  knowledge?: { candidateId: string; sourceKey: string; baseRevisionId: string | null; factsDigest: string;
    requiredRanges: Array<{ startMs: number; endMs: number }>; facts: z.infer<typeof SourceFactsSchema>; evidenceIds: string[];
    sourceEvidence: Array<Extract<KnowledgeEvidence, { kind: "source" }>> };
}

export function validateSupervisorTracks(tracks: AutomaticCoverTrack[], durationMs: number): AutomaticCoverTrack[] {
  const parsed = SupervisorTracksSchema.parse(tracks);
  for (const { track } of parsed) {
    if (track.endMs > durationMs) throw new Error("track-horizon");
    if (track.keyframes.some(frame => frame.timeMs < track.startMs || frame.timeMs > track.endMs)) throw new Error("track-keyframes");
  }
  for (let i = 0; i < parsed.length; i++) for (let j = 0; j < i; j++) {
    if (parsed[i].targetId === parsed[j].targetId && parsed[i].track.startMs < parsed[j].track.endMs && parsed[j].track.startMs < parsed[i].track.endMs) throw new Error("同一目标的轨迹时段不能重叠");
  }
  return parsed;
}

/** Never echo untrusted model output, paths or service errors into the next prompt. */
export function supervisorValidationFeedback(error: unknown, trackHorizonMs?: number): string {
  if (error instanceof Error && error.message === "track-horizon") return `tracks 仅用于新增图层的占位/覆盖，必须在 0–${trackHorizonMs}ms 内。这不是原贴纸实际消失的时间；原贴纸在此后仍存在是正常保留，不能因此延长 tracks 或判定样片有问题。`;
  if (error instanceof Error && error.message === "track-keyframes") return "每个关键帧的 timeMs 必须位于其所属轨迹的 startMs 和 endMs 之间。";
  if (error instanceof Error && error.message === "no-visible-change") return "修订没有改变有效显示时段内的画面。若原图该角没有贴纸、样片却漏角，应删除或缩短误识别的原贴纸 tracks；只调整被抑制角标的尺寸不会补回时段。请依据原图真正修正，不能直接改报 pass。";
  if (error instanceof Error && error.message === "unresolved-revision") return "上一轮已报告的问题尚未得到有效修订，不能直接通过。请修正导致问题的轨迹或角标参数；无法确认则 stop。";
  if (error instanceof SyntaxError) return "JSON 格式无效；请按协议返回单个 JSON 对象，不要 Markdown。";
  if (error instanceof z.ZodError) {
    // Only locally authored explanations; never echo arbitrary model values or keys.
    const explanations: Record<string, string> = {
      "覆盖框必须完整位于画面内": "框越界：x + width <= 1 且 y + height <= 1；x、y 是左上角，不是中心点",
      "轨迹缩放必须保持覆盖框比例": "同一段所有关键帧的 width / height 必须相同；仅平移时沿用首帧 width、height，只改变 x、y；缩放时宽高乘同一倍数，不要分别取整",
      "覆盖结束时间必须晚于开始时间": "endMs 必须大于 startMs",
      "关键帧时间必须递增且不能重复": "关键帧 timeMs 必须递增且不能重复",
      "Track exceeds source duration": "endMs 不得超过视频 durationMs",
      "Keyframe is outside its track or source duration": "timeMs 必须在 startMs、endMs 及视频时长内",
      "Tracks for the same target cannot overlap": "同一 targetId 的分段时段不得重叠",
    };
    const fields = new Set(["action", "tracks", "track", "keyframes", "rectangle", "x", "y", "width", "height", "timeMs", "startMs", "endMs", "targetId", "requests", "crop", "corners"]);
    return `返回结构不合格：${error.issues.slice(0, 6).map(issue => {
      const location = issue.path.map(part => typeof part === "number" || fields.has(part) ? part : "field").join(".") || "action";
      return `${location}：${explanations[issue.message] ?? "字段类型、范围或协议不符"}`;
    }).join("；")}。请返回修正后的完整方案，不要删除真实目标来绕过校验。`;
  }
  return "本地校验不通过：请检查时间顺序、重叠帧目标连续性、轨迹区间和贴纸安全边界；不要修改输入的抽帧时间。";
}
