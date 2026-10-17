import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";
import { QianchuanEgressRuntime, sshEgressArguments, TransientEgressProbeError, waitForEgressListener } from "../src/main/qianchuan-egress-runtime";
import { QianchuanEgressSchema, validateEgressGroups } from "../src/shared/qianchuan-egress";
import { z } from "zod";
import { DevelopmentEgressClient, DevelopmentEgressHost } from "../src/main/qianchuan-egress-development";

const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn((_signal?: NodeJS.Signals) => true), exitCode: null as number | null, signalCode: null as string | null, pid: 4321 });
  child.kill.mockImplementation(signal => { child.signalCode = signal ?? "SIGTERM"; child.emit("exit", null, signal); return true; });
  return child;
}
function fixture() {
  const children: Array<ReturnType<typeof fakeChild>> = [];
  const launch = vi.fn((_route: typeof route) => { const child = fakeChild(); children.push(child); return child; }),
    probe = vi.fn(async (_route: typeof route, _signal: AbortSignal) => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ launch, probe, portFree: async () => true });
  return { get child() { return children[0]; }, children, launch, probe, runtime };
}
it("rejects shell syntax, credentials and conflicting group bindings", () => {
  for (const sshHost of ["-oProxyCommand=evil", "user@server", "a;touch x", "a b", "a\n"]) expect(QianchuanEgressSchema.safeParse({ ...route, sshHost }).success).toBe(false);
  expect(QianchuanEgressSchema.safeParse({ ...route, password: "secret" }).success).toBe(false);
  const schema = z.array(z.object({ egress: QianchuanEgressSchema.optional() })).superRefine(validateEgressGroups);
  expect(schema.safeParse([{ egress: route }, { egress: route }]).success).toBe(true);
  expect(schema.safeParse([{ egress: route }, { egress: { ...route, group: "主体二" } }]).success).toBe(false);
  expect(schema.safeParse([{ egress: route }, { egress: { ...route, expectedIp: "203.0.113.12" } }]).success).toBe(false);
});
it("pins SSH to loopback with strict host verification and no interactive authentication", () => {
  const args = sshEgressArguments(route);
  expect(args).toContain("127.0.0.1:19381");
  for (const option of ["BatchMode=yes", "StrictHostKeyChecking=yes", "ExitOnForwardFailure=yes", "ControlMaster=no", "ControlPath=none"]) expect(args).toContain(option);
  expect(args.at(-1)).toBe("shop-one");
});
it("coalesces a group's tunnel creation and automatically restores the same frozen route after owned SSH exits", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runtime.ensure(route), f.runtime.ensure(route)]);
  expect(a).toBe(b); expect(f.launch).toHaveBeenCalledTimes(1);
  await f.runtime.verify(route);
  f.child.exitCode = 255; f.child.emit("exit", 255);
  expect(a.signal.aborted).toBe(true);
  const [freshA, freshB] = await Promise.all([f.runtime.ensure(route), f.runtime.ensure(route)]);
  expect(freshA).toBe(freshB); expect(freshA).not.toBe(a); expect(freshA.signal.aborted).toBe(false);
  expect(f.launch).toHaveBeenCalledTimes(2); expect(f.launch.mock.calls[1][0]).toEqual(route);
});
it("automatically restores and revalidates the frozen route after an owned child exits, before another ensure", async () => {
  const f = fixture(), old = await f.runtime.ensure(route);
  f.child.exitCode = 255; f.child.emit("exit", 255);
  const verification = f.runtime.verify(route);
  void verification.catch(() => undefined);
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(2));
  expect(old.signal.aborted).toBe(true);
  const fresh = await f.runtime.ensure(route);
  expect(await verification).toBe(fresh);
  expect(fresh).not.toBe(old); expect(fresh.signal.aborted).toBe(false);
  expect(f.launch.mock.calls[1][0]).toEqual(route);
  await f.runtime.dispose();
});
it("starts a new automatic recovery episode after the previous restored tunnel later exits", async () => {
  const f = fixture(), original = await f.runtime.ensure(route);
  f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(2));
  f.children[1].exitCode = 255; f.children[1].emit("exit", 255);
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(3));
  const latest = await f.runtime.ensure(route);
  expect(original.signal.aborted).toBe(true);
  expect(latest.signal.aborted).toBe(false); expect(latest).not.toBe(original);
  await f.runtime.dispose();
});
it.each(["dispose", "retire"])("does not relaunch when %s interrupts the wait for an owned child to exit", async operation => {
  const f = fixture();
  try {
    const old = await f.runtime.ensure(route);
    f.child.kill.mockImplementation(() => true); // An owned SSH may acknowledge SIGTERM before it exits.
    f.child.emit("error", new Error("fixture transport failure"));
    const recovery = f.runtime.ensure(route);
    const rejected = expect(recovery).rejects.toThrow("出口");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(f.launch).toHaveBeenCalledOnce();
    const shutdown = operation === "dispose" ? f.runtime.dispose() : (f.runtime.retireUnused([]), Promise.resolve());
    f.child.exitCode = 255; f.child.emit("exit", 255);
    await rejected; await shutdown;
    expect(old.signal.aborted).toBe(true);
    expect(f.launch).toHaveBeenCalledOnce();
  } finally { await f.runtime.dispose(); }
});
it.each(["unknown", "invalid"])("keeps a %s probe failure barrier when the owned child later exits", async failureKind => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const old = await f.runtime.ensure(route);
    if (failureKind === "unknown") f.probe.mockRejectedValueOnce(new Error("unclassified fixture failure"));
    else if (failureKind === "invalid") f.probe.mockResolvedValueOnce("invalid response");
    else throw new Error("unreachable fixture state");
    const verification = expect(f.runtime.verify(route)).rejects.toThrow("出口");
    await vi.advanceTimersByTimeAsync(400); await verification;
    await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
    f.child.exitCode = 255; f.child.emit("exit", 255);
    await vi.advanceTimersByTimeAsync(1000);
    expect(old.signal.aborted).toBe(true);
    expect(f.launch).toHaveBeenCalledOnce();
    await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
    f.runtime.recover(route);
    expect((await f.runtime.ensure(route)).signal.aborted).toBe(false);
    expect(f.launch).toHaveBeenCalledTimes(2);
  } finally { await f.runtime.dispose(); vi.useRealTimers(); }
});
it("IP mismatch kills only its own child and leaves a failure barrier", async () => {
  const f = fixture(); f.probe.mockResolvedValue("203.0.113.99");
  await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  await expect(f.runtime.ensure(route)).rejects.toThrow();
  expect(f.launch).toHaveBeenCalledTimes(1);
});
it("refuses pre-existing listeners and fails closed when a probe or SSH fails", async () => {
  const launch = vi.fn();
  await expect(new QianchuanEgressRuntime({ launch, portFree: async () => false }).ensure(route)).rejects.toThrow("端口");
  expect(launch).not.toHaveBeenCalled();
  const f = fixture(); const lease = await f.runtime.ensure(route);
  f.probe.mockRejectedValue(new Error("sensitive stderr"));
  await expect(f.runtime.verify(route)).rejects.toThrow("固定出口");
  expect(lease.signal.aborted).toBe(true);
  expect(f.child.kill).not.toHaveBeenCalled();
  await expect(f.runtime.ensure(route)).rejects.toThrow("重连");
});
it("rechecks a refused port after it becomes free without caching the no-child failure", async () => {
  let free = false;
  const portFree = vi.fn(async () => free), child = fakeChild();
  const launch = vi.fn(() => child), probe = vi.fn(async () => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ portFree, launch, probe });
  try {
    const refused = await Promise.allSettled([runtime.ensure(route), runtime.ensure(route)]);
    expect(refused.every(result => result.status === "rejected" && /端口/.test(result.reason.message))).toBe(true);
    expect(portFree).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
    await expect(runtime.ensure(route)).rejects.toThrow("端口");
    expect(portFree).toHaveBeenCalledTimes(2); expect(launch).not.toHaveBeenCalled();
    free = true;
    const [a, b] = await Promise.all([runtime.ensure(route), runtime.ensure(route)]);
    expect(a).toBe(b); expect(a.signal.aborted).toBe(false);
    expect(portFree).toHaveBeenCalledTimes(3); expect(launch).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(route); expect(probe).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  } finally { await runtime.dispose(); }
});

