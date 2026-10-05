/** Frozen once-only H2C development evaluation. Never calls mask/preview/queue/activation. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ModelConnections } from "../src/main/model-connections.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { CORNERS, createCornerScopePlan } from "../src/main/shape-cover-vision-corner-policy.js";
import { CORNER_PROMPT_VERSION } from "../src/main/shape-cover-vision-corner-schema.js";
import { confirmHybridCornerTargets, getConfirmedCornerTargets } from "../src/main/shape-cover-vision-corner-semantic.js";
import { createHybridVisionRoutes } from "../src/main/shape-cover-vision-provider.js";
import { ShapeCoverVisionSession } from "../src/main/shape-cover-vision-router.js";

const [root, ffmpegPath, realInputPath, mode, lunaModel, solModel] = process.argv.slice(2);
const finalValidation = mode === "--final-provider-validation";
if (!root || !ffmpegPath || !realInputPath || !["--prepare", "--live", "--continue-unrequested", "--final-provider-validation"].includes(mode) ||
    finalValidation && (!lunaModel || !solModel)) throw Error("Explicit private inputs, mode and final validation model IDs required");
const fixtures = join(root, "fixtures"), construction = JSON.parse(await readFile(join(fixtures, "construction.json"), "utf8"));
const cases: string[] = finalValidation ? ["product-print", "subtitle", "multi-component", "two-overlays"] :
  [...construction.cases.map((c: { case: string }) => c.case), "real233s"];
const signal = AbortSignal.timeout(1800000), tools = { ffmpegPath, ffprobePath: ffmpegPath.replace(/ffmpeg$/, "ffprobe"), signal };
const sourceInput = async (name: string) => JSON.parse(await readFile(name === "real233s" ? realInputPath : join(fixtures, `${name}-input.json`), "utf8"));
if (mode === "--prepare") {
  await writeFile(join(root, "prepare-once.json"), JSON.stringify({ cases, prompt: CORNER_PROMPT_VERSION }), { flag: "wx", mode: 0o600 });
  const audit: unknown[] = [];
  for (const name of cases) {
    if (name !== "real233s") {
      const sourcePath = join(fixtures, `${name}.mp4`), { width, height, fps, frameCount } = construction;
      const r = spawnSync(ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps),
        "-i", join(fixtures, `${name}.rgb`), "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { timeout: 60000 });
      if (r.status !== 0) throw Error("FIXTURE_ENCODE_FAILED");
      const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: frameCount * 1000 / fps, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
      await writeFile(join(fixtures, `${name}-input.json`), JSON.stringify({ sourcePath, source }), { flag: "wx", mode: 0o600 });
    }
    const input = await sourceInput(name), evidence = await prepareDiscoveryEvidence({ ...input, ffmpeg: tools, signal }, { frames: name === "real233s" ? 24 : 18 });
    try {
      const m1 = await discoverStationaryTargets(evidence, signal), plan = createCornerScopePlan(m1);
      audit.push({ case: name, candidateCount: plan.allCandidates.length, unknownCount: plan.unknownCandidateIds.length, plan });
      if (name === "real233s" && !plan.assignments.some(a => a.sourceBox.x === 627 && a.corner === "TOP_RIGHT")) throw Error("REAL233S_PRIMARY_OUT_OF_SCOPE_STOP");
      console.log(JSON.stringify({ case: name, candidates: plan.allCandidates.length, unknown: plan.unknownCandidateIds.length,
        corners: Object.fromEntries(CORNERS.map(c => [c, plan.corners[c].candidateIds.length])), outOfScope: plan.outOfScopeCandidateIds.length }));
    } finally { await evidence.close(); }
  }
  await writeFile(join(root, "corner-count-audit.json"), JSON.stringify(audit, null, 2), { mode: 0o600 });
} else {
  const paths = ["src/main/shape-cover-vision-router.ts", "src/main/shape-cover-vision-corner-policy.ts", "src/main/shape-cover-vision-corner-schema.ts", "src/main/shape-cover-vision-corner-semantic.ts",
    "src/main/shape-cover-vision-packet.ts", "src/main/shape-cover-vision-provider.ts", "scripts/shape-cover-hybrid-corner-fixtures.py", "scripts/shape-cover-hybrid-corner-diagnostic.ts",
    join(root, "corner-count-audit.json"), join(fixtures, "construction.json"), ...(finalValidation ? [] : [realInputPath]),
    ...cases.filter(c => c !== "real233s").flatMap(c => [join(fixtures, `${c}.mp4`), join(fixtures, `${c}-input.json`)])];
  const continuing = mode === "--continue-unrequested";
  const previous = continuing ? JSON.parse(await readFile(join(root, "semantic-evaluation.json"), "utf8")) : undefined;
  if (previous) {
    // Only a terminal evaluation can continue independent, never-requested sources. No source retry.
    const last = previous.evaluations.at(-1);
    if (last?.result.status !== "CORNER_SEMANTIC_BLOCKED") throw Error("TERMINAL_BLOCKED_PREDECESSOR_REQUIRED");
    for (const f of previous.freeze.frozen) {
      if (f.path !== "scripts/shape-cover-hybrid-corner-diagnostic.ts" && discoveryHash(await readFile(f.path)) !== f.sha256) throw Error("PREDECESSOR_INPUT_CHANGED");
    }
  }
  const frozen = await Promise.all(paths.map(async path => ({ path, sha256: discoveryHash(await readFile(path)) })));
  const freeze = { promptVersion: CORNER_PROMPT_VERSION, cases, frozen, createdAt: new Date().toISOString(), retry: false,
    ...(finalValidation ? { validationId: "H2C-final-provider-validation", schemaVersion: "CornerDecisionSchema/v1",
      schemaSourceSha256: discoveryHash(await readFile("src/main/shape-cover-vision-corner-schema.ts")),
      modelIds: { LUNA: lunaModel, SOL: solModel }, expectedConstructionSemantics: cases.map(name => {
        const label = construction.cases.find((c: { case: string }) => c.case === name);
        if (!label || label.labelSource !== "CONTROLLED_TRUTH") throw Error("CONSTRUCTION_SEMANTICS_REQUIRED");
        return label;
      }) } : {}) };
  await writeFile(join(root, finalValidation ? "final-provider-validation-once.json" : continuing ? "continue-unrequested-once.json" : "semantic-run-once.json"), JSON.stringify({ ...freeze,
    ...(continuing ? { predecessorSha256: discoveryHash(await readFile(join(root, "semantic-evaluation.json"))), consumedCases: previous.evaluations.map((e: { case: string }) => e.case) } : {}) }, null, 2), { flag: "wx", mode: 0o600 });
  const verify = async () => { for (const f of frozen) if (discoveryHash(await readFile(f.path)) !== f.sha256) throw Error("FROZEN_DEVELOPMENT_INPUT_CHANGED"); };
  const connections = new ModelConnections("/home/reggie/.config/jianji", process.cwd(), async () => {}, () => {}), evaluations: unknown[] = [];
  await mkdir(join(root, "sanitized-responses"), { mode: 0o700, recursive: true });
  await mkdir(join(root, "source-reservations"), { mode: 0o700, recursive: true });
  try {
    await connections.restore();
    if (connections.chatgpt.status().status !== "ready") await connections.chatgpt.refresh();
    const baseRoutes = createHybridVisionRoutes(connections); // No MiniMax capability probe or generation.
    if (finalValidation && (baseRoutes.LUNA.model !== lunaModel || baseRoutes.SOL.model !== solModel)) throw Error("FROZEN_MODEL_IDS_UNAVAILABLE");
    for (const name of cases) {
      if (previous?.evaluations.some((e: { case: string }) => e.case === name)) continue;
      await verify();
      // A crash, timeout or unknown outcome cannot replay this source in any invocation.
      await writeFile(join(root, "source-reservations", `${name}.json`), JSON.stringify({ case: name, createdAt: new Date().toISOString(), promptVersion: CORNER_PROMPT_VERSION }), { flag: "wx", mode: 0o600 });
      let seq = 0;
      const routes = Object.fromEntries(Object.entries(baseRoutes).map(([role, route]) => [role, { ...route, complete: async (...args: Parameters<typeof route.complete>) => {
        const raw = await route.complete(...args);
        const sanitized = raw.slice(0, 16384).replace(/data:image\/[^\s"]+/g, "[IMAGE]").replace(/Bearer\s+[^\s"]+|sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
          .replace(/(?:https?:\/\/|\/(?:home|tmp|mnt)\/)[^\s"\\]+/g, "[PRIVATE_REFERENCE]").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        await writeFile(join(root, "sanitized-responses", `${name}-${role}-${++seq}.txt`), sanitized, { flag: "wx", mode: 0o600 });
        return raw;
      } }])) as typeof baseRoutes;
      const input = await sourceInput(name), evidence = await prepareDiscoveryEvidence({ ...input, ffmpeg: tools, signal }, { frames: name === "real233s" ? 24 : 18 });
      try {
        const result = await confirmHybridCornerTargets(evidence, tools, new ShapeCoverVisionSession(evidence.receipt.sourceKey, routes, 180000, "CORNER"), signal);
        await result.verifyFresh(); await verify();
        evaluations.push({ case: name, ...(finalValidation ? { validationStatus: result.sourceErrors.includes("VISION_PROVIDER_ERROR") ? "PROVIDER_NOT_EVALUATED" :
          result.status === "CORNER_SEMANTIC_BLOCKED" ? "NOT_EVALUATED" : "MODEL_RESULT" } : {}),
          label: construction.cases.find((c: { case: string }) => c.case === name) ?? { labelSource: "DEVELOPMENT_OBSERVATION" },
          result, h3Targets: await getConfirmedCornerTargets(result), routes: Object.fromEntries(Object.entries(baseRoutes).map(([role, r]) => [role, { model: r.model, imageCapability: r.imageCapability }])) });
        await writeFile(join(root, continuing ? "continuation-evaluation.json" : "semantic-evaluation.json"), JSON.stringify({ freeze, evaluations }, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ case: name, status: result.status, corners: Object.fromEntries(CORNERS.map(c => [c, { status: result.corners[c].status,
          class: result.corners[c].confirmedTarget?.classification, rejected: result.corners[c].rejectedCandidates.map(d => d.classification), reasons: result.corners[c].reasons }])), requests: result.requestCounts }));
        // Infrastructure/binding failure invalidates this source, not independent fixture sources.
        if (result.status === "CORNER_SEMANTIC_BLOCKED" && !continuing && !finalValidation) throw Error("DEVELOPMENT_SOURCE_BLOCKED_STOP");
      } finally { await evidence.close(); }
    }
  } finally { await connections.dispose(); }
}
