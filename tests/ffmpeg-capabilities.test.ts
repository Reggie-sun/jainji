import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkCapabilities, discoverBinary, refreshFontCapabilities } from "../src/main/ffmpeg";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(encoders: string, probeWorks: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-encoder-capabilities-"));
  directories.push(directory);
  const bin = path.join(directory, "tools", "ffmpeg", "bin");
  await mkdir(bin, { recursive: true });
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('-encoders')) console.log(${JSON.stringify(encoders + " aac")});
else if (args.includes('-filters')) console.log('drawtext overlay');
else if (args.includes('-version')) console.log('ffmpeg version fixture');
else process.exit(${probeWorks ? 0 : 1});
`;
  for (const name of ["ffmpeg", "ffprobe"]) {
    await writeFile(path.join(bin, name), script);
    await chmod(path.join(bin, name), 0o700);
  }
  vi.stubEnv("JIANJI_FFMPEG_PATH", "");
  vi.stubEnv("JIANJI_FFPROBE_PATH", "");
  return { directory, bin };
}

it.skipIf(process.platform === "win32")("selects a working app-local GPU encoder even when x264 is absent", async () => {
  const { directory, bin } = await fixture("h264_nvenc", true);
  const result = await checkCapabilities(directory, async () => "/fixture/font.ttf");
  expect(result.status.ready).toBe(true);
  expect(result.status.videoEncoder).toBe("h264_nvenc");
  expect(result.adapter?.ffmpegPath).toBe(path.join(bin, "ffmpeg"));
});

it.skipIf(process.platform === "win32")("reports the CPU route when the NVENC device probe fails", async () => {
  const { directory } = await fixture("h264_nvenc libx264", false);
  const result = await checkCapabilities(directory, async () => "/fixture/font.ttf");
  expect(result.status.ready).toBe(true);
  expect(result.status.videoEncoder).toBe("libx264");
});

it.skipIf(process.platform === "win32")("locks export when neither encoder is usable", async () => {
  const { directory } = await fixture("h264_nvenc", false);
  const result = await checkCapabilities(directory, async () => "/fixture/font.ttf");
  expect(result.status.ready).toBe(false);
  expect(result.status.videoEncoder).toBeUndefined();
});

it.skipIf(process.platform === "win32")("honors an explicit binary override before the app-local engine", async () => {
  const { directory } = await fixture("h264_nvenc", true);
  const override = path.join(directory, "override");
  await writeFile(override, "fixture");
  await chmod(override, 0o700);
  vi.stubEnv("JIANJI_FFMPEG_PATH", override);
  expect(await discoverBinary("ffmpeg", directory)).toBe(override);
});

it.skipIf(process.platform === "win32")("refreshes fonts without changing the encoder chosen at startup", async () => {
  const { directory, bin } = await fixture("h264_nvenc libx264", true);
  const { status } = await checkCapabilities(directory, async () => null);
  expect(status.ready).toBe(false);
  expect(status.videoEncoder).toBe("h264_nvenc");
  // Even if a subsequent device probe would fail, font refresh must not rerun it.
  await writeFile(path.join(bin, "ffmpeg"), `#!${process.execPath}\nprocess.exit(1);\n`);
  const refreshed = await refreshFontCapabilities(status, async () => "/fixture/new-font.ttf");
  expect(refreshed.ready).toBe(true);
  expect(refreshed.message).toBeUndefined();
  expect(refreshed.videoEncoder).toBe("h264_nvenc");
  expect(status.fonts).toBe(false);
});
