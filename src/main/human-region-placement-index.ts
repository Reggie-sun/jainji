import { randomUUID } from "node:crypto";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { HumanPixelBox } from "../shared/human-region-cover.js";
import { SHAPE_COVER_ALPHA_VERSION, readShapeCoverAsset, rasterizeClippedShapeArtwork,
  type ShapeCoverMediaTools, type ShapeCoverPlacement } from "./shape-cover-alpha.js";
import type { PixelSize } from "./shape-cover-pixel-gate.js";
import { searchHybridCornerShape, type HybridArtworkCache, type HybridStickerCandidate, type HybridShapeMatch } from "./shape-cover-hybrid-shape.js";
import { loadHumanRegionArtworkIndex } from "./human-region-artwork-index.js";
import { humanRegionArtworkScope, opaqueRegionCovered } from "./human-region-geometry.js";
import { shapeCoverDigest } from "./shape-cover-render.js";

const VERSION = "human-region-placement/v1";
const MAX_BYTES = 8192;
const digest = (value: unknown) => shapeCoverDigest(Buffer.from(JSON.stringify(value)));
type Match = Pick<HybridShapeMatch, "placement" | "raster">;

async function decoderIdentity(tools: ShapeCoverMediaTools) {
  try {
    return await Promise.all([tools.ffmpegPath, tools.ffprobePath].map(async binary => {
      const file = path.resolve(binary), info = await stat(file);
      if (!info.isFile()) throw Error("missing decoder");
      return { path: file, size: info.size, mtimeMs: info.mtimeMs };
    }));
  } catch { tools.signal?.throwIfAborted(); return undefined; }
}

/** Only a search hint: the current artwork is always decoded and checked again. */
function allowedPlacement(value: unknown, target: HumanPixelBox, canvas: PixelSize): value is ShapeCoverPlacement {
  if (!value || typeof value !== "object") return false;
  const p = value as ShapeCoverPlacement, scope = humanRegionArtworkScope(target);
  if (Object.keys(p).sort().join() !== "height,width,x,y"
    || ![p.x, p.y, p.width, p.height].every(Number.isSafeInteger)
    || p.width <= 0 || p.height <= 0 || p.width > scope.width || p.height > scope.height || p.width * p.height > 16_777_216) return false;
  const left = Math.max(target.x + target.width - p.width, scope.x > 0 ? scope.x : -p.width);
  const top = Math.max(target.y + target.height - p.height, scope.y > 0 ? scope.y : -p.height);
  const right = Math.min(target.x, scope.x + scope.width < canvas.width ? scope.x + scope.width - p.width : canvas.width);
  const bottom = Math.min(target.y, scope.y + scope.height < canvas.height ? scope.y + scope.height - p.height : canvas.height);
  return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
}

async function readPlacement(filePath: string, identity: unknown, target: HumanPixelBox, canvas: PixelSize, signal?: AbortSignal): Promise<ShapeCoverPlacement | undefined> {
  let file;
  try {
    signal?.throwIfAborted();
    file = await open(filePath, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) return;
    const bytes = Buffer.alloc(info.size + 1), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) return;
    const cached = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    if (!cached || Object.keys(cached).sort().join() !== "digest,identity,placement"
      || JSON.stringify(cached.identity) !== JSON.stringify(identity)
      || !allowedPlacement(cached.placement, target, canvas)
      || cached.digest !== digest({ identity: cached.identity, placement: cached.placement })) return;
    return cached.placement;
  } catch { signal?.throwIfAborted(); return undefined; }
  finally { await file?.close().catch(() => undefined); }
}

async function writePlacement(filePath: string, identity: unknown, placement: ShapeCoverPlacement, signal?: AbortSignal) {
  let temporary: string | undefined;
  try {
    const body = { identity, placement }, bytes = Buffer.from(JSON.stringify({ ...body, digest: digest(body) }));
    if (bytes.length > MAX_BYTES) return;
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    signal?.throwIfAborted();
    temporary = `${filePath}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
    signal?.throwIfAborted();
    await rename(temporary, filePath); temporary = undefined;
  } catch { signal?.throwIfAborted(); }
  finally { if (temporary) await unlink(temporary).catch(() => undefined); }
}

/** Persist geometry per target/artwork, without persisting selection, approval or frozen bindings. */
export async function matchHumanRegionArtwork(candidate: HybridStickerCandidate, bitmap: Uint8Array, canvas: PixelSize,
  target: HumanPixelBox, sourceScale: number, tools: ShapeCoverMediaTools, artworkCache: HybridArtworkCache): Promise<Match | null> {
  tools.signal?.throwIfAborted();
  if (!tools.artworkIndexDirectory) return searchHybridCornerShape([candidate], bitmap, canvas, humanRegionArtworkScope(target), sourceScale,
    tools, "compact-artwork", artworkCache);
  const decoder = tools.artworkIndexDirectory ? await decoderIdentity(tools) : undefined;
  const identity = { version: VERSION, rasterVersion: SHAPE_COVER_ALPHA_VERSION, decoder,
    artworkFingerprint: candidate.asset.assetFingerprint, target, canvas, scope: humanRegionArtworkScope(target),
    maskSha256: shapeCoverDigest(bitmap), sourceScale };
  const filePath = decoder && tools.artworkIndexDirectory
    ? path.join(tools.artworkIndexDirectory, "placements", `${digest(identity)}.json`) : undefined;
  const placement = filePath && await readPlacement(filePath, identity, target, canvas, tools.signal);
  tools.signal?.throwIfAborted();
  if (placement) {
    // A matching file never grants authority to stale asset bytes or an old task's binding.
    const bytes = await readShapeCoverAsset(candidate.asset, tools);
    const { trimmed } = await loadHumanRegionArtworkIndex(candidate.asset, bytes, tools);
    const raster = await rasterizeClippedShapeArtwork(trimmed.bytes, canvas, placement, tools);
    tools.signal?.throwIfAborted();
    if (opaqueRegionCovered(raster.alpha, canvas, target)) return { placement, raster };
  }
  const matched = await searchHybridCornerShape([candidate], bitmap, canvas, humanRegionArtworkScope(target), sourceScale,
    tools, "compact-artwork", artworkCache);
  if (matched && filePath) await writePlacement(filePath, identity, matched.placement, tools.signal);
  tools.signal?.throwIfAborted();
  return matched;
}
