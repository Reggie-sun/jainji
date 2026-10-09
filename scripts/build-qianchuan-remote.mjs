import { build } from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist-electron", "qianchuan-remote");
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, "src/remote-worker.ts")], bundle: true, platform: "node", format: "cjs", target: "node22", external: ["playwright-core"], outfile: path.join(output, "worker.cjs") });
await mkdir(path.join(output, "node_modules"), { recursive: true });
await cp(path.join(root, "node_modules", "playwright-core"), path.join(output, "node_modules", "playwright-core"), { recursive: true, dereference: true });
await writeFile(path.join(output, "package.json"), JSON.stringify({ private: true, type: "commonjs", engines: { node: ">=22" } }) + "\n");
console.log(`Remote worker built: ${output}`);
