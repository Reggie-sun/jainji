import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

const helperPath = new URL("../scripts/dev-lifecycle.mjs", import.meta.url).href;

it("retains the egress owner for identical runtime bytes and replaces it only after old cleanup", async () => {
  const { refreshDevelopmentEgressHost } = await import(helperPath);
  let release!: () => void;
  const stopped = new Promise<void>(resolve => { release = resolve; });
  const oldHost = { dispose: vi.fn(() => stopped) }, nextHost = { dispose: vi.fn() };
  const first = await refreshDevelopmentEgressHost(undefined, Buffer.from("runtime one"), async () => oldHost);
  const create = vi.fn(async () => nextHost);
  expect(await refreshDevelopmentEgressHost(first, Buffer.from("runtime one"), create)).toBe(first);
  expect(oldHost.dispose).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  const replacing = refreshDevelopmentEgressHost(first, Buffer.from("runtime two"), create);
  await Promise.resolve(); expect(oldHost.dispose).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled();
  release();
  const next = await replacing;
  expect(next.host).toBe(nextHost); expect(next.sourceSha256).not.toBe(first.sourceSha256);
});

it("does not create a replacement egress owner when old cleanup fails", async () => {
  const { refreshDevelopmentEgressHost } = await import(helperPath);
  const create = vi.fn();
  const first = await refreshDevelopmentEgressHost(undefined, Buffer.from("runtime one"), async () => ({ dispose: async () => { throw Error("owned transport still running"); } }));
  await expect(refreshDevelopmentEgressHost(first, Buffer.from("runtime two"), create)).rejects.toThrow("still running");
  expect(create).not.toHaveBeenCalled();
});

it("distinguishes a rebuild restart from explicit shutdown", async () => {
  const { requestDevelopmentQuit } = await import(helperPath);
  const child = { exitCode: null, signalCode: null, connected: true, send: vi.fn() };
  requestDevelopmentQuit(child, { restart: true });
  expect(child.send).toHaveBeenCalledWith({ type: "jianji-dev-restart" }, expect.any(Function));
});

it("requests application cleanup over parent IPC without killing a running child", async () => {
  const { requestDevelopmentQuit } = await import(helperPath);
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, connected: true, send: vi.fn(), kill: vi.fn() });
  requestDevelopmentQuit(child);
  expect(child.send).toHaveBeenCalledWith({ type: "jianji-dev-quit" }, expect.any(Function));
  expect(child.kill).not.toHaveBeenCalled();
});

it("does not kill a disconnected child or send requests to an exited child", async () => {
  const { requestDevelopmentQuit } = await import(helperPath);
  const child = { exitCode: null, signalCode: null, connected: false, send: vi.fn(), kill: vi.fn() };
  expect(() => requestDevelopmentQuit(child)).toThrow(/IPC/);
  expect(child.kill).not.toHaveBeenCalled();
  expect(() => requestDevelopmentQuit({ ...child, exitCode: 0 })).not.toThrow();
  expect(child.send).not.toHaveBeenCalled();
});
it("waits for manual close after IPC disconnect so launcher cleanup can continue", async () => {
  const { waitForDevelopmentQuit } = await import(helperPath);
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, connected: false, kill: vi.fn() });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const finished = vi.fn();
    const waiting = waitForDevelopmentQuit(child).then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    child.emit("exit", 0);
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it("requests an idle restart for a replacement and waits for the original process to exit", async () => {
  const { waitForDevelopmentQuit } = await import(helperPath);
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, connected: true, send: vi.fn(), kill: vi.fn() });
  const finished = vi.fn();
  const waiting = waitForDevelopmentQuit(child, { restart: true }).then(finished);
  expect(child.send).toHaveBeenCalledWith({ type: "jianji-dev-restart" }, expect.any(Function));
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  child.emit("exit", 0);
  await waiting;
  expect(finished).toHaveBeenCalledOnce();
  expect(child.kill).not.toHaveBeenCalled();
});
