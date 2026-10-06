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
  "frame-strawberries": { border: [255, 224, 208, 255], accent: [241, 81, 99, 255], ink: [119, 43, 52, 255] },
  "frame-daisies": { border: [255, 212, 97, 255], accent: [255, 251, 229, 255], ink: [122, 85, 33, 255] },
  "frame-clovers": { border: [118, 201, 145, 255], accent: [211, 244, 174, 255], ink: [31, 108, 65, 255] },
  "frame-clouds": { border: [146, 212, 248, 255], accent: [255, 255, 250, 255], ink: [63, 126, 179, 255] },
  "frame-moons": { border: [57, 51, 103, 255], accent: [255, 229, 144, 255], ink: [175, 160, 230, 255] },
  "frame-butterflies": { border: [211, 185, 245, 255], accent: [255, 218, 239, 255], ink: [110, 62, 142, 255] },
  "frame-bubbles": { border: [71, 189, 186, 255], accent: [198, 251, 245, 255], ink: [25, 119, 138, 255] },
  "frame-rainbows": { border: [255, 217, 228, 255], accent: [255, 251, 241, 255], ink: [145, 85, 132, 255] },
  "frame-film": { border: [40, 41, 47, 255], accent: [247, 236, 211, 255], ink: [151, 139, 119, 255] },
  "frame-geometric": { border: [249, 141, 72, 255], accent: [255, 233, 167, 255], ink: [82, 61, 87, 255] },
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

function ellipse(pixels: Uint8Array, cx: number, cy: number, rx: number, ry: number, color: Rgba): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) setPixel(pixels, x, y, color);
    }
  }
}

