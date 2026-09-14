import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveHash = "fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9";
const binaryHashes = {
  "ffmpeg.exe": "72a489eccd008c2ec2c0a5856c5c75bc3d8bbfa90166c4566865c246445e6aa3",
  "ffprobe.exe": "19202b23c0043f15ad1b7bce2344f406fd52bd6efd8f995ce02e7392a1cec52f",
};
const archiveUrl = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip";
const archivePrefix = "ffmpeg-9.0.1-essentials_build";
const generatedRoot = path.join(root, "dist-ffmpeg");
const output = path.join(generatedRoot, "win32-x64");
const archive = process.env.JIANJI_FFMPEG_ARCHIVE
  ? path.resolve(process.env.JIANJI_FFMPEG_ARCHIVE)
  : path.join(generatedRoot, "ffmpeg-9.0.1-essentials_build.zip");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function validArchive() {
  try { return await sha256(archive) === archiveHash; }
  catch { return false; }
}

async function ensureArchive() {
  if (await validArchive()) return;
  if (process.env.JIANJI_FFMPEG_ARCHIVE) throw new Error("JIANJI_FFMPEG_ARCHIVE SHA-256 不匹配或文件不存在。");
  const response = await fetch(archiveUrl);
  if (!response.ok || !response.body) throw new Error(`FFmpeg 下载失败：HTTP ${response.status}`);
  const temporary = `${archive}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (await sha256(temporary) !== archiveHash) throw new Error("FFmpeg 下载包 SHA-256 不匹配。");
    await copyFile(temporary, archive);
  } finally { await rm(temporary, { force: true }); }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("此打包目标需要 Windows x64 构建主机。");
  await mkdir(generatedRoot, { recursive: true });
  await ensureArchive();
  const marker = path.join(output, "archive.sha256");
  try {
    if ((await readFile(marker, "utf8")).trim() === archiveHash) {
      for (const [name, expected] of Object.entries(binaryHashes)) {
        if (await sha256(path.join(output, name)) !== expected) throw new Error(`${name} 校验失败`);
      }
      await Promise.all(["LICENSE", "SOURCE.txt"].map((name) => access(path.join(output, name))));
      console.log("FFmpeg 9.0.1 已就绪（已校验下载包）。");
      return;
    }
  } catch { /* regenerate */ }

  const extracted = path.join(generatedRoot, "extracting");
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });
  try {
    const names = [`${archivePrefix}/bin/ffmpeg.exe`, `${archivePrefix}/bin/ffprobe.exe`, `${archivePrefix}/LICENSE`, `${archivePrefix}/README.txt`];
    const result = spawnSync("tar.exe", ["-xf", archive, "-C", extracted, ...names], { windowsHide: true, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`FFmpeg 解压失败：${result.stderr || result.error?.message || result.status}`);
    await mkdir(output, { recursive: true });
    for (const [source, destination] of [[names[0], "ffmpeg.exe"], [names[1], "ffprobe.exe"], [names[2], "LICENSE"], [names[3], "README.txt"]]) {
      await copyFile(path.join(extracted, source), path.join(output, destination));
    }
    for (const [name, expected] of Object.entries(binaryHashes)) {
      if (await sha256(path.join(output, name)) !== expected) throw new Error(`${name} 解压后 SHA-256 不匹配`);
    }
    await writeFile(path.join(output, "SOURCE.txt"),
      `FFmpeg 9.0.1 essentials build for Windows x64\nBuild: ${archiveUrl}\nUpstream source: https://github.com/FFmpeg/FFmpeg/tree/n9.0.1\nBuild project: https://github.com/GyanD/codexffmpeg\nLicense: see LICENSE in this directory (GPLv3).\n`, "utf8");
    await writeFile(marker, `${archiveHash}\n`, "utf8");
    console.log("FFmpeg 9.0.1 已就绪（含 ffmpeg、ffprobe 与许可证）。");
  } finally { await rm(extracted, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
