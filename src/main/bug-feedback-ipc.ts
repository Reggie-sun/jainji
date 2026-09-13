import { app, ipcMain, shell } from "electron";
import { BugFeedbackService, FeedbackError } from "./bug-feedback.js";
import { FEEDBACK_REPOSITORY } from "../shared/bug-feedback.js";

export function registerBugFeedbackHandlers(assertTrustedSender: (event: Electron.IpcMainInvokeEvent) => void): void {
  // Chromium net.fetch may replay a POST after an empty response. Node fetch leaves it uncertain.
  const service = new BugFeedbackService(app.getPath("userData"), { version: app.getVersion(), platform: process.platform });
  const handle = (channel: string, action: (input: unknown) => Promise<unknown>) => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertTrustedSender(event);
      try { return await action(input); }
      catch (error) {
        // Never return filesystem paths, HTTP payloads, Zod input or credential values over IPC.
        const message = error instanceof FeedbackError ? error.message : "问题反馈操作失败，请检查本地配置后重试。";
        throw new Error(message);
      }
    });
  };
  handle("feedback.status", () => service.status());
  handle("feedback.configure", (input) => service.saveToken(input));
  handle("feedback.submit", (input) => service.submit(input));
  handle("feedback.history", () => service.history());
  handle("feedback.resume", (input) => service.resume(input));
  handle("feedback.open", async (input) => { await shell.openExternal(await service.issueUrl(input)); return true; });
  handle("feedback.repository", async () => { await shell.openExternal(`https://github.com/${FEEDBACK_REPOSITORY}/issues`); return true; });
  handle("feedback.screenshot", async (input) => { shell.showItemInFolder(await service.screenshotPath(input)); return true; });
}
