import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SourceStickerKnowledgeStore } from "../src/main/source-sticker-knowledge-store";
import { RecentProjects } from "../src/main/recent-projects";

const electron = vi.hoisted(() => ({
  directory: "", events: new Map<string, (event: { preventDefault(): void }) => void>(), exit: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
}));
vi.mock("electron", () => ({
  app: { requestSingleInstanceLock: () => true, whenReady: async () => {}, getPath: () => electron.directory,
    on: (name: string, callback: (event: { preventDefault(): void }) => void) => { electron.events.set(name, callback); },
    quit: () => electron.events.get("before-quit")?.({ preventDefault() {} }), exit: electron.exit },
  protocol: { registerSchemesAsPrivileged() {} }, BrowserWindow: class {}, dialog: { showMessageBox: electron.showMessageBox }, ipcMain: {}, nativeImage: {}, shell: {},
}));

it("offers explicit safe recovery and releases the fresh owner when later bootstrap fails", async () => {
  electron.directory = await mkdtemp(path.join(tmpdir(), "jianji-knowledge-startup-"));
  const original = await SourceStickerKnowledgeStore.open(electron.directory); await original.close();
  await writeFile(path.join(original.directory, "recovery-sentinel"), "preserve me");
  await mkdir(path.join(original.directory, "owner.lock"));
  const fail = vi.spyOn(RecentProjects.prototype, "initialize").mockRejectedValue(new Error("controlled startup failure"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await import("../src/main/index");
    await vi.waitFor(() => expect(electron.exit).toHaveBeenCalledWith(0));
    expect(electron.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: "源贴纸知识库需要恢复",
      buttons: ["安全重建", "暂不恢复"],
    }));
    const quarantine = (await readdir(electron.directory)).find(name => name === "source-sticker-knowledge.recovery");
    expect(quarantine).toBe("source-sticker-knowledge.recovery");
    expect(await readdir(path.join(electron.directory, quarantine!))).toContain("recovery-sentinel");
    const reopened = await SourceStickerKnowledgeStore.open(electron.directory); await reopened.close();
  } finally { fail.mockRestore(); log.mockRestore(); await rm(electron.directory, { recursive: true, force: true }); }
});
