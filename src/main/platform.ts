import path from "node:path";
import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults.js";

export type SupportedPlatform = "linux" | "win32" | string;

function hostPath(platform: SupportedPlatform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

export function isAbsolutePath(value: string, platform: SupportedPlatform = process.platform): boolean {
  return hostPath(platform).isAbsolute(value);
}

export function binaryCandidates(command: string, platform: SupportedPlatform = process.platform, pathValue = process.env.PATH ?? ""): string[] {
  const paths = hostPath(platform);
  if (paths.isAbsolute(command)) return [command];
  const executable = platform === "win32" && paths.extname(command) === "" ? `${command}.exe` : command;
  return pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean).map((directory) => paths.join(directory, executable));
}

const WINDOWS_FONT_FILES: Readonly<Record<string, readonly string[]>> = {
  "microsoft yahei": ["msyh.ttc"],
  "microsoft yahei ui": ["msyh.ttc"],
  "microsoft jhenghei": ["msjh.ttc"],
  "simhei": ["simhei.ttf"],
  "simsun": ["simsun.ttc"],
  "nsimsun": ["simsun.ttc"],
  "fangsong": ["simfang.ttf"],
  "kaiti": ["simkai.ttf"],
  "segoe ui": ["segoeui.ttf"],
};

/**
 * Windows does not ship fontconfig. The default Noto font therefore resolves to
 * Microsoft YaHei, while other requests must be one of these explicit families.
 */
export function windowsFontCandidates(fontFamily: string, windowsDirectory = process.env.WINDIR ?? "C:\\Windows"): string[] {
  const requested = fontFamily.trim().toLocaleLowerCase();
  const resolvedFamily = requested === DEFAULT_TEXT_FONT_FAMILY.toLocaleLowerCase() ? "microsoft yahei" : requested;
  return (WINDOWS_FONT_FILES[resolvedFamily] ?? []).map((file) => path.win32.join(windowsDirectory, "Fonts", file));
}
