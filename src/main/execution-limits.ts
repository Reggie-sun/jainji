import { availableParallelism } from "node:os";
import type { H264Encoder } from "./video-encoder.js";

export function executionLimits(cpuCount = availableParallelism(), videoEncoder: H264Encoder = "libx264") {
  const cores = Math.max(1, Math.floor(cpuCount));
  const exports = videoEncoder === "h264_nvenc" ? Math.min(6, cores) : 1;
  return {
    exports,
    analysis: Math.min(8, cores),
    threads: cores,
  };
}
