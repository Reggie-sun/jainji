import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Author-side metadata only. Never activate saved providers or read ChatGPT OAuth.
const [userData, ...extra] = process.argv.slice(2);
let scratch;
try {
  if (!userData || extra.length || !path.isAbsolute(userData)) throw Error("usage");
  const entry = fileURLToPath(new URL("../src/main/source-fact-ai-connections.ts", import.meta.url));
  const compiled = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  scratch = await mkdtemp(path.join(tmpdir(), "jianji-ai-connections-"));
  const bundle = path.join(scratch, "owner.cjs");
  await writeFile(bundle, compiled.outputFiles[0].contents, { mode: 0o600, flag: "wx" });
  const owner = createRequire(import.meta.url)(bundle);
  process.stdout.write(JSON.stringify(await owner.inspectAIConnectionPreparation(userData), null, 2) + "\n");
} catch {
  process.stderr.write("AI connection preparation failed. Usage: node scripts/source-fact-ai-connections.mjs <absolute-application-userData>\n");
  process.exitCode = 1;
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
