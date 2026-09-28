import { createHash } from "node:crypto";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_FRAME_CONFIRMATION } from "../src/main/source-fact-review-session";

const roots: string[] = [], children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGTERM"); await closed; }
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("D2Q engineering transport, never human qualification", () => {
  it("uses separate controlled scene bytes and genuine identity discontinuity", async () => {
    const modulePath = resolve("scripts/source-fact-qualification-fixtures.mjs");
    const recipe = await import(modulePath);
    expect(new Set([0, 1, 2].map(group => sha(recipe.renderSyntheticFrame("static", 2, group)))).size).toBe(3);
    expect(recipe.syntheticTruth("identity-ambiguous", 2).targets.length).toBe(2);
    expect(recipe.syntheticTruth("identity-ambiguous", 3).state).toBe("TRUTH_AMBIGUOUS");
    expect(recipe.syntheticTruth("identity-ambiguous", 7).state).toBe("TRUTH_AMBIGUOUS");
    const before = recipe.renderSyntheticFrame("identity-ambiguous", 2, 0), after = recipe.renderSyntheticFrame("identity-ambiguous", 3, 0);
    expect(before.subarray((20 * recipe.WIDTH + 20) * 4, (20 * recipe.WIDTH + 20) * 4 + 4)).not.toEqual(after.subarray((20 * recipe.WIDTH + 20) * 4, (20 * recipe.WIDTH + 20) * 4 + 4));
  });
  it("exports only canonical accepted commands and frozen receipts; blocks progress until parent acknowledges", async () => {
    // All HTTP declarations below are automated engineering fixtures, explicitly excluded from human evidence.
    const root = await mkdtemp(join(tmpdir(), "jianji-d2q-ipc-test-")); roots.push(root);
    const media = join(root, "source.mp4"), output = join(root, "receipt.json");
    const encoded = spawnSync(process.env.JIANJI_FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=2:d=1",
      "-c:v", "libx264", "-threads", "1", "-crf", "0", "-bf", "0", "-pix_fmt", "yuv420p", media], { timeout: 10000 });
    if (encoded.error || encoded.status !== 0) throw encoded.error ?? new Error(encoded.stderr.toString());
    const child = fork(resolve("scripts/source-fact-review.mjs"), [media, "automated-engineering-only", output], { stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
    const pending: any[] = []; const waiters: ((message: any) => void)[] = [];
    child.on("message", message => { const waiter = waiters.shift(); if (waiter) waiter(message); else pending.push(message); });
    const nextMessage = () => pending.length ? Promise.resolve(pending.shift()) : new Promise<any>(done => waiters.push(done));
    const ack = (message: any) => child.send({ kind: "D2_EXPORT_ACK", checkpointId: message.checkpointId });
    let stdout = "", stderr = "";
    child.stderr!.on("data", bytes => { stderr += bytes; });
    const urlReady = new Promise<string>((done, reject) => {
      child.stdout!.on("data", bytes => { stdout += bytes; if (stdout.includes("\n")) done(JSON.parse(stdout.trim()).url); });
      child.once("close", () => reject(new Error(`D2 child stopped: ${stderr}`)));
    });
    const session = await nextMessage(); expect(session.kind).toBe("D2_SESSION"); ack(session);
    const url = await urlReady;
    const post = (action: string, input: unknown) => fetch(`${url}${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    for (const ordinal of [0, 1]) {
      const frame = await (await post("frame", { ordinal })).json();
      const digest = sha(Buffer.from(frame.bytes, "base64")); expect(digest).toBe(frame.binding.pixelSha256);
      expect((await post("ack", { presentationId: frame.presentationId, pixelSha256: digest, width: frame.width, height: frame.height })).status).toBe(200);
      const command = { type: "EMPTY", presentationId: frame.presentationId, confirmation: EMPTY_FRAME_CONFIRMATION };
      const recording = post("record", command);
      const exported = await nextMessage(); expect(exported).toMatchObject({ kind: "D2_RECORD", data: { binding: frame.binding, result: command } });
      expect((await post("frame", { ordinal: 1 })).status).toBe(400);
      // An unrelated parent ACK does not release this export.
      child.send({ kind: "D2_EXPORT_ACK", checkpointId: session.checkpointId });
      expect((await post("finish", {})).status).toBe(400);
      ack(exported); expect((await recording).status).toBe(200);
    }
    const finishing = post("finish", {}); const receipt = await nextMessage();
    expect(receipt.kind).toBe("D2_RECEIPT");
    expect(receipt.data).toMatchObject({ authority: "none", eligible: false, methodQualification: "NOT_EVALUATED", semanticReview: "RECORDED_NOT_QUALIFIED" });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(receipt.data);
    ack(receipt); expect((await finishing).status).toBe(200);
  }, 30000);
});
