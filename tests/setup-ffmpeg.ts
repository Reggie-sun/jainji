import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Real-media tests must exercise the same ffmpeg generation the app ships with;
// old PATH shims (e.g. a conda ffmpeg) reject options the production code uses.
// Mirror the app's documented engine lookup for tests that call discoverBinary
// without an appDataDirectory: explicit env first, then the downloaded toolchain
// under the Linux userData layout. Machines without the app toolchain (Windows
// dev, CI runners) keep their PATH behavior, and an explicit override wins.
const toolsBin = join(homedir(), ".config", "jianji", "tools", "ffmpeg", "bin");
if (!process.env.JIANJI_FFMPEG_PATH) {
  const candidate = join(toolsBin, "ffmpeg");
  if (existsSync(candidate)) process.env.JIANJI_FFMPEG_PATH = candidate;
}
if (!process.env.JIANJI_FFPROBE_PATH) {
  const candidate = join(toolsBin, "ffprobe");
  if (existsSync(candidate)) process.env.JIANJI_FFPROBE_PATH = candidate;
}