function motif(pixels: Uint8Array, id: keyof typeof FRAMES, cx: number, cy: number, r: number): void {
  const { accent, ink } = FRAMES[id];
  const white: Rgba = [255, 255, 248, 255];
  const green: Rgba = [66, 153, 90, 255];
  if (id === "frame-strawberries") {
    const fruit: Point[] = [[cx - r, cy - r * 0.4], [cx - r * 0.7, cy - r * 0.8], [cx + r * 0.7, cy - r * 0.8], [cx + r, cy - r * 0.4], [cx + r * 0.6, cy + r * 0.6], [cx, cy + r], [cx - r * 0.6, cy + r * 0.6]];
    fillPolygon(pixels, fruit, ink);
    fillPolygon(pixels, fruit.map(([x, y]) => [cx + (x - cx) * 0.87, cy + (y - cy) * 0.87]), accent);
    fillPolygon(pixels, star(cx, cy - r * 0.65, r * 0.6, r * 0.2), green);
    for (const [x, y] of [[-0.4, -0.15], [0.35, -0.15], [0, 0.15], [-0.25, 0.45], [0.25, 0.45]]) ellipse(pixels, cx + x * r, cy + y * r, r * 0.055, r * 0.1, white);
  } else if (id === "frame-daisies") {
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4;
      const x = cx + Math.cos(a) * r * 0.58; const y = cy + Math.sin(a) * r * 0.58;
      fillCircle(pixels, x, y, r * 0.4, ink);
      fillCircle(pixels, x, y, r * 0.33, accent);
    }
    fillCircle(pixels, cx, cy, r * 0.37, ink);
    fillCircle(pixels, cx, cy, r * 0.28, [255, 174, 49, 255]);
  } else if (id === "frame-clovers") {
    fillPolygon(pixels, [[cx - r * 0.1, cy], [cx + r * 0.12, cy], [cx + r * 0.35, cy + r], [cx + r * 0.12, cy + r]], ink);
    for (const [x, y] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
      fillCircle(pixels, cx + x * r, cy + y * r, r * 0.53, ink);
      fillCircle(pixels, cx + x * r, cy + y * r, r * 0.43, accent);
    }
    fillCircle(pixels, cx, cy, r * 0.13, ink);
  } else if (id === "frame-clouds") {
    for (const [x, y, radius] of [[-0.6, 0.1, 0.44], [0, -0.25, 0.62], [0.6, 0.1, 0.44]]) fillCircle(pixels, cx + x * r, cy + y * r, radius * r + r * 0.08, ink);
    for (const [x, y, radius] of [[-0.6, 0.1, 0.44], [0, -0.25, 0.62], [0.6, 0.1, 0.44]]) fillCircle(pixels, cx + x * r, cy + y * r, radius * r, accent);
    fillPolygon(pixels, [[cx - r * 0.65, cy], [cx + r * 0.65, cy], [cx + r * 0.65, cy + r * 0.5], [cx - r * 0.65, cy + r * 0.5]], accent);
  } else if (id === "frame-moons") {
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y <= r * r && (x - r * 0.42) ** 2 + (y + r * 0.28) ** 2 > (r * 0.87) ** 2) setPixel(pixels, cx + x, cy + y, accent);
    }
    outlinedStar(pixels, cx + r * 0.65, cy + r * 0.65, r * 0.35, ink, white);
  } else if (id === "frame-butterflies") {
    for (const direction of [-1, 1]) {
      ellipse(pixels, cx + direction * r * 0.48, cy - r * 0.28, r * 0.53, r * 0.66, ink);
      ellipse(pixels, cx + direction * r * 0.48, cy - r * 0.28, r * 0.43, r * 0.55, accent);
      ellipse(pixels, cx + direction * r * 0.4, cy + r * 0.48, r * 0.4, r * 0.43, ink);
      ellipse(pixels, cx + direction * r * 0.4, cy + r * 0.48, r * 0.3, r * 0.33, [172, 137, 219, 255]);
      fillCircle(pixels, cx + direction * r * 0.5, cy - r * 0.4, r * 0.14, white);
      ellipse(pixels, cx + direction * r * 0.18, cy - r * 0.8, r * 0.06, r * 0.28, ink);
    }
    ellipse(pixels, cx, cy, r * 0.12, r * 0.68, ink);
  } else if (id === "frame-bubbles") {
    fillCircle(pixels, cx, cy, r, ink);
    fillCircle(pixels, cx, cy, r * 0.9, accent);
    fillCircle(pixels, cx + r * 0.12, cy + r * 0.14, r * 0.72, [117, 220, 219, 255]);
    ellipse(pixels, cx - r * 0.4, cy - r * 0.4, r * 0.15, r * 0.25, white);
    fillCircle(pixels, cx + r * 0.95, cy - r * 0.7, r * 0.25, ink);
    fillCircle(pixels, cx + r * 0.95, cy - r * 0.7, r * 0.18, white);
  } else if (id === "frame-rainbows") {
    const colors: readonly Rgba[] = [[240, 107, 127, 255], [255, 189, 103, 255], [255, 234, 132, 255], [124, 199, 161, 255], [118, 177, 227, 255]];
    for (let y = -r; y <= 0; y += 1) for (let x = -r; x <= r; x += 1) {
      const radius = Math.hypot(x, y);
      if (radius <= r && radius >= r * 0.35) setPixel(pixels, cx + x, cy + y, colors[Math.min(4, Math.floor((r - radius) / (r * 0.13)))]);
    }
    for (const direction of [-1, 1]) {
      fillCircle(pixels, cx + direction * r * 0.7, cy, r * 0.35, white);
      fillCircle(pixels, cx + direction * r, cy + r * 0.08, r * 0.25, white);
    }
  } else if (id === "frame-film") {
    fillPolygon(pixels, [[cx - r, cy - r * 0.8], [cx + r, cy - r * 0.8], [cx + r, cy + r * 0.7], [cx - r, cy + r * 0.7]], ink);
    fillPolygon(pixels, [[cx - r * 0.85, cy - r * 0.3], [cx + r * 0.85, cy - r * 0.3], [cx + r * 0.85, cy + r * 0.55], [cx - r * 0.85, cy + r * 0.55]], accent);
    for (let x = -0.8; x < 0.9; x += 0.55) fillPolygon(pixels, [[cx + r * x, cy - r * 0.7], [cx + r * (x + 0.3), cy - r * 0.7], [cx + r * (x + 0.1), cy - r * 0.4], [cx + r * (x - 0.2), cy - r * 0.4]], accent);
  } else if (id === "frame-geometric") {
    fillPolygon(pixels, [[cx, cy - r], [cx + r, cy + r * 0.75], [cx - r, cy + r * 0.75]], ink);
    fillPolygon(pixels, [[cx, cy - r * 0.7], [cx + r * 0.75, cy + r * 0.6], [cx - r * 0.75, cy + r * 0.6]], accent);
    fillCircle(pixels, cx + r * 0.75, cy - r * 0.45, r * 0.37, [155, 221, 215, 255]);
    fillPolygon(pixels, [[cx - r, cy], [cx - r * 0.6, cy - r * 0.4], [cx - r * 0.2, cy], [cx - r * 0.6, cy + r * 0.4]], [228, 124, 177, 255]);
  }
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
  } else if (id === "frame-confetti") {
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
  } else {
    for (const [cx, cy] of [[63, 85], [657, 103], [63, 1180], [657, 1168]]) motif(pixels, id, cx, cy, 43);
    for (const y of [330, 620, 910]) {
      motif(pixels, id, 23, y, 19);
      motif(pixels, id, 697, y + 55, 19);
    }
    for (const x of [230, 490]) {
      motif(pixels, id, x, 27, 20);
      motif(pixels, id, 720 - x, 1253, 20);
    }
    if (id === "frame-film") {
      for (let y = 165; y < 1130; y += 48) {
        for (const x of [8, 704]) fillPolygon(pixels, [[x, y], [x + 9, y], [x + 9, y + 20], [x, y + 20]], accent);
      }
      for (let x = 135; x < 600; x += 40) for (const y of [8, 1260]) fillPolygon(pixels, [[x, y], [x + 20, y], [x + 20, y + 10], [x, y + 10]], accent);
    } else {
      for (let y = 185; y < 1130; y += 90) for (const x of [12, 708]) fillCircle(pixels, x, y, 3, accent);
    }
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
