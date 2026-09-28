// Negative engineering test only. These automated commands must never be called human qualification evidence.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const packageDirectory = resolve(process.argv[2]);
const pack = JSON.parse(await readFile(join(packageDirectory, "qualification-package.json"), "utf8"));
const root = await mkdtemp(join(tmpdir(), "jianji-d2q-negative-automation-")), run = join(root, "run");
const runner = resolve("scripts/source-fact-qualification.mjs");
let child;
const timer = setTimeout(() => child?.kill("SIGTERM"), 60000);
try {
  const execute = args => new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, [runner, ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; process.stderr.on("data", chunk => { stderr += chunk; });
    process.once("error", reject); process.once("close", code => code === 0 ? done() : reject(Error(stderr)));
  });
  await execute(["prepare", packageDirectory, "AUTOMATED_NEGATIVE_TEST_NOT_HUMAN", run]);
  let urls = 0, expected, driving = Promise.resolve(), stderr = "", buffered = "";
  child = spawn(process.execPath, [runner, "collect", packageDirectory, run], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((done, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? done() : reject(Error(stderr))); });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    buffered += chunk;
    while (buffered.includes("\n")) {
      const end = buffered.indexOf("\n"), line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      if (!line) continue;
      const metadata = JSON.parse(line); urls++;
      assert.equal(expected, undefined, "must not start another session after false EMPTY");
      driving = driving.then(async () => {
        const fixture = pack.truth.fixtures.find(f => f.census.censusDigest === metadata.censusDigest);
        assert.ok(fixture);
        const post = (action, input) => fetch(`${metadata.url}${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        for (const truth of fixture.frames) {
          const frame = await (await post("frame", { ordinal: truth.binding.ordinal })).json();
          const pixelSha256 = createHash("sha256").update(Buffer.from(frame.bytes, "base64")).digest("hex");
          assert.equal((await post("ack", { presentationId: frame.presentationId, pixelSha256, width: frame.width, height: frame.height })).status, 200);
          const fatal = truth.state === "KNOWN" && truth.targets.length > 0;
          if (fatal) expected = { fixtureId: fixture.fixtureId, ordinal: truth.binding.ordinal, urls };
          // Deliberately wrong EMPTY for the first target; UNKNOWN elsewhere. Never a human or successful run.
          const result = await post("record", fatal ? { type: "EMPTY", presentationId: frame.presentationId, confirmation: "这一帧完整画布不存在任何旧贴纸。" }
            : { type: "UNKNOWN", presentationId: frame.presentationId, reason: "AUTOMATED_ENGINEERING_TEST_ONLY" }).catch(() => null);
          if (fatal) return;
          assert.equal(result?.status, 200);
        }
        assert.equal((await post("finish", {})).status, 200);
      });
      driving.catch(error => { stderr += error.stack; child.kill("SIGTERM"); });
    }
  });
  await closed; await driving;
  const terminal = JSON.parse(await readFile(join(run, "collection-result.json"), "utf8"));
  assert.ok(expected);
  assert.equal(urls, expected.urls);
  assert.equal(terminal.qualificationStatus, "NOT_QUALIFIED");
  assert.equal(terminal.reason, "FALSE_EMPTY");
  assert.equal(terminal.falseEmptyCount, 1);
  assert.equal(terminal.fixtureId, expected.fixtureId);
  assert.equal(terminal.ordinal, expected.ordinal);
  assert.equal(terminal.noFurtherQualificationCollection, true);
  assert.equal(terminal.authority, "none");
  console.log(JSON.stringify({ evidenceClass: "AUTOMATED_NEGATIVE_TEST_NOT_HUMAN", result: "PASS", furtherCollection: false }));
} finally { clearTimeout(timer); child?.kill("SIGTERM"); await rm(root, { recursive: true, force: true }); }
