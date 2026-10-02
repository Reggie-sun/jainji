import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { SourceIdentitySchema, type SourceIdentity } from "../shared/source-sticker-knowledge.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { JianjiError } from "./errors.js";
import { fingerprintFile } from "./paths.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { FULL_CENSUS_LIMITS, parseFullDecodeClock } from "./source-fact-census-clock.js";

export interface FullSourceCensus {
  readonly schemaVersion: 1;
  readonly authority: "none";
  readonly semanticReview: "NOT_EVALUATED";
  readonly eligible: false;
  readonly source: Readonly<SourceIdentity>;
  readonly decode: Readonly<{ profile: "full-decode-rgba-v1"; pixelFormat: "rgba"; streamIndex: number;
    ffmpegFingerprint: string; ffprobeFingerprint: string; inputInterpretation: Readonly<{ pixelFormat: string; colorRange: string; colorSpace: string; colorPrimaries: string; colorTransfer: string }> }>;
  readonly horizon: Readonly<{ startPts: number; endPts: number; frameCount: number }>;
  readonly frames: readonly Readonly<{ index: number; pts: number; endPts: number; byteLength: number; pixelSha256: string }>[];
  readonly censusDigest: string;
}
export interface FullSourceCensusInput {
  sourcePath: string;
  source: SourceIdentity;
  ffmpeg: Pick<FfmpegAdapter, "ffmpegPath" | "ffprobePath">;
  signal: AbortSignal;
}
function unsafe(reason: string): never { throw new JianjiError(`UNSAFE: full-decode census ${reason}`, "input_invalid", "input", false); }

export async function streamSourceFactCommand(binary: string, args: string[], signal: AbortSignal, deadline: number, consume: (chunk: Buffer) => void,
  consumeBinding?: (chunk: Buffer) => void): Promise<void> {
  signal.throwIfAborted();
  if (Date.now() >= deadline) unsafe("wall budget exceeded");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: consumeBinding ? ["ignore", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
    let failure: Error | undefined;
    const stop = (reason: Error) => { failure ??= reason; child.kill("SIGKILL"); };
    const abort = () => stop(new Error("UNSAFE: full-decode census cancelled"));
    const timer = setTimeout(() => stop(new Error("UNSAFE: full-decode census wall budget exceeded")), Math.max(1, deadline - Date.now()));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout!.on("data", (chunk: Buffer) => {
      if (failure) return;
      try { consume(chunk); } catch (error) { stop(error instanceof Error ? error : new Error("UNSAFE: full-decode census stream failed")); }
    });
    if (consumeBinding) child.stdio[3]!.on("data", (chunk: Buffer) => {
      if (failure) return;
      try { consumeBinding(chunk); } catch (error) { stop(error instanceof Error ? error : new Error("INCOMPLETE: discovery binding failed")); }
    });
    // -v error: even an exit-0 decode reporting errors cannot certify a complete census.
    child.stderr!.on("data", () => stop(new Error("UNSAFE: full-decode census engine reported an error")));
    child.once("error", error => { failure ??= error; });
    child.once("close", code => {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (failure || code !== 0) reject(failure ?? new Error("UNSAFE: full-decode census engine failed"));
      else resolve();
    });
  });
}

/** Shared strict metadata/packet clock; bounded discovery does not issue a full census. */
export async function probeSourceDecodeClock(sourcePath: string, source: SourceIdentity, engines: FullSourceCensusInput["ffmpeg"], signal: AbortSignal, deadline: number) {
  const { ffprobePath } = engines;
  const chunks: Buffer[] = []; let probeBytes = 0;
  await streamSourceFactCommand(ffprobePath, ["-v", "error", "-fflags", "+nofillin", "-err_detect", "explode", "-select_streams", "v:0", "-show_streams", "-show_format", "-show_frames", "-show_entries",
    "format=format_name:stream=index,codec_name,width,height,time_base,start_pts,duration_ts,pix_fmt,sample_aspect_ratio,field_order,color_range,color_space,color_primaries,color_transfer,tags,side_data_list:frame=stream_index,pts,best_effort_timestamp,duration,pkt_duration,pkt_pos,pkt_size,width,height,pix_fmt,sample_aspect_ratio,interlaced_frame,crop_top,crop_bottom,crop_left,crop_right,color_range,color_space,color_primaries,color_transfer,side_data_list",
    "-of", "json", sourcePath], signal, deadline, chunk => {
    probeBytes += chunk.length; if (probeBytes > FULL_CENSUS_LIMITS.probeBytes) unsafe("probe metadata budget exceeded");
    chunks.push(chunk);
  });
  const probe = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  chunks.length = 0;
  await streamSourceFactCommand(ffprobePath, ["-v", "error", "-fflags", "+nofillin", "-err_detect", "explode", "-select_streams", "v:0", "-show_packets", "-show_entries",
    "packet=stream_index,pts,dts,duration,pos,size", "-of", "json", sourcePath], signal, deadline, chunk => {
    probeBytes += chunk.length; if (probeBytes > FULL_CENSUS_LIMITS.probeBytes) unsafe("probe metadata budget exceeded");
    chunks.push(chunk);
  });
  const packetProbe = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const clock = parseFullDecodeClock({ ...probe, packets: packetProbe.packets }, source);
  chunks.length = 0;
  return clock;
}

