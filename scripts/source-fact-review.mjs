import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Standalone human review tool. Never connected to product admission or model APIs.
const args = process.argv.slice(2);
if (args.length !== 3) throw new Error("Usage: node scripts/source-fact-review.mjs <source-video> <reviewer-id> <new-receipt.json>");
const [sourceFile, reviewerId, output] = args;
const workspace = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "jianji-review-tool-"));
const bundle = join(root, "owner.cjs");
const controller = new AbortController();
let evidence;
let server;
let publishing = false;
let exporting = false;
// Optional parent-only IPC export. It does not change any D2 presentation or command semantics.
async function exportCheckpoint(kind, data) {
  if (!process.send) return;
  const checkpointId = randomUUID();
  exporting = true;
  try { await new Promise((resolveCheckpoint, reject) => {
    const cleanup = () => { clearTimeout(timer); process.off("message", acknowledgeExport); controller.signal.removeEventListener("abort", abortExport); };
    const abortExport = () => { cleanup(); reject(new Error("UNSAFE: parent receipt export cancelled")); };
    const acknowledgeExport = message => {
      if (message?.kind === "D2_EXPORT_ACK" && message.checkpointId === checkpointId) { cleanup(); resolveCheckpoint(); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("UNSAFE: parent receipt export interrupted")); }, 30000);
    process.on("message", acknowledgeExport);
    controller.signal.addEventListener("abort", abortExport, { once: true });
    process.send({ kind, checkpointId, data }, error => { if (error) { cleanup(); reject(error); } });
  }); } finally { exporting = false; }
}
const close = async () => {
  controller.abort(); server?.close();
  await evidence?.close(); await rm(root, { recursive: true, force: true });
};
process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); });
try {
  const entry = join(root, "entry.ts");
  await writeFile(entry, `export { prepareFullCanvasReviewEvidence } from ${JSON.stringify(join(workspace, "src/main/source-fact-review-evidence.ts"))};\nexport * from ${JSON.stringify(join(workspace, "src/main/source-fact-review-session.ts"))};\nexport { discoverBinary } from ${JSON.stringify(join(workspace, "src/main/ffmpeg.ts"))};\nexport { identifySource } from ${JSON.stringify(join(workspace, "src/main/source-sticker-knowledge-store.ts"))};\n`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  const owner = createRequire(import.meta.url)(bundle);
  const ffmpegPath = await owner.discoverBinary("ffmpeg"), ffprobePath = await owner.discoverBinary("ffprobe");
  if (!ffmpegPath || !ffprobePath) throw new Error("UNSAFE: review engines unavailable");
  // Source interpretation is obtained by the canonical full-census clock, not guessed here.
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", resolve(sourceFile)], { stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("UNSAFE: review source probe failed");
  const probe = JSON.parse(result.stdout.toString());
  if (probe.streams.length !== 1) throw new Error("UNSAFE: ambiguous video stream");
  const stream = probe.streams[0];
  const source = await owner.identifySource(resolve(sourceFile), { width: stream.width, height: stream.height, rotation: 0,
    durationMs: Math.round(Number(stream.duration) * 1000), timeBase: stream.time_base, timeOriginPts: Number(stream.start_pts), interpretationVersion: 1 });
  evidence = await owner.prepareFullCanvasReviewEvidence({ sourcePath: resolve(sourceFile), source, ffmpeg: { ffmpegPath, ffprobePath }, signal: controller.signal });
  const session = owner.createFullCanvasReviewSession(evidence, reviewerId);
  await exportCheckpoint("D2_SESSION", session.snapshot());
  let presentedBinding;
  const token = randomUUID();
  const page = await readFile(new URL("./source-fact-review.html", import.meta.url), "utf8");
  server = createServer(async (request, response) => {
    const port = server.address().port; const origin = `http://127.0.0.1:${port}`;
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin)) throw new Error("UNSAFE: review origin mismatch");
      const url = new URL(request.url, origin);
      if (!url.pathname.startsWith(`/${token}/`)) throw new Error("UNSAFE: unknown review session");
      const action = url.pathname.slice(token.length + 2);
      if (request.method === "GET" && action === "") {
        response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(page); return;
      }
      if (request.method !== "POST" || publishing || exporting) throw new Error("UNSAFE: review request unavailable");
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; if (length > 65536) throw new Error("UNSAFE: review input too large"); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      let result;
      if (action === "frame") {
        if (Object.keys(input).join() !== "ordinal") throw new Error("UNSAFE: invalid frame request");
        const frame = await session.begin(input.ordinal); presentedBinding = frame.binding;
        result = { ...frame, bytes: frame.bytes.toString("base64"), session: session.snapshot() };
      } else if (action === "ack") { session.acknowledge(input); result = {}; }
      else if (action === "record") {
        session.record(input); result = session.snapshot();
        await exportCheckpoint("D2_RECORD", { binding: presentedBinding, result: owner.FullCanvasReviewCommandSchema.parse(input) });
      }
      else if (action === "finish") {
        if (Object.keys(input).length) throw new Error("UNSAFE: caller cannot supply a receipt");
        publishing = true;
        try {
          result = await session.finish(); await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
          await exportCheckpoint("D2_RECEIPT", result);
        }
        catch (error) { publishing = false; throw error; }
      } else throw new Error("UNSAFE: unknown review action");
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = 400; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ error: error instanceof Error ? error.message : "UNSAFE: review failed" })); }
  });
  server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/${token}/`, frameCount: evidence.census.horizon.frameCount, censusDigest: evidence.census.censusDigest, authority: "none", methodQualification: "NOT_EVALUATED" }) + "\n"));
} catch (error) { await close(); throw error; }
