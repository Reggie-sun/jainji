import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectStore } from "../src/main/store";
import { createDefaultProject, DEFAULT_PRESET, EditTemplateSchema, ProjectSchema, type EditTemplate } from "../src/main/domain";

describe("versioned domain schemas", () => {
  it("saves and reloads export history beyond a single run's 250 outputs", async () => {
    const project = createDefaultProject();
    const mediaId = crypto.randomUUID();
    project.exportBatches = Array.from({ length: 500 }, () => {
      const id = crypto.randomUUID();
      return {
        schemaVersion: 2, id, projectId: project.id, templateSnapshot: project.templates[0],
        mediaIds: [mediaId], outputDirectory: "/tmp/outputs", preset: DEFAULT_PRESET,
        status: "active", estimatedBytes: 0, createdAt: project.updatedAt,
        tasks: [{ id: crypto.randomUUID(), batchId: id, mediaId, status: "queued", progress: 0, attempt: 0, createdAt: project.updatedAt, attempts: [] }],
      };
    });
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-history-"));
    try {
      const store = new ProjectStore(path.join(directory, "project.json"));
      await store.save(project);
      expect((await store.load()).project).toEqual(project);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects unknown and future schema fields", () => {
    const project = createDefaultProject();
    expect(() => ProjectSchema.parse({ ...project, unknown: true })).toThrow();
    expect(() => ProjectSchema.parse({ ...project, schemaVersion: project.schemaVersion + 1 })).toThrow();
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
