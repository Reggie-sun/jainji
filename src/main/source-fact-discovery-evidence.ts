import { createHash } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { SourceIdentitySchema } from "../shared/source-sticker-knowledge.js";
import { FULL_CENSUS_LIMITS, type FullDecodeClock } from "./source-fact-census-clock.js";
import { probeSourceDecodeClock, streamSourceFactCommand, type FullSourceCensusInput } from "./source-fact-census.js";
import { fingerprintFile } from "./paths.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { freezeAI } from "./source-fact-ai-contract.js";

export const DISCOVERY_LIMITS = Object.freeze({ frames: 96, wallMs: 300_000, scratchBytes: 512 * 1024 ** 2,
  workingBytes: 512 * 1024 ** 2, bindingBytes: 128 * 1024 });
export const discoveryHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const discoveryIncomplete = (reason: string): never => { throw Error(`INCOMPLETE: stationary discovery ${reason}`); };
export interface DiscoveryBinding { index: number; pts: number; endPts: number; byteLength: number; pixelSha256: string }
export interface DiscoveryReceipt {
  method: "bounded-lossless-discovery/v1"; authority: "none"; eligible: false;
  source: Readonly<SourceIdentity>; sourceKey: string;
  clockDigest: string; frameCount: number; startPts: number; endPts: number;
  decode: { pixelFormat: "rgba"; streamIndex: number; ffmpegFingerprint: string; ffprobeFingerprint: string;
    inputInterpretation: FullDecodeClock["inputInterpretation"] };
  sampling: "uniform-pts-nearest-with-endpoints/v1";
  frames: readonly Readonly<DiscoveryBinding>[]; evidenceDigest: string;
}
export interface DiscoveryEvidence {
  readonly receipt: Readonly<DiscoveryReceipt>;
  readonly deadline: number;
  readonly metrics: Readonly<{ clockMs: number; decodeMs: number; identityMs: number; scratchBytes: number }>;
  readFrame(sampleIndex: number): Promise<Buffer>;
  verifyFresh(): Promise<void>;
  close(): Promise<void>;
}
const owned = new WeakSet<DiscoveryEvidence>();
export function assertOwnedDiscoveryEvidence(evidence: DiscoveryEvidence): void {
  if (!owned.has(evidence)) discoveryIncomplete("unowned or closed evidence");
}

/** Deterministic exact original ordinals; selection describes sampling, never semantic coverage. */
export function selectDiscoveryOrdinals(clock: FullDecodeClock, count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > DISCOVERY_LIMITS.frames) discoveryIncomplete("frame budget");
  const frames = clock.frames, n = Math.min(count, frames.length);
  if (n === frames.length) return frames.map(f => f.index);
  if (n < 2) return [0];
  const result = new Set<number>(); let cursor = 0;
  for (let i = 0; i < n; i++) {
    const pts = frames[0].pts + (frames[frames.length - 1].pts - frames[0].pts) * i / (n - 1);
    while (cursor + 1 < frames.length && Math.abs(frames[cursor + 1].pts - pts) <= Math.abs(frames[cursor].pts - pts)) cursor++;
    result.add(cursor);
  }
  return [...result];
}

/** FFmpeg framehash binds emitted RGBA bytes and original PTS; no caller-authored frame claims. */
export function verifyDiscoveryFramehash(text: string, frames: readonly DiscoveryBinding[], timeBase: string): void {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.includes(`#tb 0: ${timeBase}`) || !lines.includes("#hash: SHA256")) discoveryIncomplete("decoder time base or hash mismatch");
  const records = lines.filter(line => line && !line.startsWith("#"));
  if (records.length !== frames.length) discoveryIncomplete("decoder frame binding count mismatch");
  for (let i = 0; i < records.length; i++) {
    const fields = records[i].split(",").map(s => s.trim()); const f = frames[i];
    if (fields.length !== 6 || fields[0] !== "0" || Number(fields[2]) !== f.pts || Number(fields[3]) !== f.endPts - f.pts
      || Number(fields[4]) !== f.byteLength || fields[5] !== f.pixelSha256) discoveryIncomplete("decoder PTS or pixel binding mismatch");
  }
}

