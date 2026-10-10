import path from "node:path";
import { ipcMain } from "electron";
import type { AutomationStatus } from "../shared/automation.js";
import { AutomationRuntime } from "./automation-runtime.js";
import { AutomationScheduler } from "./automation-scheduler.js";

/** Trusted desktop boundary; the scheduler never acquires production authority itself. */
export async function createAutomationDesktop(input: {
  root: string;
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
    execute: async (task, signal) => { await input.authorize(); signal.throwIfAborted(); return runtime.execute(task, signal); },
    busy: input.busy,
    changed: () => input.changed(scheduler.snapshot()),
  });
  await scheduler.load();
  ipcMain.handle("automation.get", event => { input.trusted(event); return scheduler.snapshot(); });
  ipcMain.handle("automation.create", (event, request: unknown) => { input.trusted(event); return scheduler.create(request); });
  ipcMain.handle("automation.configure", async (event, request: unknown) => {
    input.trusted(event); await input.authorize(); return scheduler.configure(request);
  });
  ipcMain.handle("automation.remove", (event, id: string) => { input.trusted(event); return scheduler.remove(id); });
  return scheduler;
}
