/** Private M2-H diagnostic, never the production knowledge directory. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SourceIdentitySchema } from "../src/shared/source-sticker-knowledge.js";
import { prepareDiscoveryEvidence } from "../src/main/source-fact-discovery-evidence.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence, type StaticConfirmationInput } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask } from "../src/main/source-mask-static-extraction.js";
import { verifyStaticTargetGeometry, readOwnedStaticGeometry } from "../src/main/source-mask-static-geometry.js";
import { freezeConfirmedStaticTargetSet, issueConfirmedTargetStaticProof } from "../src/main/source-mask-static-proof.js";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store.js";

const [inputFile, selectionFile, outputDirectory, ffmpegPath, ffprobePath] = process.argv.slice(2);
if (process.argv.length !== 7) throw Error("Expected input selection NEW-private-directory ffmpeg ffprobe");
const root = resolve(outputDirectory), controller = new AbortController(), started = performance.now();
process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
await mkdir(root, { mode: 0o700 });
const save = (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const doc = JSON.parse(await readFile(inputFile, "utf8")), selection = JSON.parse(await readFile(selectionFile, "utf8")) as StaticConfirmationInput;
const input = { sourcePath: doc.sourcePath as string, source: SourceIdentitySchema.parse(doc.source), ffmpeg: { ffmpegPath, ffprobePath }, signal: controller.signal };
const discovery = await prepareDiscoveryEvidence(input);
try {
  const target = await confirmStaticDiscoveryTarget(discovery, selection, input.signal), evidence = await prepareStaticTargetEvidence(input, target);
  const set = freezeConfirmedStaticTargetSet([{ target, segmentId: "confirmed-static-segment" }]);
  try {
    const candidate = await extractStaticConservativeMask(evidence, input.signal);
    await save("confirmation.json", target.receipt); await save("candidate.json", candidate);
    const geometry = await verifyStaticTargetGeometry(input, evidence, candidate), owned = readOwnedStaticGeometry(geometry);
    await save("geometry.json", geometry.receipt); await save("geometry-frames.json", owned.data.frames); await save("geometry-reference.json", owned.data.reference);
    const privateDirectory = join(root, "private-knowledge"), store = await SourceStickerKnowledgeStore.open(privateDirectory);
    try {
      const run = await store.beginRun(input.source, input.signal);
      const issued = await issueConfirmedTargetStaticProof(input, run, set, [{ segmentId: "confirmed-static-segment", candidate, geometry }]);
      await save("issued-proof.json", issued.proof); await save("knowledge-candidate.json", issued.candidate);
      const revision = await store.publishConfirmedStaticTargets(run, issued.candidate, issued.proof, issued.blobs);
      await save("published-revision.json", revision); await store.endRun(run);
      await store.close();
      const reopened = await SourceStickerKnowledgeStore.open(privateDirectory);
      try {
        const head = await reopened.readHead(input.source);
        if (!head || JSON.stringify(head.revision) !== JSON.stringify(revision)) throw Error("durable revision changed after reopen");
        await save("roundtrip.json", { status: "DURABLE_ROUNDTRIP_VERIFIED", revisionId: head.revision.id, verification: head.revision.verification,
          proofMode: "mode" in head.revision.proof ? head.revision.proof.mode : null, blobCount: head.blobs.size,
          historicalRgbAnomalies: candidate.receipt.anomalies.length, modelRequests: 0, m3: "BLOCKED", product: "PRODUCT_DISABLED" });
      } finally { await reopened.close(); }
    } finally { await store.close(); }
    await save("performance.json", { wallMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024, modelRequests: 0 });
    console.log(JSON.stringify({ status: geometry.receipt.status, frames: geometry.receipt.frameCount, issues: geometry.receipt.issueFrames.length, mask: candidate.receipt.mask?.sha256 }));
  } finally { await evidence.close(); }
} finally { await discovery.close(); }
