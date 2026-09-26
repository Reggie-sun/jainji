import { availableParallelism, freemem, totalmem } from "node:os";
import type { H264Encoder } from "./video-encoder.js";

export interface MemoryCapacity {
  totalBytes: number;
  availableBytes: number;
}

export function executionLimits(cpuCount = availableParallelism(), videoEncoder: H264Encoder = "libx264", memory: MemoryCapacity = { totalBytes: totalmem(), availableBytes: freemem() }) {
  const cores = Math.max(1, Math.floor(cpuCount));
  const gib = 1024 ** 3;
  // Keep room for the desktop and planning, and never budget more than half of RAM.
  const memoryBudget = Math.max(0, Math.min(memory.totalBytes / 2, memory.availableBytes - Math.max(2 * gib, memory.totalBytes * 0.15)));
  const memorySlots = Math.max(1, Math.floor(memoryBudget / gib));
  const coresPerExport = videoEncoder === "libx264" ? 4 : 3;
  const exports = Math.min(6, Math.max(1, Math.floor(cores / coresPerExport)), memorySlots);
  return {
    exports,
    analysis: Math.min(8, cores),
    threads: cores,
  };
}

export type ExecutionLimits = ReturnType<typeof executionLimits>;

/** Reserve an equal CPU share so progressively arriving jobs can fill all slots. */
export function exportThreads(limits: Pick<ExecutionLimits, "exports" | "threads">): number {
  return Math.max(1, Math.min(8, Math.floor(limits.threads / Math.max(1, limits.exports))));
}

/** Test actual simultaneous sessions: a working single encoder is not a capacity check. */
export async function verifiedExportCount(maximum: number, probe: (count: number) => Promise<boolean>): Promise<number> {
  for (let count = maximum; count >= 1; count--) {
    try { if (await probe(count)) return count; } catch { /* Try a smaller startup allocation. */ }
  }
  return 0;
}
