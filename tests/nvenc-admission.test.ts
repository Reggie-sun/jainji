import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { NvencAdmission, parseNvencSessionCount } from "../src/main/nvenc-admission";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), "jianji-nvenc-test-"));
  directories.push(value);
  return value;
}

it("counts sessions across devices and rejects unsupported or malformed telemetry", () => {
  expect(parseNvencSessionCount("2\n3\n")).toBe(5);
  for (const value of ["", "N/A", "[Not Supported]", "2\nN/A", "-1", "1.5"]) expect(parseNvencSessionCount(value)).toBeUndefined();
});

it("waits for externally occupied sessions without taking the startup lock", async () => {
  const root = await directory();
  let sessions = 6;
  const admission = new NvencAdmission(root, async () => sessions);
  expect(await admission.acquire(6)).toBeUndefined();
  sessions = 5;
  const permit = await admission.acquire(6);
  expect(permit).toBeDefined();
  await permit!.release();
});

it("serializes startup between independent admissions, then permits concurrent encoding", async () => {
  const root = await directory();
  const first = new NvencAdmission(root, async () => 0);
  const second = new NvencAdmission(root, async () => 1);
  const permit = await first.acquire(2);
  try {
    expect(await second.acquire(2)).toBeUndefined();
    await permit!.started();
    const next = await second.acquire(2);
    expect(next).toBeDefined();
    await next!.release();
  } finally { await permit!.release(); }
});

it("keeps the global lock through encoding when telemetry is unsupported", async () => {
  const root = await directory();
  const first = new NvencAdmission(root, async () => undefined);
  const second = new NvencAdmission(root, async () => undefined);
  const permit = await first.acquire(6);
  try {
    await permit!.started();
    expect(await second.acquire(6)).toBeUndefined();
  } finally { await permit!.release(); }
  const next = await second.acquire(6);
  expect(next).toBeDefined();
  await next!.release();
});

it("does not bypass an observed session constraint after a telemetry failure", async () => {
  const root = await directory();
  let sessions: number | undefined = 6;
  const admission = new NvencAdmission(root, async () => sessions);
  expect(await admission.acquire(6)).toBeUndefined();
  sessions = undefined;
  expect(await admission.acquire(6)).toBeUndefined();
  sessions = 0;
  const permit = await admission.acquire(6);
  expect(permit).toBeDefined();
  await permit!.release();
});
