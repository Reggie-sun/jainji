import { afterEach, expect, it, vi } from "vitest";
import type { CommandResult, ProgressEvent, RunningCommand } from "../src/main/ffmpeg";
import { probeConcurrentEncodes } from "../src/main/hardware-probe";

const args = ["-f", "lavfi", "-i", "color=size=640x360:rate=30", "-frames:v", "2", "-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-f", "null", "-"];
afterEach(() => vi.useRealTimers());

function fixture() {
  const sessions: { progress: (event: ProgressEvent) => void; exit: (code: number) => void; kill: ReturnType<typeof vi.fn> }[] = [];
  const start = vi.fn((_args: string[], progress: (event: ProgressEvent) => void): RunningCommand => {
    let resolve!: (result: CommandResult) => void;
    const promise = new Promise<CommandResult>((done) => { resolve = done; });
    const process = { exitCode: null as number | null, kill: vi.fn(() => exit(-9)) };
    const exit = (code: number) => { process.exitCode = code; resolve({ code, stdout: "", stderr: "" }); };
    sessions.push({ progress, exit, kill: process.kill });
    return { process, promise, cancel: async () => exit(-9) } as unknown as RunningCommand;
  });
  return { start, sessions };
}

it("requires live overlapping encoders and then stops every probe", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = probeConcurrentEncodes(args, 3, f.start);
  for (const session of f.sessions) session.progress({ progress: 100000, outTimeMs: 100000 });
  await vi.advanceTimersByTimeAsync(201);
  expect(await result).toBe(true);
  expect(f.sessions.every((session) => session.kill.mock.calls.length === 1)).toBe(true);
  expect(f.start.mock.calls[0][0]).not.toContain("-frames:v");
  expect(f.start.mock.calls[0][0]).toContain("-progress");
});

it("rejects successful encodes that finish before the other sessions are ready", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = probeConcurrentEncodes(args, 2, f.start);
  f.sessions[0].progress({ progress: 100000, outTimeMs: 100000 });
  f.sessions[0].exit(0);
  f.sessions[1].progress({ progress: 100000, outTimeMs: 100000 });
  expect(await result).toBe(false);
  expect(f.sessions[1].kill).toHaveBeenCalledOnce();
});

it("times out and cleans up sessions that never produce frames", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = probeConcurrentEncodes(args, 2, f.start, 500);
  await vi.advanceTimersByTimeAsync(501);
  expect(await result).toBe(false);
  expect(f.sessions.every((session) => session.kill.mock.calls.length === 1)).toBe(true);
});

it("cleans up already launched sessions if a later launch throws", async () => {
  const f = fixture();
  const start = vi.fn(f.start).mockImplementationOnce(f.start).mockImplementationOnce(() => { throw new Error("spawn failed"); });
  await expect(probeConcurrentEncodes(args, 2, start)).rejects.toThrow("spawn failed");
  expect(f.sessions[0].kill).toHaveBeenCalledOnce();
});

it("probes CPU lanes using moving 720p input and their actual thread allocation", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const softwareArgs = args.map((arg) => arg === "h264_nvenc" ? "libx264" : arg);
  const result = probeConcurrentEncodes(softwareArgs, 3, f.start, 5_000, 4);
  const probeArgs = f.start.mock.calls[0][0];
  expect(probeArgs[probeArgs.indexOf("-i") + 1]).toBe("testsrc2=size=1280x720:rate=30");
  expect(probeArgs.flatMap((arg, i) => arg === "-threads" ? [probeArgs[i + 1]] : [])).toEqual(["4", "4"]);
  expect(probeArgs[probeArgs.indexOf("-filter_threads") + 1]).toBe("4");
  for (const session of f.sessions) session.progress({ progress: 100000, outTimeMs: 100000 });
  await vi.advanceTimersByTimeAsync(201);
  expect(await result).toBe(true);
});