it("does not cache a busy-port refusal in the development host across app replacement", async () => {
  // The launcher can outlive both a refused port and the original Electron client.
  let free = false;
  const portFree = vi.fn(async () => free), f = developmentFixture({ portFree });
  const first = f.connect();
  try {
    await expect(first.client.ensure(route)).rejects.toThrow("端口");
    expect(f.launch).not.toHaveBeenCalled();
    await first.client.dispose(); first.launcher.emit("exit");
    free = true;
    const replacement = f.connect();
    try {
      const fresh = await replacement.client.ensure(route);
      expect(fresh.signal.aborted).toBe(false); expect(f.launch).toHaveBeenCalledOnce();
      expect(portFree).toHaveBeenCalledTimes(2);
    } finally { await replacement.client.dispose(); }
  } finally { await first.client.dispose(); await f.host.dispose(); }
});
it("retries only known transient probe transport failures on the same healthy SSH and coalesces concurrent checks", async () => {
  const f = fixture(), lease = await f.runtime.ensure(route);
  f.probe.mockClear();
  let resolve!: (ip: string) => void;
  f.probe.mockImplementationOnce(() => new Promise<string>(yes => { resolve = yes; }));
  const first = f.runtime.verify(route);
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(1));
  const second = f.runtime.verify(route);
  await Promise.resolve(); await Promise.resolve();
  expect(f.probe).toHaveBeenCalledTimes(1);
  resolve(route.expectedIp);
  await Promise.all([first, second]);
  expect(lease.signal.aborted).toBe(false);
  expect(f.launch).toHaveBeenCalledOnce();

  f.probe.mockClear();
  f.probe.mockRejectedValueOnce(new TransientEgressProbeError())
    .mockRejectedValueOnce(new TransientEgressProbeError())
    .mockResolvedValueOnce(route.expectedIp);
  await f.runtime.verify(route);
  expect(f.probe).toHaveBeenCalledTimes(3);
  expect(f.launch).toHaveBeenCalledOnce(); expect(lease.signal.aborted).toBe(false);
});
it("renews only on the next request after transient probe exhaustion while retaining the healthy SSH", async () => {
  const f = fixture(), lease = await f.runtime.ensure(route);
  f.probe.mockClear(); f.probe.mockRejectedValueOnce(new TransientEgressProbeError())
    .mockRejectedValueOnce(new TransientEgressProbeError()).mockRejectedValueOnce(new TransientEgressProbeError());
  let nextEnsure!: Promise<Awaited<ReturnType<typeof f.runtime.ensure>>>;
  let nextVerify!: Promise<Awaited<ReturnType<typeof f.runtime.verify>>>;
  lease.signal.addEventListener("abort", () => {
    nextEnsure = f.runtime.ensure(route);
    nextVerify = f.runtime.verify(route);
  }, { once: true });
  await expect(f.runtime.verify(route)).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE", message: expect.stringContaining("固定出口") });
  expect(f.probe.mock.calls.filter(([, signal]) => signal === lease.signal)).toHaveLength(3);
  expect(lease.signal.aborted).toBe(true); expect(f.child.kill).not.toHaveBeenCalled();
  const [fresh, verified] = await Promise.all([nextEnsure, nextVerify]);
  expect(verified).toBe(fresh);
  expect(fresh).not.toBe(lease); expect(fresh.signal.aborted).toBe(false);
  expect(lease.signal.aborted).toBe(true); expect(f.child.kill).not.toHaveBeenCalled();
  expect(f.probe).toHaveBeenCalledTimes(4); expect(f.launch).toHaveBeenCalledOnce();
  expect(f.probe.mock.calls.every(([calledRoute]) => calledRoute.expectedIp === route.expectedIp)).toBe(true);
});
it("lets the next request reverify the healthy automatic replacement after transient exhaustion", async () => {
  const f = fixture(), old = await f.runtime.ensure(route);
  f.probe.mockRejectedValueOnce(new TransientEgressProbeError())
    .mockRejectedValueOnce(new TransientEgressProbeError()).mockRejectedValueOnce(new TransientEgressProbeError());
  vi.useFakeTimers();
  try {
    f.child.exitCode = 255; f.child.emit("exit", 255);
    const recovery = f.runtime.ensure(route);
    const rejected = expect(recovery).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(f.launch).toHaveBeenCalledTimes(2);
    expect(old.signal.aborted).toBe(true);
    expect(f.children[1].signalCode).toBeNull();

    f.probe.mockResolvedValue(route.expectedIp);
    const fresh = await f.runtime.ensure(route);
    expect(fresh.signal.aborted).toBe(false);
    expect(fresh).not.toBe(old);
    expect(f.launch).toHaveBeenCalledTimes(2);
    expect(f.probe).toHaveBeenCalledTimes(5);
    expect(f.children[1].signalCode).toBeNull();
  } finally { await f.runtime.dispose(); vi.useRealTimers(); }
});
it("does not start a fresh curl window when a transient verification leaves insufficient deadline budget", async () => {
  vi.useFakeTimers();
  const f = fixture(), lease = await f.runtime.ensure(route);
  f.probe.mockClear();
  f.probe.mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + 20_000);
    throw new TransientEgressProbeError();
  });
  try {
    const verification = f.runtime.verify(route);
    const rejected = expect(verification).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(f.probe).toHaveBeenCalledOnce();
    expect(lease.signal.aborted).toBe(true);
    f.probe.mockResolvedValue(route.expectedIp);
    const fresh = await f.runtime.ensure(route);
    expect(fresh.signal.aborted).toBe(false);
    expect(f.launch).toHaveBeenCalledOnce();
  } finally { await f.runtime.dispose(); vi.useRealTimers(); }
});
it("keeps a hard barrier when a fresh attempt after transient exhaustion has a hard result", async () => {
  const f = fixture(), old = await f.runtime.ensure(route);
  f.probe.mockRejectedValue(new TransientEgressProbeError());
  await expect(f.runtime.verify(route)).rejects.toThrow("出口");
  expect(old.signal.aborted).toBe(true);
  f.probe.mockResolvedValue("203.0.113.99");
  const probesBeforeFreshAttempt = f.probe.mock.calls.length;
  await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
  expect(f.probe).toHaveBeenCalledTimes(probesBeforeFreshAttempt + 1);
  const attempts = f.probe.mock.calls.length;
  await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
  expect(f.probe).toHaveBeenCalledTimes(attempts);
  expect(f.child.kill).toHaveBeenCalledOnce(); expect(f.launch).toHaveBeenCalledOnce();
});
it("turns an exhausted-transient barrier hard if the retained SSH exits before renewal", async () => {
  vi.useFakeTimers();
  const f = fixture(), old = await f.runtime.ensure(route);
  try {
    f.probe.mockRejectedValue(new TransientEgressProbeError());
    const pending = f.runtime.verify(route), rejected = expect(pending).rejects.toMatchObject({ code: "EGRESS_TRANSIENT_PROBE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(400); await rejected;
    f.child.exitCode = 255; f.child.emit("exit", 255);
    await vi.advanceTimersByTimeAsync(1000);
    expect(old.signal.aborted).toBe(true);
    await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
    expect(f.launch).toHaveBeenCalledOnce();
    f.runtime.recover(route);
    f.probe.mockResolvedValue(route.expectedIp);
    const fresh = await f.runtime.ensure(route);
    expect(fresh.signal.aborted).toBe(false); expect(f.launch).toHaveBeenCalledTimes(2);
  } finally { await f.runtime.dispose(); vi.useRealTimers(); }
});
it.each(["retire", "dispose"])("does not resurrect an exhausted transient lease when %s races its pending renewal", async operation => {
  const f = fixture(), old = await f.runtime.ensure(route);
  let renewal!: Promise<Awaited<ReturnType<typeof f.runtime.ensure>>>;
  let shutdown: Promise<void> | undefined;
  old.signal.addEventListener("abort", () => {
    renewal = f.runtime.ensure(route);
    if (operation === "retire") f.runtime.retireUnused([]);
    else shutdown = f.runtime.dispose();
  }, { once: true });
  f.probe.mockRejectedValue(new TransientEgressProbeError());
  try {
    const verification = f.runtime.verify(route);
    await expect(verification).rejects.toThrow("出口");
    await expect(renewal).rejects.toThrow("出口");
    await shutdown;
    expect(old.signal.aborted).toBe(true);
    expect(f.probe).toHaveBeenCalledTimes(4); // initial attestation plus three transient probes
    expect(f.launch).toHaveBeenCalledOnce();
  } finally { await f.runtime.dispose(); }
});
it("bounds a probe that ignores cancellation by the absolute connection deadline", async () => {
  vi.useFakeTimers();
  const f = fixture(); f.probe.mockImplementation(() => new Promise<string>(() => {}));
  try {
    const pending = f.runtime.ensure(route);
    const rejected = expect(pending).rejects.toThrow("出口");
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.probe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25_001);
    await rejected;
  } finally {
    await f.runtime.dispose();
    vi.useRealTimers();
  }
});
it("limits unexpected owned-child recovery to three new launches and never retries a wrong IP", async () => {
  const f = fixture(); await f.runtime.ensure(route);
  f.child.exitCode = 255; f.child.emit("exit", 255);
  f.launch.mockImplementation(() => {
    const child = fakeChild(); f.children.push(child);
    queueMicrotask(() => { child.exitCode = 255; child.emit("exit", 255); });
    return child;
  });
  await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
  expect(f.launch).toHaveBeenCalledTimes(4); // original tunnel plus three bounded recovery launches
  await expect(f.runtime.ensure(route)).rejects.toThrow("出口");
  expect(f.launch).toHaveBeenCalledTimes(4); // an exhausted child-recovery budget stays a barrier
  const mismatch = fixture(); mismatch.probe.mockResolvedValue("203.0.113.99");
  await expect(mismatch.runtime.ensure(route)).rejects.toThrow("出口");
  expect(mismatch.launch).toHaveBeenCalledOnce(); expect(mismatch.child.kill).toHaveBeenCalledOnce();
});
it("explicit recovery rechecks the same healthy transport with a new lease and never revives old work", async () => {
  const f = fixture(), old = await f.runtime.ensure(route);
  f.probe.mockRejectedValueOnce(new Error("IP service timeout"));
  await expect(f.runtime.verify(route)).rejects.toThrow();
  f.runtime.recover(route);
  const [a, b] = await Promise.all([f.runtime.ensure(route), f.runtime.ensure(route)]);
  expect(a).toBe(b); expect(a).not.toBe(old);
  expect(old.signal.aborted).toBe(true); expect(a.signal.aborted).toBe(false);
  expect(f.launch).toHaveBeenCalledTimes(1); expect(f.probe).toHaveBeenCalledTimes(3);
  expect(f.child.kill).not.toHaveBeenCalled();
  f.child.exitCode = 255; f.child.emit("exit", 255);
  expect(a.signal.aborted).toBe(true);
  const fresh = await f.runtime.ensure(route);
  expect(fresh.signal.aborted).toBe(false); expect(fresh).not.toBe(a);
  expect(f.launch).toHaveBeenCalledTimes(2);
});
it.each(["dispose", "retire"])("%s closes retained transport even after its automation lease was revoked", async operation => {
  const f = fixture(); await f.runtime.ensure(route);
  f.probe.mockRejectedValue(new Error("IP service timeout"));
  await expect(f.runtime.verify(route)).rejects.toThrow();
  expect(f.child.kill).not.toHaveBeenCalled();
  if (operation === "dispose") f.runtime.dispose(); else f.runtime.retireUnused([]);
  expect(f.child.kill).toHaveBeenCalledOnce();
  f.runtime.dispose(); expect(f.child.kill).toHaveBeenCalledOnce();
});
it("retains a newly launched tunnel if the initial IP service request fails", async () => {
  const f = fixture(); f.probe.mockRejectedValueOnce(new Error("IP service timeout"));
  await expect(f.runtime.ensure(route)).rejects.toThrow();
  expect(f.child.kill).not.toHaveBeenCalled();
  f.runtime.recover(route); const lease = await f.runtime.ensure(route);
  expect(lease.signal.aborted).toBe(false); expect(f.launch).toHaveBeenCalledTimes(1);
  f.runtime.dispose();
});
it("rejects malformed attestations and keeps the transport through an unsuccessful explicit recovery", async () => {
  const f = fixture(), old = await f.runtime.ensure(route);
  f.probe.mockResolvedValue("upstream unavailable");
  await expect(f.runtime.verify(route)).rejects.toThrow();
  f.runtime.recover(route);
  await expect(f.runtime.ensure(route)).rejects.toThrow();
  await expect(f.runtime.ensure(route)).rejects.toThrow();
  expect(f.launch).toHaveBeenCalledOnce(); expect(f.child.kill).not.toHaveBeenCalled();
  expect(old.signal.aborted).toBe(true);
  f.runtime.dispose();
});
it.each(["203.0.113.99", "203.0.113.11", "unavailable"])("handles a late old-generation probe (%s) after automatic route recovery without reviving old work", async result => {
  const f = fixture(), old = await f.runtime.ensure(route);
  let resolve!: (ip: string) => void, reject!: (error: Error) => void;
  f.probe.mockImplementationOnce(() => new Promise<string>((yes, no) => { resolve = yes; reject = no; }));
  const pending = f.runtime.verify(route); const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(2));
  f.child.exitCode = 255; f.child.emit("exit", 255);
  const fresh = await f.runtime.ensure(route);
  if (result === "unavailable") reject(new Error("late timeout")); else resolve(result);
  await rejected;
  expect(old.signal.aborted).toBe(true);
  expect(fresh.signal.aborted).toBe(false);
  expect(f.launch).toHaveBeenCalledTimes(2);
  f.runtime.dispose();
});
it("rejects reusing a port or changing a live group and bounds explicit recovery", async () => {
  const f = fixture(); await f.runtime.ensure(route);
  await expect(f.runtime.ensure({ ...route, expectedIp: "203.0.113.12" })).rejects.toThrow();
  await expect(f.runtime.ensure({ ...route, group: "主体二" })).rejects.toThrow();
  f.runtime.dispose(); expect(f.child.kill).toHaveBeenCalledTimes(1);
});
it("waits for a late listener without binding its port and cancels unavailable startup", async () => {
  const server = createServer(socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const controller = new AbortController();
  const waiting = waitForEgressListener(port, controller.signal);
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    await waiting;
  } finally { controller.abort(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); }
  const cancel = new AbortController(), pending = waitForEgressListener(port, cancel.signal);
  cancel.abort(); await expect(pending).rejects.toThrow();
});

