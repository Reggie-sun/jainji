import { execFile, spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface DesktopPanel {
  register(advertiserId: string, install: (pluginId: number) => Promise<void>, knownPluginIds?: readonly number[]): Promise<void>;
  focus(profile: string): Promise<boolean>;
}
type Command = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
const command: Command = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env, timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(new Error("Remote desktop command failed")) : resolve(stdout.trim()));
});

/** SSH's user bus can differ from XFCE's bus: use only the owned display session. */
export async function desktopEnvironment(display = process.env.DISPLAY ?? ":99"): Promise<NodeJS.ProcessEnv> {
  const pids = await command("/usr/bin/pgrep", ["-u", String(process.getuid?.()), "-x", "xfce4-panel"], process.env);
  const matches: NodeJS.ProcessEnv[] = [];
  for (const pid of pids.split(/\s+/)) {
    if (!/^[1-9][0-9]*$/.test(pid)) throw new Error("Invalid desktop process");
    const dir = `/proc/${pid}`;
    if ((await lstat(dir)).uid !== process.getuid?.()) continue;
    const args = (await readFile(`${dir}/cmdline`, "utf8")).split("\0").filter(Boolean);
    if (args.length !== 1 || path.basename(args[0]) !== "xfce4-panel") continue;
    const raw = await readFile(`${dir}/environ`);
    if (raw.length > 64 * 1024) throw new Error("Desktop environment too large");
    const values = Object.fromEntries(raw.toString().split("\0").map(v => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]));
    // GTK launchers add screen zero; :99 and :99.0 identify the same session.
    if (values.DISPLAY?.replace(/\.0$/, "") !== display.replace(/\.0$/, "") || !values.DBUS_SESSION_BUS_ADDRESS?.startsWith("unix:")) continue;
    const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display };
    env.JIANJI_XFCE_PANEL_PID = pid;
    for (const key of ["DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY", "SESSION_MANAGER", "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP"]) if (values[key]) env[key] = values[key];
    matches.push(env);
  }
  if (matches.length !== 1) throw new Error("Remote desktop session unavailable or ambiguous");
  return matches[0];
}

function numbers(value: string, allowEmpty = false): number[] {
  const lines = value.split("\n").map(v => v.trim()).filter(Boolean);
  const entries = lines[0]?.includes("is an array") ? lines.slice(1) : lines;
  if (!allowEmpty && !entries.length || entries.some(v => !/^[1-9][0-9]{0,4}$/.test(v))) throw new Error("Invalid panel array");
  const ids = entries.map(Number);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate panel entries");
  return ids;
}

