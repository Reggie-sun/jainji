import type { ModelConnections } from "./model-connections.js";
import type { SelectModel } from "../shared/connections.js";
import { discoveryHash } from "./source-fact-discovery-evidence.js";
import type { VisionRole, VisionRoute } from "./shape-cover-vision-router.js";

export const HYBRID_REQUESTED_GPT_MODELS = Object.freeze({ LUNA: "gpt-6-luna", SOL: "gpt-6.1-sol" });
// Explicit Hybrid authorization: H1 conversation 01a10b87-61f2-7da2-ab53-4b51c798e728, user reply line 1131.
// These alternates are not inferred from the catalog; requested exact models take precedence when available.
export const HYBRID_GPT_MODELS = Object.freeze({ LUNA: "gpt-5.6-luna", SOL: "gpt-5.6-sol" });
function unavailable(provider: string, model: string): VisionRoute {
  return { provider, model, imageCapability: "MODEL_IMAGE_CAPABILITY_UNAVAILABLE", verifyFresh: async () => {},
    complete: async () => { throw Error("MODEL_IMAGE_CAPABILITY_UNAVAILABLE"); } };
}

function chatGPTRoute(connections: ModelConnections, model: string): VisionRoute {
  try {
    connections.chatgpt.assertModel(model);
    const initial = connections.chatgpt.status();
    const selected = initial.models!.find(item => item.model === model)!;
    const selection = { connectionId: "chatgpt", model, reasoningEffort: selected.defaultReasoningEffort };
    const provider = connections.reviewProvider(selection);
    return { provider: "chatgpt", model, imageCapability: "AVAILABLE",
      verifyFresh: async () => {
        connections.chatgpt.assertModel(model, selection.reasoningEffort);
        if (connections.chatgpt.status().email !== initial.email) throw Error("VISION_CONNECTION_CHANGED");
      }, complete: (messages, signal, options) => provider.completeStructuredVision(messages, signal, options) };
  } catch { return unavailable("chatgpt", model); }
}

/** Explicit development capability probe. It makes one request, never retries or switches models. */
export async function probeMiniMaxVisionRoute(connections: ModelConnections, selection: SelectModel, png: Buffer,
  signal: AbortSignal): Promise<{ route: VisionRoute; imageSha256: string; modelRequests: number }> {
  signal.throwIfAborted();
  const fallback = unavailable("minimax", selection.model), imageSha256 = discoveryHash(png);
  if (selection.connectionId === "chatgpt") return { route: fallback, imageSha256, modelRequests: 0 };
  const profile = connections.store.get(selection.connectionId).input;
  const url = new URL(profile.baseUrl);
  // Only the selected, audited official route. A text-only connection test is insufficient.
  if (url.protocol !== "https:" || !["api.minimaxi.com", "api.minimax.io"].includes(url.hostname) || url.username || url.password ||
      profile.model !== selection.model || profile.protocol === "anthropic" || png.length > 8 * 1024 ** 2) return { route: fallback, imageSha256, modelRequests: 0 };
  const binding = discoveryHash(JSON.stringify(profile)); // Never serialize the private credential binding.
  const verifyFresh = async () => {
    if (discoveryHash(JSON.stringify(connections.store.get(selection.connectionId).input)) !== binding) throw Error("VISION_CONNECTION_CHANGED");
  };
  const provider = connections.reviewProvider(selection);
  try {
    const raw = await provider.completeStructuredVision([{ role: "user", content: [
      { type: "text", text: 'Identify the three vertical color bands, left to right. Return only JSON {"bands":["color","color","color"]}; basic English color names.' },
      { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" } },
    ] }], AbortSignal.any([signal, AbortSignal.timeout(90_000)]), { maxOutputTokens: 1024, maxOutputCharacters: 4096 });
    await verifyFresh(); signal.throwIfAborted();
    const result = JSON.parse(raw) as { bands?: unknown };
    if (JSON.stringify(result.bands) !== JSON.stringify(["red", "green", "blue"])) return { route: fallback, imageSha256, modelRequests: 1 };
    return { route: { provider: "minimax", model: selection.model, imageCapability: "AVAILABLE", verifyFresh,
      complete: (messages, requestSignal, options) => provider.completeStructuredVision(messages, requestSignal, options) }, imageSha256, modelRequests: 1 };
  } catch { return { route: fallback, imageSha256, modelRequests: 1 }; }
}

export function createHybridVisionRoutes(connections: ModelConnections, minimax?: VisionRoute): Record<VisionRole, VisionRoute> {
  const select = (role: "LUNA" | "SOL") => {
    const requested = chatGPTRoute(connections, HYBRID_REQUESTED_GPT_MODELS[role]);
    return requested.imageCapability === "AVAILABLE" ? requested : chatGPTRoute(connections, HYBRID_GPT_MODELS[role]);
  };
  return { LUNA: select("LUNA"), SOL: select("SOL"),
    MINIMAX: minimax ?? unavailable("minimax", "UNAVAILABLE") };
}
