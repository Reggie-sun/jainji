import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { MembershipSession } from "./membership-session.js";

// Everything else is protected, including future handlers. Recovery must remain available.
const RECOVERY = new Set([
  "app.state", "agent.cancel", "connection.chatgpt.cancel", "export.cancel", "export.cancelAll",
  "batchProduction.cancel", "batchProduction.cancelJob", "batchProduction.details", "batchProduction.projects",
  "coverReview.cancel", "coverReview.viewed", "artifact.open", "artifact.reveal", "export.appendPrefill",
  "project.save", "project.workspaceDraft", "project.productPriceDraft", "douyinUpload.stop",
  "douyinUpload.discard", "douyinUpload.closeBatch", "douyinUpload.confirm", "douyinUpload.resolvePlanMaterialDeletion",
  "videoLibrarySchedule.get", "feedback.history", "feedback.submit", "feedback.open", "feedback.repository", "feedback.screenshot",
  "membership.status", "membership.refresh", "membership.login", "membership.logout", "membership.openPricing", "membership.openAdmin",
]);
export function requiresMembership(channel: string): boolean { return !RECOVERY.has(channel); }

/** Install before registering any application IPC; preserve each handler's own trust/contract checks. */
export function installMembershipIpc(ipc: Pick<IpcMain, "handle">, session: MembershipSession, trusted: (event: IpcMainInvokeEvent) => void): void {
  const handle = ipc.handle.bind(ipc);
  ipc.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    trusted(event);
    if (requiresMembership(channel)) await session.assertAllowed();
    return listener(event, ...args);
  });
}
