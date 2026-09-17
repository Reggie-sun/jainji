import { describe, expect, it } from "vitest";
import { createDefaultTemplate, EditTemplateSchema, type StickerLayer } from "../src/main/domain";
import { beginLayerDrag, constrainedStickerPreviewGeometry, cumulativeDragPosition, LEGACY_CORNER_SAFE_POLICY, snapStickerToCorner } from "../src/shared/layout-policy";

function sticker(overrides: Partial<StickerLayer> = {}): StickerLayer {
  return {
    id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/sticker.png", assetFingerprint: "sha256:fixture",
    x: 0.015, y: 0.015, width: 0.08, rotationDeg: 0, opacity: 1, zIndex: 2, visible: true,
    ...overrides,
  };
}

describe("rule-constrained layout agent", () => {
  it("rejects v2 stickers outside the tight corners, over width, or over rotation limits", () => {
    const template = { ...createDefaultTemplate(), layoutPolicy: "corner-safe-v2" as const };
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ x: 0.4, y: 0.4 })] })).toThrow(/四角/);
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ width: 0.101 })] })).toThrow(/10%/);
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ rotationDeg: 16 })] })).toThrow(/15/);
  });

  it("keeps frozen v1 corner geometry valid", () => {
    const template = { ...createDefaultTemplate(), layoutPolicy: "corner-safe-v1" as const };
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ x: 0.04, y: 0.8, width: 0.2 })] })).not.toThrow();
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ x: 0.04, width: 0.21 })] })).toThrow(/20%/);
  });

  it("keeps legacy free templates compatible", () => {
    const template = { ...createDefaultTemplate(), layers: [sticker({ x: 0.4, y: 0.4, width: 0.4, rotationDeg: 45 })] };
    expect(() => EditTemplateSchema.parse(template)).not.toThrow();
  });

  it("snaps renderer edits to a valid corner and enforces total sticker coverage", () => {
    const snapped = snapStickerToCorner(sticker({ x: 0.43, y: 0.7, width: 0.4, rotationDeg: 90 }));
    expect(snapped).toMatchObject({ x: 0.885, y: 0.88, width: 0.1, rotationDeg: 15 });
    const template = { ...createDefaultTemplate(), layoutPolicy: "corner-safe-v2" as const };
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ width: 0.1 }), sticker({ x: 0.885, width: 0.1 })] })).not.toThrow();
    expect(() => EditTemplateSchema.parse({
      ...template,
      layers: [sticker({ width: 0.1 }), sticker({ width: 0.09 }), sticker({ width: 0.09 }), sticker({ width: 0.09 })],
    })).toThrow(/3%/);
  });

  it("accumulates pointer movement from drag start so a sticker can switch corners", () => {
    const drag = beginLayerDrag(sticker(), 100, 100);
    let position = { x: 0.015, y: 0.015 };
    let rendered = sticker();
    for (let step = 1; step <= 75; step += 1) {
      position = cumulativeDragPosition({
        ...drag,
        pointerX: 100 + 550 * step / 75, pointerY: 100 + 750 * step / 75,
        stageWidth: 1_000, stageHeight: 1_000,
      });
      rendered = snapStickerToCorner({ ...rendered, ...position });
    }
    expect(position).toEqual({ x: 0.565, y: 0.765 });
    expect(rendered).toMatchObject({ x: 0.905, y: 0.88 });
  });

  it("fits the rotated preview bounding box before anchoring it to a corner", () => {
    const geometry = constrainedStickerPreviewGeometry({
      layer: sticker({ x: 0.885, y: 0.88, width: 0.1, rotationDeg: 15 }),
      frameWidth: 320, frameHeight: 180, sourceWidth: 80, sourceHeight: 80,
    });
    expect(geometry.height).toBeCloseTo(0.1, 10);
    expect(geometry.width).toBeCloseTo(0.05625, 10);
    expect(geometry.x + geometry.width).toBeCloseTo(0.985, 10);
    expect(geometry.y + geometry.height).toBeCloseTo(0.985, 10);

    const legacy = constrainedStickerPreviewGeometry({
      layer: sticker({ x: 0.76, y: 0.8, width: 0.2, rotationDeg: 15 }),
      frameWidth: 320, frameHeight: 180, sourceWidth: 80, sourceHeight: 80,
      policy: LEGACY_CORNER_SAFE_POLICY,
    });
    expect(legacy.height).toBeCloseTo(0.16, 10);
    expect(legacy.x + legacy.width).toBeCloseTo(0.96, 10);
  });
});
