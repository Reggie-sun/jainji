/** Explicit M2-A identity confirmation only; no masks as input, knowledge admission or product rendering. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { cpus, platform } from "node:os";
import { createHash } from "node:crypto";
import { SourceIdentitySchema } from "../src/shared/source-sticker-knowledge.js";
import { prepareDiscoveryEvidence, type DiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence, type StaticTargetEvidence, type StaticConfirmationInput } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask, STATIC_MASK_CONFIG } from "../src/main/source-mask-auto-extraction.js";
import { qualifyStaticMask } from "../src/main/source-mask-auto-qualification.js";
import { decodeSourceMask } from "../src/main/shape-cover-pixel-gate.js";
import { encodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";

const [inputFile, confirmationFile, outputDirectory, ffmpegPath, ffprobePath] = process.argv.slice(2);
if (process.argv.length !== 7 || ![inputFile, confirmationFile, outputDirectory, ffmpegPath, ffprobePath].every(Boolean))
  throw Error("Expected M1-input.json explicit-confirmation.json NEW-outputDirectory ffmpegPath ffprobePath");
const root = resolve(outputDirectory), controller = new AbortController(), started = performance.now();
const abort = () => controller.abort(); process.once("SIGINT", abort); process.once("SIGTERM", abort);
await mkdir(root, { mode: 0o700 });
const save = (name: string, value: unknown) => writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
let discovery: DiscoveryEvidence | undefined, evidence: StaticTargetEvidence | undefined;
let childSampledPeakRssBytes: number | null = null, sampling = false;
const monitor = setInterval(() => {
  if (sampling || platform() !== "linux") return; sampling = true;
  void (async () => {
    try {
      const children = (await readFile(`/proc/${process.pid}/task/${process.pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean);
      for (const pid of children) try {
        const match = /^VmHWM:\s+(\d+) kB/m.exec(await readFile(`/proc/${pid}/status`, "utf8"));
        if (match) childSampledPeakRssBytes = Math.max(childSampledPeakRssBytes ?? 0, Number(match[1]) * 1024);
      } catch { /* Exited children are not an exact peak observation. */ }
    } finally { sampling = false; }
  })();
}, 25);
try {
  const document = JSON.parse(await readFile(inputFile, "utf8")), source = SourceIdentitySchema.parse(document.source);
  const selection = JSON.parse(await readFile(confirmationFile, "utf8")) as StaticConfirmationInput;
  const paths = ["src/main/source-mask-static-target.ts", "src/main/source-mask-static-extraction.ts",
    "src/main/shape-cover-stationary-discovery.ts", "src/main/source-fact-discovery-evidence.ts", "src/main/source-fact-census-clock.ts",
    "scripts/shape-cover-static-diagnostic.ts"];
  const methods = Object.fromEntries(await Promise.all(paths.map(async p => [p, createHash("sha256").update(await readFile(p)).digest("hex")])));
  await save("method-freeze.json", { methods, config: STATIC_MASK_CONFIG, selection, source, cpuOnly: true,
    independentPixelTruth: "MISSING", modelRequests: 0, platform: platform(), cpu: cpus()[0]?.model });
  const input = { sourcePath: document.sourcePath as string, source, ffmpeg: { ffmpegPath, ffprobePath }, signal: controller.signal };
  discovery = await prepareDiscoveryEvidence(input);
  const target = await confirmStaticDiscoveryTarget(discovery, selection, controller.signal);
  await save("confirmation.json", target.receipt);
  evidence = await prepareStaticTargetEvidence(input, target);
  await save("target-evidence.json", { evidenceDigest: evidence.evidenceDigest, roi: evidence.roi, clock: evidence.clock, metrics: evidence.metrics });
  // Original representative images precede extraction; images are observations, not independent pixel truth.
  const samples = [0, Math.floor(discovery.receipt.frames.length / 2), discovery.receipt.frames.length - 1];
  for (const index of samples) {
    const rgba = await evidence.readRepresentativeRoi(index), png = await encodeShapeCoverPng(rgba, evidence.roi, { ffmpegPath, ffprobePath, signal: controller.signal });
    await writeFile(join(root, `original-${discovery.receipt.frames[index].index}.png`), png, { flag: "wx", mode: 0o600 });
  }
  const candidate = await extractStaticConservativeMask(evidence, controller.signal);
  if (candidate.receipt.mask) {
    const pixels = decodeSourceMask({ ...candidate.receipt.mask, kind: "static-binary-v1" }, source)!;
    const rgba = Buffer.alloc(evidence.roi.width * evidence.roi.height * 4);
    for (let y = 0; y < evidence.roi.height; y++) for (let x = 0; x < evidence.roi.width; x++) {
      const v = pixels[(y + evidence.roi.y) * source.width + x + evidence.roi.x] ? 255 : 0, p = (y * evidence.roi.width + x) * 4;
      rgba.fill(v, p, p + 3); rgba[p + 3] = 255;
    }
    await writeFile(join(root, "mask-candidate.png"), await encodeShapeCoverPng(rgba, evidence.roi, { ffmpegPath, ffprobePath, signal: controller.signal }), { flag: "wx", mode: 0o600 });
  }
  const qualification = await qualifyStaticMask(candidate, null, controller.signal);
  await evidence.verifyFresh(); controller.signal.throwIfAborted();
  for (const [p, expected] of Object.entries(methods))
    if (createHash("sha256").update(await readFile(p)).digest("hex") !== expected) throw Error("method changed during extraction");
  await save("candidate.json", candidate);
  await save("performance.json", { wallMs: performance.now() - started, discovery: discovery.metrics, target: evidence.metrics, ...candidate.metrics,
    parentPeakRssBytes: process.resourceUsage().maxRSS * 1024, childSampledPeakRssBytes,
    childRssMethod: "linux-/proc-VmHWM-25ms-sampled-lower-bound; null-on-other-platforms", modelRequests: 0,
    matching: "NOT_EVALUATED", outputCoverage: "NOT_EVALUATED", visualSafety: "NOT_EVALUATED", product: "PRODUCT_DISABLED" });
  controller.signal.throwIfAborted(); await save("result.json", qualification);
  process.stdout.write(`${JSON.stringify({ status: qualification.status, candidateStatus: candidate.receipt.status, frames: candidate.receipt.frames.length,
    maskPixels: candidate.receipt.mask?.markedPixels ?? null, anomalies: candidate.receipt.anomalies.length, reasons: candidate.receipt.reasons, authority: "none" })}\n`);
} catch (error) {
  await save("failure.json", { status: "INCOMPLETE", authority: "none", eligible: false, reason: error instanceof Error ? error.message : "Diagnostic failed",
    wallMs: performance.now() - started, modelRequests: 0 }); process.exitCode = 2;
} finally {
  clearInterval(monitor); await evidence?.close(); await discovery?.close();
  process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
}
