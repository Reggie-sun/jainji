import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { SourceIdentitySchema, type SourceIdentity } from "../shared/source-sticker-knowledge.js";
import { FULL_CENSUS_LIMITS, type FullDecodeClock } from "./source-fact-census-clock.js";
import { probeSourceDecodeClock, streamSourceFactCommand, type FullSourceCensusInput } from "./source-fact-census.js";
import { discoveryHash as hash, verifyDiscoveryFramehash } from "./source-fact-discovery-evidence.js";
import { identifySource, sourceKey } from "./source-sticker-knowledge-store.js";
import { fingerprintFile } from "./paths.js";
import { freezeAI } from "./source-fact-ai-contract.js";

export const EXACT_SOURCE_FRAME_LIMITS = Object.freeze({ frames: 256, bytes: 512 * 1024 ** 2, wallMs: 300_000, bindingBytes: 128 * 1024 });
export interface ExactSourceFrameBinding {
  sourceKey: string; index: number; pts: number; endPts: number; byteLength: number; pixelSha256: string;
  width: number; height: number; source: SourceIdentity; pixelFormat: "rgba";
  inputInterpretation: FullDecodeClock["inputInterpretation"];
  ffmpegFingerprint: string; ffprobeFingerprint: string; clockDigest: string;
}
export interface ExactSourceFrames {
  readonly bindings: readonly Readonly<ExactSourceFrameBinding>[];
  readFrame(ordinal: number): Buffer;
  verifyFresh(): Promise<void>;
}
const fail = (why: string): never => { throw Error(`INCOMPLETE: exact source frames ${why}`); };

/** Canonical sequential decode + exact ordinal select. No seek, sampling change, or RGBA spool. */
export async function readExactSourceFrames(input: FullSourceCensusInput, clock: Readonly<FullDecodeClock>, requested: readonly number[],
  deadline = Date.now() + EXACT_SOURCE_FRAME_LIMITS.wallMs): Promise<ExactSourceFrames> {
  input.signal.throwIfAborted();
  if (!requested.length || requested.length > EXACT_SOURCE_FRAME_LIMITS.frames
    || requested.some(i => !Number.isSafeInteger(i) || i < 0 || i >= clock.frames.length)) fail("ordinal/count budget");
  const ordinals = [...new Set(requested)].sort((a, b) => a - b), expectedBytes = ordinals.length * clock.byteLengthPerFrame;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > EXACT_SOURCE_FRAME_LIMITS.bytes) fail("byte budget");
  deadline = Math.min(deadline, Date.now() + EXACT_SOURCE_FRAME_LIMITS.wallMs);
  const source = SourceIdentitySchema.parse(input.source), key = sourceKey(source), clockDigest = hash(JSON.stringify(clock));
  const sourcePath = await realpath(input.sourcePath), ffmpegPath = await realpath(input.ffmpeg.ffmpegPath), ffprobePath = await realpath(input.ffmpeg.ffprobePath);
  const paths = [sourcePath, ffmpegPath, ffprobePath], generations = paths.map(p => statSync(p, { bigint: true }));
  if (generations.some(s => !s.isFile())) fail("source or engine is not a file");
  const check = () => {
    input.signal.throwIfAborted(); if (Date.now() >= deadline) fail("wall budget");
    paths.forEach((p, i) => {
      const now = statSync(p, { bigint: true });
      if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(k => now[k as keyof typeof now] !== generations[i][k as keyof typeof now])) fail("source/engine generation changed");
    });
  };
  const options = { signal: input.signal, maxBytes: FULL_CENSUS_LIMITS.engineBytes };
  const ffmpegFingerprint = await fingerprintFile(ffmpegPath, options), ffprobeFingerprint = await fingerprintFile(ffprobePath, options);
  const verifyFresh = async () => {
    check();
    if (sourceKey(await identifySource(sourcePath, source, { signal: input.signal, maxBytes: FULL_CENSUS_LIMITS.sourceBytes })) !== key) fail("source identity changed");
    if (await fingerprintFile(ffmpegPath, options) !== ffmpegFingerprint || await fingerprintFile(ffprobePath, options) !== ffprobeFingerprint) fail("engine changed");
    check();
  };
  await verifyFresh();
  const canonical = await probeSourceDecodeClock(sourcePath, source, { ffmpegPath, ffprobePath }, input.signal, deadline);
  if (hash(JSON.stringify(canonical)) !== clockDigest) fail("canonical clock mismatch");
  check();
  const frames = new Map<number, Buffer>(), bindings: ExactSourceFrameBinding[] = [];
  let fill = 0, total = 0, text = ""; const frame = Buffer.alloc(canonical.byteLengthPerFrame);
  const outputs = (name: string, format: string, destination: string) => ["-map", `[${name}]`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux",
    "-c:v", "rawvideo", "-pix_fmt", "rgba", "-threads", "1", "-f", format, ...(format === "framehash" ? ["-hash", "sha256"] : []), destination];
  await streamSourceFactCommand(ffmpegPath, ["-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode",
    "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", sourcePath, "-filter_complex_threads", "1",
    "-filter_complex", `[0:${canonical.streamIndex}]select='${ordinals.map(i => `eq(n,${i})`).join("+")}',format=rgba,split=2[pixels][binding]`,
    ...outputs("pixels", "rawvideo", "pipe:1"), ...outputs("binding", "framehash", "pipe:3")], input.signal, deadline, chunk => {
    check(); total += chunk.length; if (total > expectedBytes) fail("extra pixel bytes");
    let offset = 0;
    while (offset < chunk.length) {
      const n = Math.min(chunk.length - offset, frame.length - fill); chunk.copy(frame, fill, offset, offset + n); fill += n; offset += n;
      if (fill === frame.length) {
        const index = ordinals[bindings.length], original = canonical.frames[index]; if (!original) fail("extra frame");
        bindings.push({ sourceKey: key, ...original, byteLength: frame.length, pixelSha256: hash(frame), width: source.width, height: source.height,
          source, pixelFormat: "rgba", inputInterpretation: canonical.inputInterpretation, ffmpegFingerprint, ffprobeFingerprint, clockDigest });
        frames.set(index, Buffer.from(frame)); fill = 0;
      }
    }
  }, chunk => { text += chunk.toString("utf8"); if (Buffer.byteLength(text) > EXACT_SOURCE_FRAME_LIMITS.bindingBytes) fail("binding budget"); });
  if (fill || total !== expectedBytes || bindings.length !== ordinals.length) fail("truncated decode");
  verifyDiscoveryFramehash(text, bindings, source.timeBase);
  await verifyFresh();
  return Object.freeze({ bindings: freezeAI(bindings), verifyFresh, readFrame: (ordinal: number) => {
    check(); const bytes = frames.get(ordinal), binding = bindings.find(f => f.index === ordinal);
    if (!bytes || !binding || hash(bytes) !== binding.pixelSha256) return fail("unrequested or changed frame");
    return Buffer.from(bytes);
  } });
}
