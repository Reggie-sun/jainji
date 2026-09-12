import { describe, expect, it } from "vitest";
import { binaryCandidates, isAbsolutePath, windowsFontCandidates } from "../src/main/platform";

describe("desktop platform support", () => {
  it("recognizes Windows and POSIX absolute paths", () => {
    expect(isAbsolutePath("C:\\Users\\Jane\\Videos\\clip.mp4", "win32")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\clip.mp4", "win32")).toBe(true);
    expect(isAbsolutePath("clip.mp4", "win32")).toBe(false);
    expect(isAbsolutePath("/home/jane/clip.mp4", "linux")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\Jane\\Videos\\clip.mp4", "linux")).toBe(false);
  });

  it("uses Windows PATH and executable conventions without rewriting absolute overrides", () => {
    expect(binaryCandidates("ffmpeg", "win32", "C:\\tools;D:\\media\\bin")).toEqual([
      "C:\\tools\\ffmpeg.exe",
      "D:\\media\\bin\\ffmpeg.exe",
    ]);
    expect(binaryCandidates("C:\\tools\\ffmpeg.exe", "win32", "ignored")).toEqual(["C:\\tools\\ffmpeg.exe"]);
  });

  it("uses Microsoft YaHei only as the documented default fallback on Windows", () => {
    expect(windowsFontCandidates("Noto Sans CJK SC", "C:\\Windows")).toEqual(["C:\\Windows\\Fonts\\msyh.ttc"]);
    expect(windowsFontCandidates("Microsoft YaHei", "C:\\Windows")).toEqual(["C:\\Windows\\Fonts\\msyh.ttc"]);
    expect(windowsFontCandidates("A made up font", "C:\\Windows")).toEqual([]);
  });
});
