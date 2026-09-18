import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

const helperPath = new URL("../scripts/dev-lifecycle.mjs", import.meta.url).href;

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
