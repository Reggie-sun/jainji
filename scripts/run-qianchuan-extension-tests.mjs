import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Harness invokes the real isolated fixture explicitly; missing Chrome fails rather than skips.
process.env.JIANJI_QIANCHUAN_CHROME_FIXTURE = "1";
const vitest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/vitest/vitest.mjs");
process.argv[1] = vitest;
await import(pathToFileURL(vitest).href);
