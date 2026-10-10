import { lstatSync } from "node:fs";
import path from "node:path";

interface CommandLine { hasSwitch(name: string): boolean; appendSwitch(name: string, value: string): void; }

/** Prepare the native Secret Service before Electron initializes safeStorage. Never select basic_text. */
export function configureMembershipKeyring(commandLine: CommandLine, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "linux" || commandLine.hasSwitch("password-store") || !process.getuid) return;
  const uid = process.getuid();
  const runtime = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  try {
    const directory = lstatSync(runtime), bus = lstatSync(path.join(runtime, "bus"));
    if (!directory.isDirectory() || directory.uid !== uid || directory.mode & 0o077 || !bus.isSocket() || bus.uid !== uid) return;
    if (!env.DBUS_SESSION_BUS_ADDRESS || env.DBUS_SESSION_BUS_ADDRESS === "disabled:") {
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${path.join(runtime, "bus")}`;
    }
    // Preserve an identified desktop's existing backend, such as KDE's KWallet.
    if (!env.XDG_CURRENT_DESKTOP) commandLine.appendSwitch("password-store", "gnome-libsecret");
  } catch { /* No private desktop bus: safeStorage retains its normal fail-closed behavior. */ }
}