function developmentFixture(options: { portFree?: () => Promise<boolean> } = {}) {
  const children: Array<ReturnType<typeof child>> = [];
  function child() { return fakeChild(); }
  const launch = vi.fn(() => { const next = child(); children.push(next); return next; });
  const probe = vi.fn(async () => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ launch, probe, portFree: options.portFree ?? (async () => true) });
  const host = new DevelopmentEgressHost(runtime);
  function connect() {
    const app = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((message: object, callback: (error: Error | null) => void) => { launcher.emit("message", message); callback(null); }) });
    const launcher = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((message: object, callback: (error: Error | null) => void) => { app.emit("message", message); callback(null); }) });
    host.attach(launcher);
    return { app, launcher, client: new DevelopmentEgressClient(app) };
  }
  return { children, launch, probe, runtime, host, connect };
}

it("propagates attestation failure across IPC and revalidates retained SSH only after explicit recovery", async () => {
  const f = developmentFixture(), connection = f.connect(), lease = await connection.client.ensure(route);
  f.probe.mockRejectedValueOnce(new Error("attestation timeout"));
  await expect(connection.client.verify(route)).rejects.toThrow();
  expect(lease.signal.aborted).toBe(true);
  expect(f.children[0].kill).not.toHaveBeenCalled();
  connection.client.dispose(); connection.launcher.emit("exit");
  const replacement = f.connect();
  await expect(replacement.client.ensure(route)).rejects.toThrow();
  replacement.client.recover(route);
  const fresh = await replacement.client.ensure(route);
  expect(fresh.signal.aborted).toBe(false); expect(lease.signal.aborted).toBe(true);
  expect(f.launch).toHaveBeenCalledOnce();
  f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
  expect(fresh.signal.aborted).toBe(true);
  replacement.client.dispose(); f.host.dispose();
});

