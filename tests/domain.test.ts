import { describe, expect, it } from "vitest";
import { createDefaultProject, EditTemplateSchema, ProjectSchema, type EditTemplate } from "../src/main/domain";

describe("versioned domain schemas", () => {
  it("rejects unknown and future schema fields", () => {
    const project = createDefaultProject();
    expect(() => ProjectSchema.parse({ ...project, unknown: true })).toThrow();
    expect(() => ProjectSchema.parse({ ...project, schemaVersion: 2 })).toThrow();
  });

  it("rejects layers outside the normalized frame", () => {
    const template = createDefaultProject().templates[0];
    const layer = {
      id: crypto.randomUUID(), type: "text", content: "x", fontFamily: "DejaVu Sans", fontSizeRatio: 0.08,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0,
      x: 0.9, y: 0, width: 0.2, opacity: 1, zIndex: 0, visible: true,
    } satisfies EditTemplate["layers"][number];
    expect(() => EditTemplateSchema.parse({ ...template, layers: [layer] })).toThrow(/right edge/);
  });

  it("rejects duplicate layer ids and positions outside the frame", () => {
    const template = createDefaultProject().templates[0];
    const layer = {
      id: crypto.randomUUID(), type: "text", content: "x", fontFamily: "DejaVu Sans", fontSizeRatio: 0.08,
      color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidthRatio: 0,
      x: 0, y: 1, width: 0.2, opacity: 1, zIndex: 0, visible: true,
    } satisfies EditTemplate["layers"][number];
    expect(() => EditTemplateSchema.parse({ ...template, layers: [layer, { ...layer, zIndex: 1 }] })).toThrow(/layer id must be unique/);
    expect(() => EditTemplateSchema.parse({ ...template, layers: [layer] })).toThrow(/layer must start inside the frame/);
  });
});
