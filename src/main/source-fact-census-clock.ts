import { z } from "zod";
import { SourceIdentitySchema, type SourceIdentity } from "../shared/source-sticker-knowledge.js";

export const FULL_CENSUS_LIMITS = Object.freeze({ frames: 100_000, probeBytes: 64 * 1024 * 1024,
  frameBytes: 64 * 1024 * 1024, decodedBytes: 512 * 1024 ** 3, sourceBytes: 16 * 1024 ** 3, engineBytes: 512 * 1024 * 1024, wallMs: 600_000 });
const integer = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int().safe())]);
const positive = integer.refine(value => value > 0);
const colors = { color_range: z.string().optional(), color_space: z.string().optional(), color_primaries: z.string().optional(), color_transfer: z.string().optional() };
const StreamSchema = z.object({ index: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive(),
  codec_name: z.literal("h264"),
  time_base: z.string(), start_pts: integer, duration_ts: positive, pix_fmt: z.string(), sample_aspect_ratio: z.literal("1:1"),
  field_order: z.literal("progressive"), side_data_list: z.array(z.unknown()).max(0).optional(), tags: z.object({ rotate: z.string().optional() }).optional(), ...colors });
const FrameSchema = z.object({ stream_index: z.number().int().nonnegative(), pts: integer, best_effort_timestamp: integer, duration: positive.optional(), pkt_duration: positive.optional(),
  pkt_pos: integer.refine(value => value >= 0), pkt_size: positive,
  width: z.number().int().positive(), height: z.number().int().positive(), pix_fmt: z.string(), sample_aspect_ratio: z.literal("1:1"), interlaced_frame: z.literal(0),
  crop_top: z.literal(0), crop_bottom: z.literal(0), crop_left: z.literal(0), crop_right: z.literal(0), ...colors,
  side_data_list: z.array(z.object({ side_data_type: z.literal("H.26[45] User Data Unregistered SEI message") })).optional() });
const PacketSchema = z.object({ stream_index: z.number().int().nonnegative(), pts: integer, dts: integer, duration: positive, pos: integer.refine(value => value >= 0), size: positive });
const ProbeSchema = z.object({ streams: z.array(StreamSchema).length(1), format: z.object({ format_name: z.literal("mov,mp4,m4a,3gp,3g2,mj2") }),
  frames: z.array(FrameSchema).min(1).max(FULL_CENSUS_LIMITS.frames), packets: z.array(PacketSchema).min(1).max(FULL_CENSUS_LIMITS.frames) });
const PIXEL_FORMATS = new Set(["yuv420p", "yuv422p", "yuv444p", "yuvj420p", "yuvj422p", "yuvj444p", "rgb24", "bgr24", "rgba", "bgra", "gray"]);
const TRANSFERS = new Set(["unknown", "bt709", "smpte170m", "bt470m", "bt470bg", "gamma22", "gamma28", "iec61966-2-1"]);

export interface FullDecodeClock {
  streamIndex: number;
  inputInterpretation: { pixelFormat: string; colorRange: string; colorSpace: string; colorPrimaries: string; colorTransfer: string };
  startPts: number;
  endPts: number;
  byteLengthPerFrame: number;
  frames: { index: number; pts: number; endPts: number }[];
}
function unsafe(reason: string): never { throw new Error(`UNSAFE: full-decode census ${reason}`); }
function safeSum(a: number, b: number): number {
  const value = BigInt(a) + BigInt(b);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) unsafe("clock overflow");
  return Number(value);
}

/** Strict census clock, separate from the existing sampled SupervisorEvidence interpretation. */
export function parseFullDecodeClock(raw: unknown, expected: SourceIdentity): FullDecodeClock {
  const identity = SourceIdentitySchema.safeParse(expected); const result = ProbeSchema.safeParse(raw);
  if (!identity.success || !result.success) unsafe("source/probe is malformed or unsupported; no frame may be discarded");
  const source = identity.data; const { streams: [stream], frames, packets } = result.data;
  const byteLengthPerFrame = source.width * source.height * 4;
  if (source.rotation !== 0 || source.interpretationVersion !== 1 || source.width > 8192 || source.height > 8192
    || !Number.isSafeInteger(byteLengthPerFrame) || byteLengthPerFrame > FULL_CENSUS_LIMITS.frameBytes
    || stream.width !== source.width || stream.height !== source.height || stream.time_base !== source.timeBase
    || stream.start_pts !== source.timeOriginPts || (stream.tags?.rotate !== undefined && stream.tags.rotate !== "0")
    || !PIXEL_FORMATS.has(stream.pix_fmt)) unsafe("source interpretation mismatch");
  const interpretation = (frame: typeof stream | typeof frames[number]) => ({ pixelFormat: frame.pix_fmt,
    colorRange: frame.color_range ?? "unknown", colorSpace: frame.color_space ?? "unknown",
    colorPrimaries: frame.color_primaries ?? "unknown", colorTransfer: frame.color_transfer ?? "unknown" });
  const inputInterpretation = interpretation(stream);
  if (!TRANSFERS.has(inputInterpretation.colorTransfer)) unsafe("non-SDR transfer is unsupported");
  const endPts = safeSum(stream.start_pts, stream.duration_ts);
  const [num, den] = source.timeBase.split("/").map(BigInt);
  const delta = BigInt(stream.duration_ts) * num * 1000n - BigInt(source.durationMs) * den;
  if (delta * 2n > den || delta * 2n < -den) unsafe("source duration disagrees with exact stream horizon");
  const clock: FullDecodeClock["frames"] = [];
  const packetByPosition = new Map<number, typeof packets[number]>(); const packetPts = new Set<number>();
  if (packets.length !== frames.length) unsafe("packet/frame census is not one-to-one");
  for (const packet of packets) {
    if (packetByPosition.has(packet.pos) || packetPts.has(packet.pts) || packet.stream_index !== stream.index) unsafe("ambiguous packet identity");
    packetByPosition.set(packet.pos, packet); packetPts.add(packet.pts);
  }
  const usedPackets = new Set<number>();
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]; const duration = frame.duration ?? frame.pkt_duration;
    const packet = packetByPosition.get(frame.pkt_pos);
    if (!packet || usedPackets.has(packet.pos) || packet.pts !== frame.pts || packet.duration !== duration || packet.size !== frame.pkt_size) unsafe("frame clock lacks an exact original packet binding");
    usedPackets.add(packet.pos);
    if (duration === undefined || (frame.duration !== undefined && frame.pkt_duration !== undefined && frame.duration !== frame.pkt_duration)
      || frame.pts !== frame.best_effort_timestamp || frame.stream_index !== stream.index || frame.width !== source.width || frame.height !== source.height
      || JSON.stringify(interpretation(frame)) !== JSON.stringify(inputInterpretation)) unsafe("frame duration, PTS or canvas interpretation is unsupported");
    const frameEnd = safeSum(frame.pts, duration);
    const nextPts = frames[index + 1]?.pts ?? endPts;
    if ((index === 0 && frame.pts !== stream.start_pts) || frameEnd !== nextPts) unsafe("clock gap, overlap or unverified tail");
    clock.push({ index, pts: frame.pts, endPts: frameEnd });
  }
  if (clock.length * byteLengthPerFrame > FULL_CENSUS_LIMITS.decodedBytes) unsafe("decoded byte budget exceeded");
  return { streamIndex: stream.index, inputInterpretation, startPts: stream.start_pts, endPts, byteLengthPerFrame, frames: clock };
}
