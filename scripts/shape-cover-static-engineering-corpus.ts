/** M2-F construction-first corpus through the unchanged application extractor. Offline evidence only. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask, STATIC_MASK_CONFIG, packStaticMask } from "../src/main/source-mask-static-extraction.js";

export const CONTROLLED_CASES = ["opaque-irregular", "antialiased-contour", "alpha-1", "one-pixel-tip", "two-pixel-stroke",
  "holes", "disconnected-components", "light-on-light", "dark-on-dark", "chroma-heavy-edge", "corner-target", "edge-target",
  "changing-background", "high-motion-background", "scene-cut", "h264-reencode", "first-frame", "last-frame", "adverse-one-frame-edge"] as const;
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const width = 128, height = 96, count = 30;
function run(binary: string, args: string[], input?: Buffer) {
  const result = spawnSync(binary, args, { input, timeout: 20_000, maxBuffer: 8 * 1024 ** 2 });
  if (result.error || result.status) throw result.error ?? Error(result.stderr.toString());
  return result.stdout;
}

/** Alpha recipes do not take a candidate, detector result, support or extracted mask. */
export function constructCase(kind: typeof CONTROLLED_CASES[number]) {
  const rgb = Buffer.alloc(width * height * 3 * count), alphas: Buffer[] = [];
  const cx = kind === "corner-target" ? 20 : kind === "edge-target" ? 108 : 65, cy = kind === "corner-target" ? 20 : 43;
  for (let f = 0; f < count; f++) {
    const alpha = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x, distance = Math.abs(x - cx) + Math.abs(y - cy);
      let a = distance <= 12 ? 255 : 0;
      if (kind === "antialiased-contour" && distance > 12 && distance <= 14) a = distance === 13 ? 128 : 32;
      if (kind === "alpha-1" && distance > 12 && distance <= 14) a = 1;
      if (kind === "one-pixel-tip" && y === cy && x > cx + 12 && x <= cx + 20) a = 255;
      if (kind === "two-pixel-stroke" && (y === cy || y === cy + 1) && x > cx + 10 && x <= cx + 20) a = 255;
      if (kind === "holes" && Math.abs(x - cx) <= 4 && Math.abs(y - cy) <= 4) a = 0;
      if (kind === "disconnected-components" && x >= cx + 18 && x <= cx + 21 && y >= cy - 2 && y <= cy + 1) a = 255;
      const adverse = kind === "first-frame" && f === 0 || kind === "last-frame" && f === count - 1
        || kind === "adverse-one-frame-edge" && f === 15;
      if (adverse && y === cy && x === cx + 15) a = 255;
      alpha[p] = a;
      for (let c = 0; c < 3; c++) {
        let background = (x * 13 + y * 7 + f * 107) % 230 + 10;
        if (kind === "light-on-light") background = 155 + (x * 13 + y * 7 + f * 107 + c * 23) % 101;
        if (kind === "dark-on-dark") background = (x * 13 + y * 7 + f * 107 + c * 23) % 91;
        if (kind === "high-motion-background") background = (x * y + (x + f * 19) * 73 + (y - f * 11) * 31 + 50000) % 256;
        if (kind === "scene-cut" && f >= 15) background = 255 - background;
        let foreground = (x + y) % 3 ? 235 : 25;
        if (kind === "light-on-light") foreground = (x + y) % 3 ? 245 : 185;
        if (kind === "dark-on-dark") foreground = (x + y) % 3 ? 20 : 80;
        if (kind === "chroma-heavy-edge") foreground = [250, 20, 230][c];
        rgb[(f * width * height + p) * 3 + c] = Math.round(background * (1 - a / 255) + foreground * a / 255);
      }
    }
    alphas.push(alpha);
  }
  return { rgb, alphas, recipe: { version: "static-exact-alpha-corpus/v1", kind, width, height, count, cx, cy,
    denominator: "construction alpha > 0, including alpha=1; pixel-frame occurrences", alphaDigests: alphas.map(sha),
    compression: kind === "h264-reencode" ? "lossless-yuv444p then libx264 CRF18 yuv420p" : "libx264 qp0 yuv444p" } };
}

