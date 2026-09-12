import { describe, expect, it } from "vitest";
import { createDefaultTemplate, EditTemplateSchema, type StickerLayer } from "../src/main/domain";
import { runLayoutAgent } from "../src/main/layout-agent";
import { beginLayerDrag, constrainedStickerPreviewGeometry, cumulativeDragPosition, snapStickerToCorner } from "../src/shared/layout-policy";

function sticker(overrides: Partial<StickerLayer> = {}): StickerLayer {
  return {
    id: crypto.randomUUID(), type: "sticker", assetPath: "/tmp/sticker.png", assetFingerprint: "sha256:fixture",
    x: 0.02, y: 0.02, width: 0.16, rotationDeg: 0, opacity: 1, zIndex: 2, visible: true,
    ...overrides,
  };
}

describe("rule-constrained layout agent", () => {
  it("generates two compact corner badges and enables the hard policy", () => {
    const template = runLayoutAgent(createDefaultTemplate(), {
      style: "black-gold", title: "今日好物推荐", price: "19.9元2单",
    });
    expect(template.layoutPolicy).toBe("corner-safe-v1");
    expect(template.layers).toHaveLength(2);
    expect(template.layers.map((layer) => layer.type)).toEqual(["text", "text"]);
    expect(template.layers[0]).toMatchObject({ content: "今日好物推荐", x: 0.025, y: 0.022, width: 0.38 });
    expect(template.layers[1]).toMatchObject({ content: "19.9元2单", x: 0.7, y: 0.022, width: 0.275 });
    expect(template.layers.every((layer) => layer.type !== "text" || layer.backgroundColor !== undefined)).toBe(true);
    expect(() => EditTemplateSchema.parse(template)).not.toThrow();
  });

  it("rejects governed stickers outside corners, over width, or over rotation limits", () => {
    const template = { ...createDefaultTemplate(), layoutPolicy: "corner-safe-v1" as const };
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ x: 0.4, y: 0.4 })] })).toThrow(/四角/);
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ width: 0.21 })] })).toThrow(/20%/);
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ rotationDeg: 16 })] })).toThrow(/15/);
  });

  it("keeps legacy free templates compatible", () => {
    const template = { ...createDefaultTemplate(), layers: [sticker({ x: 0.4, y: 0.4, width: 0.4, rotationDeg: 45 })] };
    expect(() => EditTemplateSchema.parse(template)).not.toThrow();
  });

  it("snaps renderer edits to a valid corner and enforces total sticker coverage", () => {
    const snapped = snapStickerToCorner(sticker({ x: 0.43, y: 0.7, width: 0.4, rotationDeg: 90 }));
    expect(snapped).toMatchObject({ x: 0.76, y: 0.8, width: 0.2, rotationDeg: 15 });
    const template = { ...createDefaultTemplate(), layoutPolicy: "corner-safe-v1" as const };
    expect(() => EditTemplateSchema.parse({ ...template, layers: [sticker({ width: 0.2 }), sticker({ x: 0.76, width: 0.2 })] })).not.toThrow();
    expect(() => EditTemplateSchema.parse({
      ...template,
      layers: [sticker({ width: 0.17 }), sticker({ width: 0.17 }), sticker({ width: 0.17 })],
    })).toThrow(/8%/);
  });

  it("accumulates pointer movement from drag start so a sticker can switch corners", () => {
    const drag = beginLayerDrag(sticker({ x: 0.04, y: 0.04 }), 100, 100);
    let position = { x: 0.04, y: 0.04 };
    let rendered = sticker({ x: 0.04, y: 0.04 });
    for (let step = 1; step <= 75; step += 1) {
      position = cumulativeDragPosition({
        ...drag,
        pointerX: 100 + 550 * step / 75, pointerY: 100 + 750 * step / 75,
        stageWidth: 1_000, stageHeight: 1_000,
      });
      rendered = snapStickerToCorner({ ...rendered, ...position });
    }
    expect(position).toEqual({ x: 0.59, y: 0.79 });
    expect(rendered).toMatchObject({ x: 0.8, y: 0.8 });
  });

  it("fits the rotated preview bounding box before anchoring it to a corner", () => {
    const geometry = constrainedStickerPreviewGeometry({
      layer: sticker({ x: 0.76, y: 0.8, width: 0.2, rotationDeg: 15 }),
      frameWidth: 320, frameHeight: 180, sourceWidth: 80, sourceHeight: 80,
    });
    expect(geometry.height).toBeCloseTo(0.16, 10);
    expect(geometry.width).toBeCloseTo(0.09, 10);
    expect(geometry.x + geometry.width).toBeCloseTo(0.96, 10);
    expect(geometry.y + geometry.height).toBeCloseTo(0.96, 10);
  });
});
