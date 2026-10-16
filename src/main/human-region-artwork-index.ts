import { randomUUID, createHash } from "node:crypto";
import { open, mkdir, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { decodeShapeCoverPng, readShapeCoverAsset, trimShapeCoverArtwork, type ShapeCoverMediaTools } from "./shape-cover-alpha.js";

const CACHE_SCHEMA = "human-region-artwork-index";
const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const MAX_ALPHA_BYTES = 32 * 1024 * 1024;
const MAX_ALPHA_VARIANTS = 16;
const MAX_TRIM_DIMENSION = 4096;
const DIGEST = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type TrimmedArtwork = Awaited<ReturnType<typeof trimShapeCoverArtwork>>;
type BinaryIdentity = { path: string; size: number; mtimeMs: number };
type DecoderIdentity = { ffmpeg: BinaryIdentity; ffprobe: BinaryIdentity };
type AlphaVariant = { width: number; height: number; deflateBase64: string; sha256: string };
type ArtworkCache = {
  schema: typeof CACHE_SCHEMA;
  version: typeof CACHE_VERSION;
  sourceFingerprint: string;
  decoder: DecoderIdentity;
  trimBox: TrimmedArtwork["trimBox"];
  trimmedPng: { width: number; height: number; base64: string; sha256: string };
  alphaVariants: AlphaVariant[];
};

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function parseBase64(value: unknown, maxBytes: number): Buffer | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4) return undefined;
  const bytes = Buffer.from(value, "base64");
  return bytes.length <= maxBytes && bytes.toString("base64") === value ? bytes : undefined;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function alphaKey(width: number, height: number): string {
  return `${width}x${height}`;
}

async function binaryIdentity(binaryPath: string): Promise<BinaryIdentity | undefined> {
  try {
    const resolvedPath = path.resolve(binaryPath);
    const info = await stat(resolvedPath);
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0 || !Number.isFinite(info.mtimeMs) || info.mtimeMs < 0) return undefined;
    return { path: resolvedPath, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return undefined;
  }
}

async function decoderIdentity(tools: ShapeCoverMediaTools): Promise<DecoderIdentity | undefined> {
  const [ffmpeg, ffprobe] = await Promise.all([binaryIdentity(tools.ffmpegPath), binaryIdentity(tools.ffprobePath)]);
  return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : undefined;
}

function parseBinaryIdentity(value: unknown): BinaryIdentity | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "size", "mtimeMs"])
    || typeof value.path !== "string" || value.path.length === 0
    || !isIntegerBetween(value.size, 0, Number.MAX_SAFE_INTEGER)
    || typeof value.mtimeMs !== "number" || !Number.isFinite(value.mtimeMs) || value.mtimeMs < 0) return undefined;
  return { path: value.path, size: value.size, mtimeMs: value.mtimeMs };
}

function sameDecoder(a: DecoderIdentity, b: DecoderIdentity): boolean {
  return ["ffmpeg", "ffprobe"].every(key => {
    const left = a[key as keyof DecoderIdentity], right = b[key as keyof DecoderIdentity];
    return left.path === right.path && left.size === right.size && left.mtimeMs === right.mtimeMs;
  });
}

