import { describe, expect, it } from "vitest";
import { WORKFLOW_STEPS, activeWorkflowId, resolveWorkflowTarget, templateSectionForWorkflow, workflowForTemplateSection } from "../src/renderer/workspace-flow";

describe("workspace workflow navigation", () => {
  it("keeps every creation stage visible in the redesigned stepper", () => {
    expect(WORKFLOW_STEPS.map(({ label }) => label)).toEqual(["素材", "包装", "覆盖贴纸", "导出", "作品"]);
  });

  it("routes contextual packaging stages through the existing template surface", () => {
    expect(resolveWorkflowTarget("materials")).toEqual({ step: "import", section: "materials" });
    expect(resolveWorkflowTarget("packaging")).toEqual({ step: "templates", section: "packaging" });
    expect(resolveWorkflowTarget("cover")).toEqual({ step: "templates", section: "cover", selector: "#cover-sticker-settings" });
    expect(resolveWorkflowTarget("export")).toEqual({ step: "templates", section: "export", selector: ".export-card" });
    expect(resolveWorkflowTarget("results")).toEqual({ step: "results", section: "results" });
  });

  it("tracks the contextual stage without changing the canonical app step", () => {
    expect(activeWorkflowId("import", "export")).toBe("materials");
    expect(activeWorkflowId("templates", "cover")).toBe("cover");
    expect(activeWorkflowId("templates", "export")).toBe("export");
    expect(activeWorkflowId("results", "packaging")).toBe("results");
    expect(activeWorkflowId("stickers", "cover")).toBeUndefined();
  });

  it("keeps packaging subnav sections distinct from top-level workflow stages", () => {
    expect(workflowForTemplateSection("template")).toBe("packaging");
    expect(workflowForTemplateSection("corners")).toBe("packaging");
    expect(workflowForTemplateSection("timing")).toBe("packaging");
    expect(workflowForTemplateSection("cover")).toBe("cover");
    expect(workflowForTemplateSection("export")).toBe("export");
    expect(templateSectionForWorkflow("packaging")).toBe("template");
    expect(templateSectionForWorkflow("cover")).toBe("cover");
    expect(templateSectionForWorkflow("export")).toBe("export");
  });
});
