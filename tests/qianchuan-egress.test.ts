import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";
import { QianchuanEgressRuntime, sshEgressArguments, waitForEgressListener } from "../src/main/qianchuan-egress-runtime";
import { QianchuanEgressSchema, validateEgressGroups } from "../src/shared/qianchuan-egress";
import { z } from "zod";
import { DevelopmentEgressClient, DevelopmentEgressHost } from "../src/main/qianchuan-egress-development";

const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
function fixture() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null as number | null, signalCode: null, pid: 4321 });
  const launch = vi.fn(() => child), probe = vi.fn(async () => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ launch, probe, portFree: async () => true });
  return { child, launch, probe, runtime };
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
it("coalesces a group's tunnel creation, checks IP and never restarts a failed tunnel implicitly", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runtime.ensure(route), f.runtime.ensure(route)]);
  expect(a).toBe(b); expect(f.launch).toHaveBeenCalledTimes(1);
  await f.runtime.verify(route);
  f.child.exitCode = 255; f.child.emit("exit", 255);
  expect(a.signal.aborted).toBe(true);
  await expect(f.runtime.ensure(route)).rejects.toThrow("重连");
  expect(f.launch).toHaveBeenCalledTimes(1);
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
  await expect(f.runtime.verify(route)).rejects.toThrow("出口");
  expect(lease.signal.aborted).toBe(true);
  expect(f.child.kill).not.toHaveBeenCalled();
  await expect(f.runtime.ensure(route)).rejects.toThrow("重连");
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
  await expect(f.runtime.ensure(route)).rejects.toThrow();
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
it.each(["203.0.113.99", "203.0.113.11", "unavailable"])("handles a late old-generation probe (%s) after explicit recovery without reviving old work", async result => {
  const f = fixture(), old = await f.runtime.ensure(route);
  let resolve!: (ip: string) => void, reject!: (error: Error) => void;
  f.probe.mockImplementationOnce(() => new Promise<string>((yes, no) => { resolve = yes; reject = no; }));
  const pending = f.runtime.verify(route); const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(2));
  f.probe.mockRejectedValueOnce(new Error("IP service timeout"));
  await expect(f.runtime.verify(route)).rejects.toThrow();
  f.runtime.recover(route); const fresh = await f.runtime.ensure(route);
  if (result === "unavailable") reject(new Error("late timeout")); else resolve(result);
  await rejected;
  expect(old.signal.aborted).toBe(true);
  expect(fresh.signal.aborted).toBe(result === "203.0.113.99");
  expect(f.child.kill).toHaveBeenCalledTimes(result === "203.0.113.99" ? 1 : 0);
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

function developmentFixture() {
  const children: Array<ReturnType<typeof child>> = [];
  function child() { return Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null as number | null, signalCode: null }); }
  const launch = vi.fn(() => { const next = child(); children.push(next); return next; });
  const probe = vi.fn(async () => route.expectedIp);
  const runtime = new QianchuanEgressRuntime({ launch, probe, portFree: async () => true });
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

it("keeps the same owned SSH transport across Electron replacement and closes it with the launcher", async () => {
  const f = developmentFixture(), first = f.connect();
  const lease = await first.client.ensure(route);
  first.client.dispose(); first.launcher.emit("exit");
  expect(lease.signal.aborted).toBe(true);
  expect(f.children[0].kill).not.toHaveBeenCalled();
  const second = f.connect();
  await second.client.ensure(route); await second.client.verify(route);
  expect(f.launch).toHaveBeenCalledTimes(1);
  f.host.dispose();
  expect(f.children[0].kill).toHaveBeenCalledOnce();
  second.client.dispose();
});

it("propagates transport loss and preserves the failure barrier across Electron replacement", async () => {
  const f = developmentFixture(), first = f.connect(), lease = await first.client.ensure(route);
  f.children[0].exitCode = 255; f.children[0].emit("exit", 255);
  expect(lease.signal.aborted).toBe(true);
  first.client.dispose(); first.launcher.emit("exit");
  const second = f.connect();
  await expect(second.client.ensure(route)).rejects.toThrow("出口");
  expect(f.launch).toHaveBeenCalledTimes(1);
  second.client.recover(route);
  await second.client.ensure(route);
  expect(f.launch).toHaveBeenCalledTimes(2);
  second.client.dispose(); f.host.dispose();
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
