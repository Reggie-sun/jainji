import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { CoverPreviewPathSchema, type CoverReviewDraft } from "../shared/cover-review.js";
import { isPathWithinDirectory } from "./paths.js";

export async function previewDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function removeUnreferencedPreviews(rootDirectory: string, discarded: readonly { preview?: { relativePath: string } }[], retained: readonly CoverReviewDraft[]): Promise<void> {
  const root = await realpath(rootDirectory).catch(() => undefined);
  if (!root) return;
  const references = new Set(await Promise.all(retained.flatMap((draft) => draft.frozen.flatMap(({ preview }) => preview ? [realpath(path.resolve(root, preview.relativePath)).catch(() => undefined)] : []))));
  for (const { preview } of discarded) {
    if (!preview || !CoverPreviewPathSchema.safeParse(preview.relativePath).success) continue;
    const requested = path.resolve(root, preview.relativePath);
    const file = await realpath(requested).catch(() => undefined);
    if (!file || file !== requested || references.has(file) || !isPathWithinDirectory(root, file) || !(await lstat(file)).isFile()) continue;
    await unlink(file);
  }
}
