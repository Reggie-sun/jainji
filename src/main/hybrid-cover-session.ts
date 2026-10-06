import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DecorationOptions } from "../shared/decorations.js";
import { displayTextSettings } from "../shared/decorations.js";
import { getRule, type RuleId } from "../shared/agent.js";
import type { ExportPreset, MediaItem, EditTemplate } from "./domain.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { prepareDiscoveryEvidence } from "./source-fact-discovery-evidence.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import { FfmpegAdapter } from "./ffmpeg.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { confirmHybridCornerTargets } from "./shape-cover-vision-corner-semantic.js";
import { ShapeCoverVisionSession, type VisionRole, type VisionRoute } from "./shape-cover-vision-router.js";
import { prepareHybridCornerOverlays, readHybridFrozenOverlay } from "./shape-cover-hybrid-h3.js";
import { approveHybridOverlay, hybridTemplate, hybridVideoMedia } from "./hybrid-cover-production.js";
import type { HybridStickerCandidate } from "./shape-cover-hybrid-shape.js";
import { materializePlan, ProviderError } from "./agent-provider.js";
import type { FullSourceCensusInput } from "./source-fact-census.js";
import { sourceKey } from "./source-sticker-knowledge-store.js";
import { createDecorationFrameResolver } from "./decoration-frame.js";

export interface HybridProductionSession {
  prepare(media: MediaItem, version: number, runId: string, signal: AbortSignal, onStage: (message: string) => void): Promise<EditTemplate>;
}

/** Original runner owns quantity, cancellation and submission; this adapter prepares frozen layers only. */
export function createHybridProductionSession(deps: { tools: FullSourceCensusInput["ffmpeg"]; preset: ExportPreset; directory: string;
  candidates: readonly HybridStickerCandidate[]; stickerAssets: StickerAssets; decorations: DecorationOptions; ruleId: RuleId;
  knowledgeStore?: SourceStickerKnowledgeStore;
  routes(signal: AbortSignal): Promise<Record<VisionRole, VisionRoute>> }): HybridProductionSession {
  const pending = new Map<string, Promise<{ layers: Awaited<ReturnType<typeof approveHybridOverlay>>[]; summary: string }>>();
  const resolveFrame = createDecorationFrameResolver(deps.decorations, deps.stickerAssets);
  const frozenOptions = new Map<string, DecorationOptions>();
  return { prepare: async (media, version, _runId, signal, onStage) => {
    const outputKey = `${media.id}:${version}`;
    if (!frozenOptions.has(outputKey)) frozenOptions.set(outputKey, resolveFrame(media.id));
    const key = media.fingerprint;
    let operation = pending.get(key);
    if (!operation) {
      operation = (async () => {
        onStage("自动形状匹配：检查四角静态贴纸");
        const identity = new SupervisorEvidence(new FfmpegAdapter(deps.tools.ffmpegPath, deps.tools.ffprobePath), await hybridVideoMedia(media, deps.tools));
        let probe;
        try { probe = await identity.sourceIdentity(signal); } finally { await identity.dispose(); }
        const input = { sourcePath: media.sourcePath, source: probe, ffmpeg: deps.tools, signal };
        if (probe.fingerprint !== media.fingerprint) throw new ProviderError("UNSAFE: Hybrid 原素材已变化。");
        const evidence = await prepareDiscoveryEvidence(input, { frames: 24 });
        try {
          const verifySourceKnowledge = async () => { if (deps.knowledgeStore) {
            // Legacy knowledge uses the original catalog/container interpretation of the same bytes.
            for (const durationMs of new Set([probe.durationMs, media.durationMs])) {
              const existing = await deps.knowledgeStore.lookup({ ...probe, durationMs }, [{ startMs: 0, endMs: durationMs }]);
              if (existing.status === "disputed" || existing.status === "unusable") throw new ProviderError("UNSAFE: 原源知识存在争议或完整性未知。");
            }
          } };
          await verifySourceKnowledge();
          const routes = await deps.routes(signal);
          const semantic = await confirmHybridCornerTargets(evidence, { ...deps.tools, signal }, new ShapeCoverVisionSession(sourceKey(probe), routes, 180000, "CORNER"), signal);
          if (semantic.status === "CORNER_SEMANTIC_BLOCKED") throw new ProviderError("UNSAFE: Hybrid 源或模型连接绑定失败。");
          onStage("自动形状匹配：冻结轮廓、运动与覆盖");
          const h3 = await prepareHybridCornerOverlays(input, evidence, semantic, deps.candidates,
            { resolutionMode: deps.preset.resolutionMode, frameRateMode: deps.preset.frameRateMode, quality: deps.preset.quality }, path.join(deps.directory, randomUUID()));
          if (h3.status === "BLOCKED") throw new ProviderError(`UNSAFE: Hybrid ${h3.sourceErrors.join(";")}`);
          const layers = [];
          for (const c of h3.corners) {
            if (c.status !== "FROZEN") continue;
            onStage(`自动形状匹配：检查 ${c.corner} 冻结样片`);
            const { overlay } = await readHybridFrozenOverlay(h3, c.corner, { ...deps.tools });
            try { layers.push(await approveHybridOverlay(overlay, input, routes, deps.directory, verifySourceKnowledge)); }
            catch (error) {
              // Only a completed semantic QA rejection is local. Identity/infrastructure failures stop the source.
              if (!(error instanceof Error) || error.message !== "UNSAFE: HYBRID_H4_NOT_PASS") throw error;
            }
          }
          await h3.verifyFresh();
          const corners = layers.map(l => l.cover!.hybridApproved!.corner);
          return { layers, summary: `自动形状匹配 · 已处理 ${corners.length} 个角落${corners.length ? `（${corners.join("、")}）` : ""}；其他角落保持原样，未声明全部旧贴纸已处理` };
        } finally { await evidence.close(); }
      })();
      pending.set(key, operation);
    }
    const { layers, summary } = await operation;
    signal.throwIfAborted();
    // User-authored display text uses the original materializer. No extra corner artwork or filter changes.
    const options = { ...frozenOptions.get(outputKey)!, mode: "manual" as const, sticker: "none" as const, corners: undefined, displayText: displayTextSettings(deps.decorations, media.id) };
    const rule = getRule(deps.ruleId);
    const base = materializePlan({ summary, captions: [], filter: rule.filters[0], intensity: rule.minIntensity }, deps.ruleId, media, deps.stickerAssets, options);
    return hybridTemplate(layers, { ...base, name: summary });
  } };
}