function parseTrimBox(value: unknown): TrimmedArtwork["trimBox"] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["x", "y", "width", "height"])) return undefined;
  if (!isIntegerBetween(value.x, 0, MAX_TRIM_DIMENSION - 1) || !isIntegerBetween(value.y, 0, MAX_TRIM_DIMENSION - 1)
    || !isIntegerBetween(value.width, 1, MAX_TRIM_DIMENSION) || !isIntegerBetween(value.height, 1, MAX_TRIM_DIMENSION)
    || value.x + value.width > MAX_TRIM_DIMENSION || value.y + value.height > MAX_TRIM_DIMENSION) return undefined;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function parseArtworkCache(value: unknown, sourceFingerprint: string, expectedDecoder: DecoderIdentity): { cache: ArtworkCache; alpha: Map<string, Buffer> } | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "version", "sourceFingerprint", "decoder", "trimBox", "trimmedPng", "alphaVariants"])
    || value.schema !== CACHE_SCHEMA || value.version !== CACHE_VERSION || value.sourceFingerprint !== sourceFingerprint) return undefined;

  if (!isRecord(value.decoder) || !hasExactKeys(value.decoder, ["ffmpeg", "ffprobe"])) return undefined;
  const ffmpeg = parseBinaryIdentity(value.decoder.ffmpeg), ffprobe = parseBinaryIdentity(value.decoder.ffprobe);
  if (!ffmpeg || !ffprobe) return undefined;
  const decoder = { ffmpeg, ffprobe };
  if (!sameDecoder(decoder, expectedDecoder)) return undefined;

  const trimBox = parseTrimBox(value.trimBox);
  if (!trimBox || !isRecord(value.trimmedPng) || !hasExactKeys(value.trimmedPng, ["width", "height", "base64", "sha256"])) return undefined;
  const width = value.trimmedPng.width, height = value.trimmedPng.height;
  if (width !== trimBox.width || height !== trimBox.height || !DIGEST.test(String(value.trimmedPng.sha256))) return undefined;
  const png = parseBase64(value.trimmedPng.base64, MAX_CACHE_BYTES);
  if (!png || png.length === 0 || digest(png) !== value.trimmedPng.sha256) return undefined;
  const dimensions = pngDimensions(png);
  if (!dimensions || dimensions.width !== width || dimensions.height !== height) return undefined;

  if (!Array.isArray(value.alphaVariants) || value.alphaVariants.length > MAX_ALPHA_VARIANTS) return undefined;
  const alpha = new Map<string, Buffer>();
  const variants: AlphaVariant[] = [];
  let rawBytes = 0;
  for (const item of value.alphaVariants) {
    if (!isRecord(item) || !hasExactKeys(item, ["width", "height", "deflateBase64", "sha256"])) return undefined;
    const variantWidth = item.width, variantHeight = item.height;
    if (!isIntegerBetween(variantWidth, 1, MAX_PIXELS) || !isIntegerBetween(variantHeight, 1, MAX_PIXELS)
      || variantWidth * variantHeight > MAX_PIXELS || !DIGEST.test(String(item.sha256))) return undefined;
    const key = alphaKey(variantWidth, variantHeight);
    if (alpha.has(key)) return undefined;
    const expectedLength = variantWidth * variantHeight;
    rawBytes += expectedLength;
    if (rawBytes > MAX_ALPHA_BYTES) return undefined;
    const compressed = parseBase64(item.deflateBase64, MAX_CACHE_BYTES);
    if (!compressed || compressed.length === 0) return undefined;
    let raster: Buffer;
    try { raster = inflateSync(compressed, { maxOutputLength: expectedLength }); } catch { return undefined; }
    if (raster.length !== expectedLength || digest(raster) !== item.sha256) return undefined;
    alpha.set(key, raster);
    variants.push({ width: variantWidth, height: variantHeight, deflateBase64: item.deflateBase64 as string, sha256: item.sha256 as string });
  }

  return {
    cache: {
      schema: CACHE_SCHEMA,
      version: CACHE_VERSION,
      sourceFingerprint,
      decoder,
      trimBox,
      trimmedPng: { width, height, base64: value.trimmedPng.base64 as string, sha256: value.trimmedPng.sha256 as string },
      alphaVariants: variants,
    },
    alpha,
  };
}

