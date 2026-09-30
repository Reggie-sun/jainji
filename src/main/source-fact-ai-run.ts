import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { AIDeclarationSchema, aiDigest, freezeAI, type AIDeclaration } from "./source-fact-ai-contract.js";
import { assertOwnedAIInput, type AIInput } from "./source-fact-ai-input.js";

export type AIEngineeringLimits = { requestLimit: number | null; wallMs: number; idleMs: number;
  responseBytes: number; payloadBytes: number; generationTokens: number | null };
export const AI_ENGINEERING_BUDGET: Readonly<AIEngineeringLimits> = Object.freeze({ requestLimit: null, wallMs: 600_000, idleMs: 60_000,
  responseBytes: 1024 * 1024, payloadBytes: 32 * 1024 * 1024, generationTokens: null });
export type AIEngineeringTransport = (payload: { requestId: string; actor: "A" | "B"; fixtureId: string; inputManifestDigest: string;
  methodConfigDigest: string; frames: unknown; images: Buffer[]; catalog: unknown; generationTokens: number | null }, signal: AbortSignal)
  => Promise<{ text: string; providerRequestId: string; stopReason: "complete" | "truncated"; toolRequests: number }>;

/** Testable engineering seam only. No supplied provider claim can enable a formal actor or issuer. */
export function createAIEngineeringRun(input: AIInput, actor: "A" | "B", transport: AIEngineeringTransport, configDigest: string,
  inspectAccepted: (declaration: AIDeclaration) => "FALSE_EMPTY" | undefined, budget = AI_ENGINEERING_BUDGET) {
  assertOwnedAIInput(input);
  if (!["A", "B"].includes(actor) || !/^[a-f0-9]{64}$/.test(configDigest)
    || Object.entries(budget).some(([key, n]) => n === null ? !["requestLimit", "generationTokens"].includes(key) : !Number.isSafeInteger(n) || n <= 0)) throw Error("INCOMPLETE: run configuration/budget");
  const limits = Object.freeze({ ...budget }), controller = new AbortController(), runId = randomUUID();
  const declarations: AIDeclaration[] = [], requests: unknown[] = [], quarantine: unknown[] = [];
  let status: "READY" | "RUNNING" | "NOT_QUALIFIED" | "INCOMPLETE" | "FROZEN" = "READY";
  let receipt: unknown = null;
  const terminate = (next: "NOT_QUALIFIED" | "INCOMPLETE") => { if (status !== "NOT_QUALIFIED" && status !== "FROZEN") status = next; controller.abort(); };
  const execute = async () => {
    if (status !== "READY") throw Error("INCOMPLETE: one-shot run"); status = "RUNNING";
    const createdAt = new Date().toISOString(), started = Date.now();
    const wall = setTimeout(() => terminate("INCOMPLETE"), limits.wallMs);
    try {
      if (limits.requestLimit !== null && input.manifest.packets.length > limits.requestLimit) throw Error("insufficient request budget");
      const catalog = new Map<string, { description: string; category: string }>();
      for (const p of input.manifest.packets) {
        if (controller.signal.aborted || Date.now() - started >= limits.wallMs) throw Error("cancelled or wall budget");
        const packet = await input.getPacket(p.packetIndex), requestId = randomUUID();
        const manifest = { runId, requestId, actor, fixtureId: input.manifest.fixtureId, inputPlanDigest: input.manifest.inputPlanDigest,
          methodConfigDigest: configDigest, source: input.manifest.source, censusDigest: input.manifest.censusDigest, frames: packet.frames,
          catalog: [...catalog.entries()] };
        const inputManifestDigest = aiDigest(manifest), sentAt = new Date().toISOString();
        const payload = { requestId, actor, fixtureId: input.manifest.fixtureId, inputManifestDigest, methodConfigDigest: configDigest,
          frames: packet.frames, images: packet.images, catalog: [...catalog.entries()], generationTokens: limits.generationTokens };
        const wireBytes = Buffer.byteLength(JSON.stringify({ ...payload, images: packet.images.map(x => x.toString("base64")) }));
        if (wireBytes > limits.payloadBytes) throw Error("payload budget");
        // Transport may ignore abort. Detach its late response, quarantine it and never accept another declaration.
        const call = Promise.resolve().then(() => transport(payload, controller.signal));
        call.then(value => { if (controller.signal.aborted) quarantine.push({ requestId, responseDigest: aiDigest(value) }); }, () => {});
        let abort: () => void = () => {};
        const cancelled = new Promise<never>((_, reject) => { abort = () => reject(Error("cancelled request")); controller.signal.addEventListener("abort", abort, { once: true }); if (controller.signal.aborted) abort(); });
        const idle = setTimeout(() => terminate("INCOMPLETE"), limits.idleMs);
        let reply;
        try { reply = await Promise.race([call, cancelled]); } finally { clearTimeout(idle); controller.signal.removeEventListener("abort", abort); }
        if (controller.signal.aborted) throw Error("late response");
        if (payload.images.length !== packet.frames.length || payload.images.some((image, i) => image.length !== packet.frames[i].pngByteLength
          || createHash("sha256").update(image).digest("hex") !== packet.frames[i].pngSha256)
          || aiDigest(payload.frames) !== aiDigest(packet.frames) || aiDigest(payload.catalog) !== aiDigest(manifest.catalog)) throw Error("transport mutated frozen input");
        requests.push({ manifest, inputManifestDigest, sentAt, receivedAt: new Date().toISOString(), wireBytes,
          providerRequestId: reply.providerRequestId, rawText: reply.text, responseSha256: createHash("sha256").update(reply.text).digest("hex") });
        if (!reply.providerRequestId || reply.stopReason !== "complete" || reply.toolRequests !== 0 || Buffer.byteLength(reply.text) > limits.responseBytes) throw Error("truncated/tool/response budget");
        const results = z.array(AIDeclarationSchema).max(8).parse(JSON.parse(reply.text));
        if (results.length !== packet.frames.length || results.some((d, i) => d.ordinal !== packet.frames[i].ordinal)) throw Error("partial/duplicate/borrowed ordinal");
        // Validate entire packet before appending anything, including cross-frame catalog conflicts.
        const next = new Map(catalog);
        for (const d of results) if (d.type === "TARGETS") for (const t of d.targets) {
          if (t.bbox.x + t.bbox.width > input.manifest.source.width || t.bbox.y + t.bbox.height > input.manifest.source.height) throw Error("bbox outside original canvas");
          const identity = { description: t.description, category: t.category };
          if (next.has(t.id) && aiDigest(next.get(t.id)) !== aiDigest(identity)) throw Error("conflicting actor identity"); next.set(t.id, identity);
        }
        for (const d of results) {
          declarations.push(freezeAI(d));
          if (inspectAccepted(d) === "FALSE_EMPTY") { terminate("NOT_QUALIFIED"); return snapshot(); }
        }
        for (const [id, identity] of next) catalog.set(id, identity);
      }
      await input.verifyFresh(); if (controller.signal.aborted) throw Error("cancelled before freeze");
      const body = { runId, actor, authority: "none", eligible: false, evidenceClass: "ENGINEERING_ONLY_NOT_FORMAL_AI_REVIEW",
        methodId: "dual-ai-full-canvas/v1", methodConfigDigest: configDigest, inputPlan: input.manifest, executionLimits: limits, createdAt, frozenAt: new Date().toISOString(), declarations, requests };
      receipt = freezeAI({ ...body, receiptDigest: aiDigest(body) }); status = "FROZEN";
    } catch (error) {
      terminate("INCOMPLETE"); requests.push({ failure: error instanceof Error ? error.message : "transport failed" });
    } finally { clearTimeout(wall); }
    return snapshot();
  };
  const snapshot = () => freezeAI({ status, authority: "none" as const, eligible: false as const, qualificationStatus: status === "NOT_QUALIFIED" ? "NOT_QUALIFIED" : "INCOMPLETE",
    qualificationRecord: null, receipt, accepted: [...declarations], requests: structuredClone(requests), quarantined: structuredClone(quarantine) });
  return Object.freeze({ execute, snapshot, cancel: () => terminate("INCOMPLETE") });
}
