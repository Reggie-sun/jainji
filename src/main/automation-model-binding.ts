import { z } from "zod";
import type { AutomationRequest } from "../shared/automation.js";
import { DEFAULT_COVER_STICKER } from "../shared/cover-sticker.js";
import type { Project } from "./domain.js";
import type { ModelConnections } from "./model-connections.js";
import { automationDigest } from "./automation-files.js";
import { hybridMiniMaxProfile } from "./hybrid-cover-connections.js";
import { createHybridVisionRoutes } from "./shape-cover-vision-provider.js";

export const AutomationModelRolesSchema = z.array(z.enum(["creative", "vision", "reviewer", "hybrid"])).min(1).max(4)
  .refine(roles => new Set(roles).size === roles.length);
export type AutomationModelRole = z.infer<typeof AutomationModelRolesSchema>[number];

/** Match the frozen batch input and original controller's model branches. */
export function automationModelRoles(request: AutomationRequest, projects: { recentProjectId: string; project: Project }[]): AutomationModelRole[] {
  const roles = new Set<AutomationModelRole>();
  for (const { recentProjectId, project } of projects) {
    const entry = request.production!.entries.find(entry => entry.recentProjectId === recentProjectId)!;
    const cover = project.coverSticker ?? DEFAULT_COVER_STICKER;
    const human = entry.coverMethod === "real-artwork" || Boolean(cover.manualRegionInput && cover.assistedArtwork);
    if (entry.coverEnabled && !human && cover.trackingMode === "agent" && cover.coverStrategy) { roles.add("hybrid"); continue; }
    const agent = (entry.mode ?? project.workspaceDraft?.decorations?.mode) === "agent";
    const automatic = entry.coverEnabled && !human && cover.trackingMode === "agent";
    if (agent || automatic) roles.add("creative");
    if (automatic || agent && !entry.coverEnabled) { roles.add("vision"); roles.add("reviewer"); }
  }
  return [...roles].sort();
}

/** Private credential values only enter this digest, never recipes or renderer state. */
export function automationModelBinding(connections: ModelConnections, roles: AutomationModelRole[]): string {
  connections.assertConfigurationIdle();
  const snapshot = connections.store.snapshot();
  if (snapshot.error) throw new Error("模型配置不可用，请检查模型与 API。");
  const chat = (model: string | undefined, reasoningEffort?: string) => {
    if (!model) throw new Error("请先配置任务使用的 ChatGPT 模型。");
    connections.chatgpt.assertModel(model, reasoningEffort);
    return { connectionId: "chatgpt", model, reasoningEffort, email: connections.chatgpt.status().email };
  };
  const bindings = roles.map(role => {
    if (role === "hybrid") {
      const profile = hybridMiniMaxProfile(connections), routes = createHybridVisionRoutes(connections);
      const state = connections.chatgpt.status();
      return { role, minimax: { connectionId: profile.id, input: connections.store.get(profile.id).input },
        chatgpt: ["LUNA", "SOL"].map(name => {
          const route = routes[name as "LUNA" | "SOL"];
          return { role: name, model: route.model, capability: route.imageCapability,
            ...(route.imageCapability === "AVAILABLE" ? { email: state.email, reasoningEffort: state.models?.find(item => item.model === route.model)?.defaultReasoningEffort } : {}) };
        }) };
    }
    const selection = role === "creative" ? snapshot.selected === "chatgpt"
      ? { connectionId: "chatgpt", model: snapshot.chatgptModel ?? connections.chatgpt.status().model,
        reasoningEffort: snapshot.chatgptReasoningEffort ?? connections.chatgpt.status().reasoningEffort }
      : snapshot.selected ? { connectionId: snapshot.selected, ...connections.store.get(snapshot.selected).input } : undefined
      : snapshot[role];
    const provider = role === "creative" ? connections.provider : role === "vision" ? connections.visionProvider : connections.reviewerProvider;
    if (!selection || !provider.status().configured) throw new Error(`请先在模型与 API 中配置${role === "creative" ? "创作" : role === "vision" ? "视觉识别" : "复核"}模型。`);
    return { role, binding: selection.connectionId === "chatgpt" ? chat(selection.model, selection.reasoningEffort)
      : { connectionId: selection.connectionId, input: { ...connections.store.get(selection.connectionId).input, model: selection.model, reasoningEffort: selection.reasoningEffort } } };
  });
  return automationDigest({ version: 2, bindings });
}
