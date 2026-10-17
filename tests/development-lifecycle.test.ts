import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { installDevelopmentQuit } from "../src/main/development-lifecycle";

afterEach(() => vi.useRealTimers());

it("shows the original window while a make replacement waits for active work, including repeated requests", async () => {
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  const quit = vi.fn(), show = vi.fn();
  vi.useFakeTimers();
  installDevelopmentQuit(parent, Promise.resolve(), quit, () => false, show);
  parent.emit("message", { type: "jianji-dev-restart", showWindow: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(show).toHaveBeenCalledOnce(); expect(quit).not.toHaveBeenCalled();
  parent.emit("message", { type: "jianji-dev-restart", showWindow: true });
  await Promise.resolve(); expect(show).toHaveBeenCalledTimes(2);
});

it("does not bring a window to the front for an ordinary code rebuild", async () => {
  vi.useFakeTimers();
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  const show = vi.fn();
  installDevelopmentQuit(parent, Promise.resolve(), vi.fn(), () => false, show);
  parent.emit("message", { type: "jianji-dev-restart" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(show).not.toHaveBeenCalled();
});

it("coalesces rebuilds and waits until production is idle before restarting", async () => {
  vi.useFakeTimers();
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  let busy = true;
  const quit = vi.fn();
  installDevelopmentQuit(parent, Promise.resolve(), quit, () => !busy);
  parent.emit("message", { type: "jianji-dev-restart" });
  parent.emit("message", { type: "jianji-dev-restart" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(quit).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(quit).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(quit).toHaveBeenCalledOnce();
});

it("explicit quit cancels a deferred restart and does not wait for production", async () => {
  vi.useFakeTimers();
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  const quit = vi.fn();
  installDevelopmentQuit(parent, Promise.resolve(), quit, () => false);
  parent.emit("message", { type: "jianji-dev-restart" });
  await vi.advanceTimersByTimeAsync(1000);
  parent.emit("message", { type: "jianji-dev-quit" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(quit).toHaveBeenCalledOnce();
});

it("does not restart when the idle check fails", async () => {
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  const quit = vi.fn(), log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    installDevelopmentQuit(parent, Promise.resolve(), quit, () => { throw new Error("unavailable"); });
    parent.emit("message", { type: "jianji-dev-restart" });
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it("waits for bootstrap before using the normal quit path, never bypassing cleanup", async () => {
  let ready!: () => void;
  const startup = new Promise<void>(resolve => { ready = resolve; });
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://127.0.0.1:1234" }, send: vi.fn() });
  const quit = vi.fn();
  installDevelopmentQuit(parent, startup, quit);
  parent.emit("message", { type: "jianji-dev-quit" });
  await Promise.resolve(); expect(quit).not.toHaveBeenCalled();
  ready(); await startup; await Promise.resolve(); expect(quit).toHaveBeenCalledOnce();
});

it("does not expose the parent quit channel in packaged or disconnected processes", async () => {
  for (const options of [{ env: {}, send: vi.fn() }, { env: { JIANJI_DEV_SERVER_URL: "http://localhost" } }]) {
    const parent = Object.assign(new EventEmitter(), options), quit = vi.fn();
    installDevelopmentQuit(parent, Promise.resolve(), quit);
    parent.emit("message", { type: "jianji-dev-quit" });
    await Promise.resolve(); expect(quit).not.toHaveBeenCalled();
  }
});

it("ignores other messages and still closes resources when bootstrap failed", async () => {
  const parent = Object.assign(new EventEmitter(), { env: { JIANJI_DEV_SERVER_URL: "http://localhost" }, send: vi.fn() });
  const quit = vi.fn(), startup = Promise.reject(new Error("startup"));
  installDevelopmentQuit(parent, startup, quit);
  parent.emit("message", { type: "other" });
  parent.emit("message", null);
  parent.emit("message", { type: "jianji-dev-quit" });
  await startup.catch(() => {}); await Promise.resolve(); expect(quit).toHaveBeenCalledOnce();
});
