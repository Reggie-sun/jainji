import { createHash, randomUUID, randomInt } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { DATASET_VERSION, TRUTH_AUTHOR_ID, WIDTH, HEIGHT, FRAME_COUNT, SCENARIOS, syntheticTruth, syntheticCases, renderSyntheticFrame } from "./source-fact-qualification-fixtures.mjs";

// Author-side local orchestration. Only the unmodified D2 canvas/control page is served to reviewers.
const workspace = fileURLToPath(new URL("../", import.meta.url));
const snapshotPaths = ["src/main/source-fact-census.ts", "src/main/source-fact-census-clock.ts", "src/main/source-fact-review-evidence.ts",
  "src/main/source-fact-review-session.ts", "src/main/source-sticker-knowledge-store.ts", "src/main/paths.ts", "src/shared/source-sticker-knowledge.ts",
  "src/main/source-fact-qualification-contract.ts", "src/main/source-fact-qualification-compare.ts", "scripts/source-fact-review.mjs", "scripts/source-fact-review.html",
  "scripts/source-fact-qualification.mjs", "scripts/source-fact-qualification-fixtures.mjs"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => { const info = await stat(file); if (!info.isFile() || info.size > 32 * 1024 ** 2) throw Error("UNSAFE: qualification metadata budget"); return JSON.parse(await readFile(file, "utf8")); };
const publish = (file, value) => writeFile(file, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const scratch = await mkdtemp(join(tmpdir(), "jianji-qualification-tool-"));
let activeChild;
let interrupted = false;
const stop = () => { interrupted = true; activeChild?.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const entry = join(scratch, "owner.ts"), bundle = join(scratch, "owner.cjs");
  await writeFile(entry, ["src/main/source-fact-qualification-contract.ts", "src/main/source-fact-qualification-compare.ts", "src/main/source-fact-census.ts", "src/main/source-sticker-knowledge-store.ts", "src/main/ffmpeg.ts"]
    .map(path => `export * from ${JSON.stringify(join(workspace, path))};`).join("\n"));
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  const owner = createRequire(import.meta.url)(bundle);
  const [command, ...args] = process.argv.slice(2);
  const snapshot = async () => Promise.all(snapshotPaths.map(async path => ({ path, sha256: sha(await readFile(join(workspace, path))) })));
  const load = async root => {
    const pack = owner.assertQualificationPackage(await json(join(root, "qualification-package.json")));
    if (owner.qualificationDigest(pack.manifest.sourceSnapshot) !== owner.qualificationDigest(await snapshot())) throw Error("UNSAFE: tool/source snapshot changed; freeze a new dataset before collection");
    for (const fixture of pack.manifest.fixtures) {
      const file = join(root, "media", fixture.sourceFile);
      if (await realpath(file) !== file || sha(await readFile(file)) !== fixture.sourceIdentity.fingerprint.slice(7)
        || (await stat(file)).size !== fixture.sourceIdentity.byteLength) throw Error("UNSAFE: frozen source bytes changed");
    }
    return pack;
  };
  if (command === "freeze" && args.length === 1) {
    const root = resolve(args[0]); await mkdir(root, { mode: 0o700 }); await mkdir(join(root, "media"), { mode: 0o700 });
    const sourceSnapshot = await snapshot(); const createdAt = new Date().toISOString();
    const ffmpeg = { ffmpegPath: await owner.discoverBinary("ffmpeg"), ffprobePath: await owner.discoverBinary("ffprobe") };
    if (!ffmpeg.ffmpegPath || !ffmpeg.ffprobePath) throw Error("UNSAFE: D1 engines unavailable");
    const fixtures = [], truthFixtures = [];
    for (let group = 0; group < 3; group++) for (const scenario of SCENARIOS) {
      const fixtureId = randomUUID(), sourceFile = `${fixtureId}.mp4`, sourcePath = join(root, "media", sourceFile);
      const raw = join(scratch, `${fixtureId}.rgba`);
      await writeFile(raw, Buffer.concat(Array.from({ length: FRAME_COUNT }, (_, ordinal) => renderSyntheticFrame(scenario, ordinal, group))));
      await new Promise((complete, reject) => {
        const child = spawn(ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${WIDTH}x${HEIGHT}`, "-r", "8", "-i", raw,
          "-vf", "setsar=1", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "0", "-bf", "0", "-threads", "1", "-video_track_timescale", "8000", sourcePath], { stdio: ["ignore", "ignore", "pipe"] });
        let failed = false; const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 15000);
        child.stderr.on("data", () => { failed = true; }); child.once("error", reject);
        child.once("close", code => { clearTimeout(timer); code === 0 && !failed ? complete() : reject(Error("UNSAFE: synthetic media encoding failed")); });
      });
      await rm(raw);
      const source = await owner.identifySource(sourcePath, { width: WIDTH, height: HEIGHT, rotation: 0, durationMs: 1000, timeBase: "1/8000", timeOriginPts: 0, interpretationVersion: 1 });
      const census = await owner.collectFullSourceCensus({ sourcePath, source, ffmpeg, signal: new AbortController().signal });
      // The authored truth binds the actual canonical decoded pixels, never nominal frame count or FPS guesses.
      if (census.frames.length !== FRAME_COUNT) throw Error("UNSAFE: fixture decode count");
      const decodedFile = join(scratch, `${fixtureId}.decoded.rgba`);
      await new Promise((complete, reject) => {
        const child = spawn(ffmpeg.ffmpegPath, ["-v", "error", "-nostdin", "-xerror", "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", sourcePath,
          "-map", `0:${census.decode.streamIndex}`, "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux", "-pix_fmt", "rgba", "-c:v", "rawvideo", "-threads", "1", "-f", "rawvideo", decodedFile],
        { stdio: ["ignore", "ignore", "pipe"] });
        let failed = false; const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 15000);
        child.stderr.on("data", () => { failed = true; }); child.once("error", reject);
        child.once("close", code => { clearTimeout(timer); code === 0 && !failed ? complete() : reject(Error("UNSAFE: authored fixture decode failed")); });
      });
      const decoded = await readFile(decodedFile); await rm(decodedFile);
      if (decoded.length !== WIDTH * HEIGHT * 4 * FRAME_COUNT) throw Error("UNSAFE: authored fixture decode length");
      for (const [ordinal, frame] of census.frames.entries()) {
        const actual = decoded.subarray(ordinal * frame.byteLength, (ordinal + 1) * frame.byteLength), expected = renderSyntheticFrame(scenario, ordinal, group);
        if (frame.pixelSha256 !== sha(actual) || actual.some((value, index) => Math.abs(value - expected[index]) > 3)) throw Error("UNSAFE: actual fixture pixels/geometry differ from authored recipe");
      }
      fixtures.push({ fixtureId, groupId: `controlled-scene-${group + 1}`, sourceKind: "SYNTHETIC_CONTROLLED", sourceFile, sourceIdentity: source, censusDigest: census.censusDigest, frameCount: FRAME_COUNT });
      truthFixtures.push({ fixtureId, census, frames: census.frames.map(frame => ({ binding: { ordinal: frame.index, pts: frame.pts, endPts: frame.endPts, pixelSha256: frame.pixelSha256, byteLength: frame.byteLength }, ...syntheticTruth(scenario, frame.index) })), cases: syntheticCases(scenario) });
    }
    if (owner.qualificationDigest(sourceSnapshot) !== owner.qualificationDigest(await snapshot())) throw Error("UNSAFE: snapshot changed during freeze");
    const manifest = { schemaVersion: 1, datasetVersion: DATASET_VERSION, truthAuthorId: TRUTH_AUTHOR_ID, truthCreationVersion: "controlled-rgba-recipe/v1",
      truthReviewVersion: "recipe-and-canonical-decode-audit/v1", createdAt, sourceSnapshot, fixtures };
    const truth = { schemaVersion: 1, datasetVersion: DATASET_VERSION, truthAuthorId: TRUTH_AUTHOR_ID, truthCreationVersion: manifest.truthCreationVersion,
      truthReviewVersion: manifest.truthReviewVersion, fixtures: truthFixtures };
    const pack = { manifest, truth, datasetDigest: owner.qualificationDigest(manifest), truthDigest: owner.qualificationDigest(truth), criteria: owner.QUALIFICATION_CRITERIA,
      criteriaDigest: owner.qualificationDigest(owner.QUALIFICATION_CRITERIA), frozenAt: new Date().toISOString() };
    owner.assertQualificationPackage(pack); const coverage = owner.qualificationCoverage(pack);
    if (!coverage.sufficient) throw Error("UNSAFE: controlled dataset coverage insufficient");
    await publish(join(root, "qualification-package.json"), pack);
    await publish(join(root, "freeze-summary.json"), { authority: "none", qualificationStatus: "INCOMPLETE", humanRun: "NOT_STARTED", datasetDigest: pack.datasetDigest,
      truthDigest: pack.truthDigest, criteriaDigest: pack.criteriaDigest, coverage, limitation: "SYNTHETIC_ONLY_NOT_REAL_MEDIA_GENERALIZATION" });
    process.stdout.write(JSON.stringify({ packageDirectory: root, qualificationStatus: "INCOMPLETE", humanRun: "NOT_STARTED", coverage }) + "\n");
  } else if (command === "prepare" && args.length === 3) {
    const [directory, reviewerId, outputDirectory] = args, root = resolve(directory), run = resolve(outputDirectory), pack = await load(root);
    if (!owner.qualificationCoverage(pack).sufficient) throw Error("UNSAFE: qualification coverage insufficient");
    if (!reviewerId.trim() || reviewerId.length > 160 || reviewerId !== reviewerId.trim() || reviewerId === pack.manifest.truthAuthorId) throw Error("UNSAFE: independent reviewer identity required");
    await mkdir(run, { mode: 0o700 });
    await publish(join(run, "preparation.json"), { authority: "none", qualificationStatus: "INCOMPLETE", humanRun: "NOT_STARTED", reviewerId,
      truthAuthorId: pack.manifest.truthAuthorId, datasetDigest: pack.datasetDigest, truthDigest: pack.truthDigest, criteriaDigest: pack.criteriaDigest,
      frozenAt: pack.frozenAt, preconditions: ["independent reviewer identity requires parent verification", "reviewer must not inspect author-side truth or scores",
        "real human operates every semantic declaration", "post-receipt independent correspondence adjudication"], preparedAt: new Date().toISOString() });
    process.stdout.write(JSON.stringify({ runDirectory: run, humanRun: "NOT_STARTED", qualificationStatus: "INCOMPLETE" }) + "\n");
  } else if (command === "collect" && args.length === 2) {
    const root = resolve(args[0]), run = resolve(args[1]), pack = await load(root), preparation = await json(join(run, "preparation.json"));
    if (!owner.qualificationCoverage(pack).sufficient) throw Error("UNSAFE: qualification coverage insufficient");
    if (preparation.humanRun !== "NOT_STARTED" || preparation.datasetDigest !== pack.datasetDigest || preparation.truthDigest !== pack.truthDigest
      || preparation.criteriaDigest !== pack.criteriaDigest || preparation.reviewerId === pack.manifest.truthAuthorId) throw Error("UNSAFE: review preparation binding");
    await publish(join(run, "collection-intent.json"), { authority: "none", startedAt: new Date().toISOString(), datasetDigest: pack.datasetDigest,
      evidenceClass: "LIVE_D2_COLLECTION_HUMAN_PROVENANCE_NOT_YET_ACCEPTED" });
    const ordered = [...pack.manifest.fixtures]; for (let i = ordered.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ordered[i], ordered[j]] = [ordered[j], ordered[i]]; }
    const reviews = []; let fatal;
    for (const fixture of ordered) {
      if (interrupted) { fatal = { authority: "none", qualificationStatus: "INCOMPLETE", reason: "ENVIRONMENT_INTERRUPTED" }; break; }
      try { await new Promise((complete, reject) => {
        const child = fork(join(workspace, "scripts/source-fact-review.mjs"), [join(root, "media", fixture.sourceFile), preparation.reviewerId, join(run, `${fixture.fixtureId}.receipt.json`)],
          { stdio: ["ignore", "pipe", "pipe", "ipc"] }); activeChild = child;
        let received = false, session; const accepted = new Map();
        child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
        child.on("message", async message => {
          try {
            if (fatal) return;
            const { kind, checkpointId, data } = message;
            if (kind === "D2_SESSION") {
              if (session || data.censusDigest !== fixture.censusDigest || data.reviewerId !== preparation.reviewerId || Date.parse(data.createdAt) < Date.parse(pack.frozenAt)
                || owner.qualificationDigest(data.sourceIdentity) !== owner.qualificationDigest(fixture.sourceIdentity)) throw Error("UNSAFE: live D2 session binding");
              session = data;
            } else if (kind === "D2_RECORD") {
              if (!session) throw Error("UNSAFE: live D2 session missing");
              const inspection = owner.inspectLiveQualificationRecord(pack, fixture.fixtureId, data);
              const binding = inspection.record.binding;
              accepted.set(binding.ordinal, data);
              if (inspection.falseEmpty) {
                fatal = { authority: "none", qualificationStatus: "NOT_QUALIFIED", reason: "FALSE_EMPTY", fixtureId: fixture.fixtureId,
                  ordinal: binding.ordinal, datasetDigest: pack.datasetDigest, truthDigest: pack.truthDigest, criteriaDigest: pack.criteriaDigest,
                  falseEmptyCount: 1, metricsComplete: false, acceptedRecord: data, noFurtherQualificationCollection: true };
                await publish(join(run, "collection-result.json"), fatal); child.kill("SIGTERM"); return;
              }
            } else if (kind === "D2_RECEIPT") {
              owner.validateQualificationReceipt(data, pack, fixture.fixtureId);
              if (accepted.size !== fixture.frameCount || data.results.some(r => owner.qualificationDigest({ binding: r.binding, result: r.result }) !== owner.qualificationDigest(accepted.get(r.binding.ordinal)))) throw Error("UNSAFE: IPC record/receipt mismatch");
              reviews.push({ fixtureId: fixture.fixtureId, receipt: data }); received = true;
              child.send({ kind: "D2_EXPORT_ACK", checkpointId }, () => child.kill("SIGTERM")); return;
            } else throw Error("UNSAFE: unexpected D2 export");
            child.send({ kind: "D2_EXPORT_ACK", checkpointId });
          } catch (error) { fatal ??= { authority: "none", qualificationStatus: "INCOMPLETE", reason: error.message }; child.kill("SIGTERM"); }
        });
        child.once("error", reject); child.once("close", () => { activeChild = undefined; if (fatal || received) complete(); else reject(Error("UNSAFE: collection interrupted or incomplete")); });
      }); } catch (error) { fatal ??= { authority: "none", qualificationStatus: "INCOMPLETE", reason: error.message }; }
      if (fatal) break;
    }
    await publish(join(run, "reviews.json"), reviews);
    if (!fatal) await publish(join(run, "collection-result.json"), { authority: "none", qualificationStatus: "INCOMPLETE", reason: "INDEPENDENT_HUMAN_AND_BLINDING_EVIDENCE_REQUIRES_PARENT_ACCEPTANCE",
      datasetDigest: pack.datasetDigest, criteriaDigest: pack.criteriaDigest, completedFixtures: reviews.length });
    else if (fatal.qualificationStatus === "INCOMPLETE") await publish(join(run, "collection-result.json"), fatal);
    // Do not expose scores or qualification states to the reviewer during collection.
  } else if (command === "compare" && args.length === 4) {
    const [directory, reviewsFile, correspondenceFile, newResult] = args, pack = await load(resolve(directory));
    const result = owner.compareHumanReviewQualification({ package: pack, reviews: await json(resolve(reviewsFile)), correspondence: await json(resolve(correspondenceFile)) });
    await publish(resolve(newResult), result); process.stdout.write(JSON.stringify({ authority: "none", qualificationStatus: result.qualificationStatus, formalQualificationRecord: null }) + "\n");
  } else throw Error("Usage: source-fact-qualification.mjs freeze <new-directory> | prepare <package-directory> <reviewer-id> <new-run-directory> | collect <package-directory> <run-directory> | compare <package-directory> <reviews.json> <correspondence.json> <new-result.json>");
} finally { stop(); await rm(scratch, { recursive: true, force: true }); }
