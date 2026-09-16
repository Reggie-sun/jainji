import { outputDimensions, type ExportSettings } from "../shared/export-settings.js";
import type { RuleId } from "../shared/agent.js";
import type { DecorationOptions } from "../shared/decorations.js";
import { EditTemplateSchema, type MediaItem } from "./domain.js";
import { materializePlan, type PackagingPlan, type AgentDecorationCatalog } from "./agent-provider.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { automaticCoverLayers, manualCoverLayers, type FrozenCoverSticker } from "./cover-sticker.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import { fillUncoveredCorners } from "./automatic-corner-layout.js";

export function prepareAgentTemplate(input: { plan: PackagingPlan; ruleId: RuleId; source: MediaItem; resolutionMode?: ExportSettings["resolutionMode"]; stickerAssets: StickerAssets; decorations?: DecorationOptions; catalog?: AgentDecorationCatalog; coverSticker?: FrozenCoverSticker; coverTracks?: AutomaticCoverTrack[]; runId: string; version: number }) {
  const dimensions = outputDimensions(input.source, { resolutionMode: input.resolutionMode ?? "source" });
  let template = materializePlan(input.plan, input.ruleId, dimensions, input.stickerAssets, input.decorations, input.catalog);
  if (input.coverSticker) {
    const layers = input.coverTracks !== undefined ? automaticCoverLayers(input.coverSticker, input.source, dimensions, input.coverTracks) : manualCoverLayers(input.coverSticker, input.source, dimensions, input.version);
    template = EditTemplateSchema.parse({ ...template, layers: [...template.layers, ...layers.map((layer) => ({ ...layer, cover: { ...layer.cover!, selection: { runId: input.runId, round: input.version } } }))] });
    if (input.decorations?.mode === "agent") template = EditTemplateSchema.parse({ ...template, layers: fillUncoveredCorners(template.layers, input.source.durationMs) });
  }
  return template;
}
