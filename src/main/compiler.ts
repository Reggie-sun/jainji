import path from "node:path";
import { EditTemplateSchema, type EditTemplate, type ExportPreset, type FilterConfig, type Layer, type MediaItem } from "./domain.js";
import { CORNER_SAFE_POLICY, nearestStickerCorner } from "../shared/layout-policy.js";

export interface FontResolver {
  resolve(fontFamily: string): Promise<string | null>;
}

export interface TextFile {
  layerId: string;
  path: string;
  content: string;
}

export interface CompileOptions {
  ffmpegPath: string;
  fontResolver: FontResolver;
  textFilePath: (layerId: string) => string;
}

export interface CompiledCommand {
  binary: string;
  args: string[];
  textFiles: TextFile[];
  durationSeconds: number;
}

/** Escape a value for FFmpeg's filter grammar. This is separate from shell escaping. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\:'\[\],;]/g, (character) => `\\${character}`).replace(/\n/g, "\\n");
}

function color(value: { r: number; g: number; b: number; a: number }, opacity = 1): string {
  const hex = [value.r, value.g, value.b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return `0x${hex}@${(value.a * opacity).toFixed(3)}`;
}

function filterExpression(config: FilterConfig): string | null {
  if (config.presetId === "none" || config.intensity === 0) return null;
  const amount = config.intensity;
  switch (config.presetId) {
    case "warm": return `eq=saturation=${(1 + amount * 0.18).toFixed(3)}:contrast=${(1 + amount * 0.05).toFixed(3)}:brightness=${(amount * 0.04).toFixed(3)}`;
    case "cool": return `colorbalance=bs=${(amount * 0.12).toFixed(3)}:gs=${(-amount * 0.03).toFixed(3)}:rh=${(-amount * 0.08).toFixed(3)}`;
    case "mono": return `hue=s=${(1 - amount).toFixed(3)}`;
    case "vivid": return `eq=saturation=${(1 + amount * 0.38).toFixed(3)}:contrast=${(1 + amount * 0.1).toFixed(3)}`;
  }
}

function outputScale(preset: ExportPreset, dimensions: { width: number; height: number }): string | null {
  if (preset.resolutionMode === "source") return null;
  const size = `${dimensions.width}:${dimensions.height}`;
  return `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`;
}

function outputDimensions(media: MediaItem, preset: ExportPreset): { width: number; height: number } {
  const portrait = media.height > media.width;
  if (preset.resolutionMode === "1080p") return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  if (preset.resolutionMode === "720p") return portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  return { width: media.width, height: media.height };
}

function sortedVisibleLayers(template: EditTemplate): Layer[] {
  return [...template.layers].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex);
}

function wrapText(content: string, widthRatio: number, fontSizeRatio: number, dimensions: { width: number; height: number }): string {
  const approximateGlyphWidth = Math.max(1, dimensions.height * fontSizeRatio);
  const maxUnits = Math.max(1, dimensions.width * widthRatio);
  const lines = content.split("\n");
  return lines.flatMap((line) => {
    const wrapped: string[] = [];
    let current = "";
    let units = 0;
    for (const character of line) {
      const characterUnits = /[\u0000-\u00ff]/.test(character) ? 0.6 : 1;
      if (current && (units + characterUnits) * approximateGlyphWidth > maxUnits) {
        wrapped.push(current);
        current = "";
        units = 0;
      }
      current += character;
      units += characterUnits;
    }
    wrapped.push(current);
    return wrapped;
  }).join("\n");
}

export class TemplateCompiler {
  async compile(templateInput: EditTemplate, media: MediaItem, preset: ExportPreset, options: CompileOptions): Promise<CompiledCommand> {
    const template = EditTemplateSchema.parse(templateInput);
    const textFiles: TextFile[] = [];
    // FFmpeg enables autorotation by default; omitting the legacy flag keeps compatibility
    // with system builds that parse it as an input option requiring a value.
    const args: string[] = ["-hide_banner", "-nostdin", "-y", "-i", media.sourcePath];
    let inputIndex = 1;
    let baseLabel = "base0";
    const graph: string[] = [];
    const dimensions = outputDimensions(media, preset);
    const sourceFilters = ["setpts=PTS-STARTPTS", outputScale(preset, dimensions), "format=yuv420p"].filter(Boolean).join(",");
    graph.push(`[0:v]${sourceFilters}[${baseLabel}]`);

    for (const layer of sortedVisibleLayers(template)) {
      if (layer.type === "text") {
        const fontPath = await options.fontResolver.resolve(layer.fontFamily);
        if (!fontPath) throw new Error(`font_missing:${layer.fontFamily}`);
        const textPath = options.textFilePath(layer.id);
        textFiles.push({ layerId: layer.id, path: textPath, content: wrapText(layer.content, layer.width, layer.fontSizeRatio, dimensions) });
        const nextLabel = `base${graph.length}`;
        const drawtext = [
          "drawtext=" +
          `fontfile='${escapeFilterValue(fontPath)}'`,
          `textfile='${escapeFilterValue(textPath)}'`,
          "expansion=none",
          `fontsize=h*${layer.fontSizeRatio.toFixed(5)}`,
          `fontcolor=${color(layer.color, layer.opacity)}`,
          `bordercolor=${color(layer.strokeColor, layer.opacity)}`,
          `borderw=${Math.round(layer.strokeWidthRatio * dimensions.height)}`,
          ...(layer.backgroundColor ? [
            "box=1",
            `boxcolor=${color(layer.backgroundColor, layer.opacity)}`,
            `boxborderw=${Math.round((layer.backgroundPaddingRatio ?? 0.006) * dimensions.height)}`,
          ] : []),
          `x=w*${layer.x.toFixed(5)}`,
          `y=h*${layer.y.toFixed(5)}`,
          "fix_bounds=1",
        ].join(":");
        graph.push(`[${baseLabel}]${drawtext}[${nextLabel}]`);
        baseLabel = nextLabel;
        continue;
      }

      // stream_loop works for both still images and animated GIFs. The output -t
      // remains the single duration owner, so sticker streams cannot extend a job.
      args.push("-stream_loop", "-1", "-i", layer.assetPath);
      const stickerIndex = inputIndex;
      inputIndex += 1;
      const sourceLabel = `sticker${stickerIndex}src`;
      const scaledLabel = `sticker${stickerIndex}`;
      const nextLabel = `base${graph.length}`;
      const angle = (Math.PI * layer.rotationDeg / 180).toFixed(6);
      const governed = template.layoutPolicy === CORNER_SAFE_POLICY.id;
      const corner = nearestStickerCorner(layer);
      const stickerWidth = Math.max(1, Math.round(dimensions.width * layer.width));
      const stickerScale = governed
        ? `${stickerWidth}:${Math.max(1, Math.round(dimensions.height * CORNER_SAFE_POLICY.maxStickerHeight))}:force_original_aspect_ratio=decrease`
        : `${stickerWidth}:-1`;
      graph.push(
        `[${stickerIndex}:v]format=rgba,` +
        `rotate=${angle}:c=none:ow=rotw(${angle}):oh=roth(${angle}),` +
        `scale=${stickerScale},` +
        `colorchannelmixer=aa=${layer.opacity.toFixed(4)},setpts=PTS-STARTPTS[${sourceLabel}]`,
      );
      graph.push(`[${sourceLabel}]null[${scaledLabel}]`);
      const overlayX = governed
        ? corner.horizontal === "right"
          ? `main_w-overlay_w-main_w*${CORNER_SAFE_POLICY.cornerMargin.toFixed(5)}`
          : `main_w*${CORNER_SAFE_POLICY.cornerMargin.toFixed(5)}`
        : `main_w*${layer.x.toFixed(5)}`;
      const overlayY = governed
        ? corner.vertical === "bottom"
          ? `main_h-overlay_h-main_h*${CORNER_SAFE_POLICY.cornerMargin.toFixed(5)}`
          : `main_h*${CORNER_SAFE_POLICY.cornerMargin.toFixed(5)}`
        : `main_h*${layer.y.toFixed(5)}`;
      graph.push(`[${baseLabel}][${scaledLabel}]overlay=x=${overlayX}:y=${overlayY}:format=auto[${nextLabel}]`);
      baseLabel = nextLabel;
    }

    const filter = filterExpression(template.filter);
    if (filter) {
      const nextLabel = `filtered${graph.length}`;
      graph.push(`[${baseLabel}]${filter}[${nextLabel}]`);
      baseLabel = nextLabel;
    }
    graph.push(`[${baseLabel}]null[vout]`);

    args.push(
      "-filter_complex", graph.join(";"),
      "-map", "[vout]",
      "-map", "0:a?",
      "-t", Math.max(0.01, media.durationMs / 1000).toFixed(3),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", preset.quality === "high" ? "256k" : preset.quality === "small" ? "128k" : "192k",
      "-ar", "44100",
      "-preset", preset.quality === "high" ? "slow" : "medium",
      "-crf", preset.quality === "high" ? "18" : preset.quality === "small" ? "28" : "23",
      ...(preset.frameRateMode === "30" ? ["-r", "30"] : []),
      "-movflags", "+faststart",
      "-progress", "pipe:1",
      "-nostats",
    );

    return { binary: options.ffmpegPath, args, textFiles, durationSeconds: Math.max(0.01, media.durationMs / 1000) };
  }
}

export const filterRegistry = {
  presets: ["none", "warm", "cool", "mono", "vivid"] as const,
  expression: filterExpression,
};

export function filenameForSource(sourcePath: string, suffix = "_edited"): string {
  const stem = path.basename(sourcePath, path.extname(sourcePath)).replace(/[\\/\0]/g, "_");
  return `${stem}${suffix}.mp4`;
}