it("reports runtime failure separately from lost launcher IPC without forwarding raw details", async () => {
  const f = developmentFixture(), connection = f.connect();
  try {
    await connection.client.ensure(route);
    f.probe.mockRejectedValueOnce(new Error("sensitive stderr fixture"));
    await expect(connection.client.verify(route)).rejects.toThrow("固定出口连接或 IP 校验失败");
    const denied = connection.launcher.send.mock.calls.map(call => call[0]).find((message: any) => message.ok === false);
    expect(denied).toMatchObject({ ok: false, failure: "egress-unavailable" });
    expect(JSON.stringify(denied)).not.toContain("sensitive");
    connection.app.connected = false; connection.app.emit("disconnect");
    await expect(connection.client.ensure(route)).rejects.toThrow("开发启动器");
  } finally { await connection.client.dispose(); await f.host.dispose(); }
});

it("keeps the same owned SSH transport across Electron replacement and closes it with the launcher", async () => {
  const f = developmentFixture(), first = f.connect();
  const lease = await first.client.ensure(route);
  first.client.dispose(); first.launcher.emit("exit");
  expect(lease.signal.aborted).toBe(true);
  expect(f.children[0].kill).not.toHaveBeenCalled();
  const second = f.connect();
  await second.client.ensure(route); await second.client.verify(route);
  expect(f.launch).toHaveBeenCalledTimes(1);
  await f.host.dispose();
  expect(f.children[0].kill).toHaveBeenCalledOnce();
  second.client.dispose();
});

