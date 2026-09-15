import { expect, it } from "vitest";
import { parseGpuFreeMemory, estimateNvencMemoryMiB } from "../src/main/gpu-memory";

it("uses the least free device because NVENC selects its device automatically", () => {
  expect(parseGpuFreeMemory("16000\n628\n")).toBe(628);
  for (const value of ["", "N/A", "-1", "300\n[Not Supported]"]) expect(parseGpuFreeMemory(value)).toBeUndefined();
});

it("reserves context and encoder surfaces, increasing with output resolution", () => {
  expect(estimateNvencMemoryMiB(1280, 720)).toBeGreaterThanOrEqual(768);
  expect(estimateNvencMemoryMiB(3840, 2160)).toBeGreaterThan(estimateNvencMemoryMiB(1280, 720));
});
