import { createHash } from "node:crypto";
import type { CoverReviewDraft } from "../shared/cover-review.js";
import { assertReviewResolved } from "./cover-review-session.js";
import { AgentStartSchema } from "../shared/agent.js";

export function reviewDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function approvalBinding(draft: CoverReviewDraft): string {
  return reviewDigest({ projectId: draft.projectId, id: draft.id, revision: draft.revision, media: draft.media, requestJson: draft.requestJson, settingsDigest: draft.settingsDigest,
    frozen: draft.frozen.map(({ preview: _preview, ...version }) => version) });
}

export function assertApprovable(draft: CoverReviewDraft): void {
  if (draft.status !== "awaiting_approval" && draft.status !== "approved") throw new Error("当前草稿尚不能批准。");
  assertReviewResolved(draft);
  const request = AgentStartSchema.parse(JSON.parse(draft.requestJson ?? "null"));
  if (draft.frozen.length !== draft.media.length * (request.multiplier ?? 1) || draft.media.some(({ mediaId }) => Array.from({ length: request.multiplier ?? 1 }, (_, i) => i + 1).some((version) => !draft.frozen.some((item) => item.mediaId === mediaId && item.version === version)))) throw new Error("批准必须包含全部冻结版本。");
  if (!draft.frozen.length || draft.media.some(({ mediaId }) => !draft.frozen.some((version) => version.mediaId === mediaId))) throw new Error("所有素材版本必须先准备预览。");
  if (draft.frozen.some(({ preview }) => !preview?.viewed)) throw new Error("请查看全部版本的动态预览后再确认。");
  for (const version of draft.frozen) if (reviewDigest(JSON.parse(version.templateJson)) !== version.templateDigest) throw new Error("冻结模板摘要不匹配。");
  if (draft.approval && draft.approval.bindingDigest !== approvalBinding(draft)) throw new Error("批准绑定已失效。");
}
