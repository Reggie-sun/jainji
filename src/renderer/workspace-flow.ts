export type Step = "connection" | "import" | "templates" | "stickers" | "results";
export type WorkflowId = "materials" | "packaging" | "cover" | "export" | "results";

export type WorkflowTarget = {
  step: Step;
  section: WorkflowId;
  selector?: string;
};

export const WORKFLOW_STEPS: ReadonlyArray<{ id: WorkflowId; label: string; icon: string }> = [
  { id: "materials", label: "素材", icon: "folder" },
  { id: "packaging", label: "包装", icon: "grid" },
  { id: "cover", label: "覆盖贴纸", icon: "shield" },
  { id: "export", label: "导出", icon: "download" },
  { id: "results", label: "作品", icon: "film" },
];

const targets: Record<WorkflowId, WorkflowTarget> = {
  materials: { step: "import", section: "materials" },
  packaging: { step: "templates", section: "packaging" },
  cover: { step: "templates", section: "cover", selector: "#cover-sticker-settings" },
  export: { step: "templates", section: "export", selector: ".export-card" },
  results: { step: "results", section: "results" },
};

export function resolveWorkflowTarget(id: WorkflowId): WorkflowTarget {
  return targets[id];
}

export function activeWorkflowId(step: Step, section: WorkflowId): WorkflowId | undefined {
  if (step === "import") return "materials";
  if (step === "templates") return ["packaging", "cover", "export"].includes(section) ? section : "packaging";
  if (step === "results") return "results";
  return undefined;
}
