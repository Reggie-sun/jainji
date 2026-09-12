import { availableParallelism } from "node:os";

export function executionLimits(cpuCount = availableParallelism()) {
  const cores = Math.max(1, Math.floor(cpuCount));
  const exports = Math.min(20, cores);
  return {
    exports,
    analysis: Math.min(8, cores),
    threads: cores,
  };
}
