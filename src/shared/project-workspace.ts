import { z } from "zod";
import { MAX_AGENT_OUTPUTS, RuleIdSchema } from "./agent.js";
import { DecorationAppearanceSchema } from "./decorations.js";
import { ExportFormatSchema } from "./export-format.js";
import { ExportSettingsSchema } from "./export-settings.js";

export const ProjectWorkspaceSchema = z.object({
  step: z.enum(["import", "templates", "results"]),
  selectedMediaIds: z.array(z.string().uuid()).max(1000),
  ruleId: RuleIdSchema,
  brief: z.string().max(1000),
  decorations: DecorationAppearanceSchema,
  requestedCount: z.number().int().min(1).max(MAX_AGENT_OUTPUTS).optional(),
  exportFormat: ExportFormatSchema,
  exportSettings: ExportSettingsSchema,
  outputDirectory: z.string().min(1).max(4096).optional(),
}).strict();

export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>;