/** Bounded evidence mode alongside D2. Never calls full census or spools unsampled frames. */
export async function prepareDiscoveryEvidence(input: FullSourceCensusInput,
  limits: { frames?: number; wallMs?: number; scratchBytes?: number } = {}): Promise<DiscoveryEvidence> {
  const framesLimit = limits.frames ?? DISCOVERY_LIMITS.frames, wallMs = limits.wallMs ?? DISCOVERY_LIMITS.wallMs;
  const scratchLimit = limits.scratchBytes ?? DISCOVERY_LIMITS.scratchBytes;
  for (const [value, max] of [[framesLimit, DISCOVERY_LIMITS.frames], [wallMs, DISCOVERY_LIMITS.wallMs], [scratchLimit, DISCOVERY_LIMITS.scratchBytes]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) discoveryIncomplete("invalid or enlarged budget");
  }
  const deadline = Date.now() + wallMs, budget = new AbortController();
  const signal = AbortSignal.any([input.signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), wallMs);
  let root: string | undefined, evidence: DiscoveryEvidence | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined, closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    clearTimeout(timer); if (evidence) owned.delete(evidence);
    try { await handle?.close(); } finally { if (root) await rm(root, { recursive: true, force: true }); }
  };
  try {
    signal.throwIfAborted();
    const source = SourceIdentitySchema.parse(input.source);
    const sourcePath = await realpath(input.sourcePath);
    const ffmpeg = { ffmpegPath: await realpath(input.ffmpeg.ffmpegPath), ffprobePath: await realpath(input.ffmpeg.ffprobePath) };
    const tracked = [sourcePath, ffmpeg.ffmpegPath, ffmpeg.ffprobePath];
    const generations = await Promise.all(tracked.map(p => stat(p, { bigint: true })));
    if (generations.some(s => !s.isFile())) discoveryIncomplete("non-file source or engine");
    const check = async () => {
      if (closed) discoveryIncomplete("closed evidence");
      signal.throwIfAborted(); if (Date.now() >= deadline) discoveryIncomplete("wall budget exceeded");
      for (let i = 0; i < tracked.length; i++) {
        const s = await stat(tracked[i], { bigint: true });
        for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) if (s[key] !== generations[i][key]) discoveryIncomplete("source or engine generation changed");
      }
    };
    const identityStart = performance.now();
    const verifySource = async () => {
      await check();
      if (sourceKey(await identifySource(sourcePath, source, { signal, maxBytes: FULL_CENSUS_LIMITS.sourceBytes })) !== sourceKey(source)) discoveryIncomplete("source identity mismatch");
      await check();
    };
    await verifySource();
    const engineOptions = { signal, maxBytes: FULL_CENSUS_LIMITS.engineBytes };
    const ffmpegFingerprint = await fingerprintFile(ffmpeg.ffmpegPath, engineOptions);
    const ffprobeFingerprint = await fingerprintFile(ffmpeg.ffprobePath, engineOptions);
    const identityMs = performance.now() - identityStart, clockStart = performance.now();
    const clock = await probeSourceDecodeClock(sourcePath, source, ffmpeg, signal, deadline);
    const clockMs = performance.now() - clockStart;
    const count = Math.min(framesLimit, Math.floor(scratchLimit / clock.byteLengthPerFrame));
    if (count < 1) discoveryIncomplete("scratch budget exceeded");
    const ordinals = selectDiscoveryOrdinals(clock, count), expectedBytes = ordinals.length * clock.byteLengthPerFrame;
    await check(); root = await mkdtemp(join(tmpdir(), "jianji-stationary-discovery-"));
    const file = join(root, "samples.rgba"), fd = openSync(file, "wx", 0o600);
    const frames: DiscoveryBinding[] = [], frame = Buffer.alloc(clock.byteLengthPerFrame);
    let fill = 0, total = 0, bindingText = "";
    const decodeStart = performance.now();
    try {
      const outputs = (name: string, format: string, destination: string) => ["-map", `[${name}]`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux",
        "-c:v", "rawvideo", "-pix_fmt", "rgba", "-threads", "1", "-f", format, ...(format === "framehash" ? ["-hash", "sha256"] : []), destination];
      await streamSourceFactCommand(ffmpeg.ffmpegPath, ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode",
        "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", sourcePath, "-filter_complex_threads", "1",
        "-filter_complex", `[0:${clock.streamIndex}]select='${ordinals.map(n => `eq(n,${n})`).join("+")}',format=rgba,split=2[pixels][binding]`,
        ...outputs("pixels", "rawvideo", "pipe:1"), ...outputs("binding", "framehash", "pipe:3")], signal, deadline, chunk => {
        total += chunk.length; if (total > expectedBytes) discoveryIncomplete("extra decoded bytes");
        let offset = 0;
        while (offset < chunk.length) {
          const length = Math.min(chunk.length - offset, frame.length - fill);
          chunk.copy(frame, fill, offset, offset + length); fill += length; offset += length;
          if (fill === frame.length) {
            const original = clock.frames[ordinals[frames.length]];
            if (!original) discoveryIncomplete("extra frame");
            let written = 0;
            while (written < frame.length) { const n = writeSync(fd, frame, written, frame.length - written); if (!n) discoveryIncomplete("short write"); written += n; }
            frames.push({ ...original, byteLength: frame.length, pixelSha256: discoveryHash(frame) }); fill = 0;
          }
        }
      }, chunk => { bindingText += chunk.toString("utf8"); if (Buffer.byteLength(bindingText) > DISCOVERY_LIMITS.bindingBytes) discoveryIncomplete("frame binding byte budget"); });
    } finally { closeSync(fd); }
    const decodeMs = performance.now() - decodeStart;
    if (fill || total !== expectedBytes || frames.length !== ordinals.length) discoveryIncomplete("truncated sampled decode");
    verifyDiscoveryFramehash(bindingText, frames, source.timeBase);
    handle = await open(file, "r"); const spool = await handle.stat({ bigint: true });
    const verifyFresh = async () => {
      await verifySource();
      if (await fingerprintFile(ffmpeg.ffmpegPath, engineOptions) !== ffmpegFingerprint
        || await fingerprintFile(ffmpeg.ffprobePath, engineOptions) !== ffprobeFingerprint) discoveryIncomplete("engine bytes changed");
      await check();
    };
    const readFrame = async (sampleIndex: number) => {
      await check(); const f = frames[sampleIndex];
      if (!Number.isSafeInteger(sampleIndex) || !f) discoveryIncomplete("invalid sample ordinal");
      const current = await handle!.stat({ bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) if (current[key] !== spool[key]) discoveryIncomplete("sample generation changed");
      const bytes = Buffer.alloc(f.byteLength); let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted(); const r = await handle!.read(bytes, offset, bytes.length - offset, sampleIndex * f.byteLength + offset);
        if (!r.bytesRead) discoveryIncomplete("short read"); offset += r.bytesRead;
      }
      if (discoveryHash(bytes) !== f.pixelSha256) discoveryIncomplete("sample pixel digest mismatch");
      await check(); return bytes;
    };
    await verifyFresh();
    const body = { method: "bounded-lossless-discovery/v1" as const, authority: "none" as const, eligible: false as const,
      source, sourceKey: sourceKey(source), clockDigest: discoveryHash(JSON.stringify(clock)), frameCount: clock.frames.length,
      startPts: clock.startPts, endPts: clock.endPts, decode: { pixelFormat: "rgba" as const, streamIndex: clock.streamIndex,
        ffmpegFingerprint, ffprobeFingerprint, inputInterpretation: clock.inputInterpretation }, sampling: "uniform-pts-nearest-with-endpoints/v1" as const, frames };
    evidence = Object.freeze({ receipt: freezeAI({ ...body, evidenceDigest: discoveryHash(JSON.stringify(body)) }), deadline,
      metrics: Object.freeze({ identityMs, clockMs, decodeMs, scratchBytes: expectedBytes }), readFrame, verifyFresh, close });
    owned.add(evidence); return evidence;
  } catch (error) {
    await close();
    if (error instanceof Error && error.message.startsWith("INCOMPLETE:")) throw error;
    return discoveryIncomplete(input.signal.aborted ? "cancelled" : budget.signal.aborted ? "wall budget exceeded" : "source, clock or decode could not be verified");
  }
}
