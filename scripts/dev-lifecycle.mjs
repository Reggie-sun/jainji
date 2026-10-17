import { createHash } from "node:crypto";

/** Keep a healthy owner across UI rebuilds, but replace stale runtime code only after cleanup. */
export async function refreshDevelopmentEgressHost(current, bytes, createHost) {
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  if (current?.sourceSha256 === sourceSha256) return current;
  if (current) await current.host.dispose();
  return { sourceSha256, host: await createHost() };
}

/** Ask the app to save/close through its normal lifecycle. Never force-kill it. */
export function requestDevelopmentQuit(child, { restart = false, showWindow = false } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.connected) throw new Error("Electron parent IPC unavailable; close the application normally before restarting.");
  child.send({ type: restart ? "jianji-dev-restart" : "jianji-dev-quit", ...(showWindow ? { showWindow: true } : {}) }, error => {
    if (error) console.error("[dev] Could not request a normal quit; close Electron manually.");
  });
}

/** Electron can exit while an inherited IPC pipe remains open. Release that
 * exited child's channel so no invisible owner survives a rebuild or close. */
export function waitForDevelopmentExit(child) {
  const release = () => { if (child.connected) child.disconnect(); };
  if (child.exitCode !== null || child.signalCode !== null) {
    release();
    return Promise.resolve(child.exitCode ?? 1);
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => { release(); resolve(code ?? 1); });
  });
}
/** A disconnected parent channel requires manual close, not forced termination. */
export async function waitForDevelopmentQuit(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  try { requestDevelopmentQuit(child, options); }
  catch (error) { console.error(`[dev] ${error.message}`); }
  await exited;
}
