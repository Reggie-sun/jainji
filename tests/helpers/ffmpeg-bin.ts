import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/main/ffmpeg";

// Integration tests must exercise the same ffmpeg generation the app ships with:
// the production code uses options that old PATH shims (e.g. a conda ffmpeg) reject.
// Resolution order mirrors the app: explicit env override, the app's downloaded
// toolchain (Linux userData layout), then PATH. On machines without the app
// toolchain (Windows dev, CI), the existsSync guard falls through to PATH.
const appToolsBin = join(homedir(), ".config", "jianji", "tools", "ffmpeg", "bin");
const pick = (name: "ffmpeg" | "ffprobe", override?: string): string => {
  if (override) return override;
  const local = join(appToolsBin, name);
  return existsSync(local) ? local : name;
};

export const ffmpegBin = pick("ffmpeg", process.env.JIANJI_FFMPEG_PATH);
export const ffprobeBin = pick("ffprobe", process.env.JIANJI_FFPROBE_PATH);

let displayRotationSupport: Promise<boolean> | undefined;
const supportsDisplayRotation = () =>
  (displayRotationSupport ??= runCommand(ffmpegBin, ["-hide_banner", "-h", "full"]).promise.then(
    ({ stdout }) => stdout.includes("-display_rotation"),
    () => false,
  ));

// FFmpeg 7+ replaces the legacy rotate metadata tag with the -display_rotation
// input option; new builds silently drop the tag, old builds reject the option.
// The tag convention is clockwise degrees and ffprobe reports the resulting
// display matrix negated, so a 270-degree fixture is written as rotate=90.
export async function rotateFixtureArgs(degrees: 90 | 270): Promise<{ input: string[]; output: string[] }> {
  if (await supportsDisplayRotation()) return { input: ["-display_rotation", String(degrees)], output: [] };
  return { input: [], output: ["-metadata:s:v:0", `rotate=${degrees === 270 ? 90 : degrees}`] };
}
