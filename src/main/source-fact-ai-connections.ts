import path from "node:path";
import { ConnectionStore } from "./connection-store.js";

const incomplete = {
  qualificationStatus: "INCOMPLETE" as const, authority: "none" as const, eligible: false as const,
};

/** Read-only author preparation. Saved configuration never attests an actor or route. */
export async function inspectAIConnectionPreparation(userData: string) {
  const owner = new ConnectionStore(path.join(userData, "connections"));
  await owner.load();
  const saved = owner.snapshot();
  if (saved.error || !owner.exists) {
    return { ...incomplete, status: saved.error ? "CONFIG_UNREADABLE" : "CONFIG_MISSING", apiConnections: [] };
  }
  const privateInputs = saved.profiles.map(profile => ({ profile, input: owner.get(profile.id).input }));
  const apiConnections = privateInputs.flatMap(({ profile, input }) => {
    const url = new URL(profile.baseUrl);
    const provider = url.hostname === "api.minimaxi.com" || url.hostname === "api.minimax.io" ? "minimax" :
      url.hostname === "api.openai.com" ? "openai" : null;
    if (!provider || url.port) return [];
    return [{ connectionId: profile.id, provider, model: profile.model, protocol: profile.protocol,
      credentialConfigured: Boolean(input.apiKey), endpoint: profile.baseUrl, routeQualification: "NOT_EVALUATED" as const }];
  });
  const result = {
    ...incomplete, status: "CONFIG_FOUND", apiConnections,
    savedSelections: { selected: saved.selected, vision: saved.vision, reviewer: saved.reviewer },
    chatgpt: { savedModel: saved.chatgptModel ?? null, authentication: "NOT_EVALUATED" as const, hardGenerationBound: "NOT_EVALUATED" as const },
  };
  // Even a key reflected through another profile's model/selection must not leave this process.
  const serialized = JSON.stringify(result);
  if (privateInputs.some(({ input }) => serialized.includes(JSON.stringify(input.apiKey).slice(1, -1)))) {
    return { ...incomplete, status: "SENSITIVE_METADATA_REJECTED", apiConnections: [] };
  }
  return result;
}
