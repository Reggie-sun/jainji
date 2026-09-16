import path from "node:path";
import { outputDimensions } from "../shared/export-settings.js";
import { PRICE_LINE_HEIGHT } from "../shared/price-styles.js";
import { assertPriceOnlyTemplate, EditTemplateSchema, type EditTemplate, type ExportPreset, type FilterConfig, type Layer, type MediaItem } from "./domain.js";
import { CORNER_SAFE_POLICY, nearestStickerCorner } from "../shared/layout-policy.js";
import { encoderDeviceArgs, encoderPixelFormat, videoEncodingArgs, type H264Encoder } from "./video-encoder.js";
import { coverMotionExpression, coverRasterExpressions } from "./cover-motion.js";

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
  threads?: number;
  videoEncoder?: H264Encoder;
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
    case "cool": return `colorchannelmixer=rr=${(1 - amount * 0.08).toFixed(3)}:gg=${(1 - amount * 0.03).toFixed(3)}:bb=1`;
    case "mono": return `hue=s=${(1 - amount).toFixed(3)}`;
    case "vivid": return `eq=saturation=${(1 + amount * 0.38).toFixed(3)}:contrast=${(1 + amount * 0.1).toFixed(3)}`;
  }
}

function outputScale(preset: ExportPreset, dimensions: { width: number; height: number }): string | null {
  if (preset.resolutionMode === "source") return null;
  const size = `${dimensions.width}:${dimensions.height}`;
  return `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`;
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
    assertPriceOnlyTemplate(template);
    const textFiles: TextFile[] = [];
    const durationSeconds = Math.max(0.01, media.durationMs / 1000);
    // FFmpeg enables autorotation by default; omitting the legacy flag keeps compatibility
    // with system builds that parse it as an input option requiring a value.
    const threadArgs = options.threads === undefined ? [] : ["-threads", String(options.threads)];
    const args: string[] = ["-hide_banner", "-nostdin", "-y", ...encoderDeviceArgs(options.videoEncoder ?? "libx264"), ...threadArgs, "-i", media.sourcePath];
    let inputIndex = 1;
    let baseLabel = "base0";
    const graph: string[] = [];
    const dimensions = outputDimensions(media, preset);
    const sourceFilters = ["setpts=PTS-STARTPTS", outputScale(preset, dimensions), "format=yuv420p"].filter(Boolean).join(",");
    graph.push(`[0:v]${sourceFilters}[${baseLabel}]`);

    for (const layer of sortedVisibleLayers(template)) {
      if (layer.type === "sticker" && layer.activeRanges?.some(range => range.endMs > media.durationMs)) throw new Error("贴纸显示时段超出素材时长");
      if (layer.type === "text") {
        const fontPath = await options.fontResolver.resolve(layer.fontFamily);
        if (!fontPath) throw new Error(`font_missing:${layer.fontFamily}`);
        const lines = wrapText(layer.content, layer.width, layer.fontSizeRatio, dimensions).split("\n");
        for (const [index, content] of lines.entries()) {
          const textPath = options.textFilePath(index === 0 ? layer.id : `${layer.id}-line-${index + 1}`);
          textFiles.push({ layerId: layer.id, path: textPath, content });
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
            ...(layer.shadow ? [
              `shadowcolor=${color(layer.shadow.color, layer.opacity)}`,
              `shadowx=${Math.round(layer.shadow.xRatio * dimensions.height)}`,
              `shadowy=${Math.round(layer.shadow.yRatio * dimensions.height)}`,
            ] : []),
            ...(layer.backgroundColor ? [
              "box=1",
              `boxcolor=${color(layer.backgroundColor, layer.opacity)}`,
              `boxborderw=${Math.round((layer.backgroundPaddingRatio ?? 0.006) * dimensions.height)}`,
            ] : []),
            layer.textAlign === "center" ? `x=w*${(layer.x + layer.width / 2).toFixed(5)}-text_w/2` : `x=w*${layer.x.toFixed(5)}`,
            `y=h*${(layer.y + index * layer.fontSizeRatio * PRICE_LINE_HEIGHT).toFixed(5)}`,
            "fix_bounds=1",
          ].join(":");
          graph.push(`[${baseLabel}]${drawtext}[${nextLabel}]`);
          baseLabel = nextLabel;
        }
        continue;
      }

      // Bound looping inputs too: output -t alone can leave sticker decoding
      // running and buffering indefinitely when the main video reaches EOF.
      args.push(...threadArgs, "-t", durationSeconds.toFixed(3), "-stream_loop", "-1", "-i", layer.assetPath);
      const stickerIndex = inputIndex;
      inputIndex += 1;
      const sourceLabel = `sticker${stickerIndex}src`;
      const scaledLabel = `sticker${stickerIndex}`;
      const nextLabel = `base${graph.length}`;
      if (layer.cover) {
        const motion = layer.cover.motion;
        if (motion && (motion.endMs > media.durationMs || motion.keyframes.some((frame) => frame.timeMs > media.durationMs))) throw new Error("覆盖轨迹时间超出素材时长");
        const largest = motion?.keyframes.reduce((a, b) => a.rectangle.width >= b.rectangle.width ? a : b).rectangle;
        const opaque = layer.cover.opaqueBackground;
        const coverSize = (dimension: number, ratio: number) => opaque ? Math.min(dimension, 2 * Math.ceil(dimension * ratio / 2) + 2) : Math.max(1, Math.round(dimension * ratio));
        const coverWidth = coverSize(dimensions.width, largest?.width ?? layer.width);
        const coverHeight = coverSize(dimensions.height, largest?.height ?? layer.cover.height);
        const raster = opaque ? coverRasterExpressions(motion?.keyframes ?? [{ timeMs: 0, rectangle: { x: layer.x, y: layer.y, width: layer.width, height: layer.cover.height } }], dimensions.width, dimensions.height) : undefined;
        const artwork = opaque ? `${sourceLabel}art` : sourceLabel;
        const fit = opaque
          ? `scale=w='max(1,round(iw*min(${coverWidth}/iw,${coverHeight}/ih)))':h='max(1,round(ih*min(${coverWidth}/iw,${coverHeight}/ih)))',pad=${coverWidth}:${coverHeight}:(ow-iw)/2:(oh-ih)/2:color=white`
          : `crop=w='min(iw,ceil(ih*${coverWidth}/${coverHeight}))':h='min(ih,ceil(iw*${coverHeight}/${coverWidth}))':exact=1,scale=${coverWidth}:${coverHeight}:force_original_aspect_ratio=increase,crop=${coverWidth}:${coverHeight}`;
        graph.push(`[${stickerIndex}:v]format=rgba,${fit},setpts=PTS-STARTPTS[${artwork}]`);
        if (opaque) {
          graph.push(`[${artwork}]split[${artwork}foreground][${artwork}background]`);
          graph.push(`[${artwork}background]lutrgb=r=255:g=255:b=255:a=255[${artwork}white]`);
          graph.push(`[${artwork}white][${artwork}foreground]overlay=0:0:format=auto[${sourceLabel}]`);
        }
        if (motion) {
          const main = `coverMain${stickerIndex}`, clock = `coverClock${stickerIndex}`, blank = `coverBlank${stickerIndex}`, clocked = `coverClocked${stickerIndex}`;
          // Borrow the source timestamps instead of animating at the PNG input's 25 fps.
          graph.push(`[${baseLabel}]split[${main}][${clock}]`);
          graph.push(`[${clock}]format=rgba,crop=${coverWidth}:${coverHeight}:0:0:exact=1,colorchannelmixer=aa=0[${blank}]`);
          graph.push(`[${blank}][${sourceLabel}]overlay=0:0:format=auto[${clocked}]`);
          const width = coverMotionExpression(motion.keyframes, "width"), height = coverMotionExpression(motion.keyframes, "height");
          graph.push(`[${clocked}]scale=w='${raster?.width ?? `max(1,round(${dimensions.width}*(${width})))`}':h='${raster?.height ?? `max(1,round(${dimensions.height}*(${height})))`}':eval=frame[${scaledLabel}]`);
          const x = coverMotionExpression(motion.keyframes, "x"), y = coverMotionExpression(motion.keyframes, "y");
          graph.push(`[${main}][${scaledLabel}]overlay=x='${raster?.x ?? `main_w*(${x})`}':y='${raster?.y ?? `main_h*(${y})`}':enable='gte(t,${motion.startMs / 1000})*lt(t,${motion.endMs / 1000})':format=auto[${nextLabel}]`);
        } else {
          graph.push(`[${sourceLabel}]${raster ? `scale=w='${raster.width}':h='${raster.height}'` : "null"}[${scaledLabel}]`);
          const position = raster ? `x='${raster.x}':y='${raster.y}'` : `x=main_w*${layer.x.toFixed(5)}:y=main_h*${layer.y.toFixed(5)}`;
          graph.push(`[${baseLabel}][${scaledLabel}]overlay=${position}:format=auto[${nextLabel}]`);
        }
        baseLabel = nextLabel;
        continue;
      }
      const angle = (Math.PI * layer.rotationDeg / 180).toFixed(6);
      const governed = template.layoutPolicy === CORNER_SAFE_POLICY.id;
      const corner = nearestStickerCorner(layer);
      const stickerWidth = Math.max(1, Math.round(dimensions.width * layer.width));
      const stickerScale = governed
        ? `${stickerWidth}:${Math.max(1, Math.round(dimensions.height * CORNER_SAFE_POLICY.maxStickerHeight))}:force_original_aspect_ratio=decrease`
        : `${stickerWidth}:-1`;
      const radians = Math.PI * layer.rotationDeg / 180;
      // Keep twice the final rotated width for smooth edges, without enlarging small inputs.
      const resizeRatio = `min(1,${stickerWidth * 2}/(iw*${Math.abs(Math.cos(radians)).toFixed(6)}+ih*${Math.abs(Math.sin(radians)).toFixed(6)}))`;
      // Very thin inputs must not round a scaled dimension down to zero.
      const preScale = layer.rotationDeg === 0 ? "" :
        `scale=w='if(lt(min(iw,ih)*${resizeRatio},2),iw,ceil(iw*${resizeRatio}))':h=-1,`;
      graph.push(
        `[${stickerIndex}:v]${preScale}format=rgba,` +
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
      const enabled = layer.activeRanges ? `:enable='${layer.activeRanges.map(range => `gte(t,${range.startMs / 1000})*lt(t,${range.endMs / 1000})`).join("+")}'` : "";
      graph.push(`[${baseLabel}][${scaledLabel}]overlay=x=${overlayX}:y=${overlayY}${enabled}:format=auto[${nextLabel}]`);
      baseLabel = nextLabel;
    }

    const filter = filterExpression(template.filter);
    if (filter) {
      const nextLabel = `filtered${graph.length}`;
      graph.push(`[${baseLabel}]${filter}[${nextLabel}]`);
      baseLabel = nextLabel;
    }
    graph.push(`[${baseLabel}]null[vout]`);

    const scriptedCover = template.layers.some((layer) => layer.type === "sticker" && (layer.activeRanges || layer.cover?.automatic || layer.cover?.opaqueBackground));
    const graphPath = scriptedCover ? options.textFilePath("cover-graph") : undefined;
    if (graphPath) textFiles.push({ layerId: "cover-graph", path: graphPath, content: graph.join(";") });

    args.push(
      ...(options.threads === undefined ? [] : ["-filter_complex_threads", String(options.threads)]),
      ...(graphPath ? ["-filter_complex_script", graphPath] : ["-filter_complex", graph.join(";")]),
      "-map", "[vout]",
      "-map", "0:a?",
      "-t", durationSeconds.toFixed(3),
      ...videoEncodingArgs(options.videoEncoder ?? "libx264", preset.quality),
      ...threadArgs,
      "-pix_fmt", encoderPixelFormat(options.videoEncoder ?? "libx264"),
      "-c:a", "aac",
      "-b:a", preset.quality === "high" ? "256k" : preset.quality === "small" ? "128k" : "192k",
      "-ar", "44100",
      ...(preset.frameRateMode === "30" ? ["-r", "30"] : []),
      ...(preset.container === "mkv" ? [] : ["-movflags", "+faststart"]),
      "-f", preset.container === "mkv" ? "matroska" : preset.container,
      "-progress", "pipe:1",
      "-nostats",
    );

    return { binary: options.ffmpegPath, args, textFiles, durationSeconds };
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
