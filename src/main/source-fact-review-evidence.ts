import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFullSourceCensus, type FullSourceCensus, type FullSourceCensusInput } from "./source-fact-census.js";
import { FULL_CENSUS_LIMITS } from "./source-fact-census-clock.js";

export const REVIEW_EVIDENCE_LIMITS = Object.freeze({ bytes: 32 * 1024 ** 3, wallMs: FULL_CENSUS_LIMITS.wallMs });
export interface FullCanvasReviewEvidence {
  readonly id: string;
  readonly census: FullSourceCensus;
  readFrame(index: number): Promise<Buffer>;
  verifyFresh(): Promise<void>;
  close(): Promise<void>;
}
const owned = new WeakSet<FullCanvasReviewEvidence>();
export function assertOwnedReviewEvidence(evidence: FullCanvasReviewEvidence): void {
  if (!owned.has(evidence)) throw new Error("UNSAFE: review evidence is not owned or has been closed");
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const unsafe = (reason: string): never => { throw new Error(`UNSAFE: full-canvas review ${reason}`); };

/** Reuses the frozen D1 owner; this spool is evidence, never another census issuer. */
export async function prepareFullCanvasReviewEvidence(input: FullSourceCensusInput): Promise<FullCanvasReviewEvidence> {
  try { return await prepareEvidence(input); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("UNSAFE:")) throw error;
    return unsafe("source, engine or evidence could not be verified");
  }
}

async function prepareEvidence(input: FullSourceCensusInput): Promise<FullCanvasReviewEvidence> {
  const signal = input.signal;
  signal.throwIfAborted();
  const stableInput = { ...input, source: structuredClone(input.source), ffmpeg: { ...input.ffmpeg } };
  stableInput.sourcePath = await realpath(input.sourcePath);
  stableInput.ffmpeg.ffmpegPath = await realpath(input.ffmpeg.ffmpegPath);
  stableInput.ffmpeg.ffprobePath = await realpath(input.ffmpeg.ffprobePath);
  const tracked = [stableInput.sourcePath, stableInput.ffmpeg.ffmpegPath, stableInput.ffmpeg.ffprobePath];
  const generations = await Promise.all(tracked.map(file => stat(file, { bigint: true })));
  const generationCheck = async () => {
    signal.throwIfAborted();
    for (let i = 0; i < tracked.length; i++) {
      const current = await stat(tracked[i]!, { bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) {
        if (current[key] !== generations[i]![key]) unsafe("source or engine generation changed");
      }
    }
  };
  const census = await collectFullSourceCensus(stableInput);
  const frameBytes = census.source.width * census.source.height * 4;
  const expectedBytes = frameBytes * census.horizon.frameCount;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > REVIEW_EVIDENCE_LIMITS.bytes) unsafe("evidence storage budget exceeded");
  await generationCheck();
  const root = await mkdtemp(join(tmpdir(), "jianji-full-canvas-review-"));
  const file = await open(join(root, "frames.rgba"), "wx+", 0o600).catch(async error => { await rm(root, { recursive: true, force: true }); throw error; });
  let evidence: FullCanvasReviewEvidence | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true; if (evidence) owned.delete(evidence);
    try { await file.close(); } finally { await rm(root, { recursive: true, force: true }); }
  };
  try {
    {
      const child = spawn(stableInput.ffmpeg.ffmpegPath, ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode", "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", stableInput.sourcePath,
        "-map", `0:${census.decode.streamIndex}`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux", "-pix_fmt", "rgba", "-c:v", "rawvideo", "-threads", "1", "-f", "rawvideo", "pipe:1"],
      { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let failure: Error | undefined;
      const stop = (reason: string) => { failure ??= new Error(`UNSAFE: full-canvas review ${reason}`); child.kill("SIGKILL"); };
      const abort = () => stop("cancelled");
      const timer = setTimeout(() => stop("decode wall budget exceeded"), REVIEW_EVIDENCE_LIMITS.wallMs);
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      child.stderr!.on("data", () => stop("decode reported an error"));
      child.once("error", error => { failure ??= error; });
      const exited = new Promise<number | null>(resolve => child.once("close", resolve));
      let written = 0;
      try {
        for await (const chunk of child.stdout!) {
          signal.throwIfAborted();
          const bytes = chunk as Buffer;
          if (written + bytes.length > expectedBytes) unsafe("decode produced extra bytes");
          let offset = 0;
          while (offset < bytes.length) {
            const result = await file.write(bytes, offset, bytes.length - offset, written + offset);
            if (!result.bytesWritten) unsafe("evidence short write"); offset += result.bytesWritten;
          }
          written += bytes.length;
        }
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error("UNSAFE: evidence write failed");
        child.kill("SIGKILL");
      }
      const code = await exited;
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (failure || code !== 0) throw failure ?? new Error("UNSAFE: full-canvas review decode failed");
    }
    const spool = await file.stat({ bigint: true });
    if (!spool.isFile() || spool.size !== BigInt(expectedBytes)) unsafe("decoded evidence length mismatch");
    const readFrame = async (index: number) => {
      if (closed) unsafe("evidence closed");
      await generationCheck();
      const current = await file.stat({ bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) if (current[key] !== spool[key]) unsafe("evidence generation changed");
      const frame = census.frames[index];
      if (!Number.isInteger(index) || !frame) unsafe("frame ordinal is invalid");
      const bytes = Buffer.alloc(frameBytes);
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const read = await file.read(bytes, offset, bytes.length - offset, index * frameBytes + offset);
        if (!read.bytesRead) unsafe("evidence short read"); offset += read.bytesRead;
      }
      if (sha(bytes) !== frame.pixelSha256 || bytes.length !== frame.byteLength) unsafe("frame bytes differ from D1 census");
      await generationCheck();
      return bytes;
    };
    // Every stored frame must match; a successful file write alone is insufficient.
    for (const frame of census.frames) await readFrame(frame.index);
    const verifyFresh = async () => {
      if (closed) unsafe("evidence closed");
      await generationCheck();
      const fresh = await collectFullSourceCensus(stableInput);
      if (fresh.censusDigest !== census.censusDigest) unsafe("census identity changed");
      await generationCheck();
    };
    await verifyFresh();
    evidence = Object.freeze({ id: randomUUID(), census, readFrame, verifyFresh, close });
    owned.add(evidence);
    return evidence;
  } catch (error) {
    await close();
    if (error instanceof Error && error.message.startsWith("UNSAFE:")) throw error;
    return unsafe("evidence preparation failed");
  }
}
