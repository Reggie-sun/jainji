/** Development-only M1 count audit. Explicit source input; never enumerates user/holdout media. */
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";

const [root, ffmpegPath, realInputPath] = process.argv.slice(2);
if (!root || !ffmpegPath || !realInputPath) throw Error("Expected private fixture directory, ffmpeg and authorized real input JSON");
const ffmpeg = { ffmpegPath, ffprobePath: ffmpegPath.replace(/ffmpeg$/, "ffprobe") };
const construction = JSON.parse(await readFile(join(root, "construction.json"), "utf8"));
const audit: unknown[] = [];
for (const fixture of [...construction.cases, { case: "real233s", labelSource: "DEVELOPMENT_OBSERVATION" }]) {
  let input;
  if (fixture.case === "real233s") input = JSON.parse(await readFile(realInputPath, "utf8"));
  else {
    const sourcePath = join(root, `${fixture.case}.mp4`);
    const render = spawnSync(ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${fixture.width}x${fixture.height}`,
      "-r", String(fixture.fps), "-i", join(root, `${fixture.case}.rgb`), "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0",
      "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { timeout: 20_000 });
    if (render.status !== 0) throw Error("FIXTURE_RENDER_FAILED");
    const source = await identifySource(sourcePath, { width: fixture.width, height: fixture.height, rotation: 0,
      durationMs: fixture.frameCount * 1000 / fixture.fps, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    input = { sourcePath, source };
    await writeFile(join(root, `${fixture.case}-input.json`), JSON.stringify(input), { mode: 0o600 });
  }
  const signal = AbortSignal.timeout(300_000);
  const evidence = await prepareDiscoveryEvidence({ ...input, ffmpeg, signal }, { frames: fixture.case === "real233s" ? 24 : 18 });
  try {
    const result = await discoverStationaryTargets(evidence, signal);
    const components = result.components.map(c => ({ id: c.id, state: c.state, gridBox: c.gridBox, sourceBox: c.sourceBox,
      boxArea: c.sourceBox.width * c.sourceBox.height, stableArea: c.signals.stablePixels,
      relativePosition: { x: c.sourceBox.x / input.source.width, y: c.sourceBox.y / input.source.height }, reasons: c.reasons }));
    const item = { case: fixture.case, labelSource: fixture.labelSource, constructionLabel: fixture.constructionLabel ?? null,
      sourceKey: result.evidence.sourceKey, m1ResultDigest: result.resultDigest,
      candidateCount: components.filter(c => c.state === "CANDIDATE").length,
      unknownCount: components.filter(c => c.state === "UNKNOWN").length, components };
    audit.push(item);
    await writeFile(join(root, "candidate-count-audit.json"), JSON.stringify({ version: "hybrid-h2-count-audit/v1", modelRequests: 0, audit }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ case: fixture.case, candidates: item.candidateCount, unknown: item.unknownCount,
      candidateBoxes: components.filter(c => c.state === "CANDIDATE").map(c => c.sourceBox) }));
  } finally { await evidence.close(); }
}
