import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_FRAMES } from "../shared/frames.js";
import { encodeRgbaPng } from "./builtin-stickers.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";

const WIDTH = 720;
const HEIGHT = 1280;
type Rgb = readonly [number, number, number];
type FrameStyle = "double" | "inset" | "rail" | "matte" | "soft" | "corners" | "bevel" | "rounded" | "paper" | "gilt" | "glass" | "gift"
  | "pearl" | "ribbon" | "deco" | "stitch" | "facet" | "arch" | "wave" | "starburst";

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
  "frame-wide-cream": { base: [238, 228, 208], accent: [255, 249, 235], ink: [176, 151, 112], style: "paper", width: 64 },
  "frame-wide-obsidian": { base: [34, 37, 40], accent: [193, 166, 104], ink: [13, 16, 19], style: "gilt", width: 72 },
  "frame-wide-blue": { base: [112, 143, 164], accent: [222, 235, 242], ink: [57, 85, 108], style: "glass", width: 60 },
  "frame-wide-sage": { base: [130, 150, 128], accent: [229, 232, 206], ink: [73, 94, 72], style: "gift", width: 64 },
  "frame-wide-pearl": { base: [230, 223, 216], accent: [255, 251, 245], ink: [176, 157, 140], style: "pearl", width: 64 },
  "frame-wide-rose": { base: [190, 130, 141], accent: [255, 226, 220], ink: [123, 67, 83], style: "ribbon", width: 68 },
  "frame-wide-champagne": { base: [211, 187, 138], accent: [255, 242, 204], ink: [127, 103, 60], style: "deco", width: 64 },
  "frame-wide-kraft": { base: [191, 157, 114], accent: [250, 232, 196], ink: [123, 90, 60], style: "stitch", width: 64 },
  "frame-wide-silver": { base: [167, 181, 193], accent: [244, 250, 255], ink: [76, 95, 117], style: "facet", width: 60 },
  "frame-wide-clay": { base: [187, 118, 93], accent: [247, 218, 187], ink: [123, 69, 53], style: "arch", width: 68 },
  "frame-wide-lavender": { base: [174, 160, 196], accent: [245, 234, 252], ink: [103, 85, 132], style: "wave", width: 64 },
  "frame-wide-navy": { base: [37, 59, 84], accent: [218, 192, 133], ink: [17, 29, 48], style: "starburst", width: 72 },
} as const satisfies Record<string, { base: Rgb; accent: Rgb; ink: Rgb; style: FrameStyle; width?: number }>;

function blend(left: Rgb, right: Rgb, amount: number): Rgb {
  return left.map((value, index) => Math.round(value + (right[index] - value) * amount)) as [number, number, number];
}

