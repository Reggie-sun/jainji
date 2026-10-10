import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), prepare: vi.fn(), execute: vi.fn(),
  tray: { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() }, menu: [] as any[] }));
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  Tray: class { constructor() { return mocks.tray; } }, nativeImage: { createFromBuffer: (value: Buffer) => value },
  Menu: { buildFromTemplate: (value: any[]) => { mocks.menu = value; return value; } } }));
vi.mock("../src/main/automation-runtime", () => ({ AutomationRuntime: class { prepare = mocks.prepare; execute = mocks.execute; } }));
import { createAutomationDesktop } from "../src/main/automation-desktop";
import { AutomationBackground } from "../src/main/automation-background";
import type { BrowserWindow } from "electron";

const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); mocks.handlers.clear(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it("exposes only trusted scheduled operations, authorizes create/enable and does not execute when saved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "automation-desktop-")); roots.push(root);
  const event = {} as Electron.IpcMainInvokeEvent;
  const authorize = vi.fn(async () => {}), changed = vi.fn();
  mocks.prepare.mockResolvedValue({ binding: "a".repeat(64), summary: "fixed" });
  const scheduler = await createAutomationDesktop({ root, runtime: {} as Parameters<typeof createAutomationDesktop>[0]["runtime"],
    authorize, busy: () => false, trusted: value => { if (value !== event) throw new Error("untrusted"); }, changed });
  expect(() => mocks.handlers.get("automation.get")!({})).toThrow("untrusted");
  await expect(mocks.handlers.get("automation.configure")!({}, {})).rejects.toThrow("untrusted");
  const request = { name: "固定清理", enabled: false, time: "12:00", upload: false, confirmation: "AUTHORIZE_FIXED_AUTOMATION",
    cleanup: { confirmation: "DELETE_PLAN_MATERIALS", accounts: [{ product: "蝴蝶贴", expectedAdvertiserId: "123", expectedAdId: "456" }] } };
  const saved = await mocks.handlers.get("automation.create")!(event, request);
  expect(saved.tasks).toHaveLength(1); expect(authorize).toHaveBeenCalledTimes(1); expect(mocks.execute).not.toHaveBeenCalled();
  const id = saved.tasks[0].id;
  authorize.mockRejectedValueOnce(new Error("membership unavailable"));
  await expect(mocks.handlers.get("automation.configure")!(event, { id, enabled: true, time: "12:00" })).rejects.toThrow("membership");
  expect(scheduler.task(id)?.request.enabled).toBe(false);
  await mocks.handlers.get("automation.configure")!(event, { id, enabled: true, time: "12:00" });
  expect(scheduler.enabled).toBe(true);
  await mocks.handlers.get("automation.remove")!(event, id);
  expect(scheduler.enabled).toBe(false); expect(changed).toHaveBeenCalledTimes(3);
  await scheduler.stop();
});
it("hides without quitting, provides reopen and explicit exit, and disposes the tray", () => {
  const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn(), restore: vi.fn(), isMinimized: () => true, isDestroyed: () => false };
  const quit = vi.fn(), background = new AutomationBackground(() => window as unknown as BrowserWindow, quit);
  expect(background.hide()).toBe(true); expect(window.hide).toHaveBeenCalledOnce(); expect(quit).not.toHaveBeenCalled();
  mocks.menu[0].click(); expect(window.restore).toHaveBeenCalledOnce(); expect(window.show).toHaveBeenCalledOnce();
  mocks.menu[1].click(); expect(quit).toHaveBeenCalledOnce();
  background.dispose(); expect(mocks.tray.destroy).toHaveBeenCalledOnce();
});
