import path from "node:path";
import { ipcMain } from "electron";
import type { AutomationStatus } from "../shared/automation.js";
import { AutomationRuntime } from "./automation-runtime.js";
import { AutomationScheduler } from "./automation-scheduler.js";
import { migrateCleanupSchedules } from "./automation-cleanup-migration.js";
import type { QianchuanVideoLibrarySchedule } from "./qianchuan-video-library-schedule.js";

/** Trusted desktop boundary; the scheduler never acquires production authority itself. */
export async function createAutomationDesktop(input: {
  root: string;
  legacySchedule?: QianchuanVideoLibrarySchedule;
  runtime: Omit<ConstructorParameters<typeof AutomationRuntime>[1], "task">;
  authorize(): Promise<void>;
  busy(): boolean;
  trusted(event: Electron.IpcMainInvokeEvent): void;
  changed(status: AutomationStatus): void;
}): Promise<AutomationScheduler> {
  const root = path.join(input.root, "automation");
  const runtime: AutomationRuntime = new AutomationRuntime(root, { ...input.runtime, task: id => scheduler.task(id) });
  const scheduler: AutomationScheduler = new AutomationScheduler(root, {
    prepare: async (request, id) => { await input.authorize(); return runtime.prepare(request, id); },
    configure: task => runtime.configure(task),
    configurationIssue: task => runtime.configurationIssue(task),
    execute: async (task, signal) => { await input.authorize(); signal.throwIfAborted(); return runtime.execute(task, signal); },
    busy: input.busy,
    changed: () => input.changed(scheduler.snapshot()),
  });
  await scheduler.load();
  if (input.legacySchedule) {
    try { await migrateCleanupSchedules(scheduler, input.legacySchedule, task => runtime.verifyCleanupMigration(task)); }
    catch { scheduler.blockCleanupMigration(); input.legacySchedule.useAutomationTask(() => undefined); }
  }
  await scheduler.refreshConfiguration();
  ipcMain.handle("automation.get", async event => { input.trusted(event); await scheduler.refreshConfiguration(); return scheduler.snapshot(); });
  ipcMain.handle("automation.create", (event, request: unknown) => { input.trusted(event); return scheduler.create(request); });
  ipcMain.handle("automation.configure", async (event, request: unknown) => {
    input.trusted(event); await input.authorize(); await scheduler.configure(request);
    await input.legacySchedule?.initializeAutomaticLaunch(); return scheduler.snapshot();
  });
  ipcMain.handle("automation.remove", async (event, id: string) => {
    input.trusted(event); await scheduler.remove(id); await input.legacySchedule?.initializeAutomaticLaunch(); return scheduler.snapshot();
  });
  return scheduler;
}
