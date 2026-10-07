import { expect, it } from "vitest";
import { opaqueRegionCovered, projectHumanRectangle } from "../src/main/human-region-geometry";

it("requires every target pixel to be originally fully opaque, including holes and translucent edges", () => {
  const size = { width: 6, height: 6 }, target = { x: 1, y: 1, width: 4, height: 4 };
  const alpha = new Uint8Array(36).fill(255);
  expect(opaqueRegionCovered(alpha, size, target)).toBe(true);
  alpha[14] = 254;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(false);
  alpha[14] = 0;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(false);
  alpha[14] = 255; alpha[0] = 0;
  expect(opaqueRegionCovered(alpha, size, target)).toBe(true);
});

it("projects the user's whole region through measured scale and padding with outward pixel support", () => {
  const p = { width: 1280, height: 720, scaledWidth: 720, scaledHeight: 720, padLeft: 280, padTop: 0 };
  expect(projectHumanRectangle({ x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, { width: 1000, height: 1000 }, p))
    .toEqual({ x: 350, y: 142, width: 148, height: 220 });
  expect(() => projectHumanRectangle({ x: -0.1, y: 0, width: 0.2, height: 0.3 }, { width: 1000, height: 1000 }, p)).toThrow();
});