it("propagates transport loss and preserves the failure barrier across Electron replacement", async () => {
  const f = developmentFixture(), first = f.connect(), lease = await first.client.ensure(route);
  f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
  expect(lease.signal.aborted).toBe(true);
  first.client.dispose(); first.launcher.emit("exit");
  const second = f.connect();
  const fresh = await second.client.ensure(route);
  expect(fresh.signal.aborted).toBe(false); expect(lease.signal.aborted).toBe(true);
  expect(f.launch).toHaveBeenCalledTimes(2);
  second.client.dispose(); f.host.dispose();
});

it("binds remote leases to opaque transport generations and ignores a late abort from the previous generation", async () => {
  const f = developmentFixture(), connection = f.connect(), received: any[] = [];
  connection.app.on("message", message => received.push(message));
  const old = await connection.client.ensure(route);
  const firstResult = received.filter(message => message?.type === "jianji-egress-result" && message.ok === true).at(-1);
  const [hostId, firstSequence] = firstResult.generation.split(":");
  expect(hostId).toMatch(/^[0-9a-f-]{36}$/i); expect(firstSequence).toBe("1");
  f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
  expect(old.signal.aborted).toBe(true);
  const fresh = await connection.client.ensure(route);
  const successful = received.filter(message => message?.type === "jianji-egress-result" && message.ok === true);
  const secondGeneration = successful.at(-1).generation;
  expect(secondGeneration).not.toBe(firstResult.generation);
  expect(secondGeneration.split(":")[0]).toBe(hostId); expect(secondGeneration.split(":")[1]).toBe("2");
  connection.app.emit("message", { type: "jianji-egress-aborted", identity: old.identity, generation: firstResult.generation });
  expect(fresh.signal.aborted).toBe(false);
  connection.app.emit("message", { type: "jianji-egress-aborted", identity: old.identity });
  expect(fresh.signal.aborted).toBe(true);
  await expect(connection.client.ensure(route)).rejects.toThrow("出口");
  await f.host.dispose();
});

