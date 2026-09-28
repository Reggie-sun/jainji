import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as processes from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FULL_CENSUS_LIMITS, parseFullDecodeClock } from "../src/main/source-fact-census-clock";
import { collectFullSourceCensus } from "../src/main/source-fact-census";
import { identifySource } from "../src/main/source-sticker-knowledge-store";
import * as knowledge from "../src/main/source-sticker-knowledge-store";
import * as paths from "../src/main/paths";
import type { SourceIdentity } from "../src/shared/source-sticker-knowledge";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const source: SourceIdentity = { fingerprint: `sha256:${sha("source")}`, byteLength: 100, width: 16, height: 16, rotation: 0, durationMs: 1000, timeBase: "1/1000", timeOriginPts: 10, interpretationVersion: 1 };
function probe() {
  return { streams: [{ index: 0, codec_name: "h264", width: 16, height: 16, pix_fmt: "yuv420p", sample_aspect_ratio: "1:1", field_order: "progressive", time_base: "1/1000", start_pts: 10, duration_ts: 1000 }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    packets: [{ pts: 10, duration: 200 }, { pts: 210, duration: 500 }, { pts: 710, duration: 300 }].map((packet, index) => ({ ...packet, stream_index: 0, dts: packet.pts, pos: 100 + index, size: 10 })),
    frames: [{ pts: 10, duration: 200 }, { pts: 210, duration: 500 }, { pts: 710, duration: 300 }].map((frame, index) => ({ ...frame, pkt_pos: 100 + index, pkt_size: 10, stream_index: 0, best_effort_timestamp: frame.pts,
      width: 16, height: 16, pix_fmt: "yuv420p", sample_aspect_ratio: "1:1", interlaced_frame: 0, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0 })) };
}

describe("production full-decode clock", () => {
  it("keeps original VFR PTS and explicit durations without nominal FPS", () => {
    expect(parseFullDecodeClock(probe(), source).frames).toEqual([{ index: 0, pts: 10, endPts: 210 }, { index: 1, pts: 210, endPts: 710 }, { index: 2, pts: 710, endPts: 1010 }]);
  });

  it.each(["first", "middle", "last", "pts", "guess-pts", "gap", "overlap", "tail-duration", "duration-conflict", "stream-tail", "timebase", "origin", "resize", "crop", "sar", "interlace", "hdr", "pixfmt", "side-data", "nan", "overflow", "empty", "multi-stream"])("fails closed for %s without filtering any frame", kind => {
    const value = probe();
    if (kind === "first") value.frames.shift();
    if (kind === "middle") value.frames.splice(1, 1);
    if (kind === "last") value.frames.pop();
    if (kind === "pts") Object.assign(value.frames[1], { pts: undefined });
    if (kind === "guess-pts") value.frames[1].best_effort_timestamp++;
    if (kind === "gap") value.frames[1].pts++; if (kind === "gap") value.frames[1].best_effort_timestamp++;
    if (kind === "overlap") value.frames[1].duration++;
    if (kind === "tail-duration") Object.assign(value.frames[2], { duration: undefined });
    if (kind === "duration-conflict") Object.assign(value.frames[2], { pkt_duration: 301 });
    if (kind === "stream-tail") value.streams[0].duration_ts++;
    if (kind === "timebase") value.streams[0].time_base = "1/30";
    if (kind === "origin") value.streams[0].start_pts++;
    if (kind === "resize") value.frames[1].width++;
    if (kind === "crop") value.frames[1].crop_left = 1;
    if (kind === "sar") value.frames[1].sample_aspect_ratio = "2:1";
    if (kind === "interlace") value.frames[1].interlaced_frame = 1;
    if (kind === "hdr") Object.assign(value.frames[1], { color_transfer: "smpte2084" });
    if (kind === "pixfmt") value.frames[1].pix_fmt = "yuv420p10le";
    if (kind === "side-data") Object.assign(value.frames[1], { side_data_list: [{ side_data_type: "Display Matrix", rotation: 90 }] });
    if (kind === "nan") Object.assign(value.frames[1], { pts: "NaN" });
    if (kind === "overflow") value.frames[2].duration = Number.MAX_SAFE_INTEGER;
    if (kind === "empty") value.frames = [];
    if (kind === "multi-stream") value.streams.push(value.streams[0]);
    expect(() => parseFullDecodeClock(value, source)).toThrow(/^UNSAFE:/);
  });

  it.each([{ rotation: 90 as const }, { interpretationVersion: 2 }, { width: 8192, height: 8192 }, { timeBase: "0/0" }])("rejects unsupported source interpretation %j", patch => {
    expect(() => parseFullDecodeClock(probe(), { ...source, ...patch })).toThrow(/^UNSAFE:/);
  });

  it("accepts explicitly numeric-string timestamps and old explicit packet duration only", () => {
    const value = probe();
    for (const frame of value.frames) Object.assign(frame, { pts: String(frame.pts), best_effort_timestamp: String(frame.best_effort_timestamp), pkt_duration: String(frame.duration), duration: undefined });
    expect(parseFullDecodeClock(value, source).frames.at(-1)?.endPts).toBe(1010);
  });

  it.each(["missing-pts", "missing-duration", "duration-drift", "position", "size", "duplicate", "omitted", "extra", "container", "codec"])("rejects unproved original packet binding: %s", kind => {
    const value = probe();
    if (kind === "missing-pts") Object.assign(value.packets[1], { pts: undefined });
    if (kind === "missing-duration") Object.assign(value.packets[1], { duration: undefined });
    if (kind === "duration-drift") value.packets[1].duration++;
    if (kind === "position") value.frames[1].pkt_pos++;
    if (kind === "size") value.frames[1].pkt_size++;
    if (kind === "duplicate") value.packets[1] = value.packets[0];
    if (kind === "omitted") value.packets.pop();
    if (kind === "extra") value.packets.push(value.packets[0]);
    if (kind === "container") value.format.format_name = "matroska,webm";
    if (kind === "codec") value.streams[0].codec_name = "hevc";
    expect(() => parseFullDecodeClock(value, source)).toThrow(/^UNSAFE:/);
  });

  it("rejects excessive frame/decoded-byte counts and duration metadata drift", () => {
    const value = probe(); value.frames = Array(FULL_CENSUS_LIMITS.frames + 1).fill(value.frames[0]);
    expect(() => parseFullDecodeClock(value, source)).toThrow(/^UNSAFE:/);
    const large = probe(); const count = 8193;
    large.streams[0] = { ...large.streams[0], width: 4096, height: 4096, duration_ts: count };
    large.frames = Array.from({ length: count }, (_, index) => ({ ...large.frames[0], width: 4096, height: 4096, pts: 10 + index,
      best_effort_timestamp: 10 + index, duration: 1, pkt_pos: 100 + index }));
    large.packets = large.frames.map(frame => ({ pts: frame.pts, dts: frame.pts, duration: 1, stream_index: 0, pos: frame.pkt_pos, size: 10 }));
    expect(() => parseFullDecodeClock(large, { ...source, width: 4096, height: 4096, durationMs: count })).toThrow(/decoded byte budget/);
    expect(() => parseFullDecodeClock(probe(), { ...source, durationMs: 500 })).toThrow(/source duration/);
  });
});

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(processes.spawn).mockReset().mockImplementation(spawnOriginal); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const engines = () => ({ ffmpegPath: process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.JIANJI_FFPROBE_PATH ?? "ffprobe" });
function run(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  expect(result.error, result.stderr?.toString()).toBeUndefined(); expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}
async function fixture(vfr = false, bframes = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-census-")); directories.push(directory);
  const file = path.join(directory, "source.mp4"); const ffmpeg = engines();
  const filter = "drawbox=x=6:y=6:w=4:h=4:color=white:t=fill:enable='eq(n,2)'" + (vfr ? ",select='eq(n,0)+eq(n,2)+eq(n,5)'" : "");
  run(ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=6:d=1", "-vf", filter,
    "-fps_mode", "vfr", "-c:v", "libx264", "-crf", bframes ? "18" : "0", "-bf", bframes ? "2" : "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "6000", file]);
  const output = JSON.parse(run(ffmpeg.ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-of", "json", file]).toString());
  const stream = output.streams[0];
  const identity = await identifySource(file, { width: 16, height: 16, rotation: 0, durationMs: Math.round(Number(stream.duration) * 1000),
    timeBase: stream.time_base, timeOriginPts: output.frames[0].pts, interpretationVersion: 1 });
  return { directory, sourcePath: file, source: identity, ffmpeg, signal: new AbortController().signal };
}

describe("production census with real CPU FFmpeg", () => {
  it.each([false, true])("hashes every original full-canvas frame with exact clock; VFR=%s", async vfr => {
    const input = await fixture(vfr); const census = await collectFullSourceCensus(input);
    const raw = run(input.ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-noautorotate", "-i", input.sourcePath, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]);
    const size = 16 * 16 * 4; expect(raw.length).toBe(census.frames.length * size);
    expect(census.frames).toHaveLength(vfr ? 3 : 6);
    for (const frame of census.frames) expect(frame).toMatchObject({ byteLength: size, pixelSha256: sha(raw.subarray(frame.index * size, (frame.index + 1) * size)) });
    expect(new Set(census.frames.map(frame => frame.pixelSha256)).size).toBe(2);
    expect(census).toMatchObject({ authority: "none", semanticReview: "NOT_EVALUATED", eligible: false, source: input.source });
    expect(census.frames[0].pts).toBe(input.source.timeOriginPts);
    expect(census.frames.at(-1)?.endPts).toBe(census.horizon.endPts);
    expect(census.censusDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await collectFullSourceCensus(input)).censusDigest).toBe(census.censusDigest);
    expect(Object.isFrozen(census) && Object.isFrozen(census.frames) && Object.isFrozen(census.frames[0]) && Object.isFrozen(census.source)).toBe(true);
    if (vfr) expect(census.frames.map(frame => frame.endPts - frame.pts)).toEqual([2000, 3000, 1000]);
  }, 30000);

  it("rejects initial source byte drift, unsupported interpretation and missing engines", async () => {
    const input = await fixture();
    await expect(collectFullSourceCensus({ ...input, source: { ...input.source, fingerprint: `sha256:${sha("other")}` } })).rejects.toThrow(/^UNSAFE:/);
    await expect(collectFullSourceCensus({ ...input, source: { ...input.source, rotation: 90 } })).rejects.toThrow(/^UNSAFE:/);
    await expect(collectFullSourceCensus({ ...input, ffmpeg: { ...input.ffmpeg, ffprobePath: path.join(input.directory, "missing") } })).rejects.toThrow(/^UNSAFE:/);
    await expect(collectFullSourceCensus({ ...input, source: { ...input.source, byteLength: FULL_CENSUS_LIMITS.sourceBytes + 1 } })).rejects.toThrow(/byte budget/);
    await expect(collectFullSourceCensus({ ...input, ffmpeg: { ...input.ffmpeg, ffprobePath: input.directory } })).rejects.toThrow(/regular file/);
  });

  it("binds B-frame decode order by original packet identity rather than packet enumeration order", async () => {
    const input = await fixture(false, true);
    const packets = JSON.parse(run(input.ffmpeg.ffprobePath, ["-v", "error", "-fflags", "+nofillin", "-select_streams", "v:0", "-show_packets", "-of", "json", input.sourcePath]).toString()).packets as { pts: number; dts: number }[];
    expect(packets.some((packet, index) => index > 0 && packet.pts < packets[index - 1].pts)).toBe(true);
    const census = await collectFullSourceCensus(input);
    expect(census.frames.map(frame => frame.pts)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    const raw = run(input.ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-i", input.sourcePath, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]);
    census.frames.forEach(frame => expect(frame.pixelSha256).toBe(sha(raw.subarray(frame.index * 1024, (frame.index + 1) * 1024))));
  });

  it("rejects pre-cancellation without touching a source or spawning an engine", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(collectFullSourceCensus({ sourcePath: "missing", source, ffmpeg: engines(), signal: controller.signal })).rejects.toThrow(/^UNSAFE:/);
  });

  it("rejects corrupted media instead of returning a partial census", async () => {
    const input = await fixture(); await writeFile(input.sourcePath, Buffer.from("not video"));
    const original = await readFile(input.sourcePath);
    input.source = { ...input.source, fingerprint: `sha256:${sha(original)}`, byteLength: original.length };
    await expect(collectFullSourceCensus(input)).rejects.toThrow(/^UNSAFE:/);
  });

  it.each([false, true])("revalidates source after decode, even when original bytes are restored: %s", async restore => {
    const input = await fixture(); const bytes = await readFile(input.sourcePath);
    let checks = 0;
    vi.spyOn(knowledge, "identifySource").mockImplementation(async (file, interpretation, options) => {
      checks++;
      if (checks === 2) { await writeFile(file, Buffer.from("changed")); if (restore) await writeFile(file, bytes); }
      return identifySourceOriginal(file, interpretation, options);
    });
    await expect(collectFullSourceCensus(input)).rejects.toThrow(restore ? /source generation changed/ : /source identity changed/);
    expect(checks).toBe(2);
  });

  it("rejects a changed engine fingerprint after streaming completes", async () => {
    const input = await fixture(); let checks = 0;
    vi.spyOn(paths, "fingerprintFile").mockImplementation(async (file, options) => {
      if (file !== input.sourcePath && ++checks === 3) return `sha256:${sha("changed engine")}`;
      return fingerprintFileOriginal(file, options);
    });
    await expect(collectFullSourceCensus(input)).rejects.toThrow(/engine bytes changed/);
  });

  it.each(["short", "extra", "partial", "stderr", "exit", "probe-quota", "cancel", "probe-cancel"])("joins stopped engine and rejects %s without any result", async kind => {
    const input = await fixture(); const controller = new AbortController();
    const metadata = run(input.ffmpeg.ffprobePath, ["-v", "error", "-fflags", "+nofillin", "-select_streams", "v:0", "-show_streams", "-show_format", "-show_frames", "-of", "json", input.sourcePath]);
    const packets = run(input.ffmpeg.ffprobePath, ["-v", "error", "-fflags", "+nofillin", "-select_streams", "v:0", "-show_packets", "-of", "json", input.sourcePath]);
    const children: { child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }; closed: boolean }[] = [];
    vi.mocked(processes.spawn).mockImplementation((_binary, args) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      const state = { child, closed: false }; children.push(state);
      const close = (code: number) => { if (state.closed) return; state.closed = true; child.stdout.end(); child.stderr.end(); child.emit("close", code); };
      child.kill.mockImplementation(() => { setImmediate(() => close(0)); return true; });
      setImmediate(() => {
        const probing = (args as string[]).includes("-show_frames") || (args as string[]).includes("-show_packets");
        if (probing) {
          if (kind === "probe-cancel") { controller.abort(); return; }
          child.stdout.write(kind === "probe-quota" ? Buffer.alloc(64 * 1024 * 1024 + 1) : (args as string[]).includes("-show_packets") ? packets : metadata);
        } else {
          if (kind === "cancel") { controller.abort(); return; }
          if (kind === "stderr") child.stderr.write("decode error");
          const bytes = kind === "short" ? 1024 : kind === "extra" ? 7 * 1024 : kind === "partial" ? 6 * 1024 - 1 : 6 * 1024;
          child.stdout.write(Buffer.alloc(bytes));
        }
        close(kind === "exit" && !probing ? 1 : 0);
      });
      return child as unknown as ReturnType<typeof processes.spawn>;
    });
    await expect(collectFullSourceCensus({ ...input, signal: controller.signal })).rejects.toThrow(/^UNSAFE:/);
    expect(children.every(state => state.closed)).toBe(true);
    if (["extra", "stderr", "probe-quota", "cancel", "probe-cancel"].includes(kind)) expect(children.some(state => state.child.kill.mock.calls.length > 0)).toBe(true);
  });
});

// Keep originals before installing spies; no test-issued census or review authority.
const identifySourceOriginal = identifySource;
const fingerprintFileOriginal = paths.fingerprintFile;
const spawnOriginal = vi.mocked(processes.spawn).getMockImplementation()!;

describe("canonical hash owner cancellation and byte limits", () => {
  it("keeps legacy hashes identical and rejects bounded reads before returning a digest", async () => {
    const input = await fixture(); const bytes = await readFile(input.sourcePath);
    expect(await paths.fingerprintFile(input.sourcePath)).toBe(`sha256:${sha(bytes)}`);
    await expect(paths.fingerprintFile(input.sourcePath, { maxBytes: bytes.length - 1 })).rejects.toThrow();
    await expect(knowledge.identifySource(input.sourcePath, input.source, { maxBytes: bytes.length - 1 })).rejects.toThrow();
  });

  it("closes an in-flight hash when cancelled and never returns partial SHA", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jianji-census-hash-")); directories.push(directory);
    const file = path.join(directory, "bytes.bin"); await writeFile(file, Buffer.alloc(4 * 1024 * 1024));
    const controller = new AbortController();
    const promise = paths.fingerprintFile(file, { signal: controller.signal });
    setImmediate(() => controller.abort());
    await expect(promise).rejects.toThrow();
  });

  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid byte budget %s before opening any file", async maxBytes => {
    await expect(paths.fingerprintFile("missing", { maxBytes })).rejects.toThrow(/Invalid fingerprint byte budget/);
  });
});
