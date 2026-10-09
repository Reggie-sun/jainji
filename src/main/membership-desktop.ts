import { app, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MembershipConfigSchema, type MembershipConfig, type MembershipStatus } from "../shared/membership.js";
import { MembershipSession, fetchMembership } from "./membership-session.js";
import { membershipStorage } from "./membership-storage.js";
import { loginMembership } from "./membership-oauth.js";
import { installMembershipIpc } from "./membership-ipc.js";

export async function createMembershipDesktop(input: {
  root: string; trusted(event: IpcMainInvokeEvent): void;
  changed(status: MembershipStatus): void; lostAccess(): Promise<void>;
}): Promise<MembershipSession> {
  let config: MembershipConfig | undefined;
  let localDevelopment = false;
  const file = (!app.isPackaged && process.env.JIANJI_MEMBERSHIP_CONFIG) || (app.isPackaged ? path.join(process.resourcesPath, "membership.json") : path.join(app.getAppPath(), "resources", "membership.json"));
  try { config = MembershipConfigSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    // Only an unconfigured source checkout keeps the existing local workflow.
    // Explicit configuration, malformed files, and packaged builds fail closed.
    localDevelopment = app.isPackaged === false && !process.env.JIANJI_MEMBERSHIP_CONFIG
      && (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  const session = new MembershipSession(config, {
    localDevelopment,
    storage: membershipStorage(input.root, config, safeStorage),
    check: token => fetchMembership(config!, token),
    login: signal => loginMembership(config!, url => shell.openExternal(url), signal),
    changed: input.changed, lostAccess: input.lostAccess,
  });
  installMembershipIpc(ipcMain, session, input.trusted);
  ipcMain.handle("membership.status", () => session.snapshot());
  ipcMain.handle("membership.refresh", () => session.refresh());
  ipcMain.handle("membership.login", () => session.login());
  ipcMain.handle("membership.logout", () => session.logout());
  ipcMain.handle("membership.openPricing", async () => {
    if (!config) throw new Error("账号服务尚未配置。");
    await shell.openExternal(`${config.issuer}/select-plan/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.pricingName)}`);
  });
  ipcMain.handle("membership.openAdmin", async () => {
    const status = await session.refresh();
    if (!config || !status.user?.isAdmin || status.reason === "forbidden" || status.reason === "session-expired" || status.state === "unavailable") throw new Error("需要管理员账号。");
    await shell.openExternal(`${config.issuer}/users`);
  });
  // Restore may need network; keep startup responsive and expose checking through the gate.
  void session.restore().then(() => session.startHeartbeat()).catch(() => session.startHeartbeat());
  return session;
}