it("publishes a new IPC lease after typed transient exhaustion and ignores a replayed old-generation abort", async () => {
  const f = developmentFixture(), connection = f.connect(), received: any[] = [];
  connection.app.on("message", message => received.push(message));
  try {
    const old = await connection.client.ensure(route);
    const successes = () => received.filter(message => message?.type === "jianji-egress-result" && message.ok === true);
    const firstGeneration = successes().at(-1).generation;
    f.probe.mockRejectedValueOnce(new TransientEgressProbeError())
      .mockRejectedValueOnce(new TransientEgressProbeError()).mockRejectedValueOnce(new TransientEgressProbeError());
    await expect(connection.client.verify(route)).rejects.toThrow("固定出口");
    expect(old.signal.aborted).toBe(true);
    expect(f.children[0].kill).not.toHaveBeenCalled();

    const fresh = await connection.client.ensure(route);
    const nextGeneration = successes().at(-1).generation;
    expect(nextGeneration).not.toBe(firstGeneration);
    expect(fresh.signal.aborted).toBe(false); expect(old.signal.aborted).toBe(true);
    expect(f.launch).toHaveBeenCalledOnce();

    connection.app.emit("message", { type: "jianji-egress-aborted", identity: old.identity, generation: firstGeneration });
    expect(fresh.signal.aborted).toBe(false);
    await expect(connection.client.verify(route)).resolves.toBe(fresh);
    expect(fresh.signal.aborted).toBe(false);
  } finally { await connection.client.dispose(); await f.host.dispose(); }
});

