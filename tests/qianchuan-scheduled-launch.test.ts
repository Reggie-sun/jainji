import { expect, it } from "vitest";
import { QianchuanScheduledLaunch, scheduledClearTime } from "../src/main/qianchuan-scheduled-launch";

it("does not let an independent window overwrite the shared OS timer", async () => {
  const launch = new QianchuanScheduledLaunch({ packaged: false, executable: process.execPath, root: "/unused", primary: false });
  expect(launch.snapshot()).toMatchObject({ supported: false, enabled: false });
  await launch.configure({ confirmation: "DELETE_ALL_VIDEOS", enabled: true, time: "01:30", accounts: [] });
  expect(launch.snapshot()).toMatchObject({ supported: false, enabled: false });
});

it("keeps system launch support and scheduled argument parsing on the primary", () => {
  const launch = new QianchuanScheduledLaunch({ packaged: false, executable: process.execPath, root: "/unused", primary: true });
  expect(launch.snapshot().supported).toBe(process.platform === "linux");
  expect(scheduledClearTime(["--jianji-scheduled-clear=01:30"])).toBe("01:30");
});
