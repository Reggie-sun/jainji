import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplatePanel } from "../src/renderer/TemplatePanel";
import { DecorationSchema } from "../src/shared/decorations";
import { WORKFLOW_STEPS, activeWorkflowId, resolveWorkflowTarget, templateSectionForWorkflow, workflowForTemplateSection } from "../src/renderer/workspace-flow";

describe("workspace workflow navigation", () => {
  it.each(["random", "agent", "manual"] as const)("opens packaging settings without a template grid in %s mode", mode => {
    const noop = () => {};
    const markup = renderToStaticMarkup(createElement(TemplatePanel, {
      selected: "mono", onSelect: noop, brief: "", onBrief: noop, outputDirectory: "", onOutput: noop,
      onStart: noop, count: 1, disabled: false, exportFormat: "mp4", onExportFormat: noop,
      decorationOptions: DecorationSchema.parse({ mode, productPrice: "原文", corners: { "top-left": { type: "sticker", sticker: "heart" } } }),
      onCornerSelect: noop,
    }));
    expect(markup).toContain("包装设置");
    expect(markup).not.toContain("template-grid");
    expect(markup).not.toContain("选择模板，自己设置");
    expect(markup).toContain("原文");
    if (mode === "manual") {
      expect(markup).toContain("旧模板兼容设置");
      expect(markup).toContain('value="mono" selected=""');
      expect(markup).toContain("编辑左上角");
    } else {
      expect(markup).not.toContain("旧模板兼容设置");
      expect(markup).not.toContain("黑白叙事");
      expect(markup).not.toContain("编辑左上角");
      if (mode === "random") expect(markup).toContain("具体选款以冻结结果为准");
    }
  });
  it("keeps every creation stage visible in the redesigned stepper", () => {
    expect(WORKFLOW_STEPS.map(({ label }) => label)).toEqual(["素材", "包装", "覆盖贴纸", "输出", "作品"]);
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