it("rejects an acquire response revoked before its continuation can grant a lease", async () => {
  const hostId = "550e8400-e29b-41d4-a716-446655440000";
  const channel = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_request: any, callback: (error: Error | null) => void) => callback(null)) });
  const client = new DevelopmentEgressClient(channel);
  const acquire = client.ensure(route), request = channel.send.mock.calls[0][0];
  channel.emit("message", { type: "jianji-egress-aborted", identity: JSON.stringify(route), generation: `${hostId}:1` });
  channel.emit("message", { type: "jianji-egress-result", requestId: request.requestId, ok: true, identity: JSON.stringify(route), generation: `${hostId}:1` });
  await expect(acquire).rejects.toThrow("出口");

  const nextAcquire = client.ensure(route), nextRequest = channel.send.mock.calls[1][0];
  channel.emit("message", { type: "jianji-egress-result", requestId: nextRequest.requestId, ok: true, identity: JSON.stringify(route), generation: `${hostId}:2` });
  const fresh = await nextAcquire;
  expect(fresh.signal.aborted).toBe(false);
  await client.dispose();
});

it("rejects an out-of-order old-generation success without replacing a newer lease", async () => {
  const hostId = "550e8400-e29b-41d4-a716-446655440000";
  const channel = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_request: any, callback: (error: Error | null) => void) => callback(null)) });
  const client = new DevelopmentEgressClient(channel);
  const oldAcquire = client.ensure(route), oldRequest = channel.send.mock.calls[0][0];
  const newAcquire = client.ensure(route), newRequest = channel.send.mock.calls[1][0];
  channel.emit("message", { type: "jianji-egress-result", requestId: newRequest.requestId, ok: true, identity: JSON.stringify(route), generation: `${hostId}:2` });
  const fresh = await newAcquire;
  channel.emit("message", { type: "jianji-egress-result", requestId: oldRequest.requestId, ok: true, identity: JSON.stringify(route), generation: `${hostId}:1` });
  await expect(oldAcquire).rejects.toThrow("出口");
  expect(fresh.signal.aborted).toBe(false);
  await client.dispose();
});

