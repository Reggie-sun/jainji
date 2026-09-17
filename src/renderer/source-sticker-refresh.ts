import { useCallback, useEffect, useMemo, useState } from "react";
import type { CoverSticker } from "../shared/cover-sticker";
import type { DecorationOptions } from "../shared/decorations";

export interface SourceStickerRefreshIntent { projectId: string; mediaIds: string[]; modeKey: string }
export interface SourceStickerRefreshContext { projectId: string; selectedReadyIds: readonly string[]; eligible: boolean; modeKey: string }

function ids(ids: readonly string[]): string[] { return [...new Set(ids)]; }
function sameScope(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const known = new Set(left);
  return right.every((id) => known.has(id));
}
export function sourceStickerRefreshModeKey(mode: DecorationOptions["mode"], coverSticker?: CoverSticker): string {
  if (coverSticker?.enabled && coverSticker.trackingMode === "agent") return `cover-agent:${mode}`;
  return mode === "agent" && !coverSticker?.enabled ? "preserve" : "unavailable";
}
export function sourceStickerRefreshEligible(mode: DecorationOptions["mode"], coverSticker?: CoverSticker): boolean {
  return sourceStickerRefreshModeKey(mode, coverSticker) !== "unavailable";
}

/** This is UI-only one-shot intent; no IPC, persistence, or model work happens here. */
export function requestSourceStickerRefresh(context: SourceStickerRefreshContext): SourceStickerRefreshIntent | undefined {
  const mediaIds = ids(context.selectedReadyIds);
  return context.eligible && mediaIds.length ? { projectId: context.projectId, mediaIds, modeKey: context.modeKey } : undefined;
}
export function reconcileSourceStickerRefresh(intent: SourceStickerRefreshIntent | undefined, context: SourceStickerRefreshContext): SourceStickerRefreshIntent | undefined {
  if (!intent || !context.eligible || intent.projectId !== context.projectId || intent.modeKey !== context.modeKey || !sameScope(intent.mediaIds, ids(context.selectedReadyIds))) return undefined;
  return intent;
}
export function consumeSourceStickerRefresh(_intent: SourceStickerRefreshIntent | undefined): undefined { return undefined; }
export function sourceStickerRefreshInput(intent: SourceStickerRefreshIntent | undefined): { projectId: string; mediaIds: string[] } | undefined {
  return intent && { projectId: intent.projectId, mediaIds: intent.mediaIds };
}

export function useSourceStickerRefresh(context: SourceStickerRefreshContext) {
  const [intent, setIntent] = useState<SourceStickerRefreshIntent>();
  const signature = useMemo(() => ids(context.selectedReadyIds).sort().join("\u0000"), [context.selectedReadyIds]);
  const refresh = reconcileSourceStickerRefresh(intent, context);
  useEffect(() => { setIntent((current) => reconcileSourceStickerRefresh(current, context)); }, [context.projectId, context.eligible, context.modeKey, signature]);
  return {
    refresh,
    request: useCallback(() => setIntent(requestSourceStickerRefresh(context)), [context.projectId, context.eligible, context.modeKey, signature]),
    consume: useCallback(() => setIntent(consumeSourceStickerRefresh), []),
  };
}
