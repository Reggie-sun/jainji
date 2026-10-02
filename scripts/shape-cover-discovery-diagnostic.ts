/** M1-A CPU discovery only. No ROI/mask inputs, confirmation, admission, models or rendering queue. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cpus, platform } from "node:os";
import { SourceIdentitySchema } from "../src/shared/source-sticker-knowledge.js";
import { prepareDiscoveryEvidence, type DiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";

const [sourcePath, sourceIdentityFile, outputDirectory, ffmpegPath, ffprobePath] = process.argv.slice(2);
if (process.argv.length !== 7 || ![sourcePath, sourceIdentityFile, outputDirectory, ffmpegPath, ffprobePath].every(Boolean)) {
  throw Error("Expected sourcePath sourceIdentityFile NEW-outputDirectory ffmpegPath ffprobePath (no ROI or mask)");
}
const root = resolve(outputDirectory), controller = new AbortController(), start = performance.now();
const abort = () => controller.abort(); process.once("SIGINT", abort); process.once("SIGTERM", abort);
await mkdir(root, { mode: 0o700 }); // Never overwrite an earlier development run.
const save = async (name: string, value: unknown) => writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
let evidence: DiscoveryEvidence | undefined;
let childSampledPeakRssBytes: number | null = null, sampling = false;
const sampleChildren = async () => {
  if (platform() !== "linux" || sampling) return;
  sampling = true;
  try {
    const children = (await readFile(`/proc/${process.pid}/task/${process.pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean);
    for (const pid of children) {
      try {
        const status = await readFile(`/proc/${pid}/status`, "utf8"), match = /^VmHWM:\s+(\d+) kB/m.exec(status);
        if (match) childSampledPeakRssBytes = Math.max(childSampledPeakRssBytes ?? 0, Number(match[1]) * 1024);
      } catch { /* Child can exit before observation; never claim an exact child peak. */ }
    }
  } finally { sampling = false; }
};
const monitor = setInterval(() => void sampleChildren(), 25);
try {
  const document = JSON.parse(await readFile(sourceIdentityFile, "utf8"));
  // Existing source-owner JSONs may wrap identity in `source`; no other fields are consumed.
  const source = SourceIdentitySchema.parse(document.source ?? document);
  await save("input.json", { source, authority: "none", eligible: false, modelRequests: 0,
    sourcePath: resolve(sourcePath), priorRoi: null, priorMask: null, cpu: cpus()[0]?.model, platform: platform() });
  evidence = await prepareDiscoveryEvidence({ sourcePath, source, ffmpeg: { ffmpegPath, ffprobePath }, signal: controller.signal });
  const result = await discoverStationaryTargets(evidence, controller.signal);
  // Original lossless contact evidence, whole source canvas and bounded candidate ROIs; PPM has no dependency.
  const rgba = await evidence.readFrame(0), frame = evidence.receipt.frames[0];
  const ppm = async (name: string, box: { x: number; y: number; width: number; height: number }) => {
    const rgb = Buffer.alloc(box.width * box.height * 3);
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const offset = ((box.y + y) * source.width + box.x + x) * 4;
      rgba.copy(rgb, (y * box.width + x) * 3, offset, offset + 3);
    }
    await writeFile(join(root, name), Buffer.concat([Buffer.from(`P6\n${box.width} ${box.height}\n255\n`), rgb]), { flag: "wx", mode: 0o600 });
  };
  await ppm("source-first-frame.ppm", { x: 0, y: 0, width: source.width, height: source.height });
  for (const [index, c] of result.components.filter(c => c.state === "CANDIDATE").entries()) await ppm(`candidate-${index}.ppm`, c.sourceBox);
  await evidence.verifyFresh();
  await save("performance.json", { wallMs: performance.now() - start, ...evidence.metrics, ...result.metrics,
    parentPeakRssBytes: process.resourceUsage().maxRSS * 1024, childSampledPeakRssBytes,
    childRssMethod: "linux-/proc-VmHWM-25ms-sampled-lower-bound; null-on-other-platforms",
    inspectionFrame: frame, cpuOnly: true, modelRequests: 0, maskQualification: "NOT_EVALUATED",
    matching: "NOT_EVALUATED", preview: "NOT_EVALUATED", export: "NOT_EVALUATED" });
  controller.signal.throwIfAborted();
  await save("result.json", result);
  process.stdout.write(`${JSON.stringify({ status: result.status, candidates: result.components.filter(c => c.state === "CANDIDATE").length,
    components: result.components.length, resultDigest: result.resultDigest, authority: result.authority })}\n`);
} catch (error) {
  await save("failure.json", { status: "INCOMPLETE", authority: "none", eligible: false,
    reason: error instanceof Error ? error.message : "Diagnostic failed", wallMs: performance.now() - start,
    parentPeakRssBytes: process.resourceUsage().maxRSS * 1024, childSampledPeakRssBytes, modelRequests: 0 });
  process.exitCode = 2;
} finally {
  clearInterval(monitor); await evidence?.close();
  process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
}