it("fails closed when the private lease protocol omits a generation", async () => {
  const channel = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((request: any, callback: (error: Error | null) => void) => {
    channel.emit("message", { type: "jianji-egress-result", requestId: request.requestId, ok: true, identity: JSON.stringify(route) });
    callback(null);
  }) });
  const client = new DevelopmentEgressClient(channel);
  await expect(client.ensure(route)).rejects.toThrow("出口");
  await expect(client.ensure(route)).rejects.toThrow("出口");
});

it("aborts client leases and pending work when parent IPC is lost without falling back to local SSH", async () => {
  const f = developmentFixture(), connection = f.connect(), lease = await connection.client.ensure(route);
  connection.app.send.mockImplementation(() => {});
  const pending = connection.client.verify(route);
  connection.app.connected = false; connection.app.emit("disconnect");
  await expect(pending).rejects.toThrow("出口");
  expect(lease.signal.aborted).toBe(true);
  await expect(connection.client.ensure(route)).rejects.toThrow("出口");
  expect(f.launch).toHaveBeenCalledTimes(1);
  connection.client.dispose(); f.host.dispose();
});

it("retiring a route aborts its remote leases and rejects conflicting route reuse", async () => {
  const f = developmentFixture(), connection = f.connect(), lease = await connection.client.ensure(route);
  await expect(connection.client.ensure({ ...route, expectedIp: "203.0.113.12" })).rejects.toThrow("出口");
  connection.client.retireUnused([]);
  expect(lease.signal.aborted).toBe(true);
  expect(f.children[0].kill).toHaveBeenCalledOnce();
  connection.client.dispose(); f.host.dispose();
});

it("does not publish a live lease if transport loss races with the first acquire reply", async () => {
  const f = developmentFixture(), connection = f.connect();
  connection.launcher.send.mockImplementation((message: object, callback: (error: Error | null) => void) => {
    connection.app.emit("message", message);
    if ((message as { type: string }).type === "jianji-egress-result") {
      f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
    }
    callback(null);
  });
  await expect(connection.client.ensure(route)).rejects.toThrow("出口");
  connection.client.dispose(); f.host.dispose();
});
