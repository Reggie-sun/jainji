import type { ExportPreset } from "./domain.js";

export type H264Encoder = "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv";
/**
 * Three-state classification of the H.264 encoder the bundled FFmpeg actually
 * serves at startup:
 *   - hardware:          a hardware encoder was selected.
 *   - software-fallback: ffmpeg lists a hardware encoder, but the runtime probe
 *                        failed (typical: GPU memory stolen by another process).
 *   - software-only:     ffmpeg has no hardware encoder compiled in (typical:
 *                        no-GPU box or a third-party FFmpeg that omitted NVENC).
 *
 * "software-fallback" and "software-only" both end up running libx264, but the
 * distinction matters for the renderer: fallback means the user can free the
 * GPU and get hardware back; only means there is no hardware to free.
 */
export type H264Capability =
  | { kind: "hardware"; encoder: "h264_nvenc" | "h264_amf" | "h264_qsv" }
  | { kind: "software-fallback" }
  | { kind: "software-only" };

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

/**
 * Wraps {@link selectH264Encoder} and classifies the result into one of the
 * three {@link H264Capability} states. The renderer surfaces this directly to
 * distinguish "GPU stolen by another process" (software-fallback) from
 * "no GPU in this machine" (software-only).
 *
 * Returns `undefined` only when neither HW nor libx264 can be claimed — e.g.
 * a third-party FFmpeg that was stripped of both. The capability table treats
 * this as "no H.264 path" and locks exports; the renderer is not asked to
 * label it CPU/GPU since neither actually works.
 */
export async function selectH264Capability(encoders: string, tryEncode: (args: string[]) => Promise<boolean>): Promise<H264Capability | undefined> {
  const pick = await selectH264Encoder(encoders, tryEncode);
  if (pick && pick !== "libx264") return { kind: "hardware", encoder: pick };
  // pick is undefined or "libx264". We need libx264 to actually run anything
  // on the CPU side; if it's not compiled in, there is no H.264 path left.
  const hasAnyHardware = hardwareEncoders.some((e) => new RegExp(`\\b${e}\\b`).test(encoders));
  const hasLibx264 = /\blibx264\b/.test(encoders);
  if (!hasLibx264) return undefined;
  if (hasAnyHardware) return { kind: "software-fallback" };
  return { kind: "software-only" };
}
