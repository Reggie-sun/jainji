import { createHash, randomUUID, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WIDTH, HEIGHT, FRAME_COUNT, SCENARIOS, GROUP_CONSTRUCTION, fixtureRecipe } from "./source-fact-ai-fixtures.mjs";

// Private author-side preparation and offline comparison. No provider/collector/production entry.
const workspace = fileURLToPath(new URL("../", import.meta.url));
const snapshotPaths = ["src/main/source-fact-census.ts", "src/main/source-fact-census-clock.ts", "src/main/source-fact-review-evidence.ts",
  "src/main/source-sticker-knowledge-store.ts", "src/main/paths.ts", "src/shared/source-sticker-knowledge.ts", "src/main/shape-cover-alpha.ts",
  "src/main/source-fact-ai-contract.ts", "src/main/source-fact-ai-compare.ts", "src/main/source-fact-ai-input.ts", "src/main/source-fact-ai-run.ts",
  "scripts/source-fact-ai-fixtures.mjs", "scripts/source-fact-ai-qualification.mjs", "src/main/ffmpeg.ts",
  "src/main/source-fact-qualification-contract.ts", "src/shared/shape-cover.ts"];
const sha = b => createHash("sha256").update(b).digest("hex");
const publish = (file, data) => writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
const json = async file => { const s = await stat(file); if (!s.isFile() || s.size > 32 * 1024 ** 2) throw Error("metadata budget"); return JSON.parse(await readFile(file, "utf8")); };
const scratch = await mkdtemp(join(tmpdir(), "jianji-ai-prepare-")), controller = new AbortController();
let child;
const stop = () => { controller.abort(); child?.kill("SIGKILL"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const command = async (binary, args) => {
  controller.signal.throwIfAborted();
  await new Promise((done, reject) => {
    child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] }); const running = child;
    let failure; const timer = setTimeout(() => { failure = Error("command wall budget"); running.kill("SIGKILL"); }, 15000);
    running.stderr.on("data", () => { failure = Error("command stderr"); }); running.once("error", e => { failure = e; });
    running.once("close", code => { child = undefined; clearTimeout(timer); if (failure || code !== 0 || controller.signal.aborted) reject(failure ?? Error("command interrupted")); else done(); });
  });
};
try {
  const entry = join(scratch, "owner.ts"), bundle = join(scratch, "owner.cjs");
  await writeFile(entry, ["src/main/source-fact-ai-contract.ts", "src/main/source-fact-ai-compare.ts", "src/main/source-fact-ai-input.ts",
    "src/main/source-fact-review-evidence.ts", "src/main/source-sticker-knowledge-store.ts", "src/main/ffmpeg.ts"]
    .map(path => `export * from ${JSON.stringify(join(workspace, path))};`).join("\n"));
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  const owner = createRequire(import.meta.url)(bundle), [action, ...args] = process.argv.slice(2);
  const snapshot = () => Promise.all(snapshotPaths.map(async path => ({ path, sha256: sha(await readFile(join(workspace, path))) })));
  const load = async directory => {
    const p = owner.assertAIPackage(await json(join(directory, "ai-package.json")));
    if (owner.aiDigest(p.manifest.sourceSnapshot) !== owner.aiDigest(await snapshot())) throw Error("INCOMPLETE: source snapshot drift");
    for (const f of p.manifest.fixtures) {
      const path = join(directory, "media", f.sourceFile);
      if (await realpath(path) !== path || (await stat(path)).size !== f.sourceIdentity.byteLength || sha(await readFile(path)) !== f.sourceIdentity.fingerprint.slice(7)) throw Error("INCOMPLETE: media drift");
    }
    return p;
  };
  if (action === "prepare-holdout" && args.length === 1) {
    const root = resolve(args[0]); await mkdir(root, { mode: 0o700 });
    await mkdir(join(root, "media"), { mode: 0o700 }); await mkdir(join(root, "inputs"), { mode: 0o700 });
    const sourceSnapshot = await snapshot(), createdAt = new Date().toISOString(), datasetVersion = `d2a-independent-${randomUUID()}/v1`;
    const ffmpeg = { ffmpegPath: await owner.discoverBinary("ffmpeg"), ffprobePath: await owner.discoverBinary("ffprobe"), signal: controller.signal };
    if (!ffmpeg.ffmpegPath || !ffmpeg.ffprobePath) throw Error("INCOMPLETE: engines unavailable");
    const fixtures = [], truths = [], inputPlans = [], authorRecipes = [];
    for (let group = 0; group < 3; group++) for (const scenario of SCENARIOS) {
      controller.signal.throwIfAborted(); const recipe = fixtureRecipe(scenario, group, randomInt(2 ** 30)), fixtureId = randomUUID(), sourceFile = `${fixtureId}.mp4`;
      const sourcePath = join(root, "media", sourceFile), raw = join(scratch, "raw.rgba");
      await writeFile(raw, Buffer.concat(Array.from({ length: FRAME_COUNT }, (_, i) => recipe.render(i))));
      await command(ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${WIDTH}x${HEIGHT}`, "-r", "12", "-i", raw,
        "-vf", "setsar=1", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "0", "-bf", "0", "-threads", "1", "-video_track_timescale", "12000", sourcePath]);
      const source = await owner.identifySource(sourcePath, { width: WIDTH, height: HEIGHT, rotation: 0, durationMs: 1000, timeBase: "1/12000", timeOriginPts: 0, interpretationVersion: 1 });
      const evidence = await owner.prepareFullCanvasReviewEvidence({ sourcePath, source, ffmpeg, signal: controller.signal });
      let input;
      try {
        if (evidence.census.frames.length !== FRAME_COUNT) throw Error("INCOMPLETE: decode count");
        for (let i = 0; i < FRAME_COUNT; i++) {
          const actual = await evidence.readFrame(i), nominal = recipe.render(i);
          if (actual.some((value, k) => Math.abs(value - nominal[k]) > 3)) throw Error("INCOMPLETE: authored/decode pixels differ");
        }
        input = await owner.prepareAIInput(evidence, fixtureId, ffmpeg);
        const directory = join(root, "inputs", fixtureId); await mkdir(directory, { mode: 0o700 });
        for (const p of input.manifest.packets) {
          const packet = await input.getPacket(p.packetIndex);
          for (const [i, frame] of packet.frames.entries()) await writeFile(join(directory, `${frame.ordinal}.png`), packet.images[i], { flag: "wx", mode: 0o600 });
        }
        await publish(join(directory, "input-plan.json"), input.manifest); inputPlans.push(input.manifest);
        fixtures.push({ fixtureId, groupId: GROUP_CONSTRUCTION[group], sourceKind: "SYNTHETIC_CONTROLLED", sourceFile, sourceIdentity: source,
          censusDigest: evidence.census.censusDigest, frameCount: FRAME_COUNT });
        truths.push({ fixtureId, census: evidence.census, frames: evidence.census.frames.map(f => ({ binding: { ordinal: f.index, pts: f.pts, endPts: f.endPts,
          pixelSha256: f.pixelSha256, byteLength: f.byteLength }, ...recipe.truth(f.index) })), cases: recipe.cases });
        authorRecipes.push({ fixtureId, groupId: GROUP_CONSTRUCTION[group], scenario, seed: recipe.seed });
      } finally { input?.close(); await evidence.close(); }
    }
    if (owner.aiDigest(sourceSnapshot) !== owner.aiDigest(await snapshot())) throw Error("INCOMPLETE: snapshot changed during freeze");
    const manifest = { schemaVersion: 1, datasetVersion, truthAuthorId: "d2a-author-codex-20260929", truthCreationVersion: "independent-scene-recipe/v1",
      truthReviewVersion: "construction-and-canonical-decode/v1", createdAt, sourceSnapshot, fixtures };
    const truth = { schemaVersion: 1, datasetVersion, truthAuthorId: manifest.truthAuthorId, truthCreationVersion: manifest.truthCreationVersion, truthReviewVersion: manifest.truthReviewVersion, fixtures: truths };
    const p = { manifest, truth, datasetDigest: owner.aiDigest(manifest), truthDigest: owner.aiDigest(truth), criteria: owner.AI_CRITERIA,
      criteriaDigest: owner.aiDigest(owner.AI_CRITERIA), frozenAt: new Date().toISOString(), usage: "NEVER_EXPOSED_HOLDOUT_CANDIDATE",
      independence: GROUP_CONSTRUCTION.map(groupId => ({ groupId, construction: `Distinct ${groupId} background geometry, independent anonymous media and randomized placement; no legacy D2Q recipe/media imports.`,
        evidenceDigest: owner.aiDigest(authorRecipes.filter(r => r.groupId === groupId)) })) };
    owner.assertAIPackage(p); const coverage = owner.aiCoverage(p); if (!coverage.sufficient) throw Error("INCOMPLETE: coverage minimum");
    const packets = inputPlans.reduce((n, p) => n + p.packets.length, 0);
    await publish(join(root, "author-recipes.json"), authorRecipes); await publish(join(root, "ai-package.json"), p);
    await publish(join(root, "preparation.json"), { authority: "none", eligible: false, qualificationStatus: "INCOMPLETE", formalRun: "NOT_STARTED",
      datasetDigest: p.datasetDigest, truthDigest: p.truthDigest, criteriaDigest: p.criteriaDigest, inputPlanDigest: owner.aiDigest(inputPlans), coverage,
      sourceSnapshotDigest: owner.aiDigest(sourceSnapshot), budgetDraft: { perFixtureActorRequestLimit: 2, allActorsPacketRequests: packets * 2,
        mappingRequests: 1, totalRequestLimit: packets * 2 + 1, perRequestGenerationTokens: 4096, perRequestWallSeconds: 180, perRequestIdleSeconds: 90,
        totalWallSeconds: 3600, maxImagesPerPacket: 8, maxPayloadBytes: 32 * 1024 ** 2, formalCostAuthorizationUsd: 0 },
      methodConfigDigest: null, applicabilityEnvelope: null, capabilityProbeA: "NOT_EVALUATED", capabilityProbeB: "NOT_EVALUATED",
      isolationEvidence: null, recordIssuer: "BLOCKED_NO_TRUSTED_FORMAL_ROUTE", realMedia: "NOT_EVALUATED",
      accessAudit: { truthAuthor: manifest.truthAuthorId, actorA: "NOT_CREATED", actorB: "NOT_CREATED", actorDeliveryCount: 0,
        inheritedConversationAllowed: false, qualificationActorsMayReadAuthorDirectory: false },
      limitation: "Synthetic preparation only; final configuration, trusted route, visual probes, isolation and finite price evidence must precede any formal request." });
    process.stdout.write(JSON.stringify({ directory: root, qualificationStatus: "INCOMPLETE", formalRun: "NOT_STARTED", coverage }) + "\n");
  } else if (action === "verify-preparation" && args.length === 1) {
    const root = resolve(args[0]), p = await load(root), plans = [];
    for (const f of p.manifest.fixtures) {
      const plan = await json(join(root, "inputs", f.fixtureId, "input-plan.json")), { inputPlanDigest, ...body } = plan;
      if (owner.aiDigest(body) !== inputPlanDigest || plan.fixtureId !== f.fixtureId || plan.censusDigest !== f.censusDigest
        || owner.aiDigest(plan.source) !== owner.aiDigest(f.sourceIdentity)) throw Error("INCOMPLETE: input plan digest/source");
      const frames = plan.packets.flatMap(p => p.frames);
      if (frames.length !== f.frameCount || frames.some((frame, i) => frame.ordinal !== i) || plan.packets.some(p => !p.frames.length || p.frames.length > 8)) throw Error("INCOMPLETE: packet coverage");
      for (const frame of frames) {
        const bytes = await readFile(join(root, "inputs", f.fixtureId, `${frame.ordinal}.png`));
        const truthFrame = p.truth.fixtures.find(t => t.fixtureId === f.fixtureId).frames[frame.ordinal];
        if (bytes.length !== frame.pngByteLength || sha(bytes) !== frame.pngSha256 || frame.pixelSha256 !== truthFrame.binding.pixelSha256
          || frame.pts !== truthFrame.binding.pts || frame.endPts !== truthFrame.binding.endPts || frame.byteLength !== truthFrame.binding.byteLength) throw Error("INCOMPLETE: frozen PNG/frame binding");
      }
      plans.push(plan);
    }
    const prep = await json(join(root, "preparation.json"));
    if (prep.inputPlanDigest !== owner.aiDigest(plans) || prep.datasetDigest !== p.datasetDigest || prep.truthDigest !== p.truthDigest || prep.criteriaDigest !== p.criteriaDigest) throw Error("INCOMPLETE: preparation digests");
    process.stdout.write(JSON.stringify({ preparationVerified: true, formalRun: "NOT_STARTED", qualificationStatus: "INCOMPLETE", coverage: owner.aiCoverage(p) }) + "\n");
  } else if (action === "compare" && args.length === 3) {
    const [directory, reviews, output] = args, p = await load(resolve(directory));
    const r = owner.compareAIQualification({ package: p, reviews: await json(resolve(reviews)) }); await publish(resolve(output), r);
    process.stdout.write(JSON.stringify({ qualificationStatus: r.qualificationStatus, qualificationRecord: null }) + "\n");
  } else throw Error("Usage: source-fact-ai-qualification.mjs prepare-holdout <new-directory> | verify-preparation <directory> | compare <directory> <reviews.json> <new-result.json>. No formal collect entry exists without qualified visual routes.");
} finally { stop(); await rm(scratch, { recursive: true, force: true }); }
