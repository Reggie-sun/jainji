import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { basename, join } from "node:path";
import { FONT_CHOICES } from "../shared/decorations.js";
import { LIBRARY_FONTS } from "../shared/asset-library.js";
import { binaryCandidates, windowsFontCandidates } from "./platform.js";
import { selectH264Capability, type H264Capability, type H264Encoder } from "./video-encoder.js";
import { executionLimits, verifiedExportCount, type ExecutionLimits } from "./execution-limits.js";
import { probeConcurrentEncodes } from "./hardware-probe.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProgressEvent {
  progress: number;
  outTimeMs?: number;
}

export interface RunningCommand {
  process: ChildProcessWithoutNullStreams;
  promise: Promise<CommandResult>;
  cancel: () => Promise<void>;
}

export function runCommand(binary: string, args: readonly string[], onProgress?: (event: ProgressEvent) => void): RunningCommand {
  const child = spawn(binary, [...args], { shell: false, windowsHide: true });
  let stdout = "";
  let stderr = "";
  let progressBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    if (!onProgress) return;
    progressBuffer += text;
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop() ?? "";
    const values = new Map<string, string>();
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
    }
    const outTimeMs = Number(values.get("out_time_ms"));
    const progress = values.get("progress") === "end" ? 1 : Number.isFinite(outTimeMs) ? outTimeMs : undefined;
    if (progress !== undefined) onProgress({ progress, outTimeMs: Number.isFinite(outTimeMs) ? outTimeMs : undefined });
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const promise = new Promise<CommandResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
  return {
    process: child,
    promise,
    cancel: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGINT");
      await Promise.race([
        promise.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { duration?: string; size?: string };
}

export class FfmpegAdapter {
  constructor(public readonly ffmpegPath: string, public readonly ffprobePath: string) {}

  async probe(filePath: string): Promise<FfprobeJson> {
    const result = await runCommand(this.ffprobePath, [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
    ]).promise;
    if (result.code !== 0) throw new Error(result.stderr.trim() || "ffprobe failed");
    try { return JSON.parse(result.stdout) as FfprobeJson; } catch { throw new Error("ffprobe returned invalid JSON"); }
  }

  run(args: readonly string[], onProgress?: (event: ProgressEvent) => void): RunningCommand {
    return runCommand(this.ffmpegPath, args, onProgress);
  }
}

export interface CapabilityStatus {
  ready: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  drawtext: boolean;
  overlay: boolean;
  h264Encoder: boolean;
  videoEncoder?: H264Capability;
  /** Renderer-readable mirror of `videoEncoder.kind` when not "hardware". */
  videoEncoderReason?: "fallback" | "only";
  executionLimits?: ExecutionLimits;
  aacEncoder: boolean;
  fonts: boolean;
  appDataWritable: boolean;
  ffmpegVersion?: string;
  message?: string;
}

async function executable(command: string): Promise<string | null> {
  const candidates = binaryCandidates(command);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return null;
}

function bundledResourcesDirectory(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

export async function discoverBinary(name: "ffmpeg" | "ffprobe", appDataDirectory?: string, resourcesDirectory = bundledResourcesDirectory()): Promise<string | null> {
  const override = name === "ffmpeg" ? process.env.JIANJI_FFMPEG_PATH : process.env.JIANJI_FFPROBE_PATH;
  if (override) return executable(override);
  if (appDataDirectory) {
    const local = await executable(join(appDataDirectory, "tools", "ffmpeg", "bin", process.platform === "win32" ? `${name}.exe` : name));
    if (local) return local;
  }
  if (process.platform === "win32" && resourcesDirectory) {
    const bundled = await executable(join(resourcesDirectory, "ffmpeg", `${name}.exe`));
    if (bundled) return bundled;
  }
  return executable(name);
}

async function fontsAvailable(fontResolver: (family: string) => Promise<string | null>): Promise<boolean> {
  return (await Promise.all([...FONT_CHOICES, ...LIBRARY_FONTS.map((entry) => entry.family!)].map(fontResolver))).some(Boolean);
}

function updateReadiness(status: CapabilityStatus): CapabilityStatus {
  status.ready = status.ffmpeg && status.ffprobe && status.drawtext && status.overlay && status.h264Encoder && status.aacEncoder && status.fonts && status.appDataWritable;
  if (status.ready) status.message = undefined;
  else status.message ??= "本机 FFmpeg 能力不完整，导出入口已锁定。";
  return status;
}

/** Adding a font must not reselect the engine already captured by the export queue. */
export async function refreshFontCapabilities(status: CapabilityStatus, fontResolver: (family: string) => Promise<string | null>): Promise<CapabilityStatus> {
  return updateReadiness({ ...status, fonts: await fontsAvailable(fontResolver) });
}

export async function checkCapabilities(appDataDirectory: string, fontResolver: (family: string) => Promise<string | null> = resolveFont): Promise<{ status: CapabilityStatus; adapter?: FfmpegAdapter }> {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg", appDataDirectory), discoverBinary("ffprobe", appDataDirectory)]);
  const status: CapabilityStatus = {
    ready: false,
    ffmpeg: Boolean(ffmpegPath),
    ffprobe: Boolean(ffprobePath),
    drawtext: false,
    overlay: false,
    h264Encoder: false,
    aacEncoder: false,
    fonts: await fontsAvailable(fontResolver),
    appDataWritable: false,
  };
  try {
    await access(appDataDirectory, constants.W_OK | constants.X_OK);
    status.appDataWritable = true;
  } catch { /* reported below */ }
  if (!ffmpegPath || !ffprobePath) {
    status.message = "未找到可用的 ffmpeg 或 ffprobe，请安装带 H.264/AAC 编码器的 FFmpeg。";
    return { status };
  }
  const version = await runCommand(ffmpegPath, ["-version"]).promise;
  const filters = await runCommand(ffmpegPath, ["-hide_banner", "-filters"]).promise;
  const encoders = await runCommand(ffmpegPath, ["-hide_banner", "-encoders"]).promise;
  status.ffmpegVersion = version.stdout.split(/\r?\n/, 1)[0]?.replace(/^ffmpeg version\s*/i, "") || undefined;
  status.drawtext = /\bdrawtext\b/.test(filters.stdout);
  status.overlay = /\boverlay\b/.test(filters.stdout);
  const probeDeadline = Date.now() + 15_000;
  const tryEncode = async (args: string[]): Promise<boolean> => {
    const remaining = Math.min(5_000, probeDeadline - Date.now());
    if (remaining <= 0) return false;
    const command = runCommand(ffmpegPath, args);
    const timeout = setTimeout(() => command.process.kill("SIGKILL"), remaining);
    try { return (await command.promise).code === 0; }
    finally { clearTimeout(timeout); }
  };
  // selectH264Capability wraps selectH264Encoder and reclassifies the result.
  // We need the inner tryEncode to also fill executionLimits when a hardware
  // encoder passes the concurrent-export probe, so we capture the picked encoder
  // by intercepting the probe args.
  let probedHardware: H264Encoder | undefined;
  status.videoEncoder = await selectH264Capability(encoders.code === 0 ? encoders.stdout : "", async (args) => {
    if (!await tryEncode(args)) return false;
    const encoder = args[args.indexOf("-c:v") + 1] as H264Encoder;
    const limits = executionLimits(undefined, encoder);
    const exports = await verifiedExportCount(limits.exports, (count) => {
      const remaining = Math.min(5_000, probeDeadline - Date.now());
      return remaining > 0 ? probeConcurrentEncodes(args, count, (probeArgs, onProgress) => runCommand(ffmpegPath, probeArgs, onProgress), remaining) : Promise.resolve(false);
    });
    if (!exports) return false;
    status.executionLimits = { ...limits, exports };
    probedHardware = encoder;
    return true;
  });
  if (!probedHardware) status.executionLimits = executionLimits(undefined, "libx264");
  status.h264Encoder = status.videoEncoder !== undefined;
  status.videoEncoderReason = status.videoEncoder?.kind === "software-fallback"
    ? "fallback"
    : status.videoEncoder?.kind === "software-only"
      ? "only"
      : undefined;
  status.aacEncoder = /\baac\b/.test(encoders.stdout);
  return { status: updateReadiness(status), adapter: new FfmpegAdapter(ffmpegPath, ffprobePath) };
}

export async function resolveFont(fontFamily: string, resourcesDirectory = bundledResourcesDirectory()): Promise<string | null> {
  if (process.platform === "win32") {
    if (fontFamily === "Noto Sans CJK SC" && resourcesDirectory) {
      const bundled = join(resourcesDirectory, "fonts", "NotoSansCJKsc-Regular.otf");
      try { await access(bundled, constants.F_OK); return bundled; } catch { /* continue */ }
    }
    for (const candidate of windowsFontCandidates(fontFamily)) {
      try { await access(candidate, constants.F_OK); return candidate; } catch { /* continue */ }
    }
    return null;
  }
  const fcMatch = await executable("fc-match");
  if (!fcMatch) return null;
  const result = await runCommand(fcMatch, ["-f", "%{family}\n%{file}", fontFamily]).promise;
  const [matchedFamily, filePath] = result.stdout.trim().split(/\r?\n/);
  if (result.code !== 0 || !matchedFamily || !filePath || filePath === "${file}") return null;
  const requested = fontFamily.trim().toLocaleLowerCase();
  const generic = new Set(["sans", "sans-serif", "serif", "monospace"]);
  if (!generic.has(requested) && !matchedFamily.split(",").some((family) => family.trim().toLocaleLowerCase() === requested)) return null;
  return filePath;
}

export function redactStderr(stderr: string): string {
  return stderr.replace(/(?:\/[^\s:'"]+)+/g, "<path>").trim().slice(-1_000);
}

export function binaryLabel(binary: string): string { return basename(binary); }