/** Canonical deterministic census only. No semantic review, knowledge write or admission handle. */
export async function collectFullSourceCensus(input: FullSourceCensusInput): Promise<FullSourceCensus> {
  let wallTimer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
  try {
    input.signal.throwIfAborted();
    const budget = new AbortController(); const signal = AbortSignal.any([input.signal, budget.signal]);
    const deadline = Date.now() + FULL_CENSUS_LIMITS.wallMs;
    wallTimer = setTimeout(() => { timedOut = true; budget.abort(); }, FULL_CENSUS_LIMITS.wallMs);
    const source = SourceIdentitySchema.parse(input.source);
    const requestedSourcePath = input.sourcePath;
    const { ffmpegPath: requestedFfmpegPath, ffprobePath: requestedFfprobePath } = input.ffmpeg;
    const sourcePath = await realpath(requestedSourcePath);
    const ffmpegPath = await realpath(requestedFfmpegPath); const ffprobePath = await realpath(requestedFfprobePath);
    const sourceRead = { signal, maxBytes: FULL_CENSUS_LIMITS.sourceBytes };
    const engineRead = { signal, maxBytes: FULL_CENSUS_LIMITS.engineBytes };
    const generation = await stat(sourcePath, { bigint: true });
    if (!generation.isFile() || generation.size > BigInt(FULL_CENSUS_LIMITS.sourceBytes) || source.byteLength > FULL_CENSUS_LIMITS.sourceBytes
      || source.rotation !== 0 || source.interpretationVersion !== 1) unsafe("unsupported source or source byte budget exceeded");
    const verify = async () => {
      signal.throwIfAborted();
      if (sourceKey(await identifySource(sourcePath, source, sourceRead)) !== sourceKey(source)) unsafe("source identity changed");
      const current = await stat(sourcePath, { bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) if (generation[key] !== current[key]) unsafe("source generation changed during census");
      signal.throwIfAborted(); if (Date.now() >= deadline) unsafe("wall budget exceeded");
    };
    await verify();
    for (const file of [ffmpegPath, ffprobePath]) if (!(await stat(file)).isFile()) unsafe("engine is not a regular file");
    const ffmpegFingerprint = await fingerprintFile(ffmpegPath, engineRead); const ffprobeFingerprint = await fingerprintFile(ffprobePath, engineRead);
    const clock = await probeSourceDecodeClock(sourcePath, source, { ffmpegPath, ffprobePath }, signal, deadline);
    const frames: { index: number; pts: number; endPts: number; byteLength: number; pixelSha256: string }[] = [];
    let bytesInFrame = 0; let hash = createHash("sha256");
    await streamSourceFactCommand(ffmpegPath, ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode", "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", sourcePath,
      "-map", `0:${clock.streamIndex}`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux", "-pix_fmt", "rgba", "-c:v", "rawvideo", "-threads", "1", "-f", "rawvideo", "pipe:1"], signal, deadline, chunk => {
      let offset = 0;
      while (offset < chunk.length) {
        const frame = clock.frames[frames.length]; if (!frame) unsafe("decode produced extra frames");
        const length = Math.min(chunk.length - offset, clock.byteLengthPerFrame - bytesInFrame);
        hash.update(chunk.subarray(offset, offset + length)); offset += length; bytesInFrame += length;
        if (bytesInFrame === clock.byteLengthPerFrame) {
          frames.push({ ...frame, byteLength: bytesInFrame, pixelSha256: hash.digest("hex") });
          bytesInFrame = 0; hash = createHash("sha256");
        }
      }
    });
    if (bytesInFrame !== 0 || frames.length !== clock.frames.length) unsafe("decode is truncated or missing frames");
    if (await fingerprintFile(ffmpegPath, engineRead) !== ffmpegFingerprint || await fingerprintFile(ffprobePath, engineRead) !== ffprobeFingerprint) unsafe("engine bytes changed during census");
    await verify();
    signal.throwIfAborted(); if (Date.now() >= deadline) unsafe("wall budget exceeded");
    const body = { schemaVersion: 1 as const, authority: "none" as const, semanticReview: "NOT_EVALUATED" as const, eligible: false as const,
      source: Object.freeze(source), decode: Object.freeze({ profile: "full-decode-rgba-v1" as const, pixelFormat: "rgba" as const, streamIndex: clock.streamIndex,
        ffmpegFingerprint, ffprobeFingerprint, inputInterpretation: Object.freeze(clock.inputInterpretation) }),
      horizon: Object.freeze({ startPts: clock.startPts, endPts: clock.endPts, frameCount: frames.length }), frames: Object.freeze(frames.map(frame => Object.freeze(frame))) };
    return Object.freeze({ ...body, censusDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex") });
  } catch (error) {
    if (timedOut) return unsafe("wall budget exceeded");
    if (input.signal.aborted) return unsafe("cancelled");
    if (error instanceof JianjiError && error.message.startsWith("UNSAFE:")) throw error;
    return unsafe(error instanceof Error && error.message.startsWith("UNSAFE:") ? error.message.slice("UNSAFE: full-decode census ".length) : "source, engine or decoded evidence could not be verified");
  } finally { if (wallTimer) clearTimeout(wallTimer); }
}
