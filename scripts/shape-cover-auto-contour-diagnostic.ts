/** Author-side M2/M3 development only. M1/M4/M5 live execution remains with the canonical router/AI owners. */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SourceIdentitySchema } from "../src/shared/source-sticker-knowledge.js";
import { AIDeclarationSchema } from "../src/main/source-fact-ai-contract.js";
import { prepareFullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence.js";
import { AUTO_CONTOUR_CONFIG, AutoContourBindingSchema, extractAutomaticSourceContours, buildAutomaticContourEnvelope } from "../src/main/source-mask-auto-extraction.js";
import { freezeAutoContourEvaluation, evaluateAutoContours } from "../src/main/source-mask-auto-qualification.js";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const manifestSchema = z.object({
  purpose: z.literal("AUTO_CONTOUR_DEVELOPMENT_ONLY"),
  declarationOrigin: z.literal("UNQUALIFIED_ENGINEERING_DECLARATIONS"),
  sourcePath: z.string().refine(isAbsolute), source: SourceIdentitySchema,
  ffmpeg: z.object({ ffmpegPath: z.string().refine(isAbsolute), ffprobePath: z.string().refine(isAbsolute) }).strict(),
  range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict(),
  declarations: z.array(z.object({ binding: AutoContourBindingSchema, declaration: AIDeclarationSchema }).strict()).min(1).max(100000),
  // Independent truth is author-side evaluation data; it is never an extractor input.
  truthSet: z.unknown().optional(),
}).strict();

/** No masks, sticker IDs, mock knowledge heads, provider callbacks or output-verdict injection. */
export async function runAutoContourDevelopment(raw: unknown, directory: string, signal: AbortSignal) {
  const input = manifestSchema.parse(structuredClone(raw)), started = process.hrtime.bigint();
  if (!isAbsolute(directory)) throw Error("Diagnostic directory must be absolute");
  signal.throwIfAborted();
  await mkdir(directory, { mode: 0o700 }); // Exclusive ownership; never overwrite evidence.
  const save = async (name: string, value: unknown) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  let evidence: Awaited<ReturnType<typeof prepareFullCanvasReviewEvidence>> | undefined;
  try {
    await save("development-input.json", input);
    evidence = await prepareFullCanvasReviewEvidence({ sourcePath: input.sourcePath, source: input.source, ffmpeg: input.ffmpeg, signal });
    await save("census.json", evidence.census);
    const configs = [AUTO_CONTOUR_CONFIG, { ...AUTO_CONTOUR_CONFIG, method: "temporal-stable-exterior-difference/v1" as const }];
    // Freeze independent inputs for both methods BEFORE either extractor sees the development data.
    const evaluations = input.truthSet === undefined ? [] : await Promise.all(configs.map(config => freezeAutoContourEvaluation({ evidence: evidence!, config, range: input.range, truthSet: input.truthSet })));
    for (const [index, evaluation] of evaluations.entries()) await save(`method-${index}-truth-freeze.json`, evaluation.receipt);
    const methods = [];
    for (const [index, config] of configs.entries()) {
      signal.throwIfAborted();
      const candidate = await extractAutomaticSourceContours({ evidence, declarations: input.declarations, range: input.range, config, signal });
      await save(`method-${index}-candidate.json`, candidate.receipt);
      const comparison = evaluations[index] ? await evaluateAutoContours(evaluations[index], candidate) : { status: "INCOMPLETE", maskReview: "NOT_EVALUATED", motionReview: "NOT_EVALUATED", metrics: null };
      await save(`method-${index}-evaluation.json`, comparison);
      const envelopes = [];
      if (candidate.receipt.status === "CANDIDATE" && comparison.status !== "NOT_QUALIFIED") for (const target of candidate.receipt.targets) {
        const envelope = await buildAutomaticContourEnvelope(candidate, target.targetId, signal);
        await save(`method-${index}-target-${target.targetId}-envelope.json`, envelope.receipt);
        envelopes.push({ targetId: target.targetId, receiptDigest: envelope.receipt.receiptDigest });
      }
      methods.push({ method: config.method, configDigest: candidate.receipt.configDigest, status: candidate.receipt.status, receiptDigest: candidate.receipt.receiptDigest, comparison, envelopes });
    }
    await evidence.verifyFresh(); signal.throwIfAborted();
    const report = { purpose: "AUTO_CONTOUR_DEVELOPMENT_ONLY", authority: "none", eligible: false, production: "PRODUCT_DISABLED",
      manifestDigest: sha(JSON.stringify(input)), censusDigest: evidence.census.censusDigest, source: evidence.census.source, range: input.range, methods,
      selectedMethod: null, qualifiedExtractor: null, actualAIRecognition: "NOT_EVALUATED", aiSelection: "NOT_EVALUATED", independentSampleReview: "NOT_EVALUATED",
      realMediaMaskTruth: "NOT_EVALUATED", realStationaryAnimation: "NOT_EVALUATED", formalQualification: "INCOMPLETE", modelRequests: 0,
      productionHandle: null, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, maxRssKiB: process.resourceUsage().maxRSS };
    await save("result.json", report);
    return report;
  } catch {
    await save("failure.json", { status: "INCOMPLETE", reason: signal.aborted ? "CANCELLED" : "INPUT_OR_EVIDENCE_INVALID", authority: "none", eligible: false, modelRequests: 0, production: "PRODUCT_DISABLED" });
    throw Error("UNSAFE: automatic contour development stopped; no live or production result");
  } finally { await evidence?.close(); }
}

async function main() {
  const [manifestPath, directory, ...extra] = process.argv.slice(2);
  if (!manifestPath || !directory || extra.length || !isAbsolute(manifestPath) || !isAbsolute(directory)) throw Error("usage");
  if ((await stat(manifestPath)).size > 64 * 1024 ** 2) throw Error("manifest budget");
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try {
    const report = await runAutoContourDevelopment(JSON.parse((await readFile(manifestPath)).toString()), directory, controller.signal);
    process.stdout.write(JSON.stringify({ purpose: report.purpose, directory, modelRequests: report.modelRequests, production: report.production }) + "\n");
  } finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write("Auto-contour development stopped. Usage: <bundled-script.mjs> <absolute-development-manifest.json> <new-absolute-directory>\n"); process.exitCode = 1; });
}
