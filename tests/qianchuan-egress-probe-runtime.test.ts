import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type CurlCall = { file: string; args: string[]; options: { signal?: AbortSignal; timeout?: number; maxBuffer?: number; env?: Record<string, string> } };
type CurlOutcome =
  | { kind: "resolve"; stdout: string }
  | { kind: "reject"; code: number; advanceSystemTimeMs?: number }
  | { kind: "pending" };

const curl = vi.hoisted(() => ({
  execFile: vi.fn(),
  invokePromisified: vi.fn(),
  calls: [] as CurlCall[],
  outcomes: [] as CurlOutcome[],
}));

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  Object.defineProperty(curl.execFile, promisify.custom, {
    configurable: true,
    value: (...args: unknown[]) => curl.invokePromisified(...args),
  });
  return { ...actual, execFile: curl.execFile };
});

import { QianchuanEgressRuntime, probeEgressIp } from "../src/main/qianchuan-egress-runtime";
import type { QianchuanEgress } from "../src/shared/qianchuan-egress";

const EXPECTED_IP = "175.27.166.60";
const PROBE_URLS = [
  "https://checkip.amazonaws.com",
  "https://ipv4.icanhazip.com",
  "https://4.ident.me",
] as const;
const route: QianchuanEgress = { group: "probe-test", sshHost: "probe-test-host", localPort: 19160, expectedIp: EXPECTED_IP };

beforeEach(() => {
  curl.calls.length = 0;
  curl.outcomes.length = 0;
  curl.invokePromisified.mockReset();
  curl.invokePromisified.mockImplementation((file: string, args: string[], options: CurlCall["options"]) => {
    curl.calls.push({ file, args: [...args], options });
    const outcome = curl.outcomes.shift() ?? { kind: "resolve", stdout: `${EXPECTED_IP}\n` };
    if (outcome.kind === "reject") {
      if (outcome.advanceSystemTimeMs) vi.setSystemTime(Date.now() + outcome.advanceSystemTimeMs);
      return Promise.reject(Object.assign(new Error("stubbed curl failure"), { code: outcome.code }));
    }
    if (outcome.kind === "pending") {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal;
        const abort = () => reject(Object.assign(new Error("stubbed curl aborted"), { name: "AbortError" }));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return Promise.resolve({ stdout: outcome.stdout, stderr: "" });
  });
});

afterEach(() => vi.useRealTimers());

function makeChild() {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn((_signal?: NodeJS.Signals) => true),
    exitCode: null as number | null,
    signalCode: null as string | null,
    pid: 4321,
  });
  child.kill.mockImplementation(signal => {
    child.signalCode = signal ?? "SIGTERM";
    child.emit("exit", null, signal);
    return true;
  });
  return child;
}

function makeRuntime() {
  const child = makeChild();
  const launch = vi.fn((_route: QianchuanEgress) => child);
  const runtime = new QianchuanEgressRuntime({ launch, portFree: async () => true, probe: probeEgressIp });
  return { child, launch, runtime };
}

function expectSecureCalls(urls: readonly string[]) {
  expect(curl.calls.map(call => call.file)).toEqual(urls.map(() => "/usr/bin/curl"));
  expect(curl.calls.map(call => call.args.at(-1))).toEqual(urls);
  for (const call of curl.calls) {
    expect(call.args).toEqual([
      "--disable", "--silent", "--show-error", "--fail", "--proto", "=https", "--max-time", "10",
      "--max-filesize", "64", "--noproxy", "", "--proxy", "socks5h://127.0.0.1:19160", call.args.at(-1),
    ]);
    expect(call.args).not.toContain("--location");
    expect(call.options).toMatchObject({
      timeout: 12_000,
      maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    });
  }
  if (curl.calls.length > 1) {
    expect(curl.calls.every(call => call.options.signal === curl.calls[0].options.signal)).toBe(true);
  }
}

