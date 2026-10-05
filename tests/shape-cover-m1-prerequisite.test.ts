import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, discoveryHash as hash } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence } from "../src/main/source-mask-static-target.js";

const fixtures = path.resolve("tests/fixtures/static-m1-components");
const manifest = JSON.parse(await readFile(path.join(fixtures, "manifest.json"), "utf8"));
// Frozen experimental queue observations are offline data. JSON never restores live support authority.
const archive = JSON.parse(await readFile(path.join(fixtures, "observations.json"), "utf8"));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

describe("HC4 frozen actual-M1 prerequisite observations (not a geometry issuer)", () => {
  it("retains the gate blocker and all pre-measurement detector support identities", () => {
    expect(archive.status).toBe("BLOCKED"); expect(archive.authority).toBe("none"); expect(archive.eligible).toBe(false);
    expect(archive.cases).toHaveLength(12);
    for (const observed of archive.cases.filter((c: { freeze?: unknown }) => c.freeze)) {
      for (const c of observed.freeze.components) {
        const { supportDigest, ...body } = c.support;
        expect(hash(JSON.stringify(body))).toBe(supportDigest);
        const bitmap = Buffer.from(body.dataBase64, "base64");
        expect(hash(bitmap)).toBe(body.bitmapSha256);
        expect(body.resultDigest).toBe(observed.freeze.resultDigest);
        expect(body.candidateId).toBe(c.candidateId);
        expect(body.sourceKey).toBe(observed.freeze.sourceKey);
        expect(bitmap.length).toBe(Math.ceil(body.gridWidth * body.gridHeight / 8));
      }
    }
  });
  it.each(manifest.cases.map((c: { name: string }) => c.name) as string[])("%s rebinds unchanged media and current public M1 identity", async name => {
    const entry = manifest.cases.find((c: { name: string }) => c.name === name);
    const observed = archive.cases.find((c: { name: string }) => c.name === name);
    const sourcePath = path.join(fixtures, entry.file);
    expect(hash(await readFile(sourcePath))).toBe(entry.sha256);
    const source = await identifySource(sourcePath, { width: 128, height: 96, rotation: 0, durationMs: 3000,
      timeBase: "1/10000", timeOriginPts: 0, interpretationVersion: 1 });
    const input = { sourcePath, source, ffmpeg: { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! }, signal: new AbortController().signal };
    const discovery = await prepareDiscoveryEvidence(input, { frames: manifest.discoveryFrames }); cleanup.push(() => discovery.close());
    const result = await discoverStationaryTargets(discovery, input.signal);
    const intended = result.components.filter(c => entry.confirmedConstructionBoxes.some((b: { x: number; y: number; width: number; height: number }) =>
      c.gridBox.x === b.x && c.gridBox.y === b.y && c.gridBox.width === b.width && c.gridBox.height === b.height));
    expect(intended).toHaveLength(2);
    const root = process.env.JIANJI_HC4_EVIDENCE_ROOT ? path.join(process.env.JIANJI_HC4_EVIDENCE_ROOT, name) : await mkdtemp(path.join(tmpdir(), "jianji-hc4-replay-"));
    if (process.env.JIANJI_HC4_EVIDENCE_ROOT) await mkdir(root, { recursive: true }); else cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "discovery.json"), JSON.stringify(result), { mode: 0o600 });
    if (observed.blocked) {
      expect(result.resultDigest).toBe(observed.blocked.resultDigest);
      const missing = intended.find(c => c.state === "UNKNOWN")!;
      expect(missing.signals.stablePixels).toBe(16);
      expect(missing.signals.edgePixels).toBe(name === "uniform-island" ? 3 : 1);
      expect(missing.reasons).toContain("INSUFFICIENT_PERSISTENT_EDGES");
      await expect(confirmStaticDiscoveryTarget(discovery, { targetId: randomUUID(), candidateIds: intended.map(c => c.id), confirmedBy: "controlled-construction",
        description: "HC4 required component cannot be skipped", decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY", range: { startFrame: 0, endFrame: 30 } }, input.signal)).rejects.toThrow(/candidate/);
      await writeFile(path.join(root, "blocked.json"), JSON.stringify(observed.blocked), { mode: 0o600 });
      return;
    }
    const freeze = observed.freeze;
    expect(result.resultDigest).toBe(freeze.resultDigest);
    expect(discovery.receipt.sourceKey).toBe(freeze.sourceKey);
    expect(discovery.receipt.evidenceDigest).toBe(freeze.components[0].support.discoveryDigest);
    expect(intended.every(c => c.state === "CANDIDATE")).toBe(true);
    expect(discovery.receipt.frames.map(f => f.index)).toEqual(freeze.representativeOrdinals);
    const target = await confirmStaticDiscoveryTarget(discovery, { targetId: randomUUID(), candidateIds: intended.map(c => c.id), confirmedBy: "controlled-construction",
      description: "Replay archived detector observations only", decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY", range: { startFrame: 0, endFrame: 30 } }, input.signal);
    const evidence = await prepareStaticTargetEvidence(input, target); cleanup.push(() => evidence.close());
    expect(evidence.roi).toEqual(freeze.roi);
    const frames: Buffer[] = [];
    const bindings = await evidence.streamRange(rgba => frames.push(Buffer.from(rgba)), input.signal);
    const raw = Buffer.concat(frames);
    expect(bindings).toEqual(freeze.bindings); expect(hash(raw)).toBe(freeze.frameBytesSha256);
    // Replay only the original queue bitmaps. No bbox fill or changed-pixel reconstruction.
    await writeFile(path.join(root, "freeze.json"), JSON.stringify(freeze), { mode: 0o600 });
    await writeFile(path.join(root, "frames.rgba"), raw, { mode: 0o600 });
    const measured = spawnSync("python3", ["-B", "scripts/shape-cover-m1-component-gate.py", root], { timeout: 30000, maxBuffer: 8 * 1024 ** 2, env: { ...process.env, OPENBLAS_NUM_THREADS: "1" } });
    expect(measured.error).toBeUndefined(); expect(measured.status, measured.stderr.toString()).toBe(0);
    await writeFile(path.join(root, "result.json"), measured.stdout, { mode: 0o600 });
    const output = JSON.parse(measured.stdout.toString());
    expect(output.status).toBe(entry.expected);
    expect(output.components.map((c: { status: string; issueFrames: number[]; pairCount: number }) => [c.status,c.issueFrames,c.pairCount]))
      .toEqual(observed.measurement.components.map((c: { status: string; issueFrames: number[]; pairCount: number }) => [c.status,c.issueFrames,c.pairCount]));
  }, 45000);
});
