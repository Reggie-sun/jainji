import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_FRAMES } from "../shared/frames.js";
import { encodeRgbaPng } from "./builtin-stickers.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";

const WIDTH = 720;
const HEIGHT = 1280;
type Rgb = readonly [number, number, number];
type FrameStyle = "double" | "inset" | "rail" | "matte" | "soft" | "corners" | "bevel" | "rounded";

// IDs stay stable; existing frozen files keep their original content-hash paths.
const FRAMES = {
  "frame-stars": { base: [189, 166, 120], accent: [240, 228, 201], ink: [117, 96, 64], style: "double" },
  "frame-hearts": { base: [173, 128, 132], accent: [235, 213, 212], ink: [127, 89, 94], style: "inset" },
  "frame-confetti": { base: [120, 147, 167], accent: [222, 233, 240], ink: [74, 100, 120], style: "rail" },
  "frame-strawberries": { base: [241, 234, 219], accent: [253, 249, 239], ink: [190, 176, 151], style: "matte" },
  "frame-daisies": { base: [239, 239, 232], accent: [255, 255, 250], ink: [175, 176, 166], style: "soft" },
  "frame-clovers": { base: [109, 129, 116], accent: [201, 191, 154], ink: [67, 83, 74], style: "corners" },
  "frame-clouds": { base: [221, 216, 205], accent: [243, 239, 229], ink: [160, 151, 135], style: "matte" },
  "frame-moons": { base: [43, 63, 82], accent: [157, 173, 187], ink: [28, 42, 56], style: "double" },
  "frame-butterflies": { base: [73, 73, 77], accent: [194, 187, 171], ink: [35, 35, 38], style: "bevel" },
  "frame-bubbles": { base: [195, 203, 206], accent: [242, 247, 247], ink: [131, 145, 151], style: "rounded" },
  "frame-rainbows": { base: [137, 113, 95], accent: [222, 206, 188], ink: [89, 71, 57], style: "inset" },
  "frame-film": { base: [31, 32, 35], accent: [187, 164, 117], ink: [12, 13, 15], style: "corners" },
  "frame-geometric": { base: [150, 145, 138], accent: [235, 230, 220], ink: [98, 95, 89], style: "rail" },
} as const satisfies Record<string, { base: Rgb; accent: Rgb; ink: Rgb; style: FrameStyle }>;

function blend(left: Rgb, right: Rgb, amount: number): Rgb {
  return left.map((value, index) => Math.round(value + (right[index] - value) * amount)) as [number, number, number];
}

function drawFrame(id: keyof typeof FRAMES): Buffer {
  const { base, accent, ink, style } = FRAMES[id];
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      // Equal proportions keep the perimeter narrow in portrait and landscape.
      const edgeX = Math.min(x, WIDTH - 1 - x);
      const edgeY = Math.min(y, HEIGHT - 1 - y) * WIDTH / HEIGHT;
      const distance = Math.min(edgeX, edgeY);
      if (distance >= 32) continue;
      let color: Rgb = base;
      let alpha = distance < 2 ? 255 : 0;
      if (style === "double") {
        if (distance < 4) { color = blend(ink, accent, 0.25 + 0.65 * x / WIDTH); alpha = 255; }
        else if (distance >= 11 && distance < 12.5) { color = base; alpha = 255; }
      } else if (style === "inset") {
        if (distance < 5) alpha = 255;
        else if (distance >= 10 && distance < 11) { color = accent; alpha = 255; }
        else if (distance >= 16 && distance < 17) { color = base; alpha = 255; }
      } else if (style === "rail") {
        if (distance < 3) { color = ink; alpha = 255; }
        else if (distance >= 9 && distance < 11) alpha = 255;
        if (edgeX < 72 && edgeY < 72 && distance < 5) { color = accent; alpha = 255; }
      } else if (style === "matte") {
        if (distance < 12) {
          color = distance < 1 ? ink : distance >= 10 ? accent : blend(base, accent, ((x * 17 + y * 13) % 11) / 100);
          alpha = 255;
        }
      } else if (style === "soft") {
        if (distance < 6) { color = distance < 1 ? ink : accent; alpha = 255; }
        else if (distance < 16) { color = ink; alpha = Math.round(85 * (16 - distance) / 10); }
      } else if (style === "corners") {
        if (distance < 7) { color = distance < 1 ? ink : base; alpha = 255; }
        if (edgeX < 80 && edgeY < 80 && distance >= 12 && distance < 14) { color = accent; alpha = 255; }
      } else if (style === "bevel") {
        if (distance < 11) { color = blend(ink, base, Math.min(1, distance / 4)); alpha = 255; }
        if (distance >= 10 && distance < 11) color = accent;
      } else if (style === "rounded") {
        const radius = 19;
        const roundedDistance = edgeX < radius && edgeY < radius
          ? radius - Math.hypot(radius - edgeX, radius - edgeY) : distance;
        if (roundedDistance >= 4 && roundedDistance < 6) { color = ink; alpha = 255; }
        else if (roundedDistance >= 6 && roundedDistance < 8) { color = accent; alpha = 255; }
      }
      if (!alpha) continue;
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = alpha;
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
