import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

const MATERIAL_DIRECTORY_NAME = /^素材(?:[0-9]+)?$/;
const VIDEO_DIRECTORY_NAME = "视频";

function productRootForSource(sourcePath: string): string | undefined {
  let directory = path.dirname(path.resolve(sourcePath));
  while (true) {
    if (MATERIAL_DIRECTORY_NAME.test(path.basename(directory))) return path.dirname(directory);
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function outputDirectoryName(at: Date): string {
  const separator = process.platform === "win32" ? "：" : ":";
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${at.getMonth() + 1}.${at.getDate()} ${hours}${separator}${minutes}`;
}

function automaticVideoRoot(sourcePaths: readonly string[]): string {
  if (!sourcePaths.length) throw new Error("请先选择素材，再自动创建成片目录。");
  const roots = sourcePaths.map(productRootForSource);
  if (roots.some((root) => !root)) {
    throw new Error("无法从素材位置识别产品目录。请把素材放在“产品/素材”或“产品/素材2”等目录中，或手动选择成片目录。");
  }
  const productRoots = new Set(roots as string[]);
  if (productRoots.size !== 1) {
    throw new Error("所选素材来自不同产品目录，无法自动确定成片位置。请只选择同一产品的素材，或手动选择成片目录。");
  }

  return path.join([...productRoots][0], VIDEO_DIRECTORY_NAME);
}

export async function createAutomaticOutputDirectory(sourcePaths: readonly string[], at = new Date(), existingDirectory?: string): Promise<string> {
  const videoRoot = automaticVideoRoot(sourcePaths);
  if (existingDirectory) {
    const existing = path.resolve(existingDirectory);
    const automaticName = /^\d{1,2}\.\d{1,2} \d{2}[:：]\d{2}(?: \(\d+\))?$/;
    if (path.dirname(existing) !== path.resolve(videoRoot) || !automaticName.test(path.basename(existing))) {
      throw new Error("原自动成片目录与当前素材不匹配，请重新生成预览。");
    }
    const info = await lstat(existing).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error("原自动成片目录已不存在，请重新生成预览。");
    return existing;
  }
  await mkdir(videoRoot, { recursive: true });
  const baseName = outputDirectoryName(at);
  for (let copy = 1; copy <= 10_000; copy += 1) {
    const candidate = path.join(videoRoot, copy === 1 ? baseName : `${baseName} (${copy})`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("同一分钟的成片目录过多，无法创建新的输出目录。");
}
