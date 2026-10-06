import { outputDimensions, type ExportSettings } from "../shared/export-settings.js";
import type { RuleId } from "../shared/agent.js";
import { displayTextSettings, type DecorationOptions } from "../shared/decorations.js";
import { EditTemplateSchema, type MediaItem, type StickerLayer } from "./domain.js";
import { materializePlan, type PackagingPlan, type AgentDecorationCatalog } from "./agent-provider.js";
import type { StickerAssets } from "./builtin-stickers.js";
import { automaticCoverLayers, manualCoverLayers, type FrozenCoverSticker } from "./cover-sticker.js";
import type { AutomaticCoverTrack } from "./automatic-cover-tracks.js";
import { fillUncoveredCorners } from "./automatic-corner-layout.js";
import { frameSettings } from "../shared/frames.js";

export function prepareAgentTemplate(input: { plan: PackagingPlan; ruleId: RuleId; source: MediaItem; resolutionMode?: ExportSettings["resolutionMode"]; stickerAssets: StickerAssets; decorations?: DecorationOptions; catalog?: AgentDecorationCatalog; coverSticker?: FrozenCoverSticker; shapeCoverLayers?: StickerLayer[]; coverTracks?: AutomaticCoverTrack[]; sourceStickerTracks?: AutomaticCoverTrack[]; preserveCoverMotion?: boolean; runId: string; version: number }) {
  const dimensions = outputDimensions(input.source, { resolutionMode: input.resolutionMode ?? "source" });
  const textOptions = input.decorations && (input.decorations.displayText || input.decorations.displayTextByMedia)
    ? { ...input.decorations, displayText: displayTextSettings(input.decorations, input.source.id) } : input.decorations;
  const frame = frameSettings(textOptions, input.source.id);
  const decorations = textOptions?.framesByMedia ? { ...textOptions, frame, framesByMedia: undefined,
    frameId: frame.mode === "manual" ? frame.frameId : frame.mode === "random" ? textOptions.frameId : undefined } : textOptions;
  let template = materializePlan(input.plan, input.ruleId, dimensions, input.stickerAssets, decorations, input.catalog);
  if (input.coverSticker && !input.shapeCoverLayers) {
    const layers = input.coverTracks !== undefined ? automaticCoverLayers(input.coverSticker, input.source, dimensions, input.coverTracks, { preserveMotion: input.preserveCoverMotion }) : manualCoverLayers(input.coverSticker, input.source, dimensions, input.version);
    template = EditTemplateSchema.parse({ ...template, layers: [...template.layers, ...layers.map((layer) => ({ ...layer, cover: { ...layer.cover!, selection: { runId: input.runId, round: input.version } } }))] });
  }
  if (input.decorations?.mode === "agent" || input.decorations?.mode === "random") {
    // Original corner identity is relative to the source; export padding must not create a second sticker beside it.
    const sourceTracks = input.shapeCoverLayers ? input.shapeCoverLayers.map(layer => {
      const shape = layer.cover!.shapeMatched!;
      const left = Math.max(0, shape.placement.x - shape.radiusPx), top = Math.max(0, shape.placement.y - shape.radiusPx);
      const right = Math.min(shape.projection.width, shape.placement.x + shape.placement.width + shape.radiusPx);
      const bottom = Math.min(shape.projection.height, shape.placement.y + shape.placement.height + shape.radiusPx);
      return { ...shape.range, keyframes: [{ timeMs: shape.range.startMs, rectangle: { x: left / shape.projection.width,
        y: top / shape.projection.height, width: (right - left) / shape.projection.width, height: (bottom - top) / shape.projection.height } }] };
    }) : input.sourceStickerTracks?.map(({ track }) => track);
    template = EditTemplateSchema.parse({ ...template, layers: fillUncoveredCorners(template.layers, input.source.durationMs, sourceTracks) });
  }
  if (input.shapeCoverLayers) template = EditTemplateSchema.parse({ ...template, layers: [...template.layers, ...input.shapeCoverLayers] });
  return template;
}
