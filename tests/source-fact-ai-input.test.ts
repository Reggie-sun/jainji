import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identifySource } from "../src/main/source-sticker-knowledge-store";
import { prepareFullCanvasReviewEvidence, type FullCanvasReviewEvidence } from "../src/main/source-fact-review-evidence";
import { prepareAIInput, type AIInput } from "../src/main/source-fact-ai-input";
import { createAIEngineeringRun, AI_ENGINEERING_BUDGET, type AIEngineeringTransport } from "../src/main/source-fact-ai-run";

let root: string, evidence: FullCanvasReviewEvidence, input: AIInput;
const digest = createHash("sha256").update("engineering-config-only").digest("hex");
const engine = { ffmpegPath: process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.JIANJI_FFPROBE_PATH ?? "ffprobe" };
const reply: AIEngineeringTransport = async payload => ({ text: JSON.stringify((payload.frames as { ordinal: number }[]).map(f => ({ ordinal: f.ordinal, type: "EMPTY" }))),
  providerRequestId: "SIMULATED_TRANSPORT_NOT_MODEL", stopReason: "complete", toolRequests: 0 });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "jianji-ai-input-test-")); const path = join(root, "source.mp4");
  const encoded = spawnSync(engine.ffmpegPath, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=10:d=1",
    "-c:v", "libx264", "-threads", "1", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "10000", path], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
  if (encoded.error || encoded.status !== 0) throw Error("fixture encode failed");
  const source = await identifySource(path, { width: 32, height: 32, rotation: 0, durationMs: 1000, timeBase: "1/10000", timeOriginPts: 0, interpretationVersion: 1 });
  evidence = await prepareFullCanvasReviewEvidence({ sourcePath: path, source, ffmpeg: engine, signal: new AbortController().signal });
  input = await prepareAIInput(evidence, randomUUID(), engine);
}, 30000);
afterAll(async () => { input?.close(); await evidence?.close(); if (root) await rm(root, { recursive: true, force: true }); });