export class XfceDesktopPanel implements DesktopPanel {
  constructor(private readonly environment = desktopEnvironment, private readonly run: Command = command,
    private readonly start = (env: NodeJS.ProcessEnv) => new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/xfce4-panel", [], { detached: true, stdio: "ignore", env });
      child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
    })) {}
  async register(id: string, install: (pluginId: number) => Promise<void>, knownPluginIds: readonly number[] = []): Promise<void> {
    const env = await this.environment();
    const query = (args: string[]) => this.run("/usr/bin/xfconf-query", ["-c", "xfce4-panel", ...args], env);
    const get = (property: string) => query(["-p", property]);
    const props = new Set((await query(["-l"])).split("\n"));
    const panels = numbers(await get("/panels"));
    const name = `jianji-account-${id}.desktop`;
    const allPlugins = [...new Set([...props].map(v => /^\/plugins\/plugin-([0-9]+)(?:\/|$)/.exec(v)?.[1]).filter((v): v is string => !!v).map(Number))];
    const existing: number[] = [];
    for (const pluginId of allPlugins) {
      if (props.has(`/plugins/plugin-${pluginId}/items`) && await get(`/plugins/plugin-${pluginId}`) === "launcher") {
        const items = await get(`/plugins/plugin-${pluginId}/items`);
        const lines = items.split("\n").map(v => v.trim()).filter(v => v && !v.includes("is an array"));
        if (lines.includes(name)) {
          if (lines.length !== 1) throw new Error("Ambiguous account launcher");
          existing.push(pluginId);
        }
      }
    }
    if (existing.length > 1) throw new Error("Duplicate account launcher");
    const contents = new Map<number, number[]>(), docks: number[] = [];
    for (const panel of panels) {
      const ids = props.has(`/panels/panel-${panel}/plugin-ids`) ? numbers(await get(`/panels/panel-${panel}/plugin-ids`), true) : [];
      contents.set(panel, ids);
      if (ids.some(value => [...knownPluginIds, ...existing].includes(value)) || props.has(`/panels/panel-${panel}/jianji-account-dock`) && await get(`/panels/panel-${panel}/jianji-account-dock`) === "true") docks.push(panel);
    }
    if (docks.length > 1 || docks.includes(1)) throw new Error("Account dock location ambiguous");
    const panelId = docks[0] ?? (contents.has(2) && !contents.get(2)!.length ? 2 : Math.max(...panels) + 1);
    const pluginIds = contents.get(panelId) ?? [];
    if (existing.length && !pluginIds.includes(existing[0])) throw new Error("Account launcher belongs to another panel");
    const pluginId = existing[0] ?? Math.max(0, ...allPlugins, ...pluginIds) + 1;
    if (pluginId > 99999) throw new Error("Panel capacity exceeded");
    await install(pluginId); // Ownership and file checks precede panel mutation.
    const set = async (property: string, type: string, values: (string | number | boolean)[], array = false) => {
      const args = ["-p", property, ...(props.has(property) ? [] : ["-n"]), ...(array ? ["-a"] : [])];
      for (const value of values) args.push("-t", type, "-s", String(value));
      await query(args); props.add(property);
    };
    if (!props.has(`/panels/panel-${panelId}/jianji-account-dock`)) await set(`/panels/panel-${panelId}/jianji-account-dock`, "bool", [true]);
    const color = `/panels/panel-${panelId}/background-rgba`;
    // Migrate the exact old helper's invalid string type, retaining its color.
    if (props.has(color) && await get(color) === "rgba(17,17,17,1)") {
      await query(["-p", color, "-r"]); props.delete(color);
      await set(color, "double", [17 / 255, 17 / 255, 17 / 255, 1], true);
    }
    if (existing.length) return;
    // XFCE ignores live plugin-array additions and --save would overwrite them.
    await this.run("/usr/bin/xfce4-panel", ["--quit"], env);
    if (env.JIANJI_XFCE_PANEL_PID) {
      const deadline = Date.now() + 5000;
      for (;;) {
        try { await lstat(`/proc/${env.JIANJI_XFCE_PANEL_PID}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
        if (Date.now() >= deadline) throw new Error("Desktop panel did not stop");
        await delay(50);
      }
    }
    try {
      await set(`/plugins/plugin-${pluginId}`, "string", ["launcher"]);
      await set(`/plugins/plugin-${pluginId}/items`, "string", [name], true);
      if (!panels.includes(panelId)) await set("/panels", "int", [...panels, panelId], true);
      for (const [key, type, value] of [["position", "string", "p=10;x=0;y=0"], ["position-locked", "bool", true], ["autohide-behavior", "uint", 0], ["size", "uint", 80], ["icon-size", "uint", 64], ["length", "double", 1], ["mode", "uint", 0], ["nrows", "uint", 1]] as const) {
        // Existing dock layout is user-owned; only a new dock gets defaults.
        if (!props.has(`/panels/panel-${panelId}/${key}`)) await set(`/panels/panel-${panelId}/${key}`, type, [value]);
      }
      if (!props.has(color)) { await set(color, "double", [17 / 255, 17 / 255, 17 / 255, 1], true); await set(`/panels/panel-${panelId}/background-style`, "uint", [1]); }
      await set(`/panels/panel-${panelId}/plugin-ids`, "int", [...pluginIds, pluginId], true);
    } finally { await this.start(env); }
  }
  async focus(profile: string): Promise<boolean> {
    const env = await this.environment();
    const windows = await this.run("/usr/bin/wmctrl", ["-l"], env);
    for (const line of windows.split("\n").filter(Boolean)) {
      const id = line.split(/\s+/)[0];
      if (!/^0x[0-9a-fA-F]+$/.test(id)) throw new Error("Invalid window metadata");
      const value = await this.run("/usr/bin/xprop", ["-id", id, "WM_CLASS"], env);
      if (value === `WM_CLASS(STRING) = "google-chrome (${profile})", "Google-chrome"`) {
        await this.run("/usr/bin/wmctrl", ["-ia", id], env); return true;
      }
    }
    return false;
  }
}
