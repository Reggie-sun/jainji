import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { basename } from "node:path";

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
  aacEncoder: boolean;
  fonts: boolean;
  appDataWritable: boolean;
  ffmpegVersion?: string;
  message?: string;
}

async function executable(command: string): Promise<string | null> {
  const candidates = command.includes("/") ? [command] : (process.env.PATH ?? "").split(":").map((directory) => `${directory}/${command}`);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return null;
}

export async function discoverBinary(name: "ffmpeg" | "ffprobe"): Promise<string | null> {
  const override = name === "ffmpeg" ? process.env.JIANJI_FFMPEG_PATH : process.env.JIANJI_FFPROBE_PATH;
  return executable(override || name);
}

export async function checkCapabilities(appDataDirectory: string): Promise<{ status: CapabilityStatus; adapter?: FfmpegAdapter }> {
  const [ffmpegPath, ffprobePath] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe")]);
  const status: CapabilityStatus = {
    ready: false,
    ffmpeg: Boolean(ffmpegPath),
    ffprobe: Boolean(ffprobePath),
    drawtext: false,
    overlay: false,
    h264Encoder: false,
    aacEncoder: false,
    fonts: Boolean(await executable("fc-match")),
    appDataWritable: false,
  };
  try {
    await access(appDataDirectory, constants.W_OK | constants.X_OK);
    status.appDataWritable = true;
  } catch { /* reported below */ }
  if (!ffmpegPath || !ffprobePath) {
    status.message = "未找到可用的 ffmpeg 或 ffprobe，请安装带 libx264/AAC 的 system FFmpeg。";
    return { status };
  }
  const version = await runCommand(ffmpegPath, ["-version"]).promise;
  const filters = await runCommand(ffmpegPath, ["-hide_banner", "-filters"]).promise;
  const encoders = await runCommand(ffmpegPath, ["-hide_banner", "-encoders"]).promise;
  status.ffmpegVersion = version.stdout.split(/\r?\n/, 1)[0]?.replace(/^ffmpeg version\s*/i, "") || undefined;
  status.drawtext = /\bdrawtext\b/.test(filters.stdout);
  status.overlay = /\boverlay\b/.test(filters.stdout);
  status.h264Encoder = /\blibx264\b/.test(encoders.stdout);
  status.aacEncoder = /\baac\b/.test(encoders.stdout);
  status.ready = status.ffmpeg && status.ffprobe && status.drawtext && status.overlay && status.h264Encoder && status.aacEncoder && status.fonts && status.appDataWritable;
  if (!status.ready) status.message = "本机 FFmpeg 能力不完整，导出入口已锁定。";
  return { status, adapter: new FfmpegAdapter(ffmpegPath, ffprobePath) };
}

export async function resolveFont(fontFamily: string): Promise<string | null> {
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
