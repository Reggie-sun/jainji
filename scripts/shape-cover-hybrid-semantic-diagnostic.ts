/** Once-only fixed H2 development run. Does not publish knowledge, masks, preview approval or production tasks. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelConnections } from "../src/main/model-connections.js";
import { prepareDiscoveryEvidence, discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { buildVisionCandidatePacket } from "../src/main/shape-cover-vision-packet.js";
import { createHybridVisionRoutes } from "../src/main/shape-cover-vision-provider.js";
import { H2_PROMPT_VERSION, ShapeCoverVisionSession, type VisionRoute } from "../src/main/shape-cover-vision-router.js";
import { confirmHybridSemanticTargets, planHybridSemanticBatches } from "../src/main/shape-cover-vision-semantic.js";

const [root, fixtures, ffmpegPath, realInputPath, capabilityPath, mode] = process.argv.slice(2);
if (!root || !fixtures || !ffmpegPath || !realInputPath || !capabilityPath || mode !== "--live") throw Error("Explicit private inputs and --live required");
const cases = ["overlay", "box-print", "bottle-print", "subtitle", "video-title", "logo-and-print", "multi-component", "padding", "background", "real233s"];
const compareCases = ["box-print", "multi-component"];
const frozenPaths = ["src/main/shape-cover-vision-router.ts", "src/main/shape-cover-vision-schema.ts", "src/main/shape-cover-vision-semantic.ts",
  "scripts/shape-cover-hybrid-fixtures.py", "scripts/shape-cover-hybrid-semantic-diagnostic.ts", join(fixtures, "construction.json"), join(fixtures, "candidate-count-audit.json")];
const frozen = await Promise.all(frozenPaths.map(async path => ({ path, sha256: discoveryHash(await readFile(path)) })));
const freeze = { promptVersion: H2_PROMPT_VERSION, cases, compareCases, frozenAt: new Date().toISOString(), frozenInputs: frozen };
await writeFile(join(root, "semantic-run-once.json"), JSON.stringify(freeze, null, 2), { flag: "wx", mode: 0o600 });
const construction = JSON.parse(await readFile(join(fixtures, "construction.json"), "utf8"));
const connection = new ModelConnections("/home/reggie/.config/jianji", process.cwd(), async () => {}, () => {});
const evaluations: unknown[] = [], comparisons: unknown[] = [];
const verifyFreeze = async () => { for (const f of frozen) if (discoveryHash(await readFile(f.path)) !== f.sha256) throw Error("FROZEN_DEVELOPMENT_INPUT_CHANGED"); };
try {
  await connection.restore();
  if (connection.chatgpt.status().status !== "ready") await connection.chatgpt.refresh();
  const capability = JSON.parse(await readFile(capabilityPath, "utf8"));
  const profile = connection.store.snapshot().profiles.find(p => p.model === "MiniMax-M3" && new URL(p.baseUrl).hostname === "api.minimaxi.com" && p.protocol === "responses");
  let minimax: VisionRoute | undefined;
  if (profile && capability.status === "IMAGE_CAPABILITY_VERIFIED" && capability.model === profile.model) {
    const selection = { connectionId: profile.id, model: profile.model };
    const binding = discoveryHash(JSON.stringify(connection.store.get(profile.id).input));
    const provider = connection.reviewProvider(selection);
    minimax = { provider: "minimax", model: profile.model, imageCapability: "AVAILABLE", verifyFresh: async () => {
      if (discoveryHash(JSON.stringify(connection.store.get(profile.id).input)) !== binding) throw Error("VISION_CONNECTION_CHANGED");
    }, complete: (messages, signal, options) => provider.completeStructuredVision(messages, signal, options) };
  }
  const routes = createHybridVisionRoutes(connection, minimax);
  for (const name of cases) {
    await verifyFreeze();
    const input = JSON.parse(await readFile(name === "real233s" ? realInputPath : join(fixtures, `${name}-input.json`), "utf8"));
    const signal = AbortSignal.timeout(600000), tools = { ffmpegPath, ffprobePath: ffmpegPath.replace(/ffmpeg$/, "ffprobe"), signal };
    const evidence = await prepareDiscoveryEvidence({ ...input, ffmpeg: tools, signal }, { frames: name === "real233s" ? 24 : 18 });
    try {
      const result = await confirmHybridSemanticTargets(evidence, tools, new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes), signal);
      await result.verifyFresh(); await verifyFreeze();
      const label = construction.cases.find((c: { case: string }) => c.case === name);
      const item = { case: name, labelSource: label?.labelSource ?? "DEVELOPMENT_OBSERVATION", constructionLabel: label?.constructionLabel ?? null,
        result, routes: Object.fromEntries(Object.entries(routes).map(([role, r]) => [role, { model: r.model, imageCapability: r.imageCapability }])) };
      evaluations.push(item);
      await writeFile(join(root, "semantic-evaluation.json"), JSON.stringify({ freeze, evaluations, comparisons }, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ case: name, status: result.status, groups: result.confirmedGroups.map(g => g.candidateIds.length),
        rejected: result.rejectedCandidates.map(c => c.classification), unresolved: result.unresolvedCandidates.length, requests: result.requestCounts }));
      if (compareCases.includes(name)) {
        const plan = planHybridSemanticBatches(await discoverStationaryTargets(evidence, signal));
        if (plan.batches.length !== 1) throw Error("COMPARISON_PACKET_LIMIT");
        const packet = await buildVisionCandidatePacket(evidence, plan.batches[0], tools);
        const comparison = new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes);
        try { await comparison.request("MINIMAX", packet, signal, { batchPlanDigest: plan.batchPlanDigest,
          allCandidates: plan.allCandidates.map(c => ({ candidateId: c.candidateId, sourceBox: c.sourceBox })) }); } catch { /* Receipt is the outcome; never retry. */ }
        comparisons.push({ case: name, purpose: "DEVELOPMENT_COMPARISON", requests: comparison.requestCounts, receipts: comparison.receipts });
        await writeFile(join(root, "semantic-evaluation.json"), JSON.stringify({ freeze, evaluations, comparisons }, null, 2), { mode: 0o600 });
      }
    } finally { await evidence.close(); }
  }
} finally { await connection.dispose(); }
