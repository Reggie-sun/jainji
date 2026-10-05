import { expect, it } from "vitest";
import { checkHybridCornerMotion } from "../src/main/shape-cover-hybrid-motion.js";

it("a moving solid overlay whose common mask interior stays identical cannot claim observable static motion", () => {
  const size = { width: 80, height: 64 }, mask = new Uint8Array(80 * 64);
  for (let y = 16; y < 48; y++) for (let x = 24; x < 56; x++) mask[y * 80 + x] = 1;
  const frames = [0, 12, 0].map((shift, index) => {
    const rgba = Buffer.alloc(80 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) {
      const v = x >= 8 + shift && x < 72 + shift && y >= 8 && y < 56 ? 240 : 20;
      rgba.fill(v, (y * 80 + x) * 4, (y * 80 + x) * 4 + 3); rgba[(y * 80 + x) * 4 + 3] = 255;
    }
    return { index, rgba };
  });
  expect(checkHybridCornerMotion(frames, size, mask, [{ x: 24, y: 16, width: 32, height: 32 }]).status).toBe("UNOBSERVABLE");
});

const size = { width: 64, height: 48 }, box = { x: 18, y: 14, width: 16, height: 12 };
const mask = new Uint8Array(size.width * size.height);
for (let y = 11; y < 29; y++) for (let x = 15; x < 37; x++) mask[y * size.width + x] = 1;
function frame(shift = 0, absent = false) {
  const rgba = Buffer.alloc(size.width * size.height * 4, 255);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const inside = !absent && x >= box.x + shift && x < box.x + shift + box.width && y >= box.y && y < box.y + box.height;
    const value = inside ? ((x - shift + y) % 3 ? 20 : 180) : 240;
    rgba.fill(value, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  }
  return rgba;
}
const samples = (frames: Buffer[]) => frames.map((rgba, index) => ({ index, rgba }));
it("supports a static sampled component independently of semantic STABLE", () => {
  expect(checkHybridCornerMotion(samples([frame(), frame(), frame()]), size, mask, [box])).toMatchObject({ status: "STATIC_SUPPORTED", sampleCount: 3 });
});
it("skips obvious motion and disappearance even when other samples stay static", () => {
  expect(checkHybridCornerMotion(samples([frame(), frame(9), frame()]), size, mask, [box]).status).toBe("MOVED");
  expect(checkHybridCornerMotion(samples([frame(), frame(0, true), frame()]), size, mask, [box]).status).toBe("DISAPPEARED_OR_CHANGED");
});
it("requires every component and refuses unavailable or malformed samples", () => {
  expect(checkHybridCornerMotion(samples([frame(), frame(), frame()]), size, mask, [box, { x: 45, y: 10, width: 4, height: 4 }]).status).toBe("UNOBSERVABLE");
  expect(checkHybridCornerMotion(samples([frame(), frame()]), size, mask, [box]).status).toBe("UNOBSERVABLE");
  expect(checkHybridCornerMotion(samples([frame(), Buffer.alloc(2), frame()]), size, mask, [box]).status).toBe("UNOBSERVABLE");
});
it("does not reject bounded encoding noise or mutate the source mask", () => {
  const noisy = frame(); for (let i = 0; i < noisy.length; i++) if (i % 4 !== 3) noisy[i] = Math.max(0, noisy[i] - 15);
  const before = mask.slice();
  expect(checkHybridCornerMotion(samples([frame(), noisy, frame()]), size, mask, [box]).status).toBe("STATIC_SUPPORTED");
  expect(mask).toEqual(before);
});
