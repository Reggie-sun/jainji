import { execFile } from "node:child_process";

export const GPU_MEMORY_RESERVE_MIB = 512;

export function parseGpuFreeMemory(output: string): number | undefined {
  const lines = output.trim().split(/\r?\n/);
  if (lines.some((line) => !/^\d+(\.\d+)?$/.test(line.trim()))) return undefined;
  const values = lines.map(Number);
  return values.every(Number.isFinite) ? Math.min(...values) : undefined;
}

/** Conservative when NVENC chooses among multiple devices. Never sum VRAM. */
export function readGpuFreeMemory(): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"],
      { timeout: 1500, maxBuffer: 16_384, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : parseGpuFreeMemory(stdout)));
  });
}

export function estimateNvencMemoryMiB(width: number, height: number): number {
  // Context plus encoder surfaces. This is headroom, not an allocation guarantee.
  return Math.max(768, Math.ceil(512 + width * height * 128 / 1024 ** 2));
}