async function readBoundedFile(filePath: string, signal?: AbortSignal): Promise<Buffer | undefined> {
  let file;
  try {
    file = await open(filePath, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size < 0 || info.size > MAX_CACHE_BYTES) return undefined;
    const capacity = info.size + 1;
    const bytes = Buffer.allocUnsafe(capacity);
    let total = 0;
    while (total < capacity) {
      signal?.throwIfAborted();
      const length = Math.min(64 * 1024, capacity - total);
      const { bytesRead } = await file.read(bytes, total, length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total === info.size ? bytes.subarray(0, total) : undefined;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function decodeCache(bytes: Buffer, sourceFingerprint: string, decoder: DecoderIdentity): { cache: ArtworkCache; alpha: Map<string, Buffer> } | undefined {
  try { return parseArtworkCache(JSON.parse(bytes.toString("utf8")), sourceFingerprint, decoder); }
  catch { return undefined; }
}

function cachePath(root: string, sourceFingerprint: string): string {
  const hash = sourceFingerprint.slice("sha256:".length);
  return path.join(root, `${hash}.json`);
}

function serializedCache(cache: ArtworkCache, alpha: Map<string, Buffer>): Buffer | undefined {
  const variants: AlphaVariant[] = [];
  for (const [key, raster] of alpha) {
    const [widthText, heightText] = key.split("x");
    const width = Number(widthText), height = Number(heightText);
    variants.push({ width, height, deflateBase64: deflateSync(raster).toString("base64"), sha256: digest(raster) });
  }
  while (true) {
    const json = Buffer.from(JSON.stringify({ ...cache, alphaVariants: variants }), "utf8");
    if (json.length <= MAX_CACHE_BYTES) return json;
    if (variants.length === 0) return undefined;
    variants.shift();
  }
}

async function writeAtomically(filePath: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
  const directory = path.dirname(filePath);
  let temporary: string | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    signal?.throwIfAborted();
    temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      signal?.throwIfAborted();
    } finally {
      await file.close();
    }
    signal?.throwIfAborted();
    await rename(temporary, filePath);
    temporary = undefined;
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}

async function persistBestEffort(filePath: string, cache: ArtworkCache, alpha: Map<string, Buffer>, signal?: AbortSignal): Promise<void> {
  try {
    const bytes = serializedCache(cache, alpha);
    if (!bytes) return;
    signal?.throwIfAborted();
    await writeAtomically(filePath, bytes, signal);
  } catch {
    signal?.throwIfAborted();
  }
}

function trimCacheBytes(cache: ArtworkCache): Buffer {
  return Buffer.from(cache.trimmedPng.base64, "base64");
}

function isSupportedTrimBox(trimBox: TrimmedArtwork["trimBox"]): boolean {
  return !!parseTrimBox(trimBox);
}

export async function loadHumanRegionArtworkIndex(asset: BuiltinStickerAsset, bytes: Buffer, tools: ShapeCoverMediaTools): Promise<{
  trimmed: TrimmedArtwork;
  alpha(width: number, height: number, produce: () => Promise<Uint8Array>): Promise<Uint8Array>;
}> {
  const sourceFingerprint = `sha256:${digest(bytes)}`;
  if (asset.assetFingerprint !== sourceFingerprint) throw new Error("sticker asset fingerprint mismatch");
  tools.signal?.throwIfAborted();

  const root = tools.artworkIndexDirectory ? path.resolve(tools.artworkIndexDirectory) : undefined;
  const decoder = root ? await decoderIdentity(tools) : undefined;
  const filePath = root && decoder ? cachePath(root, sourceFingerprint) : undefined;
  let cache: ArtworkCache | undefined;
  let alpha = new Map<string, Buffer>();
  let persistable = !!filePath && !!decoder;

  if (filePath && decoder) {
    const contents = await readBoundedFile(filePath, tools.signal);
    tools.signal?.throwIfAborted();
    const parsed = contents && decodeCache(contents, sourceFingerprint, decoder);
    if (parsed) {
      cache = parsed.cache;
      alpha = parsed.alpha;
    }
  }

  let trimmed: TrimmedArtwork | undefined;
  if (cache) {
    const png = trimCacheBytes(cache);
    // The stored PNG is retained only after its digest and header dimensions have passed validation.
    try {
      await decodeShapeCoverPng(png, { width: cache.trimBox.width, height: cache.trimBox.height }, tools);
      trimmed = { bytes: png, trimBox: cache.trimBox, sha256: cache.trimmedPng.sha256 };
    } catch {
      tools.signal?.throwIfAborted();
      cache = undefined; alpha = new Map();
    }
  }
  if (!trimmed) {
    trimmed = await trimShapeCoverArtwork(bytes, tools);
    tools.signal?.throwIfAborted();
    if (filePath && decoder && isSupportedTrimBox(trimmed.trimBox)) {
      const dimensions = pngDimensions(trimmed.bytes);
      if (dimensions?.width === trimmed.trimBox.width && dimensions.height === trimmed.trimBox.height
        && trimmed.bytes.length <= MAX_CACHE_BYTES && digest(trimmed.bytes) === trimmed.sha256) {
        cache = {
          schema: CACHE_SCHEMA,
          version: CACHE_VERSION,
          sourceFingerprint,
          decoder,
          trimBox: trimmed.trimBox,
          trimmedPng: { width: trimmed.trimBox.width, height: trimmed.trimBox.height, base64: trimmed.bytes.toString("base64"), sha256: trimmed.sha256 },
          alphaVariants: [],
        };
        await persistBestEffort(filePath, cache, alpha, tools.signal);
      } else {
        persistable = false;
      }
    } else {
      persistable = false;
    }
  }

  return {
    trimmed: { ...trimmed, bytes: Buffer.from(trimmed.bytes) },
    async alpha(width, height, produce) {
      tools.signal?.throwIfAborted();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
        throw new Error("invalid final-pixel alpha raster size");
      }
      const expectedLength = width * height;
      const key = alphaKey(width, height);
      const cached = alpha.get(key);
      if (cached) return new Uint8Array(cached);

      const produced = await produce();
      tools.signal?.throwIfAborted();
      if (!(produced instanceof Uint8Array) || produced.byteLength !== expectedLength) throw new Error("incomplete final-pixel alpha raster");
      const raster = Buffer.from(produced);
      if (alpha.has(key)) alpha.delete(key);
      alpha.set(key, raster);
      let retained = [...alpha.entries()];
      let rawBytes = retained.reduce((total, [, value]) => total + value.length, 0);
      while (retained.length > MAX_ALPHA_VARIANTS || rawBytes > MAX_ALPHA_BYTES) {
        const [oldestKey, oldest] = retained.shift()!;
        alpha.delete(oldestKey);
        rawBytes -= oldest.length;
      }
      if (persistable && cache && filePath) await persistBestEffort(filePath, cache, alpha, tools.signal);
      return new Uint8Array(raster);
    },
  };
}

export async function prepareHumanRegionArtworkIndex(asset: BuiltinStickerAsset, tools: ShapeCoverMediaTools): Promise<void> {
  try {
    const bytes = await readShapeCoverAsset(asset, tools);
    await loadHumanRegionArtworkIndex(asset, bytes, tools);
  } catch {
    // This is derived data for ordinary uploads. Cover production uses the
    // strict loader and still binds/validates the actual artwork before export.
    tools.signal?.throwIfAborted();
  }
}
