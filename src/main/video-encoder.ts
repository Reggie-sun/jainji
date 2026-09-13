import type { ExportPreset } from "./domain.js";

export type H264Encoder = "libx264" | "h264_nvenc";

export function videoEncodingArgs(encoder: H264Encoder, quality: ExportPreset["quality"]): string[] {
  const qualityValue = quality === "high" ? "18" : quality === "small" ? "28" : "23";
  if (encoder === "h264_nvenc") {
    return ["-c:v", encoder, "-preset", quality === "high" ? "p6" : "p4", "-tune", "hq", "-rc", "vbr", "-cq", qualityValue, "-b:v", "0"];
  }
  return ["-c:v", encoder, "-preset", quality === "high" ? "slow" : "medium", "-crf", qualityValue];
}

/** Compiled-in hardware support is not proof that a usable device/driver exists. */
export async function selectH264Encoder(encoders: string, tryEncode: (args: string[]) => Promise<boolean>): Promise<H264Encoder | undefined> {
  if (/\bh264_nvenc\b/.test(encoders)) {
    try {
      const usable = await tryEncode([
        "-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=size=640x360:rate=30",
        "-frames:v", "2", ...videoEncodingArgs("h264_nvenc", "balanced"), "-pix_fmt", "yuv420p", "-f", "null", "-",
      ]);
      if (usable) return "h264_nvenc";
    } catch { /* Startup admission can use the software route if it is available. */ }
  }
  return /\blibx264\b/.test(encoders) ? "libx264" : undefined;
}
