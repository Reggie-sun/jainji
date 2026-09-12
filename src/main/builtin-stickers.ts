import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { StickerId } from "../shared/agent.js";

export interface BuiltinStickerAsset {
  assetPath: string;
  assetFingerprint: string;
}

export type BuiltinStickerAssets = Readonly<Record<StickerId, BuiltinStickerAsset>>;

type Rgba = readonly [number, number, number, number];
type Point = readonly [number, number];

const SIZE = 256;
const STICKER_IDS: readonly StickerId[] = ["sparkle", "arrow", "heart", "burst"];

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data = Buffer.alloc(0)): Buffer {
  const type = Buffer.from(name, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return chunk;
}

function encodePng(pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    scanlines[row] = 0;
    scanlines.set(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), row + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

function setPixel(pixels: Uint8Array, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (Math.floor(y) * SIZE + Math.floor(x)) * 4;
  pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3];
}

function fillCircle(pixels: Uint8Array, cx: number, cy: number, radius: number, color: Rgba): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(pixels, x, y, color);
    }
  }
}

function insidePolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, previous = points.length - 1; i < points.length; previous = i, i += 1) {
    const [xi, yi] = points[i]; const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fillPolygon(pixels: Uint8Array, points: readonly Point[], color: Rgba): void {
  const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += 1) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += 1) {
      if (insidePolygon(x + 0.5, y + 0.5, points)) setPixel(pixels, x, y, color);
    }
  }
}

function star(cx: number, cy: number, outer: number, inner: number, points: number, rotation = -Math.PI / 2): Point[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const angle = rotation + index * Math.PI / points;
    const radius = index % 2 === 0 ? outer : inner;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  });
}

function distanceToSegment(x: number, y: number, start: Point, end: Point): number {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared));
  return Math.hypot(x - (start[0] + t * dx), y - (start[1] + t * dy));
}

function strokePath(pixels: Uint8Array, points: readonly Point[], width: number, color: Rgba): void {
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    if (points.slice(1).some((point, index) => distanceToSegment(x, y, points[index], point) <= width / 2)) setPixel(pixels, x, y, color);
  }
}

function fillHeart(pixels: Uint8Array, cx: number, cy: number, scale: number, color: Rgba): void {
  for (let y = Math.floor(cy - scale); y <= Math.ceil(cy + scale); y += 1) for (let x = Math.floor(cx - scale); x <= Math.ceil(cx + scale); x += 1) {
    const nx = (x - cx) / scale * 1.35;
    const ny = (cy - y) / scale * 1.35 + 0.18;
    const base = nx * nx + ny * ny - 1;
    if (base ** 3 - nx * nx * ny ** 3 <= 0) setPixel(pixels, x, y, color);
  }
}

function stickerPng(id: StickerId): Buffer {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const white: Rgba = [255, 255, 255, 255];
  if (id === "sparkle") {
    fillPolygon(pixels, star(128, 128, 108, 22, 4), white);
    fillPolygon(pixels, star(128, 128, 94, 17, 4), [255, 204, 52, 255]);
    fillCircle(pixels, 54, 50, 13, white); fillCircle(pixels, 54, 50, 8, [255, 224, 102, 255]);
    fillCircle(pixels, 204, 190, 10, white); fillCircle(pixels, 204, 190, 6, [255, 224, 102, 255]);
  } else if (id === "arrow") {
    const path: Point[] = [[42, 178], [79, 178], [105, 156], [132, 110], [187, 91]];
    strokePath(pixels, path, 35, white); strokePath(pixels, path, 21, [54, 217, 196, 255]);
    fillPolygon(pixels, [[166, 49], [226, 74], [194, 132]], white);
    fillPolygon(pixels, [[174, 62], [211, 77], [191, 113]], [54, 217, 196, 255]);
  } else if (id === "heart") {
    fillHeart(pixels, 128, 130, 105, white);
    fillHeart(pixels, 128, 130, 91, [244, 89, 111, 255]);
    fillCircle(pixels, 99, 91, 13, [255, 160, 173, 255]);
  } else {
    fillPolygon(pixels, star(128, 128, 112, 78, 12, -Math.PI / 24), white);
    fillPolygon(pixels, star(128, 128, 96, 67, 12, -Math.PI / 24), [255, 116, 52, 255]);
    fillCircle(pixels, 128, 128, 53, [255, 221, 67, 255]);
  }
  return encodePng(pixels);
}

export async function ensureBuiltinStickerAssets(directory: string): Promise<BuiltinStickerAssets> {
  const absoluteDirectory = path.resolve(directory);
  await mkdir(absoluteDirectory, { recursive: true });
  const entries = await Promise.all(STICKER_IDS.map(async (id) => {
    const contents = stickerPng(id);
    const hash = createHash("sha256").update(contents).digest("hex");
    const assetPath = path.join(absoluteDirectory, `${id}-${hash.slice(0, 12)}.png`);
    try {
      if (!(await readFile(assetPath)).equals(contents)) await writeFile(assetPath, contents);
    } catch {
      await writeFile(assetPath, contents);
    }
    return [id, { assetPath, assetFingerprint: `sha256:${hash}` }] as const;
  }));
  return Object.fromEntries(entries) as BuiltinStickerAssets;
}
