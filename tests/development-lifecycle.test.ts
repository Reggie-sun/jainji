import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { installDevelopmentQuit } from "../src/main/development-lifecycle";

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