export async function runCorpus(output: string, ffmpegPath: string, ffprobePath: string) {
  const root = resolve(output), started = performance.now(); await mkdir(root, { mode: 0o700 });
  const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const methodSources = ["src/main/source-mask-static-extraction.ts", "src/main/source-mask-static-target.ts",
    "src/main/shape-cover-stationary-discovery.ts", "src/main/source-fact-discovery-evidence.ts", "src/main/source-fact-census-clock.ts",
    "scripts/shape-cover-static-engineering-corpus.ts"];
  const methods = Object.fromEntries(await Promise.all(methodSources.map(async p => [p, sha(await readFile(p))])));
  await save(join(root, "method-freeze.json"), { methods, config: STATIC_MASK_CONFIG, configDigest: sha(JSON.stringify(STATIC_MASK_CONFIG)),
    engineDigest: sha(await readFile(ffmpegPath)), cases: CONTROLLED_CASES, authority: "none", eligible: false, modelRequests: 0 });
  const results = [];
  for (const kind of CONTROLLED_CASES) {
    const directory = join(root, kind); await mkdir(directory, { mode: 0o700 });
    const construction = constructCase(kind);
    const required = construction.alphas.map(alpha => packStaticMask(Uint8Array.from(alpha, a => a > 0 ? 1 : 0), { x: 0, y: 0, width, height })!);
    // This durable truth is created before media decode, discovery, confirmation and extraction.
    await save(join(directory, "construction-truth.json"), { recipe: construction.recipe, required });
    for (const [f, alpha] of construction.alphas.entries()) await writeFile(join(directory, `alpha-${f}.bin`), alpha, { flag: "wx" });
    const sourcePath = join(directory, "source.mp4"), initial = kind === "h264-reencode" ? join(directory, "lossless.mp4") : sourcePath;
    run(ffmpegPath, ["-v", "error", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "10", "-i", "pipe:0",
      "-vf", "setsar=1", "-c:v", "libx264", "-threads", "1", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "10000", "-n", initial], construction.rgb);
    if (kind === "h264-reencode") run(ffmpegPath, ["-v", "error", "-threads", "1", "-i", initial, "-c:v", "libx264", "-threads", "1", "-crf", "18",
      "-bf", "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "10000", "-n", sourcePath]);
    const probe = JSON.parse(run(ffprobePath, ["-v", "error", "-show_streams", "-of", "json", sourcePath]).toString());
    const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 3000, timeBase: probe.streams[0].time_base, timeOriginPts: 0, interpretationVersion: 1 });
    const signal = new AbortController().signal, input = { sourcePath, source, ffmpeg: { ffmpegPath, ffprobePath }, signal };
    const discovery = await prepareDiscoveryEvidence(input, { frames: 4 });
    try {
      const found = await discoverStationaryTargets(discovery, signal);
      const component = found.components.filter(c => c.state === "CANDIDATE").sort((a, b) => b.sourceBox.width * b.sourceBox.height - a.sourceBox.width * a.sourceBox.height)[0];
      if (!component) throw Error("controlled target not discovered");
      const target = await confirmStaticDiscoveryTarget(discovery, { candidateId: component.id, targetId: randomUUID(), confirmedBy: "construction-recipe",
        description: kind, decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY", range: { startFrame: 0, endFrame: count } }, signal);
      const evidence = await prepareStaticTargetEvidence(input, target);
      try {
        const candidate = await extractStaticConservativeMask(evidence, signal);
        await save(join(directory, "candidate.json"), { source, roi: evidence.roi, receipt: candidate.receipt });
        results.push({ kind, candidateDigest: candidate.receipt.receiptDigest, truthDigest: sha(await readFile(join(directory, "construction-truth.json"))) });
        process.stdout.write(`${kind}: ${candidate.receipt.mask?.markedPixels ?? "no mask"} candidate pixels\n`);
      } finally { await evidence.close(); }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await save(join(directory, "failure.json"), { kind, reason, authority: "none", eligible: false }); results.push({ kind, reason });
    } finally { await discovery.close(); }
  }
  for (const [path, expected] of Object.entries(methods)) if (sha(await readFile(path)) !== expected) throw Error("method drift");
  const result = { version: "static-exact-alpha-corpus/v1", cases: results, runtimeMs: performance.now() - started,
    peakRssBytes: process.resourceUsage().maxRSS * 1024, authority: "none", eligible: false, modelRequests: 0 };
  await save(join(root, "execution.json"), result); return result;
}
if (process.argv[1]?.endsWith("static-engineering-corpus.mjs")) {
  const [output, ffmpeg, ffprobe] = process.argv.slice(2);
  if (!output || !ffmpeg || !ffprobe) throw Error("Expected NEW-output application-ffmpeg application-ffprobe");
  await runCorpus(output, ffmpeg, ffprobe);
}