it("moves from the AWS probe to the second fixed HTTPS endpoint after a known transient curl error", async () => {
  const f = makeRuntime();
  try {
    curl.outcomes.push({ kind: "reject", code: 28 }, { kind: "resolve", stdout: `${EXPECTED_IP}\n` });
    const lease = await f.runtime.ensure(route);
    expect(lease.signal.aborted).toBe(false);
    expectSecureCalls(PROBE_URLS.slice(0, 2));
    expect(f.launch).toHaveBeenCalledOnce();
    expect(f.child.kill).not.toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
});

it("uses the third fixed HTTPS endpoint after two known transient curl errors", async () => {
  const f = makeRuntime();
  try {
    curl.outcomes.push(
      { kind: "reject", code: 7 },
      { kind: "reject", code: 56 },
      { kind: "resolve", stdout: `${EXPECTED_IP}\n` },
    );
    const lease = await f.runtime.ensure(route);
    expect(lease.signal.aborted).toBe(false);
    expectSecureCalls(PROBE_URLS);
    expect(f.launch).toHaveBeenCalledOnce();
    expect(f.child.kill).not.toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
});

it.each([5, 6, 7, 28, 55, 56])("advances to the next endpoint for allowlisted curl exit code %i", async code => {
  const f = makeRuntime();
  try {
    curl.outcomes.push({ kind: "reject", code }, { kind: "resolve", stdout: `${EXPECTED_IP}\n` });
    await expect(f.runtime.ensure(route)).resolves.toMatchObject({ identity: expect.any(String) });
    expectSecureCalls(PROBE_URLS.slice(0, 2));
    expect(f.child.kill).not.toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
});

it("stops after three transient endpoint failures, revokes the lease, and retains the healthy SSH child", async () => {
  const f = makeRuntime();
  try {
    const lease = await f.runtime.ensure(route);
    curl.calls.length = 0;
    curl.outcomes.push(
      { kind: "reject", code: 28 },
      { kind: "reject", code: 7 },
      { kind: "reject", code: 56 },
    );

    await expect(f.runtime.verify(route)).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE" });
    expectSecureCalls(PROBE_URLS);
    expect(lease.signal.aborted).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.launch).toHaveBeenCalledOnce();

    curl.calls.length = 0;
    const freshLease = await f.runtime.ensure(route);
    expect(freshLease).not.toBe(lease);
    expect(lease.signal.aborted).toBe(true);
    expect(freshLease.signal.aborted).toBe(false);
    expectSecureCalls([PROBE_URLS[0]]);
    expect(f.launch).toHaveBeenCalledOnce();
    expect(f.child.kill).not.toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
});

const hardFailures = [
  { description: "a positive IP mismatch", outcome: { kind: "resolve", stdout: "175.27.166.61\n" } },
  { description: "malformed output", outcome: { kind: "resolve", stdout: "not-an-ip\n" } },
  { description: "TLS certificate curl error 60", outcome: { kind: "reject", code: 60 } },
  { description: "TLS curl error 35", outcome: { kind: "reject", code: 35 } },
  { description: "unclassified curl error 22", outcome: { kind: "reject", code: 22 } },
] as const;
const hardFailureContexts = hardFailures.flatMap(({ description, outcome }) =>
  [0, 1, 2].map(transientPrefix => [description, transientPrefix, outcome] as const));

it.each(hardFailureContexts)("does not advance after %s when reached following %i transient errors", async (_description, transientPrefix, outcome) => {
  const f = makeRuntime();
  try {
    const precedingTransientErrors = Array.from({ length: transientPrefix }, () => ({ kind: "reject" as const, code: 28 }));
    curl.outcomes.push(...precedingTransientErrors, outcome);
    await expect(f.runtime.ensure(route)).rejects.toThrow("固定出口");
    expectSecureCalls(PROBE_URLS.slice(0, transientPrefix + 1));
    if (_description === "a positive IP mismatch") expect(f.child.kill).toHaveBeenCalledOnce();
    else expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.launch).toHaveBeenCalledOnce();
  } finally {
    await f.runtime.dispose();
  }
});

it("does not try another endpoint when the active probe is cancelled", async () => {
  const f = makeRuntime();
  try {
    const lease = await f.runtime.ensure(route);
    curl.calls.length = 0;
    curl.outcomes.push({ kind: "pending" });
    const verification = f.runtime.verify(route);
    await vi.waitFor(() => expect(curl.calls).toHaveLength(1));

    const shutdown = f.runtime.dispose();
    await expect(verification).rejects.toThrow("固定出口");
    await shutdown;
    expectSecureCalls([PROBE_URLS[0]]);
    expect(lease.signal.aborted).toBe(true);
  } finally {
    await f.runtime.dispose();
  }
});

it("does not start another endpoint when the remaining absolute deadline cannot cover a probe", async () => {
  vi.useFakeTimers();
  const f = makeRuntime();
  try {
    const lease = await f.runtime.ensure(route);
    curl.calls.length = 0;
    curl.outcomes.push({ kind: "reject", code: 28, advanceSystemTimeMs: 14_000 });

    await expect(f.runtime.verify(route)).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE" });
    expectSecureCalls([PROBE_URLS[0]]);
    expect(lease.signal.aborted).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled();
  } finally {
    await f.runtime.dispose();
  }
});
