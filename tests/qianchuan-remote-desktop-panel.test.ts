import { expect, it, vi } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import { desktopEnvironment, XfceDesktopPanel } from "../src/main/qianchuan-remote-desktop-panel";

vi.mock("node:child_process", async () => ({ ...await vi.importActual<typeof childProcess>("node:child_process"), execFile: vi.fn() }));
vi.mock("node:fs/promises", async () => ({ ...await vi.importActual<typeof fs>("node:fs/promises"), lstat: vi.fn(), readFile: vi.fn() }));

it("accepts XFCE launcher's screen-zero DISPLAY spelling without accepting another display", async () => {
  let panelDisplay = ":99";
  vi.mocked(childProcess.execFile).mockImplementation(((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
    callback(null, "4321"); return {};
  }) as unknown as typeof childProcess.execFile);
  vi.mocked(fs.lstat).mockResolvedValue({ uid: process.getuid?.() } as Stats);
  vi.mocked(fs.readFile).mockImplementation((async (file: string) => file.endsWith("/cmdline") ? "xfce4-panel\0" : Buffer.from(`DISPLAY=${panelDisplay}\0DBUS_SESSION_BUS_ADDRESS=unix:path=/real-session\0`)) as typeof fs.readFile);
  try {
    expect((await desktopEnvironment(":99.0")).DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/real-session");
    panelDisplay = ":99.0";
    expect((await desktopEnvironment(":99")).DISPLAY).toBe(":99");
    await expect(desktopEnvironment(":98")).rejects.toThrow("unavailable");
    await expect(desktopEnvironment(":99.1")).rejects.toThrow("unavailable");
  } finally { vi.restoreAllMocks(); }
});

function fixture() {
  const values = new Map<string, string>([["/panels", "Value is an array with 2 items:\n\n1\n2"], ["/panels/panel-1/plugin-ids", "1\n2"], ["/panels/panel-2/plugin-ids", "23\n24\n30"], ["/plugins/plugin-23", "launcher"], ["/plugins/plugin-24", "launcher"], ["/plugins/plugin-30", "separator"], ["/plugins/plugin-23/items", "Value is an array with 1 items:\n\njianji-account-123.desktop"], ["/plugins/plugin-24/items", "Value is an array with 1 items:\n\njianji-account-456.desktop"]]);
  const calls: { file: string; args: string[] }[] = [];
  const run = vi.fn(async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (file.endsWith("xfce4-panel")) return "";
    if (args.includes("-l")) return [...values.keys()].join("\n");
    const prop = args[args.indexOf("-p") + 1];
    if (!args.includes("-s")) { if (!values.has(prop)) throw new Error("missing"); return values.get(prop)!; }
    const entries = args.flatMap((v, i) => v === "-s" ? [args[i + 1]] : []); values.set(prop, entries.join("\n")); return "";
  });
  const start = vi.fn(async () => {});
  const panel = new XfceDesktopPanel(async () => ({ DISPLAY: ":99", DBUS_SESSION_BUS_ADDRESS: "unix:path=/real-session" }), run, start);
  return { values, calls, run, start, panel };
}

it("appends a third account around foreign plugins and leaves the top panel intact", async () => {
  const f = fixture(), install = vi.fn(async () => {});
  await f.panel.register("789", install, [23, 24]);
  expect(install).toHaveBeenCalledWith(31);
  expect(f.values.get("/panels/panel-2/plugin-ids")).toBe("23\n24\n30\n31");
  expect(f.values.get("/panels/panel-1/plugin-ids")).toBe("1\n2");
  expect(f.values.get("/plugins/plugin-30")).toBe("separator");
  const quit = f.calls.findIndex(c => c.args.includes("--quit")), change = f.calls.findIndex(c => c.args.includes("/panels/panel-2/plugin-ids") && c.args.includes("-s"));
  expect(quit).toBeGreaterThan(-1); expect(change).toBeGreaterThan(quit); expect(f.start).toHaveBeenCalledOnce();
  await f.panel.register("789", install); expect(f.start).toHaveBeenCalledOnce();
});

it("adopts an existing exact launcher without restarting the panel, and never writes after failed file ownership checks", async () => {
  const f = fixture(), install = vi.fn(async () => {});
  await f.panel.register("123", install); expect(install).toHaveBeenCalledWith(23); expect(f.start).not.toHaveBeenCalled();
  await expect(f.panel.register("789", async () => { throw new Error("foreign"); })).rejects.toThrow();
  expect(f.calls.some(c => c.args.includes("--quit"))).toBe(false);
});

it("creates a dedicated dock instead of changing an unrelated panel and migrates only the old invalid color type", async () => {
  const f = fixture();
  f.values.set("/plugins/plugin-23/items", "foreign.desktop"); f.values.set("/plugins/plugin-24/items", "another.desktop");
  await f.panel.register("789", async () => {});
  expect(f.values.get("/panels/panel-2/plugin-ids")).toBe("23\n24\n30");
  expect(f.values.get("/panels/panel-3/plugin-ids")).toBe("31");
  expect(f.values.get("/panels/panel-3/nrows")).toBe("1");
  const old = fixture(); old.values.set("/panels/panel-2/background-rgba", "rgba(17,17,17,1)");
  await old.panel.register("123", async () => {});
  expect(old.values.get("/panels/panel-2/background-rgba")).toBe([17 / 255, 17 / 255, 17 / 255, 1].join("\n"));
  expect(old.start).not.toHaveBeenCalled();
});

it("focuses only an exact canonical profile and returns missing without launching Chrome", async () => {
  const calls: string[][] = [], profile = "/home/user/state/browsers/account-browsers/123";
  const run = async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file.endsWith("wmctrl") && args[0] === "-l") return "0x001 0 user other\n0x002 0 user target";
    if (file.endsWith("xprop")) return `WM_CLASS(STRING) = "google-chrome (${args[1] === "0x001" ? profile + "4" : profile})", "Google-chrome"`;
    return "";
  };
  const panel = new XfceDesktopPanel(async () => ({}), run);
  expect(await panel.focus(profile)).toBe(true); expect(calls.at(-1)).toEqual(["/usr/bin/wmctrl", "-ia", "0x002"]);
  expect(await panel.focus(profile + "9")).toBe(false);
});
