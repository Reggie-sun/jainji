/** Ask the app to save/close through its normal lifecycle. Never force-kill it. */
export function requestDevelopmentQuit(child, { restart = false } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.connected) throw new Error("Electron parent IPC unavailable; close the application normally before restarting.");
  child.send({ type: restart ? "jianji-dev-restart" : "jianji-dev-quit" }, error => {
    if (error) console.error("[dev] Could not request a normal quit; close Electron manually.");
  });
}
/** A disconnected parent channel requires manual close, not forced termination. */
export async function waitForDevelopmentQuit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  try { requestDevelopmentQuit(child); }
  catch (error) { console.error(`[dev] ${error.message}`); }
  await exited;
}
