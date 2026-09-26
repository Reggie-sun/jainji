import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkCapabilities } from "../src/main/ffmpeg";
import { probeConcurrentEncodes } from "../src/main/hardware-probe";

const machine = vi.hoisted(() => ({ cores: 12, free: 10 * 1024 ** 3, encoders: "libx264", hardwareWorks: false, cpuSlots: 3, gpuSlots: 4 }));
vi.mock("node:os", async (original) => ({
  ...await original<typeof import("node:os")>(),
  availableParallelism: () => machine.cores,
  totalmem: () => 16 * 1024 ** 3,
  freemem: () => machine.free,
}));
vi.mock("../src/main/hardware-probe", () => ({ probeConcurrentEncodes: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawn: (_binary: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    queueMicrotask(() => {
      const stdout = args.includes("-encoders") ? `${machine.encoders} aac` : args.includes("-filters") ? "drawtext overlay" : "ffmpeg version fixture";
      child.stdout.emit("data", Buffer.from(stdout));
      child.emit("close", args.includes("-c:v") && !machine.hardwareWorks ? 1 : 0);
    });
    return child;
  },
}));

const directories: string[] = [];
beforeEach(() => {
  Object.assign(machine, { cores: 12, free: 10 * 1024 ** 3, encoders: "libx264", hardwareWorks: false, cpuSlots: 3, gpuSlots: 4 });
  vi.mocked(probeConcurrentEncodes).mockImplementation(async (args, count) => count <= (args.includes("libx264") ? machine.cpuSlots : machine.gpuSlots));
});
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function capabilities() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-auto-encoder-"));
  directories.push(directory);
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const binary = path.join(bin, `${name}.exe`);
    await writeFile(binary, "fixture", { mode: 0o700 });
    vi.stubEnv(name === "ffmpeg" ? "JIANJI_FFMPEG_PATH" : "JIANJI_FFPROBE_PATH", binary);
  }
  return (await checkCapabilities(directory, async () => "/fixture/font.ttf")).status;
}

it("admits multiple CPU lanes and probes with the same thread share as the queue", async () => {
  const status = await capabilities();
  expect(status.ready).toBe(true);
  expect(status.videoEncoder).toEqual({ kind: "software-only" });
  expect(status.executionLimits).toEqual({ exports: 3, analysis: 8, threads: 12 });
  expect(vi.mocked(probeConcurrentEncodes).mock.calls.map((call) => [call[1], call[4]])).toEqual([[3, 4]]);
});

it("reduces CPU lanes after a failed concurrent probe and redistributes threads", async () => {
  machine.encoders = "h264_nvenc libx264";
  machine.cpuSlots = 2;
  const status = await capabilities();
  expect(status.videoEncoder).toEqual({ kind: "software-fallback" });
  expect(status.executionLimits?.exports).toBe(2);
  expect(vi.mocked(probeConcurrentEncodes).mock.calls.map((call) => [call[1], call[4]])).toEqual([[3, 4], [2, 6]]);
});

it("limits CPU lanes for a smaller machine and for low available memory", async () => {
  machine.cores = 8;
  expect((await capabilities()).executionLimits?.exports).toBe(2);
  machine.free = 500 * 1024 ** 2;
  expect((await capabilities()).executionLimits?.exports).toBe(1);
});

it.each(["h264_nvenc", "h264_amf", "h264_qsv"])("automatically selects a working %s encoder and validates its sessions", async (encoder) => {
  machine.encoders = `${encoder} libx264`;
  machine.hardwareWorks = true;
  machine.gpuSlots = 2;
  const status = await capabilities();
  expect(status.ready).toBe(true);
  expect(status.videoEncoder).toEqual({ kind: "hardware", encoder });
  expect(status.executionLimits?.exports).toBe(2);
  expect(vi.mocked(probeConcurrentEncodes).mock.calls.map((call) => call[1])).toEqual([4, 3, 2]);
});

it("locks exports when even one CPU lane fails its live probe", async () => {
  machine.cpuSlots = 0;
  const status = await capabilities();
  expect(status.ready).toBe(false);
  expect(status.h264Encoder).toBe(false);
  expect(status.videoEncoder).toBeUndefined();
  expect(status.executionLimits?.exports).toBe(0);
});
