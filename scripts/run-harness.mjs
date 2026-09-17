import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const outputDirectory = path.join(root, ".agent", "harness", ".generated");
const outputFile = path.join(outputDirectory, "cli.mjs");
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "harness", "cli.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent",
});
await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
