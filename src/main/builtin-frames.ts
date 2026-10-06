import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_FRAMES } from "../shared/frames.js";
import { encodeRgbaPng } from "./builtin-stickers.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";

const WIDTH = 720;
const HEIGHT = 1280;
type Rgba = readonly [number, number, number, number];
type Point = readonly [number, number];

const FRAMES = {
  "frame-stars": { border: [255, 185, 18, 255], accent: [255, 225, 112, 255], ink: [44, 38, 23, 255] },
  "frame-hearts": { border: [244, 112, 157, 255], accent: [255, 220, 230, 255], ink: [118, 40, 75, 255] },
  "frame-confetti": { border: [38, 174, 220, 255], accent: [192, 245, 255, 255], ink: [24, 76, 110, 255] },
} as const satisfies Record<string, { border: Rgba; accent: Rgba; ink: Rgba }>;

function setPixel(pixels: Uint8Array, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fillCircle(pixels: Uint8Array, cx: number, cy: number, radius: number, color: Rgba): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(pixels, x, y, color);
    }
  }
}

function fillPolygon(pixels: Uint8Array, points: readonly Point[], color: Rgba): void {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.floor(Math.min(...xs));
  const right = Math.ceil(Math.max(...xs));
  const top = Math.floor(Math.min(...ys));
  const bottom = Math.ceil(Math.max(...ys));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      let inside = false;
      for (let i = 0, previous = points.length - 1; i < points.length; previous = i, i += 1) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[previous];
        if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) setPixel(pixels, x, y, color);
    }
  }
}

function star(cx: number, cy: number, outer: number, inner: number, points = 5): Point[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / points;
    const radius = index % 2 === 0 ? outer : inner;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  });
}

function heart(pixels: Uint8Array, cx: number, cy: number, scale: number, color: Rgba): void {
  for (let y = Math.floor(cy - scale); y <= Math.ceil(cy + scale); y += 1) {
    for (let x = Math.floor(cx - scale); x <= Math.ceil(cx + scale); x += 1) {
      const nx = (x - cx) / scale * 1.35;
      const ny = (cy - y) / scale * 1.35 + 0.18;
      const base = nx * nx + ny * ny - 1;
      if (base ** 3 - nx * nx * ny ** 3 <= 0) setPixel(pixels, x, y, color);
    }
  }
}

function outlinedStar(pixels: Uint8Array, cx: number, cy: number, radius: number, ink: Rgba, fill: Rgba): void {
  fillPolygon(pixels, star(cx, cy, radius, radius * 0.43), ink);
  fillPolygon(pixels, star(cx, cy, radius * 0.78, radius * 0.34), fill);
}

function outlinedHeart(pixels: Uint8Array, cx: number, cy: number, radius: number, ink: Rgba, fill: Rgba): void {
  heart(pixels, cx, cy, radius, ink);
  heart(pixels, cx, cy, radius * 0.77, fill);
}

function drawFrame(id: keyof typeof FRAMES): Buffer {
  const { border, accent, ink } = FRAMES[id];
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const side = Math.round(WIDTH * 0.04);
  const horizontal = Math.round(HEIGHT * 0.04);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (x < side || x >= WIDTH - side || y < horizontal || y >= HEIGHT - horizontal) setPixel(pixels, x, y, border);
    }
  }

  if (id === "frame-stars") {
    outlinedStar(pixels, 71, 78, 39, ink, [255, 226, 100, 255]);
    outlinedStar(pixels, 648, 114, 31, ink, [255, 226, 100, 255]);
    outlinedStar(pixels, 75, 1188, 34, ink, [255, 226, 100, 255]);
    outlinedStar(pixels, 657, 1152, 38, ink, [255, 226, 100, 255]);
    outlinedStar(pixels, 360, 28, 17, ink, accent);
    outlinedStar(pixels, 359, 1252, 21, ink, accent);
    fillCircle(pixels, 123, 43, 7, accent);
    fillCircle(pixels, 601, 1235, 8, accent);
  } else if (id === "frame-hearts") {
    outlinedHeart(pixels, 71, 83, 36, ink, [255, 205, 221, 255]);
    outlinedHeart(pixels, 649, 116, 33, ink, [255, 205, 221, 255]);
    outlinedHeart(pixels, 73, 1181, 34, ink, [255, 205, 221, 255]);
    outlinedHeart(pixels, 654, 1151, 39, ink, [255, 205, 221, 255]);
    outlinedHeart(pixels, 360, 26, 17, ink, accent);
    outlinedHeart(pixels, 358, 1253, 21, ink, accent);
    fillCircle(pixels, 117, 41, 7, accent);
    fillCircle(pixels, 607, 1238, 8, accent);
  } else {
    const colors: readonly Rgba[] = [[255, 224, 100, 255], [255, 132, 153, 255], [133, 231, 176, 255], accent];
    for (const [index, [cx, cy, radius]] of [
      [56, 82, 13], [84, 134, 9], [57, 355, 10], [76, 676, 14], [54, 1008, 11], [79, 1191, 13],
      [662, 87, 11], [640, 355, 13], [666, 693, 9], [644, 1000, 14], [664, 1182, 10], [360, 25, 9], [358, 1254, 12],
    ].entries()) {
      fillCircle(pixels, cx, cy, radius, ink);
      fillCircle(pixels, cx, cy, radius * 0.72, colors[index % colors.length]);
    }
    outlinedStar(pixels, 115, 35, 15, ink, [255, 224, 100, 255]);
    outlinedStar(pixels, 602, 1245, 17, ink, [255, 132, 153, 255]);
    fillPolygon(pixels, [[49, 515], [61, 492], [73, 515]], [255, 224, 100, 255]);
    fillPolygon(pixels, [[647, 826], [659, 803], [671, 826]], [255, 132, 153, 255]);
  }

  return encodeRgbaPng(pixels, WIDTH, HEIGHT);
}

export async function ensureBuiltinFrameAssets(directory: string): Promise<Record<string, BuiltinStickerAsset>> {
  const absoluteDirectory = path.resolve(directory);
  await mkdir(absoluteDirectory, { recursive: true });
  const entries = await Promise.all(BUILTIN_FRAMES.map(async ({ id }) => {
    const contents = drawFrame(id as keyof typeof FRAMES);
    const hash = createHash("sha256").update(contents).digest("hex");
    const assetPath = path.join(absoluteDirectory, `${id}-${hash}.png`);
    try {
      await writeFile(assetPath, contents, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(assetPath);
      if (!existing.equals(contents)) throw new Error(`Built-in frame asset is corrupted: ${assetPath}`);
    }
    return [id, { assetPath, assetFingerprint: `sha256:${hash}` }] as const;
  }));
  return Object.fromEntries(entries);
}
