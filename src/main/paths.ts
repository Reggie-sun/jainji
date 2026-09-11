import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, constants, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { EditTemplate, MediaItem } from "./domain.js";

export async function fingerprintFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isWritableDirectory(directory: string): Promise<boolean> {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) return false;
    await access(directory, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  if (!(await isWritableDirectory(directory))) throw new Error("Output directory is not writable");
}

export async function canonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export async function pathsEqual(left: string, right: string): Promise<boolean> {
  return (await canonicalPath(left)) === (await canonicalPath(right));
}

export function isPathWithinDirectory(directory: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function assertOutputDirectorySafe(directory: string, mediaItems: readonly MediaItem[]): Promise<void> {
  await ensureDirectory(directory);
  const resolvedOutput = await canonicalPath(directory);
  for (const media of mediaItems) {
    const resolvedSource = await canonicalPath(media.sourcePath);
    if (resolvedOutput === resolvedSource) throw new Error("Output directory cannot be an input file");
  }
}

export function sanitizeFilename(name: string): string {
  const normalized = name
    .replace(/[\\/\0]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  return normalized || "video";
}

export async function allocateOutputPath(
  outputDirectory: string,
  sourcePath: string,
  suffix: string,
  reserved: readonly string[] = [],
): Promise<string> {
  const sourceName = path.basename(sourcePath, path.extname(sourcePath));
  const base = sanitizeFilename(`${sourceName}${suffix}`);
  const used = new Set(reserved.map((entry) => path.resolve(entry)));
  for (let index = 0; ; index += 1) {
    const filename = `${base}${index === 0 ? "" : `_${index}`}.mp4`;
    const candidate = path.resolve(outputDirectory, filename);
    if (used.has(candidate) || await pathExists(candidate)) continue;
    if (await pathsEqual(candidate, sourcePath)) continue;
    return candidate;
  }
}

export async function validateTemplateResources(template: EditTemplate, fontResolver: FontResolver): Promise<string[]> {
  const missing: string[] = [];
  for (const layer of template.layers) {
    if (!layer.visible) continue;
    if (layer.type === "text") {
      if (!(await fontResolver.resolve(layer.fontFamily))) missing.push(`字体：${layer.fontFamily}`);
    } else {
      if (!(await pathExists(layer.assetPath))) {
        missing.push(`贴纸：${path.basename(layer.assetPath)}`);
        continue;
      }
      try {
        if (await fingerprintFile(layer.assetPath) !== layer.assetFingerprint) missing.push(`贴纸已变化：${path.basename(layer.assetPath)}`);
      } catch {
        missing.push(`贴纸不可读取：${path.basename(layer.assetPath)}`);
      }
      const extension = path.extname(layer.assetPath).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) missing.push(`贴纸格式：${path.basename(layer.assetPath)}`);
    }
  }
  return missing;
}

export interface FontResolver {
  resolve(fontFamily: string): Promise<string | null>;
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}
