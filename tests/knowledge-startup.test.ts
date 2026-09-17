import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { RecentProjects } from "../src/main/recent-projects";

const electron = vi.hoisted(() => ({ directory: "", events: new Map<string, (event: { preventDefault(): void }) => void>(), exit: vi.fn() }));
vi.mock("electron", () => ({
  app: { requestSingleInstanceLock: () => true, whenReady: async () => {}, getPath: () => electron.directory,
    on: (name: string, callback: (event: { preventDefault(): void }) => void) => { electron.events.set(name, callback); },
    quit: () => electron.events.get("before-quit")?.({ preventDefault() {} }), exit: electron.exit },
  protocol: { registerSchemesAsPrivileged() {} }, BrowserWindow: class {}, dialog: {}, ipcMain: {}, nativeImage: {}, shell: {},
}));

it("releases an acquired knowledge owner when controlled bootstrap fails before other services exist", async () => {
  electron.directory = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-startup-"));
  const fail = vi.spyOn(RecentProjects.prototype, "initialize").mockRejectedValue(new Error("controlled startup failure"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await import("../src/main/index");
    await vi.waitFor(() => expect(electron.exit).toHaveBeenCalledWith(0));
    const reopened = await SourceStickerKnowledgeStore.open(electron.directory); await reopened.close();
  } finally { fail.mockRestore(); log.mockRestore(); await rm(electron.directory, { recursive: true, force: true }); }
});
