import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";
import { QianchuanEgressRuntime, sshEgressArguments, waitForEgressListener } from "../src/main/qianchuan-egress-runtime";
import { QianchuanEgressSchema, validateEgressGroups } from "../src/shared/qianchuan-egress";
import { z } from "zod";

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