function drawFrame(id: keyof typeof FRAMES): Buffer {
  const definition = FRAMES[id];
  const { base, accent, ink, style } = definition;
  const band = "width" in definition ? definition.width : undefined;
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      // Equal proportions preserve the selected band width in either orientation.
      const edgeX = Math.min(x, WIDTH - 1 - x);
      const edgeY = Math.min(y, HEIGHT - 1 - y) * WIDTH / HEIGHT;
      const distance = Math.min(edgeX, edgeY);
      if (distance >= (band ?? 32)) continue;
      let color: Rgb = base;
      let alpha = distance < 2 ? 255 : 0;
      if (band) {
        const light = (1 - x / WIDTH) * .35 + (1 - y / HEIGHT) * .25;
        const grain = ((x * 17 + y * 13) % 11) / 100;
        const corner = edgeX < band * 1.9 && edgeY < band * 1.9;
        if (style === "paper") {
          // A warm paper mount, inset sheet and fine champagne keyline.
          color = blend(base, accent, grain);
          if (distance < 8) color = blend(ink, base, .55 + light * .4);
          else if (distance < 11) color = accent;
          else if (distance >= band - 15 && distance < band - 11) color = blend(base, ink, .16);
          else if (distance >= band - 11) color = blend(accent, base, (distance - band + 11) / 20);
          if (distance >= band - 2) color = blend(base, ink, .28);
          if (corner && distance >= 19 && distance < 21) color = blend(ink, base, .35);
        } else if (style === "gilt") {
          // Satin-black rails with hairline gold and a restrained stepped corner.
          color = blend(ink, base, .55 + light * .4 + grain * .2);
          if (distance >= 7 && distance < 9 || distance >= band - 7 && distance < band - 5) color = blend(accent, [255, 241, 201], light);
          if (corner && (Math.abs(edgeX - edgeY) < 1.3 || distance >= 18 && distance < 20)) color = accent;
          if (distance >= band - 3) color = blend(ink, base, .3);
        } else if (style === "glass") {
          // Frosted blue stepped glass; diagonal reflections stay in the rim.
          color = blend(base, accent, .12 + light * .45);
          if (distance < 6) color = blend(ink, base, .45 + light * .3);
          else if (distance < 9 || distance >= band - 9 && distance < band - 6) color = blend(accent, base, .12);
          else if (distance >= band - 6) color = blend(base, ink, .15);
          const reflection = (x / WIDTH + y / HEIGHT) % .48;
          if (reflection < .014 && distance > 12 && distance < band - 12) color = blend(color, accent, .4);
          if (corner && distance >= 16 && distance < 18) color = accent;
        } else if (style === "gift") {
          // Linen-like sage mount with woven detail and pale ribbon corners.
          color = blend(base, accent, grain + (x % 4 === 0 || y % 4 === 0 ? .06 : 0));
          if (distance < 6) color = blend(ink, base, .45 + light * .3);
          else if (distance < 8 || distance >= band - 5 && distance < band - 3) color = accent;
          if (corner && Math.abs(edgeX - edgeY) < 8 && distance > 10 && distance < band - 10) {
            color = blend(accent, base, Math.abs(edgeX - edgeY) / 24);
          }
          if (distance >= band - 3) color = blend(base, ink, .22);
        } else if (style === "pearl") {
          // Porcelain mount with a graduated row of small pearl studs.
          color = blend(base, accent, .2 + light * .5);
          if (distance < 5 || distance >= band - 5) color = blend(base, ink, .22);
          if (distance >= 8 && distance < 10 || distance >= band - 10 && distance < band - 8) color = accent;
          const along = edgeX < edgeY ? y * WIDTH / HEIGHT : x;
          const beadX = (along + 12) % 24 - 12;
          const beadY = distance - band / 2;
          const bead = Math.hypot(beadX, beadY);
          if (bead < 6) color = blend(ink, accent, Math.max(.2, 1 - bead / 9 + (beadX + beadY) / 30));
        } else if (style === "ribbon") {
          // Satin rail and broad diagonal ribbon folds at each corner.
          color = blend(ink, base, .55 + .35 * Math.sin(distance / band * Math.PI));
          if (distance >= 7 && distance < 9 || distance >= band - 8 && distance < band - 6) color = accent;
          if (corner && Math.abs(edgeX - edgeY) < 15) {
            color = blend(base, accent, .3 + .5 * (1 - Math.abs(edgeX - edgeY) / 15));
            if (Math.abs(edgeX - edgeY) > 12) color = ink;
          }
          if (distance >= band - 3) color = blend(base, ink, .4);
        } else if (style === "deco") {
          // Etched fan corners, on a brushed champagne surround.
          color = blend(base, accent, grain + light * .3);
          if (distance < 5 || distance >= band - 4) color = ink;
          if (distance >= 8 && distance < 10 || distance >= band - 9 && distance < band - 7) color = accent;
          if (corner) {
            const radius = Math.hypot(edgeX, edgeY);
            const angle = Math.atan2(edgeY, edgeX);
            if (radius > 22 && radius < band * 1.65 && (radius % 18 < 1.8 || Math.abs(Math.sin(angle * 8)) < .045)) color = accent;
          }
        } else if (style === "stitch") {
          // Kraft fibre, a pale inset and separate dashed stitch tracks.
          color = blend(base, accent, grain + (y % 3 === 0 ? .06 : 0));
          if (distance < 4 || distance >= band - 4) color = blend(base, ink, .35);
          if (distance >= band - 15 && distance < band - 7) color = blend(base, accent, .7);
          const along = edgeX < edgeY ? y * WIDTH / HEIGHT : x;
          if (distance >= 13 && distance < 15 && along % 17 < 9) color = accent;
          if (corner && distance >= 23 && distance < 25) color = ink;
        } else if (style === "facet") {
          // Alternating polished bevels and diamond corner plates.
          const bevel = Math.abs(distance / band * 4 % 2 - 1);
          color = blend(ink, accent, .25 + bevel * .65 + light * .1);
          if (distance >= band - 3 || distance < 2) color = ink;
          if (corner && Math.abs(edgeX + edgeY - band * 1.45) < 10) {
            color = blend(base, accent, edgeX < edgeY ? .2 : .85);
          }
        } else if (style === "arch") {
          // Matte terracotta with nested pottery-like corner arches.
          color = blend(base, accent, grain * .5 + light * .12);
          if (distance < 7 || distance >= band - 6) color = blend(base, ink, .35);
          if (distance >= 11 && distance < 14) color = accent;
          if (corner && Math.hypot(edgeX, edgeY) % 22 < 3) color = blend(accent, base, .15);
          if (distance >= band - 12 && distance < band - 9) color = blend(base, accent, .6);
        } else if (style === "wave") {
          // Fine flowing lines on a lilac silk gradient.
          color = blend(base, accent, .15 + light * .5);
          if (distance < 5 || distance >= band - 4) color = blend(base, ink, .3);
          const along = edgeX < edgeY ? y * WIDTH / HEIGHT : x;
          const ripple = distance + Math.sin(along / 55) * 5;
          if (distance > 11 && distance < band - 10 && ripple % 13 < 1.8) color = blend(accent, base, .1);
          if (corner && Math.abs(edgeX - edgeY) < 2) color = accent;
        } else if (style === "starburst") {
          // Midnight gift packaging with small four-point corner highlights.
          color = blend(ink, base, .6 + light * .4);
          if (distance >= 7 && distance < 9 || distance >= band - 8 && distance < band - 6) color = accent;
          const starX = Math.abs(edgeX - 33);
          const starY = Math.abs(edgeY - 33);
          if (corner && starX + starY < 18 && Math.min(starX, starY) < 3.5 * (1 - Math.max(starX, starY) / 18)) color = accent;
          if (corner && Math.abs(edgeX + edgeY - 104) < 1.4 && distance > 15) color = blend(accent, base, .3);
        }
        alpha = 255;
      } else if (style === "double") {
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
