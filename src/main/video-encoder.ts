import type { ExportPreset } from "./domain.js";

export type H264Encoder = "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv";

const hardwareEncoders = ["h264_nvenc", "h264_amf", "h264_qsv"] as const;

export function encoderPixelFormat(encoder: H264Encoder): "yuv420p" | "nv12" {
  return encoder === "h264_amf" || encoder === "h264_qsv" ? "nv12" : "yuv420p";
}

export function encoderDeviceArgs(encoder: H264Encoder): string[] {
  return encoder === "h264_qsv" ? ["-init_hw_device", "qsv:hw"] : [];
}

export function videoEncodingArgs(encoder: H264Encoder, quality: ExportPreset["quality"]): string[] {
  const qualityValue = quality === "high" ? "18" : quality === "small" ? "28" : "23";
  if (encoder === "h264_nvenc") {
    return ["-c:v", encoder, "-preset", quality === "high" ? "p6" : "p4", "-tune", "hq", "-rc", "vbr", "-cq", qualityValue, "-b:v", "0"];
  }
  if (encoder === "h264_amf") {
    return ["-c:v", encoder, "-quality", quality === "high" ? "quality" : quality === "small" ? "speed" : "balanced", "-rc", "cqp", "-qp_i", qualityValue, "-qp_p", qualityValue, "-qp_b", qualityValue];
  }
  if (encoder === "h264_qsv") {
    return ["-c:v", encoder, "-preset", quality === "high" ? "slow" : quality === "small" ? "fast" : "medium", "-global_quality", qualityValue];
  }
  return ["-c:v", encoder, "-preset", quality === "high" ? "slow" : "medium", "-crf", qualityValue];
}

/** Compiled-in hardware support is not proof that a usable device/driver exists. */
export async function selectH264Encoder(encoders: string, tryEncode: (args: string[]) => Promise<boolean>): Promise<H264Encoder | undefined> {
  for (const encoder of hardwareEncoders) {
    if (!new RegExp(`\\b${encoder}\\b`).test(encoders)) continue;
    try {
      const usable = await tryEncode([
        ...encoderDeviceArgs(encoder),
        "-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=size=640x360:rate=30",
        "-frames:v", "2", ...videoEncodingArgs(encoder, "balanced"), "-pix_fmt", encoderPixelFormat(encoder), "-f", "null", "-",
      ]);
      if (usable) return encoder;
    } catch { /* Startup admission can use the software route if it is available. */ }
  }
  return /\blibx264\b/.test(encoders) ? "libx264" : undefined;
}
