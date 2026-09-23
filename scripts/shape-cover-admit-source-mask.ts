/** Local M4-A entry: explicit human PASS receipt -> exact source evidence -> canonical knowledge store. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { admitReviewedSourceMask } from "../src/main/source-mask-admission.js";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || args.has(key)) throw new Error("Expected unique --key value arguments");
  args.set(key, value);
}
const sourcePath = args.get("--source"), probeDirectory = args.get("--probe-dir"), reviewPath = args.get("--review-receipt"), storeRoot = args.get("--store-root");
if (!sourcePath || !probeDirectory || !reviewPath || !storeRoot) throw new Error("Required: --source --probe-dir --review-receipt --store-root");
const store = await SourceStickerKnowledgeStore.open(storeRoot);
try {
  const result = await admitReviewedSourceMask({ sourcePath, ffmpegPath: args.get("--ffmpeg") ?? "ffmpeg", ffprobePath: args.get("--ffprobe") ?? "ffprobe", store,
    probeReport: await readFile(path.join(probeDirectory, "result.json")), packedMask: await readFile(path.join(probeDirectory, "candidate-mask.bitset")),
    contactSheet: await readFile(path.join(probeDirectory, "edge-contact-sheet.png")), reviewReceipt: await readFile(reviewPath) });
  process.stdout.write(`${JSON.stringify({ status: "SOURCE_MASK_PUBLISHED", sourceKey: result.revision.sourceKey, revisionId: result.revision.id,
    verification: result.revision.verification, maskSha256: result.revision.candidate.facts.targets[0].segments[0].mask?.sha256,
    reviewedRanges: result.revision.candidate.facts.reviewedRanges })}\n`);
} finally { await store.close(); }
