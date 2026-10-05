import type { ModelConnections } from "./model-connections.js";
import { createHybridVisionRoutes, probeMiniMaxVisionRoute } from "./shape-cover-vision-provider.js";
import { encodeShapeCoverPng } from "./shape-cover-alpha.js";
import type { VisionRole, VisionRoute } from "./shape-cover-vision-router.js";
import type { FfmpegAdapter } from "./ffmpeg.js";

/** The canonical connection owner provides credentials; bounded capability failure is never retried. */
export function hybridProductRoutes(connections: ModelConnections, tools: FfmpegAdapter) {
  let capability: Promise<VisionRoute> | undefined;
  return async (signal: AbortSignal): Promise<Record<VisionRole, VisionRoute>> => {
    signal.throwIfAborted();
    if (!capability) capability = (async () => {
      const profile = connections.store.snapshot().profiles.find(p => p.model === "MiniMax-M3" && p.protocol === "responses" &&
        ["api.minimaxi.com", "api.minimax.io"].includes(new URL(p.baseUrl).hostname));
      if (!profile) throw Error("HYBRID_MINIMAX_CONNECTION_UNAVAILABLE");
      const rgba = Buffer.alloc(96 * 32 * 4);
      for (let i = 0; i < rgba.length / 4; i++) { rgba[i * 4 + Math.floor(i % 96 / 32)] = 255; rgba[i * 4 + 3] = 255; }
      const probe = await probeMiniMaxVisionRoute(connections, { connectionId: profile.id, model: profile.model },
        await encodeShapeCoverPng(rgba, { width: 96, height: 32 }, { ...tools, signal }), signal);
      if (probe.route.imageCapability !== "AVAILABLE") throw Error("HYBRID_MINIMAX_IMAGE_CAPABILITY_UNAVAILABLE");
      return probe.route;
    })();
    const minimax = await capability;
    await minimax.verifyFresh();
    return createHybridVisionRoutes(connections, minimax);
  };
}
