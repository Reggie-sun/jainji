import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A Harness-owned Vitest seam runs the offline controls; it does not qualify real media.
describe("offline static holdout and human truth acquisition", () => {
  for (const file of [
    "tests/shape-cover-static-engineering.test.py",
    "tests/shape-cover-static-holdout.test.py",
    "tests/shape-cover-static-truth-tool.test.py",
    "tests/shape-cover-required-pixel-truth.test.py",
    "tests/shape-cover-static-geometry.test.py",
    "tests/shape-cover-static-anomalies.test.py",
  ]) {
    it(file, () => {
      const result = execFileSync("python3", [file], { encoding: "utf8", stdio: "pipe", timeout: 90_000 });
      expect(result).not.toContain("FAILED");
    }, 100_000);
  }
});
