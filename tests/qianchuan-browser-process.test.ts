import { spawn } from "node:child_process";
import { expect, it, vi } from "vitest";
import { shutdownAccountChrome } from "../src/main/qianchuan-browser-process";

const browser = { profile: "/private/original", profileDirectory: "Profile 9", windowClass: "original", processId: 42, startedAt: "1234" };
it("does not signal a different process behind stale discovery metadata", async () => {
  const child = spawn("/usr/bin/sleep", ["30"], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const stale = { ...browser, processId: child.pid! };
  try {
    await expect(shutdownAccountChrome(stale, async () => [stale], { timeoutMs: 5 })).rejects.toThrow("身份");
    expect(child.exitCode).toBeNull(); expect(child.signalCode).toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once("close", resolve)); child.kill("SIGTERM"); await closed;
    }
  }
});
it("requests normal exit exactly once for the reverified process, without requiring CDP", async () => {
  const browsers = vi.fn().mockResolvedValueOnce([browser]).mockResolvedValueOnce([browser]).mockResolvedValue([]);
  const signal = vi.fn(); await shutdownAccountChrome(browser, browsers, { signal });
  expect(signal).toHaveBeenCalledTimes(1); expect(signal).toHaveBeenCalledWith(browser);
});
it.each([
  [], [browser, { ...browser, processId: 43 }], [{ ...browser, processId: 43 }], [{ ...browser, startedAt: "9999" }], [{ ...browser, profileDirectory: "Profile 10" }], [{ ...browser, windowClass: "other" }],
].map(matches => [matches]))("does not signal an absent, duplicate or replaced browser", async matches => {
  const signal = vi.fn(); await expect(shutdownAccountChrome(browser, async () => matches, { signal })).rejects.toThrow("身份"); expect(signal).not.toHaveBeenCalled();
});
it("stops after timeout or replacement without another signal or force kill", async () => {
  const signal = vi.fn();
  await expect(shutdownAccountChrome(browser, async () => [browser], { signal, timeoutMs: 5 })).rejects.toThrow("未正常退出");
  expect(signal).toHaveBeenCalledTimes(1); expect(signal).toHaveBeenCalledWith(browser); signal.mockClear();
  const browsers = vi.fn().mockResolvedValueOnce([browser]).mockResolvedValue([{ ...browser, startedAt: "9999" }]);
  await expect(shutdownAccountChrome(browser, browsers, { signal })).rejects.toThrow("身份"); expect(signal).toHaveBeenCalledTimes(1);
});