describe("real CPU canonical decode and PNG transport, never qualification", () => {
  it("keeps repeated pixels as ten ordinals in 8+2 full-size packets", async () => {
    expect(input.manifest.packets.map(p => p.frames.length)).toEqual([8, 2]);
    const fs = input.manifest.packets.flatMap(p => p.frames); expect(fs.map(f => f.ordinal)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(new Set(fs.map(f => f.pixelSha256)).size).toBe(1);
    const p = await input.getPacket(0);
    expect(p.images[0].readUInt32BE(16)).toBe(32); expect(p.images[0].readUInt32BE(20)).toBe(32);
    expect(createHash("sha256").update(p.images[0]).digest("hex")).toBe(fs[0].pngSha256);
    p.images[0].fill(0); expect((await input.getPacket(0)).images[0][0]).toBe(137);
  });
  it("rejects copied input and forged D2 evidence", async () => {
    expect(() => createAIEngineeringRun({ ...input }, "A", reply, digest, () => undefined)).toThrow(/not owned/);
    await expect(prepareAIInput({ ...evidence }, randomUUID(), engine)).rejects.toThrow(/not owned/);
  });
  it("freezes machine receipts and never creates human or formal evidence", async () => {
    const run = createAIEngineeringRun(input, "A", reply, digest, () => undefined), result = await run.execute();
    expect(result).toMatchObject({ status: "FROZEN", qualificationStatus: "INCOMPLETE", qualificationRecord: null, receipt: { evidenceClass: "ENGINEERING_ONLY_NOT_FORMAL_AI_REVIEW" } });
    expect(result.accepted).toHaveLength(10); await expect(run.execute()).rejects.toThrow(/one-shot/);
    expect(Object.isFrozen(result.receipt)).toBe(true);
  });
  it("does not impose a token or total request cap on the new default run", async () => {
    expect(AI_ENGINEERING_BUDGET.requestLimit).toBeNull();
    expect(AI_ENGINEERING_BUDGET.generationTokens).toBeNull();
    const run = createAIEngineeringRun(input, "A", async (p, s) => {
      expect(p.generationTokens).toBeNull(); return reply(p, s);
    }, digest, () => undefined);
    const result = await run.execute();
    expect(result.status).toBe("FROZEN"); expect(result.accepted).toHaveLength(10);
    expect(result.receipt).toMatchObject({ executionLimits: { requestLimit: null, generationTokens: null } });
    expect(result.qualificationStatus).toBe("INCOMPLETE");
  });
  it.each([0,4,9])("false EMPTY %i stops further requests and preserves negative evidence", async ordinal => {
    let count = 0; const run = createAIEngineeringRun(input, "B", async (p, s) => { count++; return reply(p, s); }, digest, d => d.ordinal === ordinal ? "FALSE_EMPTY" : undefined);
    const r = await run.execute(); expect(r.status).toBe("NOT_QUALIFIED"); expect(count).toBe(ordinal < 8 ? 1 : 2);
    expect(r.accepted.at(-1)?.ordinal).toBe(ordinal); expect(r.receipt).toBeNull(); run.cancel(); expect(run.snapshot().status).toBe("NOT_QUALIFIED");
  });
  it.each(["partial", "duplicate", "borrowed", "tool", "truncated", "unknown-field", "malformed", "oversized", "bbox", "duplicate-target", "image-mutated", "image-missing"])("fails closed without retries: %s", async fault => {
    let count = 0;
    const run = createAIEngineeringRun(input, "A", async (p, s) => {
      count++; const r = await reply(p, s); const ds = JSON.parse(r.text);
      if (fault === "partial") ds.pop(); if (fault === "duplicate") ds[1] = ds[0]; if (fault === "borrowed") ds[0].ordinal = 99;
      if (fault === "tool") r.toolRequests = 1; if (fault === "truncated") r.stopReason = "truncated";
      if (fault === "unknown-field") ds[0].authority = "qualified";
      if (fault === "bbox" || fault === "duplicate-target") {
        const t = { id: randomUUID(), description: "simulated", category: "static", bbox: { x: 30, y: 1, width: 4, height: 4 } };
        ds[0] = { ordinal: 0, type: "TARGETS", targets: fault === "duplicate-target" ? [t, t] : [t] };
      }
      r.text = fault === "malformed" ? "{" : fault === "oversized" ? "x".repeat(AI_ENGINEERING_BUDGET.responseBytes + 1) : JSON.stringify(ds);
      if (fault === "image-mutated") p.images[0].fill(0);
      if (fault === "image-missing") p.images.pop();
      return r;
    }, digest, () => undefined);
    const r = await run.execute(); expect(r.status).toBe("INCOMPLETE"); expect(r.accepted).toHaveLength(0); expect(count).toBe(1);
  });
  it.each(["requestLimit", "payloadBytes"])("rejects insufficient %s before a provider call", async field => {
    let count = 0; const run = createAIEngineeringRun(input, "A", async (p, s) => { count++; return reply(p, s); }, digest, () => undefined, { ...AI_ENGINEERING_BUDGET, [field]: 1 });
    expect((await run.execute()).status).toBe("INCOMPLETE"); expect(count).toBe(0);
  });
  it.each(["idleMs", "wallMs"])("%s terminates a hung transport without accepting output", async field => {
    const run = createAIEngineeringRun(input, "A", () => new Promise(() => {}), digest, () => undefined, { ...AI_ENGINEERING_BUDGET, [field]: 20 });
    expect((await run.execute()).status).toBe("INCOMPLETE"); expect(run.snapshot().accepted).toHaveLength(0);
  });
  it("cancellation quarantines an abort-ignoring late response", async () => {
    let deliver!: (v: Awaited<ReturnType<AIEngineeringTransport>>) => void, sent!: () => void;
    const sending = new Promise<void>(r => { sent = r; }); let payload: Parameters<AIEngineeringTransport>[0];
    const run = createAIEngineeringRun(input, "A", p => { payload = p; sent(); return new Promise(r => { deliver = r; }); }, digest, () => undefined);
    const task = run.execute(); await sending; run.cancel(); expect((await task).status).toBe("INCOMPLETE");
    deliver(await reply(payload!, new AbortController().signal)); await new Promise(r => setImmediate(r));
    expect(run.snapshot().accepted).toHaveLength(0); expect(run.snapshot().quarantined).toHaveLength(1);
  });
});
