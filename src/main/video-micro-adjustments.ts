import type { VideoMicroAdjustments } from "../shared/video-micro-adjustments.js";

type FrozenVisualSettings = Pick<VideoMicroAdjustments, "contrast" | "saturation" | "brightness" | "gamma"> & Partial<VideoMicroAdjustments>;

/** One frozen visual chain for ordinary production and fission, before artwork overlays. */
export function videoMicroAdjustmentFilters(settings: FrozenVisualSettings): string {
  const filters = [`eq=contrast=${settings.contrast}:saturation=${settings.saturation}:brightness=${settings.brightness}:gamma=${settings.gamma}`];
  const curveEnabled = [settings.blacks, settings.shadows, settings.highlights, settings.whites].some(value => value !== undefined);
  const rgbEnabled = curveEnabled || [settings.exposureStops, settings.temperatureKelvin, settings.tint, settings.vibrance].some(value => value !== undefined);
  // Preserve chroma blocks during the RGB round trip instead of introducing edge bleed.
  if (rgbEnabled) filters.push("scale=iw:ih:flags=neighbor+accurate_rnd,format=gbrpf32le");
  if (settings.exposureStops !== undefined) filters.push(`exposure=exposure=${settings.exposureStops}`);
  if (settings.temperatureKelvin !== undefined) filters.push(`colortemperature=temperature=${settings.temperatureKelvin}:mix=0.2:pl=1`);
  if (settings.tint !== undefined || settings.vibrance !== undefined || curveEnabled) filters.push("format=gbrp16le");
  if (settings.tint !== undefined) filters.push(`colorbalance=gm=${settings.tint}:pl=0`);
  if (settings.vibrance !== undefined) filters.push(`vibrance=intensity=${settings.vibrance}`);
  if (curveEnabled) {
    const black = settings.blacks ?? 0, white = settings.whites ?? 0;
    const number = (value: number) => Number(value.toFixed(6));
    const points = [[Math.max(0, -black), Math.max(0, black)], [0.25, 0.25 + (settings.shadows ?? 0)],
      [0.5, 0.5], [0.75, 0.75 + (settings.highlights ?? 0)], [Math.min(1, 1 - white), Math.min(1, 1 + white)]];
    filters.push(`curves=master='${points.map(([x, y]) => `${number(x)}/${number(y)}`).join(" ")}'`);
  }
  if (rgbEnabled) filters.push("scale=iw:ih:flags=area+accurate_rnd,format=yuv420p");
  if (settings.hueDegrees !== undefined) filters.push(`hue=h=${settings.hueDegrees}`);
  if (settings.sharpness !== undefined) filters.push(`format=yuv420p,unsharp=3:3:${settings.sharpness}:3:3:0`);
  if (settings.grainStrength !== undefined && settings.grainStrength > 0) {
    if (settings.grainSeed === undefined) throw new Error("颗粒参数缺少冻结种子。");
    filters.push(`noise=c0s=${settings.grainStrength * 4}:c0_seed=${settings.grainSeed}:c0f=t+u+a`);
  }
  if (settings.vignetteAngle !== undefined) filters.push(`vignette=angle=${settings.vignetteAngle}:dither=0`);
  if (rgbEnabled || [settings.hueDegrees, settings.sharpness, settings.grainStrength, settings.vignetteAngle].some(value => value !== undefined)) {
    // Both branches already share frozen geometry/timing; rounding avoids plane-wide bias.
    return `split[microOriginal][microAdjustment];[microAdjustment]${filters.join(",")}[microAdjusted];[microOriginal][microAdjusted]blend=all_expr='round(A*0.75+B*0.25)'`;
  }
  return filters.join(",");
}
